import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {collect} from '../cloud/worker.mjs';
import {paperSnapshot} from '../cloud/paper-agent.mjs';
import {auditSnapshot} from '../cloud/audit.mjs';
const MINT='11111111111111111111111111111111',SOL='So11111111111111111111111111111111111111112';

function localD1(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../cloud/schema.sql',import.meta.url),'utf8'));
 const wrap=(statement,args)=>({
  run:async()=>({meta:{changes:Number(statement.run(...args).changes)}}),
  first:async()=>statement.get(...args)||null,
  all:async()=>({results:statement.all(...args)})
 });
 return {prepare(text){const stmt=sql.prepare(text);const raw=wrap(stmt,[]);
  return {...raw,bind:(...args)=>wrap(stmt,args)};
 },async batch(stmts){sql.exec('BEGIN');try{
   const result=[];for(const stmt of stmts)result.push(await stmt.run());
   sql.exec('COMMIT');return result;
  }catch(e){sql.exec('ROLLBACK');throw e;}
 },close(){sql.close();}};
}
function market(t0){
 let currentPrice=.01,failDexBatch=false,failGecko=false;
 const json=data=>({ok:true,headers:{get:()=>null},json:async()=>data});
 const token={id:MINT,name:'Example',symbol:'EX',usdPrice:.01,decimals:6,isVerified:true,
  organicScore:85,liquidity:35000,
  audit:{mintAuthorityDisabled:true,freezeAuthorityDisabled:true,topHoldersPercentage:9},
  stats5m:{buyVolume:30000,sellVolume:10000,numBuys:60,numSells:14},
  firstPool:{createdAt:new Date(t0-20*60000).toISOString()}};
 const gecko={data:[{attributes:{address:'pool',name:'Example / SOL',pool_created_at:new Date(t0-20*60000).toISOString(),reserve_in_usd:'30000',
   volume_usd:{m5:'9000'},transactions:{m5:{buys:60,sells:14}},
   price_change_percentage:{m5:'8'},base_token_price_usd:String(currentPrice)},
   relationships:{base_token:{data:{id:'solana_'+MINT}},dex:{data:{id:'solana_pump_swap'}}}}],
  included:[{id:'solana_'+MINT,attributes:{name:'Example',symbol:'EX',address:MINT}},
   {id:'solana_pump_swap',attributes:{name:'PumpSwap'}}]};
 const pair=()=>({chainId:'solana',dexId:'pumpswap',baseToken:{address:MINT,name:'Example',symbol:'EX'},
  priceUsd:String(currentPrice),liquidity:{usd:30000},volume:{m5:9000},
  txns:{m5:{buys:60,sells:14}},priceChange:{m5:8},pairCreatedAt:t0-20*60000});
 const fetcher=async url=>{
  if(url.includes('geckoterminal'))return failGecko?{ok:false,status:429,headers:{get:()=>null}}:json(gecko);
  if(url.includes('tokens/v2/recent')||url.includes('tokens/v2/search'))return json([token,{id:SOL,usdPrice:100,decimals:9}]);
  if(url.includes('token-profiles/latest'))return json([]);
  if(url.includes('api.dexscreener.com/tokens/v1/solana/')){
   if(failDexBatch)return {ok:false,status:429,headers:{get:()=>null}};
   return json([pair()]);
  }
  if(url.includes('/swap/v2/order'))return json({outAmount:'150000000',router:'test-no-execution'});
  throw Error('Unexpected URL '+url);
 };
 return {fetcher,setPrice:v=>{currentPrice=v},failDex:v=>{failDexBatch=v},failGecko:v=>{failGecko=v}};
}
test('D1 integration: scalp closes after observed +6%, baseline still open, both remain fictional',async()=>{
 const db=localD1();const t0=Date.now();const source=market(t0);
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'false',
  FRONTEND_ORIGIN:'https://edge-radar-gamma.vercel.app'};
 try{
  const first=await collect(env,{clock:()=>t0,fetcher:source.fetcher});
  assert.equal(first.errors.length,0,'first collect succeeds');
  const firstSnapshot=await paperSnapshot(env,t0);
  assert.equal(firstSnapshot.aiConfigured,false);
  assert.equal(firstSnapshot.comparisonSince,t0);
  assert.ok(firstSnapshot.positions.some(x=>x.strategy==='scalp'));
  assert.ok(firstSnapshot.positions.some(x=>x.strategy==='baseline'));
  assert.ok(firstSnapshot.evidence.some(x=>x.strategy==='scalp'));
  source.setPrice(.0106);
  const next=await collect(env,{clock:()=>t0+60000,fetcher:source.fetcher});
  assert.equal(next.errors.length,0,'second collect succeeds');
  const after=await paperSnapshot(env,t0+60000);
  assert.ok(after.trades.some(x=>x.strategy==='scalp'&&x.action==='sell'));
  assert.ok(after.positions.some(x=>x.strategy==='baseline'));
  assert.ok(!after.positions.some(x=>x.strategy==='scalp'));
  const scalp=after.performance.find(x=>x.strategy==='scalp');
  assert.equal(scalp.sells,1);
  assert.ok(scalp.realized_pnl>0);
  assert.ok(Number(scalp.stress_pnl)>-1,'stress scenario computed');
  assert.ok(Number(scalp.max_drawdown_usd)>=0);
  assert.equal(after.scalpDiagnostics.candidates>=1,true);
  assert.equal(after.fees.stressEachSidePct,2.5);
 }finally{db.close();}
});
test('D1 integration: missing prices do not invent scalp exits or a positive equity mark',async()=>{
 const db=localD1(),t0=Date.now(),source=market(t0);
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'false'};
 try{
  await collect(env,{clock:()=>t0,fetcher:source.fetcher});
  source.failDex(true);source.failGecko(true);
  const result=await collect(env,{clock:()=>t0+7*60000,fetcher:source.fetcher});
  assert.ok([...result.errors,...result.warnings].some(x=>x.includes('DEX Screener')));
  const snap=await paperSnapshot(env,t0+7*60000);
  assert.ok(snap.positions.some(x=>x.strategy==='scalp'),'no fake time exit without real price');
  assert.equal(snap.accounts.find(x=>x.strategy==='scalp').equity_usd,null);
 }finally{db.close();}
});

