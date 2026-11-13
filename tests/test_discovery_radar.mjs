import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {poolAgeMillis,selectGeckoPairs,mergeFreshPairs} from '../cloud/gecko-prices.mjs';
import {selectBalancedCandidates} from '../cloud/discovery.mjs';
import {collect,handle,parsePools} from '../cloud/worker.mjs';
const NEW='11111111111111111111111111111111',OLD='22222222222222222222222222222222';
function d1(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../cloud/schema.sql',import.meta.url),'utf8'));
 const wrap=(stmt,args)=>({run:async()=>({meta:{changes:Number(stmt.run(...args).changes)}}),
  first:async()=>stmt.get(...args)||null,
  all:async()=>({results:stmt.all(...args)})});
 return {prepare(q){const stmt=sql.prepare(q);return {...wrap(stmt,[]),bind:(...args)=>wrap(stmt,args)};},
  async batch(statements){sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result}
   catch(e){sql.exec('ROLLBACK');throw e}},close(){sql.close()}};
}
const body=(mint,at,days=0)=>({
 data:[{attributes:{address:mint,name:(days?'OLD':'NEW')+' / SOL',reserve_in_usd:'45000',
    volume_usd:{m5:'15000'},transactions:{m5:{buys:90,sells:20}},
    price_change_percentage:{m5:'7'},base_token_price_usd:'0.007',
    pool_created_at:new Date(at-(days?days*24*3600000:10*60000)).toISOString()},
   relationships:{base_token:{data:{id:'solana_'+mint}},dex:{data:{id:'solana_pump_swap'}}}}],
 included:[{id:'solana_'+mint,attributes:{name:days?'Two months old':'Fresh launch',symbol:days?'OLD':'NEW',address:mint}},
 {id:'solana_pump_swap',attributes:{name:'PumpSwap'}}]
});
const json=x=>({ok:true,headers:{get:()=>null},json:async()=>x});
test('Pool creation time and fresh Gecko quotes include enough fields for risk screening',()=>{
 const at=Date.now(),p=parsePools(body(OLD,at,60),'trending_24h');
 assert.equal(p.length,1);assert.equal(p[0].mint,OLD);
 assert.ok(Math.abs(p[0].createdAt-(at-60*24*3600000))<2000);
 assert.equal(poolAgeMillis('not a date'),null);
 const quotes=selectGeckoPairs(p,at);
 assert.equal(quotes.get(OLD)?.volume.m5,15000);
 assert.equal(quotes.get(OLD)?.txns.m5.buys,90);
 assert.ok(quotes.get(OLD)?.pairCreatedAt>0);
 assert.equal(mergeFreshPairs(new Map(),quotes).get(OLD)?.priceSource,'gecko');
});
test('Balanced discovery preserves established pools when a fresh-launch feed is full',()=>{
 const ids=i=>({mint:String(i).padStart(32,'1')});
 const fresh=Array.from({length:50},(_,i)=>ids(i+1));
 const hour=[{mint:OLD,source:'trending_1h'}];
 const older=[{mint:NEW,source:'trending_24h'}];
 const result=selectBalancedCandidates([fresh,[],hour,older],10,[4,0,3,3]);
 assert.equal(result.length,10);
 assert.ok(result.some(x=>x.mint===OLD));
 assert.ok(result.some(x=>x.mint===NEW));
});
test('DB retains two-month-old trending token after quote provider returns 429',async()=>{
 const db=d1();
 const now=Date.now(),slot=Math.floor(now/180000),
  at=(slot-((slot-2+3)%3))*180000;
 const seen=[];
 let failBoth=false;
 const fetcher=async url=>{
  seen.push(url);
  if(url.includes('geckoterminal')){
   if(failBoth)return {ok:false,status:429,headers:{get:()=>null}};
   return json(url.includes('trending_pools')?body(OLD,at,60):body(NEW,at,0));
  }
  if(url.includes('api.dexscreener.com/tokens/v1/'))return {ok:false,status:429,headers:{get:()=>null}};
  if(url.includes('api.jup.ag/tokens/v2/recent'))return json([]);
  if(url.includes('api.jup.ag/tokens/v2/search'))return json([]);
  throw Error('Unexpected URL '+url);
 };
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'false',PAPER_AI_ENABLED:'false'};
 try{
  const result=await collect(env,{clock:()=>at,fetcher});
  assert.equal(result.errors.length,0,'Gecko covers prices even when DEX rate limits');
  assert.ok(seen.some(x=>x.includes('duration=24h')));
  const old=(await handle(new Request('https://worker.example/api/discover?group=established&limit=50'),env));
  assert.equal(old.status,200);
  const data=await old.json();
  assert.ok(data.rows.some(x=>x.mint===OLD&&x.score>=70));
  const recent=await(await handle(new Request('https://worker.example/api/discover?group=new'),env)).json();
  assert.ok(recent.rows.some(x=>x.mint===NEW));
  failBoth=true;
  await collect(env,{clock:()=>at+3*60000,fetcher});
  const historic=await(await handle(new Request('https://worker.example/api/discover?group=established'),env)).json();
  assert.ok(historic.rows.some(x=>x.mint===OLD),'Token remains visible even if rate-limited after previous observation');
  const page=await handle(new Request('https://worker.example/radar'),env);
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
  const html=await page.text();
  assert.ok(html.includes('Antigos · 1 dia+'));
  assert.ok(html.includes('Preço desatualizado'));
 }finally{db.close();}
});
