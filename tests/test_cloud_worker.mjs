import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{parsePools,quality,checkpointDecision,collect,handle,selectDexPairs} from '../cloud/worker.mjs';
const mint='11111111111111111111111111111111';
const other='22222222222222222222222222222222';
const t0=Date.now();
const gecko=()=>({
 data:[{attributes:{address:'pooladdr',name:'TEST / SOL',reserve_in_usd:'25000',volume_usd:{m5:'20000'},transactions:{m5:{buys:60,sells:20}},price_change_percentage:{m5:'12'},base_token_price_usd:'0.01'},
 relationships:{base_token:{data:{id:'solana_'+mint}},dex:{data:{id:'solana_pump_swap'}}}}],
 included:[{id:'solana_'+mint,attributes:{name:'Test Token',symbol:'TEST',address:mint}},
 {id:'solana_pump_swap',attributes:{name:'PumpSwap'}}]
});
const goodPair=(price='0.01')=>({chainId:'solana',dexId:'pumpswap',baseToken:{address:mint,name:'Test Token',symbol:'TEST'},priceUsd:price,
 liquidity:{usd:25000},volume:{m5:20000},txns:{m5:{buys:60,sells:20}},priceChange:{m5:12},pairCreatedAt:t0-60000});
class FakeDB {
 constructor(){this.rows=[];this.state=null;this.daily=new Map();this.risks=new Map();this.quotes=new Map();this.evidence=[];this.sourceHealth=null;this.sourceStates=new Map();this.universe=new Map();this.priceState=null}
 prepare(sql){return {first:async()=>{if(sql.includes('FROM source_health'))return this.sourceStates.get(sql.includes('dex_pairs')?'dex_pairs':sql.includes('gecko_watch')?'gecko_watch':'gecko')||null;if(sql.includes('FROM collector_state'))return this.state;throw Error('Unknown unbound first '+sql)},bind:(...args)=>({
  all:async()=>{
   if(sql.includes('WHERE completed=0'))return {results:this.rows.filter(r=>!r.completed&&r.triggered_at>args[0]).sort((a,b)=>b.triggered_at-a.triggered_at).slice(0,args[1])};
   if(sql.startsWith('SELECT mint FROM'))return {results:this.rows.filter(r=>r.triggered_at>args[0]&&args.slice(1).includes(r.mint)).map(r=>({mint:r.mint}))};
   if(sql.startsWith('SELECT * FROM signals WHERE triggered_at<'))return {results:this.rows.filter(r=>r.triggered_at<args[0]).sort((a,b)=>b.triggered_at-a.triggered_at).slice(0,args[1])};
   if(sql.startsWith('SELECT mint,MAX(name) AS name')){const by=new Map();for(const x of this.rows.filter(x=>x.triggered_at>args[0])){const old=by.get(x.mint);if(!old||old.seen<x.triggered_at)by.set(x.mint,{mint:x.mint,name:x.name,symbol:x.symbol,seen:x.triggered_at});}return {results:[...by.values()].sort((a,b)=>b.seen-a.seen).slice(0,12)};}
   if(sql.includes('FROM token_universe')&&sql.includes('pool_address'))return {results:[...this.universe.values()].filter(r=>r.pool_address&&r.score>=65).slice(0,24)};
   if(sql.includes('FROM token_universe'))return {results:[...this.universe.values()].filter(r=>r.last_seen>args[0]).sort((a,b)=>b.score-a.score).slice(0,60)};
   if(sql.startsWith('SELECT mint,name,symbol FROM risk_watch'))return {results:[...this.risks.values()].filter(x=>x.assessed_at>args[0]).slice(0,22)};
   if(sql.startsWith('SELECT mint,pool_price,pool_liquidity FROM risk_watch'))return {results:args.map(m=>this.risks.get(m)).filter(Boolean)};
   if(sql.startsWith('SELECT * FROM risk_watch'))return {results:[...this.risks.values()]};
   if(sql.startsWith('SELECT e.risk_level')){const groups=new Map();for(const ev of this.evidence){const signal=this.rows.find(x=>x.id===ev.signal_id);if(!signal)continue;const g=groups.get(ev.risk_level)||{level:ev.risk_level,signals:0,measured5:0,missing5:0,positive5:0,mean_change5:null,_sum:0};g.signals++;if(signal.m5_status==='measured'){g.measured5++;g.positive5+=signal.m5_return>0?1:0;g._sum+=signal.m5_return;g.mean_change5=g._sum/g.measured5;}if(signal.m5_status==='missing')g.missing5++;groups.set(ev.risk_level,g);}return {results:[...groups.values()]};}
   if(sql.startsWith('SELECT * FROM exit_quotes'))return {results:sql.includes('WHERE mint=?')?[this.quotes.get(args[0])].filter(Boolean):[...this.quotes.values()]};
   if(sql.startsWith('SELECT day,signals,measured5'))return {results:[...this.daily.entries()].map(([day,x])=>({day,...x}))};
   throw Error('Unknown all '+sql);
  },
  run:async()=>{
   if(sql.startsWith('UPDATE signals SET completed=1,')){for(const r of this.rows.filter(x=>!x.completed&&x.triggered_at<args[0])){r.completed=1;for(const key of ['m1','m5','m15','m30'])r[key+'_status'] ||= 'missing';}return {success:true};}
   if(sql.startsWith('INSERT INTO source_health')||sql.startsWith('INSERT INTO source_health(')){
    const source=sql.includes('dex_pairs')?'dex_pairs':sql.includes('gecko_watch')?'gecko_watch':'gecko';
    const success=sql.includes("0,200"),state=success?
     {source,next_attempt:args[0],failures:0,last_status:200,last_success:args[1],last_error:''}:
     {source,next_attempt:args[0],failures:args[1],last_status:args[2]||200,
      last_success:args[3]||null,last_error:args[4]||''};
    if(source==='gecko_watch'){
     state.last_status=args[2]||200;state.last_success=args[3]||null;
    }
    this.sourceStates.set(source,state);if(source==='gecko')this.sourceHealth=state;
    return {success:true};}
   if(sql.startsWith('INSERT INTO token_universe')){
    const keys=['mint','name','symbol','source','first_seen','first_pool_at','last_observed_at','last_seen',
     'pool_address','dex','price_usd','liquidity_usd','volume5m_usd','volume24h_usd',
     'change5m_pct','change1h_pct','change24h_pct','market_cap_usd','buys5m','sells5m',
     'score','best_score','stage','risk_level','price_source'];
    const row=Object.fromEntries(keys.map((k,i)=>[k,args[i]]));
    const old=this.universe.get(row.mint);this.universe.set(row.mint,{...old,...row,
      first_seen:old?.first_seen??row.first_seen,best_score:Math.max(old?.best_score||0,row.score),
      observations:(old?.observations||0)+1});return {success:true};
   }
   if(sql.startsWith('INSERT INTO price_source_state')){this.priceState={checked_at:args[0],dex_count:args[1],gecko_count:args[2],missing_count:args[3],watched_pools:args[4],dex_next_attempt:args[5]};return {success:true};}
   if(sql.includes('INSERT OR IGNORE INTO signal_evidence')){const [signal_id,mint,captured_at,risk_level,organic_score,buy_usd,sell_usd,liquidity,reasons,quote_status]=args;this.evidence.push({signal_id,mint,captured_at,risk_level,organic_score,buy_usd,sell_usd,liquidity,reasons,quote_status});return {success:true};}
   if(sql.includes('INSERT INTO exit_quotes')){const cols=['mint','checked_at','stake_usd','status','estimated_sol','estimated_usd','recovery_pct','router','error'];const row=Object.fromEntries(cols.map((c,i)=>[c,args[i]]));this.quotes.set(row.mint,row);return {success:true};}
   if(sql.includes('INSERT INTO risk_watch')){const cols=['mint','name','symbol','assessed_at','level','market_score','organic_score','is_verified','top_holders','buy_usd','sell_usd','flow_ratio','pool_price','pool_liquidity','jupiter_liquidity','change_price','change_liquidity','reasons','exit_quote_verified','entry_allowed'];const row=Object.fromEntries(cols.map((c,i)=>[c,args[i]]));this.risks.set(row.mint,row);return {success:true};}
   if(sql.includes('INSERT OR IGNORE INTO signals')){
    const [id,mint,name,symbol,triggered_at,entry_price,last_price,last_quote_at,score,liquidity,volume,change5,buys,sells,source]=args;
    this.rows.push({id,mint,name,symbol,triggered_at,entry_price,last_price,last_quote_at,score,liquidity,volume,change5,buys,sells,source,completed:0});return {success:true};
   }
   const match=sql.match(/^UPDATE signals SET (m\d+)_status=/);
   if(match){const [status,at,price,ret,id]=args;const row=this.rows.find(r=>r.id===id),k=match[1];
    row[k+'_status']=status;row[k+'_at']=at;row[k+'_price']=price;row[k+'_return']=ret;return {success:true};}
   if(sql.startsWith('UPDATE signals SET completed=1')){this.rows.find(r=>r.id===args[0]).completed=1;return {success:true};}
   if(sql.includes('INSERT INTO daily_metrics')){const day=args[0],m=this.daily.get(day)||{signals:0,measured5:0,positive5:0,sum5:0};
    if(args.length===1)m.signals++;else{m.measured5++;m.positive5+=args[1];m.sum5+=args[2];}this.daily.set(day,m);return {success:true};}
   if(sql.includes('INSERT INTO collector_state')){this.state={last_run:args[0],last_ok:args[1],scanned:args[2],added:args[3],checkpoints:args[4],error:args[5]};return {success:true};}
   throw Error('Unknown run '+sql);
  },
  first:async()=>{
   if(sql.includes('FROM collector_state'))return this.state;
   if(sql.includes('FROM source_health'))return this.sourceStates.get(sql.includes('dex_pairs')?'dex_pairs':sql.includes('gecko_watch')?'gecko_watch':'gecko')||null;
   if(sql.includes('FROM price_source_state'))return this.priceState;
   if(sql.includes('COUNT(*)')){const measured=this.rows.filter(x=>x.m5_status==='measured');return {total:this.rows.length,day:this.rows.length,m5measured:measured.length,m5positive:measured.filter(x=>x.m5_return>0).length,m5avg:measured.reduce((sum,x)=>sum+x.m5_return,0)/(measured.length||1)};}
   throw Error('Unknown first '+sql);
  }
 })};}
}
const mockFetch=(url)=>{
 if(url.includes('geckoterminal')){mockFetch.geckoCalls=(mockFetch.geckoCalls||0)+1;return Promise.resolve(mockFetch.geckoRateLimited?{ok:false,status:429,headers:{get:()=>null}}:{ok:true,json:async()=>gecko()});}
 if(url.includes('api.jup.ag/tokens/v2/recent'))return Promise.resolve({ok:true,json:async()=>[{id:mint,name:'Test Token',symbol:'TEST',usdPrice:.01,decimals:6,organicScore:85,isVerified:true,liquidity:25000,audit:{mintAuthorityDisabled:true,freezeAuthorityDisabled:true,topHoldersPercentage:8},stats5m:{buyVolume:30000,sellVolume:14000,numBuys:60,numSells:20},firstPool:{createdAt:new Date(t0-3600000).toISOString()}},{id:'So11111111111111111111111111111111111111112',usdPrice:100,decimals:9}]});
 if(url.includes('api.dexscreener.com/token-profiles/latest/v1'))return Promise.resolve({ok:true,json:async()=>[]});
 if(url.includes('api.jup.ag/tokens/v2/search'))return Promise.resolve({ok:true,json:async()=>[{id:'So11111111111111111111111111111111111111112',usdPrice:100,decimals:9},{id:mint,usdPrice:.01,decimals:6,name:'Test Token',symbol:'TEST',isVerified:true,organicScore:85,liquidity:25000,audit:{mintAuthorityDisabled:true,freezeAuthorityDisabled:true,topHoldersPercentage:8},stats5m:{buyVolume:30000,sellVolume:14000,numBuys:60,numSells:20},firstPool:{createdAt:new Date(t0-3600000).toISOString()}}]});
 if(url.includes('api.jup.ag/swap/v2/order'))return Promise.resolve({ok:true,json:async()=>({outAmount:'150000000',router:'metis',transaction:null})});
 if(url.includes('dexscreener'))return Promise.resolve({ok:true,json:async()=>[goodPair(mockFetch.price||'0.01')]});
 throw Error('Unexpected external request '+url);
};
test('Gecko parser only accepts PumpSwap pools and valid mint',()=>{
 assert.equal(parsePools(gecko(),'new').length,1);
 const invalid=gecko();invalid.included[1].attributes.name='Raydium';assert.equal(parsePools(invalid,'new').length,0);
 assert.equal(selectDexPairs([goodPair(),{...goodPair(),dexId:'raydium'}]).size,1);
});
test('Quality filter does not mistake rising but underliquid token for an opportunity',()=>{
 assert.equal(quality(goodPair()).stage,'priority');
 const p=goodPair();p.liquidity.usd=900;assert.notEqual(quality(p).stage,'priority');
 const over=goodPair();over.priceChange.m5=110;assert.notEqual(quality(over).stage,'priority');
});
test('Checkpoints require observation strictly after target and before deadline',()=>{
 const s={triggered_at:t0,entry_price:1};const h=['m1',60_000,90_000];
 assert.equal(checkpointDecision(s,h,t0+50_000,1.2),null);
 assert.equal(checkpointDecision(s,h,t0+65_000,1.2).returnPct,20-0.000000000000004);
 assert.equal(checkpointDecision(s,h,t0+151_000,1.2).status,'missing');
});
test('Collector creates a signal, observes actual checkpoints and blocks duplicate re-entry',async()=>{
 const db=new FakeDB(),env={DB:db,FRONTEND_ORIGIN:'https://edge-radar-gamma.vercel.app'};
 mockFetch.price='0.01';let r=await collect(env,{clock:()=>t0,fetcher:mockFetch});
 assert.equal(r.added,1);assert.equal(db.rows.length,1);assert.equal(db.risks.get(mint).entry_allowed,0);assert.equal(db.rows[0].score,100);assert.equal(db.evidence[0].risk_level,'watch');assert.equal(db.evidence[0].quote_status,'quoted');assert.equal(db.quotes.get(mint).status,'quoted');assert.equal(db.quotes.get(mint).estimated_usd,15);
 mockFetch.price='0.015';r=await collect(env,{clock:()=>t0+60_000,fetcher:mockFetch});
 assert.equal(r.added,0);assert.equal(db.rows[0].m1_status,'measured');assert.ok(Math.abs(db.rows[0].m1_return-50)<0.001);
 r=await collect(env,{clock:()=>t0+310_000,fetcher:mockFetch});
 assert.equal(db.rows[0].m5_status,'measured');
 const evaluation=await handle(new Request('https://worker.example/api/evaluation'),env);
 assert.equal(evaluation.status,200);const metrics=await evaluation.json();
 assert.equal(metrics.groups[0].level,'watch');assert.equal(metrics.groups[0].measured5,1);
 assert.equal(metrics.groups[0].positive5,1);
 r=await collect(env,{clock:()=>t0+1_200_000,fetcher:mockFetch});
 assert.equal(db.rows[0].m15_status,'missing','no invented 15-minute price');
 r=await collect(env,{clock:()=>t0+1_850_000,fetcher:mockFetch});
 assert.equal(db.rows[0].m30_status,'measured');assert.equal(db.rows[0].completed,1);
 const reply=await handle(new Request('https://worker.example/api/signals?limit=2',{headers:{origin:'https://edge-radar-gamma.vercel.app'}}),env);
 assert.equal(reply.status,200);assert.equal((await reply.json()).signals.length,1);
 assert.equal(reply.headers.get('access-control-allow-origin'),'https://edge-radar-gamma.vercel.app');
 const bad=await handle(new Request('https://worker.example/api/signals',{headers:{origin:'https://not-authorized.example'}}),env);
 assert.equal(bad.headers.get('access-control-allow-origin'),null);
});