test('Cloudflare provides a secure same-origin standalone read-only laboratory',async()=>{
 const db=localD1(),env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'false'};
 try{
  const {handle}=await import('../cloud/worker.mjs');
  const response=await handle(new Request('https://worker.example/lab'),env);
  const text=await response.text();
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/html/);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.ok(text.includes('Edge Scalp Rápido'));
  assert.ok(text.includes("fetch('/api/paper'"));
  assert.ok(!text.includes('OPENAI_API_KEY'));
 }finally{db.close();}
});

test('V2 starts forward-only, logs entry features and closes only on observed target',async()=>{
 const db=localD1(),t0=Date.now(),source=market(t0);
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'false'};
 try{
  const initial=await collect(env,{clock:()=>t0,fetcher:source.fetcher});
  assert.equal(initial.errors.length,0);
  const before=await paperSnapshot(env,t0);
  assert.equal(before.v2Since,t0);
  assert.ok(before.positions.some(x=>x.strategy==='scalp_v2'));
  assert.ok(Math.abs(before.profiles.scalp_v2.targetPct-7)<1e-9);
  assert.equal(before.profiles.scalp_v2.holdMinutes,8);
  source.setPrice(.0108);
  const second=await collect(env,{clock:()=>t0+60000,fetcher:source.fetcher});
  assert.equal(second.errors.length,0);
  const after=await paperSnapshot(env,t0+60000);
  assert.ok(!after.positions.some(x=>x.strategy==='scalp_v2'));
  assert.ok(after.trades.some(x=>x.strategy==='scalp_v2'&&x.action==='sell'));
  assert.ok(after.positions.some(x=>x.strategy==='baseline'),'baseline preserved');
  const audit=await auditSnapshot(env,t0+60000,100);
  assert.equal(audit.complete,true);
  assert.equal(audit.v2Since,t0);
  const v2=audit.rows.find(x=>x.strategy==='scalp_v2');
  assert.ok(v2);
  assert.equal(v2.reason_group,'alvo');
  assert.ok(v2.volume5m>0,'entry data captured at buy');
  assert.ok(v2.sample_count>=2,'observed quote path');
  assert.ok(v2.sampled_peak_return_pct>=7,'sampled, not interpolated');
  assert.equal(v2.duration_minutes,1);
  assert.ok(audit.forwardSummary.some(x=>x.strategy==='scalp_v2'&&x.closed===1));
 }finally{db.close();}
});
test('Audit web routes serve own-origin read-only history, no artificial trades',async()=>{
 const db=localD1(),env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'false'};
 try{
  const {handle}=await import('../cloud/worker.mjs');
  const page=await handle(new Request('https://worker.example/audit'),env);
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
  const html=await page.text();assert.ok(html.includes('Auditoria de operações fictícias'));
  assert.ok(html.includes("fetch('/api/audit?limit=1000'"));
  const api=await handle(new Request('https://worker.example/api/audit?limit=100'),env);
  assert.equal(api.status,200);
  const json=await api.json();assert.equal(json.totalClosed,0);
  assert.deepEqual(json.rows,[]);
 }finally{db.close();}
});
test('No price means no V2 fill and no invented audited results',async()=>{
 const db=localD1(),t0=Date.now(),source=market(t0);
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'false'};
 try{
  await collect(env,{clock:()=>t0,fetcher:source.fetcher});
  source.failDex(true);source.failGecko(true);
  await collect(env,{clock:()=>t0+9*60000,fetcher:source.fetcher});
  const snap=await paperSnapshot(env,t0+9*60000);
  assert.ok(snap.positions.some(x=>x.strategy==='scalp_v2'));
  assert.equal(snap.accounts.find(x=>x.strategy==='scalp_v2').equity_usd,null);
  const a=await auditSnapshot(env,t0+9*60000,100);
  assert.ok(!a.rows.some(x=>x.strategy==='scalp_v2'));
 }finally{db.close();}
});

test('Live Gecko pool observations keep paper discovery alive during DEX HTTP 429',async()=>{
 const db=localD1(),t0=Date.now(),source=market(t0);
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'false'};
 try{
  source.failDex(true);
  const out=await collect(env,{clock:()=>t0,fetcher:source.fetcher});
  assert.ok(out.warnings.some(x=>x.includes('DEX Screener')));
  assert.equal(out.errors.length,0,'Fresh Gecko price should avoid false platform outage');
  const snap=await paperSnapshot(env,t0);
  assert.ok(snap.positions.some(x=>x.strategy==='scalp_v2'),'V2 is able to study a candidate with complete fresh Gecko observations');
  const next=await collect(env,{clock:()=>t0+60000,fetcher:source.fetcher});
  assert.ok(next.warnings.some(x=>x.includes('DEX Screener em pausa')));
  assert.equal(next.errors.length,0,'Price source pause does not invalidate already stored history');
  assert.equal((await paperSnapshot(env,t0+60000)).v2Since,t0);
 }finally{db.close();}
});
