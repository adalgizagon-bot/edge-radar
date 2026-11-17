import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_VERSION, roundWinRate, scoreDistribution, probabilityOverPoisson, generateFrozen, assess, metrics } from '../scripts/model.mjs';
const sample={name:'Mirage',played:12,roundsFor:132,roundsAgainst:121};
const other={name:'Mirage',played:10,roundsFor:105,roundsAgainst:115};
test('probability and regularized round rates are bounded',()=>{
 assert.equal(roundWinRate({...sample,played:2},other),null);
 const p=roundWinRate(sample,other);assert.ok(p>.5&&p<1);
 assert.equal(roundWinRate(sample,sample),.5);
});
test('MR12 score distribution sums to 100%, with correct symmetry and OT',()=>{
 const dist=scoreDistribution(.5);
 const sum=dist.reduce((s,x)=>s+x.prob,0);
 const pa=dist.filter(x=>x.a>x.b).reduce((s,x)=>s+x.prob,0);
 assert.ok(Math.abs(sum-1)<1e-10);
 assert.ok(Math.abs(pa-.5)<.00001);
 assert.ok(dist.every(x=>x.a!==x.b && x.rounds>=13));
 assert.ok(dist.some(x=>x.rounds>24));
});
test('Poisson over/under distribution is sensible',()=>{
 assert.ok(probabilityOverPoisson(18,15.5)>probabilityOverPoisson(11,15.5));
 assert.ok(probabilityOverPoisson(18,15.5)>0&&probabilityOverPoisson(18,15.5)<1);
});
const fixture={id:'cs2-match-example',event:'Example',startTime:'2026-11-18T12:00:00Z',teamA:{id:'a',name:'Alpha'},teamB:{id:'b',name:'Beta'}};
const snapshot={fetchedAt:'2026-11-17T12:00:00Z',matches:[fixture],teams:[
 {id:'a',maps:[sample]},{id:'b',maps:[other]}]};
const players={teams:[{id:'a',players:[{id:'p',nickname:'One',teamId:'a'}]}],players:[
 {id:'p',teamId:'a',nickname:'One',fetchedAt:'2026-11-17T11:00:00Z',maps:[{name:'Mirage',count:10,kpr:.7}]}]};
test('freeze immutable forecasts: no duplicate, no predictions after start',()=>{
 const first=generateFrozen({forecasts:[]},snapshot,players,'2026-11-17T20:00:00Z');
 assert.equal(first.model,MODEL_VERSION);
 assert.equal(first.forecasts.length,4);
 const again=generateFrozen(first,snapshot,players,'2026-11-17T21:00:00Z');
 assert.equal(again.forecasts.length,4);
 assert.deepEqual(first.forecasts,again.forecasts);
 const late=generateFrozen({forecasts:[]},snapshot,players,'2026-11-18T12:01:00Z');
 assert.equal(late.forecasts.length,0);
});
test('resolve only played maps and observed player kills',()=>{
 const forecasts=generateFrozen({forecasts:[]},snapshot,players,'2026-11-17T20:00:00Z');
 let tracked=assess(forecasts.forecasts,{matches:[]});
 assert.equal(tracked.filter(x=>x.status==='resolved').length,0);
 const result={matches:[{id:fixture.id,verifiedAt:'2026-11-19T12:00:00Z',maps:[
 {name:'Mirage',scoreA:13,scoreB:10,players:[{id:'p',kills:17}]}]}]};
 tracked=assess(forecasts.forecasts,result);
 assert.equal(tracked.filter(x=>x.status==='resolved').length,4);
 const byId=Object.fromEntries(tracked.map(x=>[x.kind,x]));
 assert.equal(byId.map_a.outcome,1);
 assert.equal(byId.rounds_over_21_5.outcome,1);
 assert.equal(byId.handicap_a_minus_2_5.outcome,1);
 assert.equal(byId.kills_over_15_5.outcome,1);
 const summary=metrics(tracked);
 assert.equal(summary.resolved,4);
 assert.ok(summary.byMarket.every(x=>x.brier>=0&&x.brier<=1));
});
