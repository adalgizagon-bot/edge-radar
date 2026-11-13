/* Edge Radar Crypto Cloud Collector — read-only 1 minute snapshots; no trades, no wallets.
 * Cloudflare Workers Cron + D1. Missing checkpoints remain missing, never backfilled.
 * Source data: GeckoTerminal public API + DEX Screener token batch API.
 */
import {assessRisk,riskRow} from './risk.mjs';
import {labHtml} from './lab.mjs';
import {auditSnapshot} from './audit.mjs';
import {auditHtml} from './audit-page.mjs';
import {paperEnabled,runPaperCycle,paperSnapshot} from './paper-agent.mjs';
import {SOL_MINT,quoteRequest,parseExitQuote} from './exit-quote.mjs';
import {GECKO_COOLDOWN_MS,geckoDelay,parseJupiterRecent,parseDexProfiles,selectBalancedCandidates} from './discovery.mjs';
import {selectGeckoPairs,mergeFreshPairs,poolAgeMillis} from './gecko-prices.mjs';
const SETTINGS=Object.freeze({
  gecko:'https://api.geckoterminal.com/api/v2/networks/solana/',
  dex:'https://api.dexscreener.com/tokens/v1/solana/',
  maxMintsPerScan:90,maxNewSignals:4,maxActive:230,maxCandidates:25,
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
      price:value(attr.base_token_price_usd),dex,createdAt:poolAgeMillis(attr.pool_created_at)});
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
    if(!resp.ok){
      const error=new Error('HTTP '+resp.status+' em '+new URL(url).pathname);
      error.status=resp.status;
      const retry=resp.headers?.get?.('retry-after');
      const seconds=Number(retry);
      error.retryAfterMs=Number.isFinite(seconds)&&seconds>=0?seconds*1000:0;
      throw error;
    }
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
async function discoverMarket(env,fetcher,at,active=[]){
 const warnings=[],sources=[],cache=[];
 const state=await env.DB.prepare("SELECT * FROM source_health WHERE source='gecko'").first();
 const poolsByGroup={new:[],['5m']:[],['1h']:[],['24h']:[]};
 let recent=[],jupiterRecent=[],didJupiterRecent=false;
 const freshPools=[];
 const canTry=!state||at>=Number(state.next_attempt||0);
 if(canTry){
  const period=['5m','1h','24h'][Math.floor(at/GECKO_COOLDOWN_MS)%3];
  const endpoints=[['new','new_pools?include=base_token,dex'],
   [period,'trending_pools?include=base_token,dex&duration='+period]];
  let succeeded=0,lastError=null;
  for(const [kind,path] of endpoints){
   try{
    const payload=await fetchJSON(SETTINGS.gecko+path,fetcher);
    const found=parsePools(payload,kind==='new'?'new':'trending_'+kind);
    poolsByGroup[kind].push(...found);freshPools.push(...found);succeeded++;
   }catch(e){lastError=e;warnings.push('GeckoTerminal '+kind+': '+String(e?.message||e).slice(0,85));}
  }
  if(succeeded){
   sources.push('GeckoTerminal ('+succeeded+'/2)');
   await env.DB.prepare("INSERT INTO source_health (source,next_attempt,failures,last_status,last_success,last_error) "+
    "VALUES ('gecko',?,0,200,?,'') ON CONFLICT(source) DO UPDATE SET "+
    "next_attempt=excluded.next_attempt,failures=0,last_status=200,last_success=excluded.last_success,last_error=''")
    .bind(at+GECKO_COOLDOWN_MS,at).run();
  }else{
   const failures=Math.min(30,Number(state?.failures||0)+1),status=lastError?.status||0;
   const next=at+geckoDelay(status,failures,lastError?.retryAfterMs||0);
   await env.DB.prepare("INSERT INTO source_health (source,next_attempt,failures,last_status,last_success,last_error) "+
    "VALUES ('gecko',?,?,?,? ,?) ON CONFLICT(source) DO UPDATE SET "+
    "next_attempt=excluded.next_attempt,failures=excluded.failures,last_status=excluded.last_status,last_error=excluded.last_error")
    .bind(next,failures,status,Number(state?.last_success||0)||null,String(lastError?.message||'sem fonte').slice(0,160)).run();
  }
 }
 if(!canTry&&Number(state?.last_status)===429)warnings.push('GeckoTerminal em pausa por limite; aguardando nova tentativa');
 if(freshPools.length<12){
  didJupiterRecent=true;
  try{
   const payload=await fetchJSON('https://api.jup.ag/tokens/v2/recent',fetcher);
   if(!Array.isArray(payload))throw Error('resposta invalida');
   jupiterRecent=payload.filter(t=>validMint(t?.id));
   recent=parseJupiterRecent(jupiterRecent);sources.push('Jupiter recentes');
  }catch(e){warnings.push('Jupiter recentes: '+String(e?.message||e).slice(0,85));}
 }
 const stored=await env.DB.prepare("SELECT mint,name,symbol,source,first_pool_at,score,last_seen FROM token_universe "+
  "WHERE last_seen>? ORDER BY score DESC,last_seen DESC LIMIT 60").bind(at-14*24*60*60_000).all();
 const mature=[],persistedNew=[];
 for(const row of stored.results||[]){
  if(!validMint(row.mint))continue;
  const item={mint:row.mint,name:row.name,symbol:row.symbol,source:'universe_history'};
  if(row.first_pool_at&&at-row.first_pool_at>=24*60*60_000)mature.push(item);
  else persistedNew.push(item);
 }
 const previous=await env.DB.prepare("SELECT mint,name,symbol FROM risk_watch WHERE assessed_at>? ORDER BY assessed_at DESC LIMIT 18")
  .bind(at-6*60*60_000).all();
 for(const x of previous.results||[])if(validMint(x.mint))cache.push({mint:x.mint,name:x.name,symbol:x.symbol,source:'historico_d1'});
 const tracked=active.slice(0,12).filter(x=>validMint(x.mint)).map(x=>({mint:x.mint,name:x.name,symbol:x.symbol,source:'sinal_ativo'}));
 const oldSignals=await env.DB.prepare("SELECT mint,MAX(name) AS name,MAX(symbol) AS symbol,MAX(triggered_at) AS seen "+
  "FROM signals WHERE triggered_at>? GROUP BY mint ORDER BY seen DESC LIMIT 12")
  .bind(at-48*60*60_000).all();
 const historical=(oldSignals.results||[]).filter(x=>validMint(x.mint))
  .map(x=>({mint:x.mint,name:x.name,symbol:x.symbol,source:'sinal_historico'}));
 const candidates=selectBalancedCandidates([
    poolsByGroup.new,poolsByGroup['5m'],poolsByGroup['1h'],poolsByGroup['24h'],
    mature,tracked,historical,persistedNew,recent,cache
 ],SETTINGS.maxCandidates,[5,6,5,5,4,0,0,0,0,0]);
 return {candidates,warnings,sources,jupiterRecent,didJupiterRecent,
  geckoOk:sources.some(x=>x.startsWith('GeckoTerminal')),freshPools,
  groups:{new:poolsByGroup.new.length,short:poolsByGroup['5m'].length,
   medium:poolsByGroup['1h'].length,older:poolsByGroup['24h'].length,watch:mature.length}};
}
function dedupePools(pools){
 const by=new Map();for(const p of pools){const o=by.get(p.mint);if(!o||(p.liquidity??0)>(o.liquidity??0))by.set(p.mint,p)}
 return [...by.values()].sort((a,b)=>(b.volume??0)-(a.volume??0));
}
/* Prioritize open paper positions, then return partial successes. A single failed batch
 * must not make valid prices from other batches disappear.
 */
