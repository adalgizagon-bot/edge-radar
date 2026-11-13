import test from 'node:test';
import assert from 'node:assert/strict';
import {V2,scalpV2Candidate,scalpV2Exit} from '../cloud/scalp-v2.mjs';
const at=Date.now();
const pass=()=>({
 assessment:{eligible:true,tier:'exploratory'},tier:'exploratory',
 score:95,quote:'not_checked',risk:{level:'unverified',organic:null,top:null,dropP:0,alerts:[]},
 pair:{priceUsd:0.01,pairCreatedAt:at-20*60000,liquidity:{usd:35000},volume:{m5:9000},
  priceChange:{m5:7},txns:{m5:{buys:55,sells:20}}}
});
test('V2 is independently predeclared for forward-only paper research',()=>{
 assert.equal(V2.target,0.07);assert.equal(V2.stop,-0.03);
 assert.equal(V2.maxHoldMs,480000);assert.equal(V2.maxPositions,2);
 assert.equal(V2.dailyLossLimitUsd,15);
});
test('V2 candidate can be exploratory but never claim live tradability',()=>{
 const x=scalpV2Candidate(pass(),at);
 assert.deepEqual(x,{eligible:true,reason:'v2_candidato_experimental',tier:'exploratory'});
});
test('V2 conservatively rejects missing/too-new age and steep momentum',()=>{
 const p=pass();
 const cases=[
  {...p,score:70},
  {...p,pair:{...p.pair,liquidity:{usd:15000}}},
  {...p,pair:{...p.pair,volume:{m5:1000}}},
  {...p,pair:{...p.pair,txns:{m5:{buys:15,sells:20}}}},
  {...p,pair:{...p.pair,priceChange:{m5:30}}},
  {...p,pair:{...p.pair,priceChange:{m5:0}}},
  {...p,pair:{...p.pair,pairCreatedAt:null}},
  {...p,pair:{...p.pair,pairCreatedAt:at-2*60000}},
  {...p,risk:{...p.risk,organic:45}},
  {...p,risk:{...p.risk,top:30}},
  {...p,risk:{...p.risk,dropP:-3}},
  {...p,assessment:{eligible:false,tier:'rejected',reason:'risco_critico'}}
 ];
 for(const c of cases)assert.equal(scalpV2Candidate(c,at).eligible,false,JSON.stringify(c));
});
test('V2 no false stop or timeout without observed market price',()=>{
 const p={entry_price:1,opened_at:1000};
 assert.equal(scalpV2Exit(p,null,1000+1000000,{peak_price:1.06}),null);
 assert.match(scalpV2Exit(p,.965,1000+65000,null),/stop/);
 assert.match(scalpV2Exit(p,1.072,1000+65000,null),/alvo/);
 assert.match(scalpV2Exit(p,1.035,1000+8*60000,null),/limite/);
});
test('V2 trailing and flat exits never use future prices',()=>{
 const p={entry_price:1,opened_at:1000};
 assert.match(scalpV2Exit(p,1.03,1000+240000,{peak_price:1.06,weak_ticks:0}),/pico/);
 assert.match(scalpV2Exit(p,1.001,1000+240000,{peak_price:1.005,weak_ticks:0}),/sem impulso/);
 assert.equal(scalpV2Exit(p,1.04,1000+120000,{peak_price:1.04,weak_ticks:0}),null);
});
