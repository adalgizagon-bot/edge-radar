import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {collect} from '../cloud/worker.mjs';
import {paperSnapshot} from '../cloud/paper-agent.mjs';
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
 let currentPrice=.01,failDexBatch=false;
 const json=data=>({ok:true,headers:{get:()=>null},json:async()=>data});
 const token={id:MINT,name:'Example',symbol:'EX',usdPrice:.01,decimals:6,isVerified:true,
  organicScore:85,liquidity:35000,
  audit:{mintAuthorityDisabled:true,freezeAuthorityDisabled:true,topHoldersPercentage:9},
  stats5m:{buyVolume:30000,sellVolume:10000,numBuys:60,numSells:14},
  firstPool:{createdAt:new Date(t0-20*60000).toISOString()}};
 const gecko={data:[{attributes:{address:'pool',name:'Example / SOL',reserve_in_usd:'30000',
   volume_usd:{m5:'9000'},transactions:{m5:{buys:60,sells:14}},
   price_change_percentage:{m5:'8'},base_token_price_usd:String(currentPrice)},
   relationships:{base_token:{data:{id:'solana_'+MINT}},dex:{data:{id:'solana_pump_swap'}}}}],
  included:[{id:'solana_'+MINT,attributes:{name:'Example',symbol:'EX',address:MINT}},
   {id:'solana_pump_swap',attributes:{name:'PumpSwap'}}]};
 const pair=()=>({chainId:'solana',dexId:'pumpswap',baseToken:{address:MINT,name:'Example',symbol:'EX'},
  priceUsd:String(currentPrice),liquidity:{usd:30000},volume:{m5:9000},
  txns:{m5:{buys:60,sells:14}},priceChange:{m5:8},pairCreatedAt:t0-20*60000});
 const fetcher=async url=>{
  if(url.includes('geckoterminal'))return json(gecko);
  if(url.includes('tokens/v2/recent')||url.includes('tokens/v2/search'))return json([token,{id:SOL,usdPrice:100,decimals:9}]);
  if(url.includes('token-profiles/latest'))return json([]);
  if(url.includes('api.dexscreener.com/tokens/v1/solana/')){
   if(failDexBatch)return {ok:false,status:429,headers:{get:()=>null}};
   return json([pair()]);
  }
  if(url.includes('/swap/v2/order'))return json({outAmount:'150000000',router:'test-no-execution'});
  throw Error('Unexpected URL '+url);
 };
 return {fetcher,setPrice:v=>{currentPrice=v},failDex:v=>{failDexBatch=v}};
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
  source.failDex(true);
  const result=await collect(env,{clock:()=>t0+7*60000,fetcher:source.fetcher});
  assert.ok(result.errors.some(x=>x.includes('DEX Screener parcial')));
  const snap=await paperSnapshot(env,t0+7*60000);
  assert.ok(snap.positions.some(x=>x.strategy==='scalp'),'no fake time exit without real price');
  assert.equal(snap.accounts.find(x=>x.strategy==='scalp').equity_usd,null);
 }finally{db.close();}
});