async function fetchPrices(env,at,mints,fetcher){
 const out=[],errors=[],warnings=[];
 const health=await env.DB.prepare("SELECT * FROM source_health WHERE source='dex_pairs'").first();
 if(health&&at<Number(health.next_attempt||0)){
  warnings.push('DEX Screener em pausa por limite; priorizando cotacoes recentes da GeckoTerminal');
  return {prices:new Map(),errors,warnings};
 }
 let rateLimited=false,lastError=null,success=0;
 for(let i=0;i<mints.length;i+=30){
  try{
   const rows=await fetchJSON(SETTINGS.dex+mints.slice(i,i+30).join(','),fetcher);
   if(!Array.isArray(rows))throw new Error('Formato invalido do DEX Screener');
   out.push(...rows);success++;
  }catch(e){
   errors.push('lote '+(Math.floor(i/30)+1)+': '+String(e?.message||e).slice(0,95));
   if(e?.status===429)rateLimited=true;
   lastError=e;
   if(rateLimited)break;
  }
 }
 if(rateLimited){
  const failures=Math.min(30,Number(health?.failures||0)+1);
  const next=at+geckoDelay(429,failures,lastError?.retryAfterMs||0);
  await env.DB.prepare("INSERT INTO source_health (source,next_attempt,failures,last_status,last_success,last_error) "+
   "VALUES ('dex_pairs',?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET "+
   "next_attempt=excluded.next_attempt,failures=excluded.failures,last_status=429,last_error=excluded.last_error")
   .bind(next,failures,429,Number(health?.last_success||0)||null,'HTTP 429').run();
  warnings.push('DEX Screener HTTP 429; aguardar '+Math.ceil((next-at)/60000)+' min');
 }else if(success){
  await env.DB.prepare("INSERT INTO source_health (source,next_attempt,failures,last_status,last_success,last_error) "+
   "VALUES ('dex_pairs',?,0,200,?,'') ON CONFLICT(source) DO UPDATE SET "+
   "next_attempt=excluded.next_attempt,failures=0,last_status=200,last_success=excluded.last_success,last_error=''")
   .bind(at+60_000,at).run();
 }
 return {prices:selectDexPairs(out),errors,warnings};
}

