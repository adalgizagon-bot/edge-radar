/* Edge Radar Crypto Cloud Collector — read-only 1 minute snapshots; no trades, no wallets.
 * Cloudflare Workers Cron + D1. Missing checkpoints remain missing, never backfilled.
 * Source data: GeckoTerminal public API + DEX Screener token batch API.
 */
const SETTINGS=Object.freeze({
  gecko:'https://api.geckoterminal.com/api/v2/networks/solana/',
  dex:'https://api.dexscreener.com/tokens/v1/solana/',
  maxMintsPerScan:90,maxNewSignals:4,maxActive:230,maxCandidates:35,
  quoteTimeout:8500,reentryMs:60*60*1000,
  horizons:[['m1',60_000,90_000],['m5',300_000,120_000],['m15',900_000,180_000],['m30',1_800_000,240_000]],
});
const validMint=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const value=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const clean=(s,n=80)=>String(s??'').slice(0,n);
const localDay=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const pumpDex=s=>/(pump.?swap|pump.?fun|pumpfun)/i.test(String(s||''));
function parsePools(payload,source){
  const inc=new Map((Array.isArray(payload?.included)?payload.included:[]).filter(x=>x?.id).map(x=>[x.id,x]));
  const out=[];
  for(const row of Array.isArray(payload?.data)?payload.data:[]){
    const attr=row?.attributes||{},rid=row?.relationships?.dex?.data?.id||'';
    const dex=inc.get(rid)?.attributes?.name||rid;
    if(!pumpDex(dex))continue;
    const id=row?.relationships?.base_token?.data?.id||'';
    const token=inc.get(id),mint=token?.attributes?.address||id.replace(/^solana_/, '');
    if(!validMint(mint))continue;
    out.push({mint,name:clean(token?.attributes?.name||attr.name?.split('/')?.[0]),symbol:clean(token?.attributes?.symbol,25),
      pool:attr.address||null,source,liquidity:value(attr.reserve_in_usd),volume:value(attr.volume_usd?.m5),
      change:value(attr.price_change_percentage?.m5),buys:value(attr.transactions?.m5?.buys),sells:value(attr.transactions?.m5?.sells),
      price:value(attr.base_token_price_usd),dex});
  }
  return out;
}
function selectDexPairs(pairs){
  const out=new Map();
  for(const p of Array.isArray(pairs)?pairs:[]){
    if(p?.chainId!=='solana'||!validMint(p.baseToken?.address)||!pumpDex(p.dexId))continue;
    const mint=p.baseToken.address,liq=value(p.liquidity?.usd);
    if(!out.has(mint)||(liq??0)>(value(out.get(mint).liquidity?.usd)??0))out.set(mint,p);
  }
  return out;
}
function quality(p,now=Date.now()){
  if(!p)return {valid:false,score:0,stage:'waiting'};
  const l=value(p.liquidity?.usd),v=value(p.volume?.m5),c=value(p.priceChange?.m5);
  const b=value(p.txns?.m5?.buys),s=value(p.txns?.m5?.sells),n=b===null||s===null?null:b+s;
  const ratio=b===null||s===null?null:b/(s||1);
  const poolAge=value(p.pairCreatedAt),ageMin=poolAge?Math.max(0,(now-poolAge)/60000):null;
  let score=0;
  if(l!==null)score+=l>=20000?21:l>=10000?18:l>=5000?14:l>=3000?8:0;
  if(v!==null)score+=v>=10000?20:v>=5000?17:v>=1500?13:v>=500?6:0;
  if(n!==null)score+=n>=50?18:n>=25?14:n>=15?10:n>=8?4:0;
  if(ratio!==null)score+=b>=8&&ratio>=1.5?21:b>=8&&ratio>=1.2?16:b>=5&&ratio>=1?7:0;
  if(c!==null)score+=c>=3&&c<=35?16:c>0&&c<60?9:0;
  if(ageMin!==null&&ageMin<240)score+=4;
  const meets=l!==null&&l>=5000&&v!==null&&v>=1500&&n!==null&&n>=18&&b>=8&&s!==null&&ratio>=1.25&&c!==null&&c>=2&&c<=45;
  const extreme=(l!==null&&l<3000)||(c!==null&&(c>100||c<-25));
  return {valid:true,score,stage:meets&&score>=67&&!extreme?'priority':extreme?'risk':'watch',liquidity:l,volume:v,change:c,buys:b,sells:s};
}
function checkpointDecision(signal,horizon,at,price){
  const [key,after,grace]=horizon,target=signal.triggered_at+after;
  if(signal[key+'_status'])return null;
  if(at<target)return null;
  if(at<=target+grace&&price!==null&&price>0&&signal.entry_price>0){
    return {key,status:'measured',at,price,returnPct:(price/signal.entry_price-1)*100};
  }
  if(at>target+grace)return {key,status:'missing',at:null,price:null,returnPct:null};
  return null;
}
async function fetchJSON(url,fetcher=fetch){
  const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),SETTINGS.quoteTimeout);
  try{const resp=await fetcher(url,{headers:{accept:'application/json', 'user-agent':'EdgeRadarCryptoCollector/1.0'},signal:ctl.signal});
    if(!resp.ok)throw new Error('HTTP '+resp.status+' em '+new URL(url).pathname);
    return await resp.json();
  }finally{clearTimeout(tm);}
}
async function recentSignals(db,at,limit=230){
 const r=await db.prepare("SELECT * FROM signals WHERE completed=0 AND triggered_at>? ORDER BY triggered_at DESC LIMIT ?")
  .bind(at-42*60_000,limit).all();
 return r.results||[];
}
async function recentMints(db,mints,at){
 if(!mints.length)return new Set();
 const query=`SELECT mint FROM signals WHERE triggered_at>? AND mint IN (${mints.map(()=>'?').join(',')}) GROUP BY mint`;
 const r=await db.prepare(query).bind(at-SETTINGS.reentryMs,...mints).all();
 return new Set((r.results||[]).map(x=>x.mint));
}
async function fetchData(fetcher){
 const urls=['new_pools?include=base_token,dex','trending_pools?include=base_token,dex&duration=5m'];
 const results=await Promise.allSettled(urls.map(url=>fetchJSON(SETTINGS.gecko+url,fetcher)));
 const pools=[],errors=[];
 for(let i=0;i<results.length;i++){
  if(results[i].status==='fulfilled')pools.push(...parsePools(results[i].value,i?'trending':'new'));
  else errors.push(String(results[i].reason?.message||results[i].reason).slice(0,120));
 }
 if(!pools.length && results.every(x=>x.status==='rejected'))throw new Error('GeckoTerminal indisponível: '+errors.join('; '));
 return {pools,errors};
}
function dedupePools(pools){
 const by=new Map();for(const p of pools){const o=by.get(p.mint);if(!o||(p.liquidity??0)>(o.liquidity??0))by.set(p.mint,p)}
 return [...by.values()].sort((a,b)=>(b.volume??0)-(a.volume??0));
}
async function fetchPrices(mints,fetcher){
 const out=[];
 for(let i=0;i<mints.length;i+=30){
  const rows=await fetchJSON(SETTINGS.dex+mints.slice(i,i+30).join(','),fetcher);
  if(!Array.isArray(rows))throw new Error('Formato inválido do DEX Screener');
  out.push(...rows);
 }
 return selectDexPairs(out);
}
async function makeCheckpoints(db,signal,now,price){
 let changed=0;
 for(const horizon of SETTINGS.horizons){
  const x=checkpointDecision(signal,horizon,now,price);
  if(!x)continue;
  // SQL columns are from the server's fixed literal horizon allowlist, never from requests.
  const q=`UPDATE signals SET ${x.key}_status=?,${x.key}_at=?,${x.key}_price=?,${x.key}_return=? WHERE id=? AND ${x.key}_status IS NULL`;
  await db.prepare(q).bind(x.status,x.at,x.price,x.returnPct,signal.id).run();
  signal[x.key+'_status']=x.status;changed++;
  if(x.key==='m5'&&x.status==='measured'){
   await db.prepare(`INSERT INTO daily_metrics (day,signals,measured5,positive5,sum5) VALUES (?,0,1,?,?)
   ON CONFLICT(day) DO UPDATE SET measured5=measured5+1,positive5=positive5+excluded.positive5,sum5=sum5+excluded.sum5`)
   .bind(localDay(signal.triggered_at),x.returnPct>0?1:0,x.returnPct).run();
  }
 }
 if(SETTINGS.horizons.every(h=>!!signal[h[0]+'_status'])){
   await db.prepare('UPDATE signals SET completed=1 WHERE id=?').bind(signal.id).run();
 }
 return changed;
}
async function collect(env,{clock=Date.now,fetcher=fetch}={}){
 const at=clock();if(!env?.DB)throw Error('D1 binding DB ausente');
 await env.DB.prepare(`UPDATE signals SET completed=1,
 m1_status=COALESCE(m1_status,'missing'),
 m5_status=COALESCE(m5_status,'missing'),
 m15_status=COALESCE(m15_status,'missing'),
 m30_status=COALESCE(m30_status,'missing')
 WHERE completed=0 AND triggered_at<?`).bind(at-42*60_000).run();
 const active=await recentSignals(env.DB,at,SETTINGS.maxActive);
 let pools=[],errors=[];
 try{({pools,errors}=await fetchData(fetcher));}catch(e){errors.push(String(e?.message||e));}
 const candidates=dedupePools(pools).slice(0,SETTINGS.maxCandidates);
 // Only reprice signals that have a checkpoint due or approaching; all overdue records
 // are still processed for missing checkpoints even without a quote.
 const due=active.filter(s=>SETTINGS.horizons.some(h=>!s[h[0]+'_status']&&at>=s.triggered_at+h[1]-90_000&&at<=s.triggered_at+h[1]+h[2]));
 const mints=[...new Set([...due.map(x=>x.mint),...candidates.map(x=>x.mint)])].slice(0,SETTINGS.maxMintsPerScan);
 let prices=new Map();
 if(mints.length){try{prices=await fetchPrices(mints,fetcher);}catch(e){errors.push('DEX Screener: '+String(e?.message||e));}}
 let checkpoints=0;
 for(const signal of active){
  const p=prices.get(signal.mint),price=value(p?.priceUsd);
  checkpoints+=await makeCheckpoints(env.DB,signal,at,price);
 }
 let inserted=0;
 const qualified=[];
 for(const c of candidates){
  const pair=prices.get(c.mint);if(!pair)continue;
  const pr=value(pair.priceUsd),q=quality(pair,at);
  if(pr!==null&&pr>0&&q.stage==='priority')qualified.push({c,pair,pr,q});
 }
 qualified.sort((a,b)=>b.q.score-a.q.score||b.q.volume-a.q.volume);
 const shortlist=qualified.slice(0,SETTINGS.maxNewSignals*3);
 const duplicates=await recentMints(env.DB,shortlist.map(x=>x.c.mint),at);
 for(const x of shortlist){
  if(inserted>=SETTINGS.maxNewSignals)break;
  if(duplicates.has(x.c.mint))continue;
  const {c,pr,q}=x,id=c.mint+':'+at;
  await env.DB.prepare(`INSERT OR IGNORE INTO signals
   (id,mint,name,symbol,triggered_at,entry_price,last_price,last_quote_at,score,liquidity,volume,change5,buys,sells,source,completed)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
   .bind(id,c.mint,c.name||x.pair.baseToken?.name||'',c.symbol||x.pair.baseToken?.symbol||'',at,pr,pr,at,q.score,q.liquidity,q.volume,q.change,q.buys,q.sells,'geckoterminal+dexscreener').run();
  await env.DB.prepare(`INSERT INTO daily_metrics (day,signals,measured5,positive5,sum5) VALUES (?,1,0,0,0)
   ON CONFLICT(day) DO UPDATE SET signals=signals+1`).bind(localDay(at)).run();
  duplicates.add(c.mint);inserted++;
 }
 const errorText=errors.join(' | ').slice(0,500);
 await env.DB.prepare(`INSERT INTO collector_state (name,last_run,last_ok,scanned,added,checkpoints,error)
 VALUES ('cloud',?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET
 last_run=excluded.last_run,last_ok=excluded.last_ok,scanned=excluded.scanned,added=excluded.added,checkpoints=excluded.checkpoints,error=excluded.error`)
 .bind(at,errors.length?0:1,mints.length,inserted,checkpoints,errorText).run();
 return {at,scanned:mints.length,added:inserted,checkpoints,errors};
}
const cors=(req,env)=>{
 const origin=req.headers.get('Origin')||'',allow=String(env.FRONTEND_ORIGIN||'https://edge-radar-gamma.vercel.app').replace(/\/$/,'');
 return origin===allow?{'access-control-allow-origin':allow,'vary':'Origin'}:{};
};
const json=(value,status,req,env)=>new Response(JSON.stringify(value),{status,headers:{...cors(req,env),'content-type':'application/json; charset=utf-8','cache-control':'public,max-age=15','x-content-type-options':'nosniff'}});
const finiteInt=(s,fallback,max)=>Math.min(max,Math.max(1,Number.isFinite(Number(s))?Math.trunc(Number(s)):fallback));
async function handle(request,env){
 if(request.method!=='GET'&&request.method!=='OPTIONS')return json({error:'Método não permitido'},405,request,env);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors(request,env),'access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'3600'}});
 if(!env?.DB)return json({error:'Coletor ainda sem banco D1 configurado'},503,request,env);
 const u=new URL(request.url),path=u.pathname;
 if(path==='/api/health'||path==='/api/status'){
  const r=await env.DB.prepare("SELECT * FROM collector_state WHERE name='cloud'").first();
  const fresh=!!r&&Date.now()-r.last_run<3*60_000;
  return json({online:fresh&&!!r.last_ok,running:fresh,mode:'cron_1m',latest:r||null,checkedAt:Date.now(),precision:'polling de aproximadamente 1 minuto; fonte GeckoTerminal tem cache de até 1 minuto; não é fluxo por segundo'},200,request,env);
 }
 if(path==='/api/signals'){
  const limit=finiteInt(u.searchParams.get('limit'),50,100);
  const before=Math.min(Date.now()+1,Number(u.searchParams.get('before'))||Date.now()+1);
  const rows=await env.DB.prepare('SELECT * FROM signals WHERE triggered_at<? ORDER BY triggered_at DESC LIMIT ?').bind(before,limit).all();
  return json({signals:rows.results||[],checkedAt:Date.now(),source:'D1 / GeckoTerminal / DEX Screener',mode:'cron_1m'},200,request,env);
 }
 if(path==='/api/stats'){
  const res=await env.DB.prepare('SELECT day,signals,measured5,positive5,sum5 FROM daily_metrics ORDER BY day DESC LIMIT 90').all();
  const days=res.results||[],today=localDay(Date.now());
  const total=days.reduce((a,x)=>a+(Number(x.signals)||0),0),m5=days.reduce((a,x)=>a+(Number(x.measured5)||0),0);
  const positive=days.reduce((a,x)=>a+(Number(x.positive5)||0),0),sum=days.reduce((a,x)=>a+(Number(x.sum5)||0),0);
  return json({stats:{total,day:days.find(x=>x.day===today)?.signals||0,m5measured:m5,m5positive:positive,m5avg:m5?sum/m5:null,period:'últimos 90 dias'},checkedAt:Date.now()},200,request,env);
 }
 return json({error:'Rota inexistente'},404,request,env);
}
export default {
 async fetch(req,env){try{return await handle(req,env);}catch(err){return json({error:'Falha no coletor; confira os logs no Cloudflare'},503,req,env);}},
 async scheduled(controller,env,ctx){ctx.waitUntil(collect(env).catch(async err=>{
   try{await env.DB.prepare(`INSERT INTO collector_state(name,last_run,last_ok,scanned,added,checkpoints,error)
    VALUES('cloud',?,0,0,0,0,?) ON CONFLICT(name) DO UPDATE SET last_run=excluded.last_run,last_ok=0,error=excluded.error`).bind(Date.now(),String(err?.message||err).slice(0,450)).run();}catch{}
   throw err;
 }));}
};
export {SETTINGS,validMint,pumpDex,parsePools,selectDexPairs,quality,checkpointDecision,collect,handle};