test('Risk API shows reasons and never releases auto-entry',async()=>{
 const db=new FakeDB(),env={DB:db};await collect(env,{clock:()=>t0,fetcher:mockFetch});
 const reply=await handle(new Request('https://worker.example/api/risk'),env);
 assert.equal(reply.status,200);const data=await reply.json();assert.equal(data.risk.length,1);
 assert.equal(data.risk[0].level,'watch');assert.equal(data.risk[0].entry_allowed,0);
 const bad=await handle(new Request('https://worker.example/api/risk?mint=abc'),env);assert.equal(bad.status,400);
 const q=await handle(new Request('https://worker.example/api/exit-quotes?mint='+mint),env);assert.equal(q.status,200);assert.equal((await q.json()).quotes[0].estimated_sol,.15);
});

test('429 GeckoTerminal enters cooldown but risk is populated from Jupiter recent and DEX',async()=>{
 const db=new FakeDB(),env={DB:db};mockFetch.geckoRateLimited=true;mockFetch.geckoCalls=0;
 try{
  const first=await collect(env,{clock:()=>t0,fetcher:mockFetch});
  assert.equal(db.sourceHealth.last_status,429);
  assert.ok(db.sourceHealth.next_attempt>=t0+5*60000);
  assert.ok(first.warnings.some(x=>x.includes('GeckoTerminal')));
  assert.ok(db.risks.has(mint),'Triagem should not remain empty on HTTP 429');
  assert.equal(db.state.last_ok,1,'Alternative discovery does not make whole collector offline');
  await collect(env,{clock:()=>t0+60000,fetcher:mockFetch});
  assert.equal(mockFetch.geckoCalls,2,'Two Gecko cohorts on initial attempt, then no retries during cooldown');
 }finally{mockFetch.geckoRateLimited=false;}
});