const ACTIVE_UNIVERSE_MS=14*24*60*60_000;
/* Keep market observations for 14 days independently of score and entry conditions.
 * A token doesn't vanish because its 5-minute score or external quote drops.
 */
async function saveUniverse(db,at,candidates,prices,riskAtSignal){
 if(Math.floor(at/60000)%3!==0)return 0; // bound D1 free write usage
 const statement=db.prepare(
  "INSERT INTO token_universe "+
  "(mint,name,symbol,source,first_seen,first_pool_at,last_observed_at,last_seen,pool_address,dex,"+
  "price_usd,liquidity_usd,volume5m_usd,change5m_pct,buys5m,sells5m,score,best_score,"+
  "stage,risk_level,price_source,observations) "+
  "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) "+
  "ON CONFLICT(mint) DO UPDATE SET "+
  "name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE token_universe.name END,"+
  "symbol=CASE WHEN excluded.symbol<>'' THEN excluded.symbol ELSE token_universe.symbol END,"+
  "source=CASE WHEN excluded.source='universe_history' THEN token_universe.source ELSE excluded.source END,"+
  "first_pool_at=CASE WHEN token_universe.first_pool_at IS NULL THEN excluded.first_pool_at "+
  "WHEN excluded.first_pool_at IS NULL THEN token_universe.first_pool_at "+
  "ELSE MIN(token_universe.first_pool_at,excluded.first_pool_at) END,"+
  "last_observed_at=excluded.last_observed_at,last_seen=excluded.last_seen,"+
  "pool_address=COALESCE(excluded.pool_address,token_universe.pool_address),"+
  "dex=excluded.dex,price_usd=excluded.price_usd,liquidity_usd=excluded.liquidity_usd,"+
  "volume5m_usd=excluded.volume5m_usd,change5m_pct=excluded.change5m_pct,"+
  "buys5m=excluded.buys5m,sells5m=excluded.sells5m,"+
  "score=excluded.score,best_score=MAX(token_universe.best_score,excluded.score),"+
  "stage=excluded.stage,risk_level=excluded.risk_level,price_source=excluded.price_source,"+
  "observations=token_universe.observations+1");
 let recorded=0;
 for(const c of candidates){
  const p=prices.get(c.mint),price=value(p?.priceUsd);
  if(!(price>0)||!validMint(c.mint))continue;
  const score=quality(p,at),risk=riskAtSignal.get(c.mint);
  await statement.bind(c.mint,clean(c.name||p?.baseToken?.name),clean(c.symbol||p?.baseToken?.symbol,25),
   clean(c.source||'observed',40),at,value(p.pairCreatedAt),at,at,
   validMint(p.pairAddress)?p.pairAddress:null,clean(p.dexId,40),
   price,value(p.liquidity?.usd),value(p.volume?.m5),value(p.priceChange?.m5),
   value(p.txns?.m5?.buys),value(p.txns?.m5?.sells),score.score,score.score,score.stage,
   risk?.level||'unverified',clean(p.priceSource||'dex',15)).run();
  recorded++;
 }
 return recorded;
}
async function fetchWatchedGecko(db,fetcher,at,alreadySeen){
 const results=[],warnings=[];
 const health=await db.prepare("SELECT * FROM source_health WHERE source='gecko_watch'").first();
 if(health&&at<Number(health.next_attempt||0))return {pools:results,warnings};
 const ids=new Set((alreadySeen||[]).map(p=>p.mint));
 const rows=await db.prepare("SELECT mint,pool_address FROM token_universe "+
  "WHERE last_seen>? AND first_pool_at<? AND pool_address IS NOT NULL AND score>=65 "+
  "ORDER BY score DESC,last_observed_at ASC LIMIT 24")
  .bind(at-ACTIVE_UNIVERSE_MS,at-60*60_000).all();
 const poolAddresses=[];
 for(const row of rows.results||[]){
  if(!ids.has(row.mint)&&validMint(row.pool_address)&&!poolAddresses.includes(row.pool_address))
   poolAddresses.push(row.pool_address);
  if(poolAddresses.length>=10)break;
 }
 if(!poolAddresses.length)return {pools:results,warnings};
 let error=null;
 try{
  const payload=await fetchJSON(SETTINGS.gecko+'pools/multi/'+poolAddresses.join(',')+'?include=base_token,dex',fetcher);
  results.push(...parsePools(payload,'watchlist'));
 }catch(e){error=e;warnings.push('GeckoTerminal monitorados: '+String(e?.message||e).slice(0,70));}
 const failures=error?Math.min(30,Number(health?.failures||0)+1):0;
 const next=error?at+geckoDelay(error?.status||0,failures,error?.retryAfterMs||0):at+GECKO_COOLDOWN_MS;
 await db.prepare("INSERT INTO source_health(source,next_attempt,failures,last_status,last_success,last_error) "+
  "VALUES('gecko_watch',?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET "+
  "next_attempt=excluded.next_attempt,failures=excluded.failures,last_status=excluded.last_status,"+
  "last_success=excluded.last_success,last_error=excluded.last_error")
  .bind(next,failures,error?.status||200,error?health?.last_success||null:at,String(error?.message||'').slice(0,120)).run();
 return {pools:results,warnings};
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
 let errors=[],warnings=[];
 const discovered=await discoverMarket(env,fetcher,at,active);
 const candidates=discovered.candidates;
 warnings.push(...discovered.warnings);
 if(!candidates.length&&discovered.sources.length===0)errors.push('Nenhuma fonte de descoberta disponivel');
 // Lote Jupiter (uma requisicao por ciclo). Falha de API nao libera entradas.
 let jupiter=new Map(discovered.jupiterRecent.map(t=>[t.id,t]));
 if(candidates.length&&!discovered.didJupiterRecent){try{
  const uri='https://api.jup.ag/tokens/v2/search?query='+[...candidates.map(c=>c.mint),SOL_MINT].join(',');
  const response=await fetchJSON(uri,fetcher);
  if(!Array.isArray(response))throw Error('resposta invalida');
  jupiter=new Map(response.filter(t=>validMint(t?.id)).map(t=>[t.id,t]));
 }catch(e){warnings.push('Jupiter risco: '+String(e?.message||e).slice(0,120));}}
 const prevRisk=new Map();
 if(candidates.length){
  const query=`SELECT mint,pool_price,pool_liquidity FROM risk_watch WHERE mint IN (${candidates.map(()=>'?').join(',')})`;
  const old=await env.DB.prepare(query).bind(...candidates.map(c=>c.mint)).all();
  for(const p of old.results||[])prevRisk.set(p.mint,p);
 }
 // Only reprice signals that have a checkpoint due or approaching; all overdue records
 // are still processed for missing checkpoints even without a quote.
 const due=active.filter(s=>SETTINGS.horizons.some(h=>!s[h[0]+'_status']&&at>=s.triggered_at+h[1]-90_000&&at<=s.triggered_at+h[1]+h[2]));
 let paperOpenMints=[];
 if(paperEnabled(env)){
  const open=await env.DB.prepare('SELECT DISTINCT mint FROM paper_positions LIMIT 12').all();
  paperOpenMints=(open.results||[]).map(r=>r.mint).filter(validMint);
 }
 const mints=[...new Set([...paperOpenMints,...due.map(x=>x.mint),...candidates.map(x=>x.mint)])].slice(0,SETTINGS.maxMintsPerScan);
 let prices=new Map();
 const geckoFresh=selectGeckoPairs(discovered.freshPools,at);
 let dexPrices=new Map();
 if(mints.length){
  const outcome=await fetchPrices(env,at,mints,fetcher);
  dexPrices=outcome.prices;
  warnings.push(...outcome.warnings);
  if(outcome.errors.length)warnings.push('DEX Screener parcial: '+outcome.errors.join('; '));
 }
 prices=mergeFreshPairs(dexPrices,geckoFresh);
 if(mints.length&&!mints.some(m=>prices.has(m)))errors.push('Nenhuma cotacao atual disponivel nas fontes');

 let checkpoints=0;
 for(const signal of active){
  const p=prices.get(signal.mint),price=value(p?.priceUsd);
  checkpoints+=await makeCheckpoints(env.DB,signal,at,price);
 }
 let inserted=0;
 const qualified=[];
 let blocked=0,unverified=0;
 const riskAtSignal=new Map(),quoteThisCycle=new Map();
 for(const c of candidates){
  const pair=prices.get(c.mint);
  const check=assessRisk({mint:c.mint,pair:pair||null,token:jupiter.get(c.mint)||null,previous:prevRisk.get(c.mint),now:at});
  if(c.source==='dex_profile_promotional')check.reasons.push('Descoberta via perfil potencialmente promocional; nao comprova procura organica');
  if(c.source==='sinal_historico')check.reasons.push('Reavaliacao de moeda do historico; nao e novo lancamento');
  riskAtSignal.set(c.mint,check);
  if(check.level==='blocked')blocked++;
  if(check.level==='unverified')unverified++;
  const row=riskRow(check,{name:c.name,symbol:c.symbol,score:quality(pair,at).score});
  await env.DB.prepare(`INSERT INTO risk_watch
  (mint,name,symbol,assessed_at,level,market_score,organic_score,is_verified,top_holders,buy_usd,sell_usd,flow_ratio,pool_price,pool_liquidity,jupiter_liquidity,change_price,change_liquidity,reasons,exit_quote_verified,entry_allowed)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,assessed_at=excluded.assessed_at,level=excluded.level,market_score=excluded.market_score,organic_score=excluded.organic_score,is_verified=excluded.is_verified,top_holders=excluded.top_holders,buy_usd=excluded.buy_usd,sell_usd=excluded.sell_usd,flow_ratio=excluded.flow_ratio,pool_price=excluded.pool_price,pool_liquidity=excluded.pool_liquidity,jupiter_liquidity=excluded.jupiter_liquidity,change_price=excluded.change_price,change_liquidity=excluded.change_liquidity,reasons=excluded.reasons,exit_quote_verified=0,entry_allowed=0`)
  .bind(...Object.values(row)).run();
 }
 // Apenas UMA cotacao hipotetica por ciclo, sem carteira nem transacao.
 const quotable=candidates.filter(c=>jupiter.has(c.mint)&&quoteRequest(jupiter.get(c.mint)));
 const strongest=quotable.filter(c=>quality(prices.get(c.mint),at).stage==='priority');
 const quoteOptions=(strongest.length?strongest:quotable).slice(0,3);
 if(quoteOptions.length){
  const chosen=quoteOptions[Math.floor(at/60000)%quoteOptions.length];
  const request=quoteRequest(jupiter.get(chosen.mint));
  let result={status:'unavailable',error:'Sem rota de venda comprovada'};
  try{
   const data=await fetchJSON(request.url,fetcher);
   result=parseExitQuote(data,jupiter.get(SOL_MINT)?.usdPrice,request.stakeUsd);
  }catch(e){result.error=String(e?.message||e).slice(0,140);}
  quoteThisCycle.set(chosen.mint,result.status);
  await env.DB.prepare(`INSERT INTO exit_quotes
  (mint,checked_at,stake_usd,status,estimated_sol,estimated_usd,recovery_pct,router,error)
  VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(mint) DO UPDATE SET
  checked_at=excluded.checked_at,stake_usd=excluded.stake_usd,status=excluded.status,
  estimated_sol=excluded.estimated_sol,estimated_usd=excluded.estimated_usd,
  recovery_pct=excluded.recovery_pct,router=excluded.router,error=excluded.error`)
  .bind(chosen.mint,at,request.stakeUsd,result.status,result.estimatedSol??null,result.estimatedUsd??null,result.recoveryPct??null,result.router||'',String(result.error||'').slice(0,140)).run();
 }
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
   const risk=riskAtSignal.get(c.mint);
   await env.DB.prepare(`INSERT OR IGNORE INTO signal_evidence
   (signal_id,mint,captured_at,risk_level,organic_score,buy_usd,sell_usd,liquidity,reasons,quote_status)
   VALUES (?,?,?,?,?,?,?,?,?,?)`)
   .bind(id,c.mint,at,risk?.level||'unverified',risk?.organic??null,risk?.buyUsd??null,risk?.sellUsd??null,risk?.liq??null,
    JSON.stringify([...(risk?.alerts||[]),...(risk?.reasons||[])]).slice(0,1150),quoteThisCycle.get(c.mint)||'not_checked').run();
  await env.DB.prepare(`INSERT INTO daily_metrics (day,signals,measured5,positive5,sum5) VALUES (?,1,0,0,0)
   ON CONFLICT(day) DO UPDATE SET signals=signals+1`).bind(localDay(at)).run();
  duplicates.add(c.mint);inserted++;
 }
 if(paperEnabled(env)){
  try{
   const ranked=candidates.map(c=>{const q=quality(prices.get(c.mint),at);return {...c,stage:q.stage,score:q.score};});
   const result=await runPaperCycle(env,at,{prices,candidates:ranked,riskAtSignal,quoteThisCycle,fetcher});
   if(result?.aiStatus==='error')warnings.push('IA indisponivel: verifique chave, modelo e limites');
  }catch(e){warnings.push('Teste A/B suspenso neste ciclo: '+String(e?.message||e).slice(0,110));}
 }
 const errorText=[...errors,...warnings].join(' | ').slice(0,500);
 await env.DB.prepare(`INSERT INTO collector_state (name,last_run,last_ok,scanned,added,checkpoints,error)
 VALUES ('cloud',?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET
 last_run=excluded.last_run,last_ok=excluded.last_ok,scanned=excluded.scanned,added=excluded.added,checkpoints=excluded.checkpoints,error=excluded.error`)
 .bind(at,errors.length?0:1,mints.length,inserted,checkpoints,errorText).run();
 return {at,scanned:mints.length,added:inserted,checkpoints,blocked,unverified,sources:discovered.sources,errors,warnings};
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
 if(path==='/audit'){
  return new Response(auditHtml,{status:200,headers:{
   'content-type':'text/html; charset=utf-8','cache-control':'no-store',
   'x-content-type-options':'nosniff','x-frame-options':'DENY',
   'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
   'referrer-policy':'no-referrer'
  }});
 }
 if(path==='/lab'){
  return new Response(labHtml,{status:200,headers:{
   'content-type':'text/html; charset=utf-8','cache-control':'no-store',
   'x-content-type-options':'nosniff','x-frame-options':'DENY',
   'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
   'referrer-policy':'no-referrer'
  }});
 }

 if(path==='/api/health'||path==='/api/status'){
  const r=await env.DB.prepare("SELECT * FROM collector_state WHERE name='cloud'").first();
  const fresh=!!r&&Date.now()-r.last_run<3*60_000;
  const source=await env.DB.prepare("SELECT * FROM source_health WHERE source='gecko'").first();
   return json({online:fresh&&!!r.last_ok,running:fresh,mode:'cron_1m',latest:r||null,sourceHealth:{gecko:source||null},checkedAt:Date.now(),precision:'polling de aproximadamente 1 minuto; fonte GeckoTerminal tem cache de até 1 minuto; não é fluxo por segundo'},200,request,env);
 }
 if(path==='/api/risk'){
  const limit=finiteInt(u.searchParams.get('limit'),40,100);
  const mint=u.searchParams.get('mint');
  if(mint!==null&&!validMint(mint))return json({error:'Mint invalido'},400,request,env);
  const rows=mint?
   await env.DB.prepare('SELECT * FROM risk_watch WHERE mint=? LIMIT 1').bind(mint).all():
   await env.DB.prepare('SELECT * FROM risk_watch ORDER BY assessed_at DESC LIMIT ?').bind(limit).all();
  return json({risk:rows.results||[],checkedAt:Date.now(),precision:'triagem conservadora; sem cotacao executavel de venda'},200,request,env);
 }
 if(path==='/api/paper'){return json(await paperSnapshot(env),200,request,env);}
 if(path==='/api/audit'){
  const limit=finiteInt(u.searchParams.get('limit'),500,1000);
  return json(await auditSnapshot(env,Date.now(),limit),200,request,env);
 }
 if(path==='/api/exit-quotes'){
  const limit=finiteInt(u.searchParams.get('limit'),30,100);
  const mint=u.searchParams.get('mint');
  if(mint!==null&&!validMint(mint))return json({error:'Mint invalido'},400,request,env);
  const rows=mint?
   await env.DB.prepare('SELECT * FROM exit_quotes WHERE mint=? LIMIT 1').bind(mint).all():
   await env.DB.prepare('SELECT * FROM exit_quotes ORDER BY checked_at DESC LIMIT ?').bind(limit).all();
  return json({quotes:rows.results||[],checkedAt:Date.now(),note:'Estimativas para US$ 15 sem garantia de execucao, sem carteira e sem ordens'},200,request,env);
 }
 if(path==='/api/evaluation'){
  const records=await env.DB.prepare(`SELECT e.risk_level AS level,
   COUNT(*) AS signals,
   SUM(CASE WHEN s.m5_status='measured' THEN 1 ELSE 0 END) AS measured5,
   SUM(CASE WHEN s.m5_status='missing' THEN 1 ELSE 0 END) AS missing5,
   SUM(CASE WHEN s.m5_status='measured' AND s.m5_return>0 THEN 1 ELSE 0 END) AS positive5,
   ROUND(AVG(CASE WHEN s.m5_status='measured' THEN s.m5_return ELSE NULL END),2) AS mean_change5
   FROM signal_evidence e JOIN signals s ON e.signal_id=s.id
   WHERE e.captured_at>? GROUP BY e.risk_level ORDER BY signals DESC`).bind(Date.now()-90*24*60*60*1000).all();
  return json({groups:records.results||[],checkedAt:Date.now(),
   note:'Variações de preco de 5 minutos, NAO resultado de trades. Sem slippage, taxas ou teste de venda. Amostras pequenas nao validam uma estrategia.'},200,request,env);
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
