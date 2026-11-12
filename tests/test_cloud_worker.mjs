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
 constructor(){this.rows=[];this.state=null;this.daily=new Map()}
 prepare(sql){return {bind:(...args)=>({
  all:async()=>{
   if(sql.includes('WHERE completed=0'))return {results:this.rows.filter(r=>!r.completed&&r.triggered_at>args[0]).sort((a,b)=>b.triggered_at-a.triggered_at).slice(0,args[1])};
   if(sql.startsWith('SELECT mint FROM'))return {results:this.rows.filter(r=>r.triggered_at>args[0]&&args.slice(1).includes(r.mint)).map(r=>({mint:r.mint}))};
   if(sql.startsWith('SELECT * FROM signals WHERE triggered_at<'))return {results:this.rows.filter(r=>r.triggered_at<args[0]).sort((a,b)=>b.triggered_at-a.triggered_at).slice(0,args[1])};
   if(sql.startsWith('SELECT day,signals,measured5'))return {results:[...this.daily.entries()].map(([day,x])=>({day,...x}))};
   throw Error('Unknown all '+sql);
  },
  run:async()=>{
   if(sql.startsWith('UPDATE signals SET completed=1,')){for(const r of this.rows.filter(x=>!x.completed&&x.triggered_at<args[0])){r.completed=1;for(const key of ['m1','m5','m15','m30'])r[key+'_status'] ||= 'missing';}return {success:true};}
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
   if(sql.includes('COUNT(*)')){const measured=this.rows.filter(x=>x.m5_status==='measured');return {total:this.rows.length,day:this.rows.length,m5measured:measured.length,m5positive:measured.filter(x=>x.m5_return>0).length,m5avg:measured.reduce((sum,x)=>sum+x.m5_return,0)/(measured.length||1)};}
   throw Error('Unknown first '+sql);
  }
 })};}
}
const mockFetch=(url)=>{
 if(url.includes('geckoterminal'))return Promise.resolve({ok:true,json:async()=>gecko()});
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
 assert.equal(r.added,1);assert.equal(db.rows.length,1);assert.equal(db.rows[0].score,100);
 mockFetch.price='0.015';r=await collect(env,{clock:()=>t0+60_000,fetcher:mockFetch});
 assert.equal(r.added,0);assert.equal(db.rows[0].m1_status,'measured');assert.ok(Math.abs(db.rows[0].m1_return-50)<0.001);
 r=await collect(env,{clock:()=>t0+310_000,fetcher:mockFetch});
 assert.equal(db.rows[0].m5_status,'measured');
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
