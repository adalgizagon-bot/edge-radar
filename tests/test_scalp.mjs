import test from 'node:test';
import assert from 'node:assert/strict';
import {SCALP,scalpCandidate,nextScalpTracking,scalpExit} from '../cloud/scalp.mjs';
import {assessPaperCandidate} from '../cloud/paper-agent.mjs';
const t0=Date.now();
const c=()=>({
 mint:'11111111111111111111111111111111',stage:'priority',score:86,quote:'not_checked',
 pair:{chainId:'solana',dexId:'pumpswap',priceUsd:'0.001',liquidity:{usd:18000},volume:{m5:5000},
  priceChange:{m5:8},txns:{m5:{buys:33,sells:13}},pairCreatedAt:t0-15*60000},
 risk:{level:'unverified',alerts:[],verified:false,organic:null,top:null,dropP:0},
 assessment:{eligible:true,tier:'exploratory'}
});
test('6-minute scalp is distinct from the 20-minute baseline, with independent capital limits',()=>{
 assert.equal(SCALP.target,0.05);assert.equal(SCALP.stop,-0.03);
 assert.equal(SCALP.maxHoldMs,360000);assert.equal(SCALP.maxPositions,2);
 assert.equal(SCALP.dailyLossLimitUsd,25);
});
test('Scalp approves valid hypothetical exploratory candidates without claiming verified execution',()=>{
 const x=scalpCandidate(c(),t0);
 assert.equal(x.eligible,true);assert.equal(x.tier,'exploratory');
 const audited={...c(),assessment:{eligible:true,tier:'audited'}};
 assert.equal(scalpCandidate(audited,t0).tier,'audited');
});
test('Scalp rejects extreme pumps, thin markets, weak buys and recent pools',()=>{
 const p=c();
 const changes=[
  {...p,score:59},
  {...p,pair:{...p.pair,liquidity:{usd:8000}}},
  {...p,pair:{...p.pair,volume:{m5:900}}},
  {...p,pair:{...p.pair,priceChange:{m5:34}}},
  {...p,pair:{...p.pair,priceChange:{m5:-0.5}}},
  {...p,pair:{...p.pair,txns:{m5:{buys:12,sells:18}}}},
  {...p,pair:{...p.pair,pairCreatedAt:t0-30000}},
  {...p,risk:{...p.risk,dropP:-2.2}},
  {...p,assessment:{eligible:false,tier:'rejected',reason:'risco_critico'}}
 ];
 for(const x of changes)assert.equal(scalpCandidate(x,t0).eligible,false,JSON.stringify(x));
});
test('Scalp continues to respect the shared baseline hard-risk screens',()=>{
 const x=c();
 const shared=assessPaperCandidate({...x,risk:{...x.risk,level:'blocked',alerts:['congelamento']}},t0);
 assert.equal(shared.eligible,false);
 assert.equal(scalpCandidate({...x,assessment:shared},t0).eligible,false);
});
test('Tracking does not count repeated observations twice and retains peak',()=>{
 const pos=nextScalpTracking(null,1,1000);
 const first=nextScalpTracking(pos,1.04,61000);
 const second=nextScalpTracking(first,1.029,121000);
 const third=nextScalpTracking(second,1.021,181000);
 assert.equal(first.peak_price,1.04);
 assert.equal(second.peak_price,1.04);
 assert.equal(second.weak_ticks,1);
 assert.equal(third.weak_ticks,2);
 assert.deepEqual(nextScalpTracking(third,0.9,181000),third,'same timestamp cannot duplicate weak tick');
 assert.equal(nextScalpTracking(third,null,200000),third);
});
test('Scalp stop/target use observed prices only; elapsed time does not fabricate an exit quote',()=>{
 const p={entry_price:1,opened_at:1000};
 assert.equal(scalpExit(p,null,1000+900000,null),null);
 assert.match(scalpExit(p,.96,1000+60000,null),/stop/);
 assert.match(scalpExit(p,1.051,1000+60000,null),/alvo/);
 assert.match(scalpExit(p,1.01,1000+360000,null),/tempo maximo/);
 assert.equal(scalpExit(p,1.02,1000+60000,null),null);
});
test('Scalp early-exits on two weak observed prices and on flat movement after 3 minutes',()=>{
 const p={entry_price:1,opened_at:1000};
 assert.match(scalpExit(p,1.006,1000+120000,{peak_price:1.015,weak_ticks:2}),/duas observacoes/);
 assert.match(scalpExit(p,1.005,1000+181000,{peak_price:1.007,weak_ticks:0}),/sem forca/);
 assert.equal(scalpExit(p,1.02,1000+181000,{peak_price:1.02,weak_ticks:0}),null);
});
test('Trailing response is based on recorded peak, not hindsight',()=>{
 const p={entry_price:1,opened_at:1000};
 assert.match(scalpExit(p,1.019,1000+150000,{peak_price:1.04,weak_ticks:0}),/devolucao/);
 assert.equal(scalpExit(p,1.03,1000+150000,{peak_price:1.04,weak_ticks:0}),null);
});
test('Net fee sensitivity: +5% spot is close to break-even with 2.5% on each side',()=>{
 const stake=20,entry=1,exit=1.05;
 const pnl=fee=>stake/(entry*(1+fee))*exit*(1-fee)-stake;
 assert.ok(pnl(.01)>0.5&&pnl(.01)<0.7);
 assert.ok(pnl(.025)<0&&pnl(.025)>-0.1);
 const factor=(1+.01)*(1-.025)/((1+.025)*(1-.01));
 assert.ok(Math.abs((pnl(.01)+stake)*factor-stake-pnl(.025))<1e-8);
});
