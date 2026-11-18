'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../public/opportunities-core.js');
const date='2026-11-18T12:00:00.000Z';
function game(i){
 return {id:'cs2-match-'+i,eventId:i<=4?'cs2-event-9258':'cs2-event-9273',
 event:'Example event',startTime:date,status:'upcoming',teamA:{id:'a'+i,name:'Alpha'+i},teamB:{id:'b'+i,name:'Beta'+i}};
}
function forecast(m,i,kind='map_a',probability=.65,sample=12){
 return {id:m.id+'|'+i+'|'+kind,kind,matchId:m.id,map:'Mirage',
  teamA:m.teamA.name,teamB:m.teamB.name,startsAt:m.startTime,
  snapshotAt:'2026-11-17T12:00:00Z',label:'Sample market',
  observationsA:sample,observationsB:sample,probability,
  observedPlayerMaps:kind==='kills_over_15_5'?sample:undefined};
}
const fixtures=Array.from({length:8},(_,i)=>game(i+1));
const f=fixtures.flatMap((m,i)=>[forecast(m,i,'map_a',.58+.03*i,12),forecast(m,i,'kills_over_15_5',.75,4)]);
// Explicitly thin player sample.
test('filter data older than match and minimum sample',()=>{
 const invalid={...forecast(fixtures[0],100),id:'future-leak',snapshotAt:'2026-11-19T12:00:00Z'};
 const thin={...forecast(fixtures[0],101),id:'thin',observationsA:2};
 const snapshots={forecasts:[...f,invalid,thin]};
 const result=core.assemble(snapshots,{matches:fixtures},'2026-11-17T18:00:00Z');
 assert.equal(result.length,16);
 assert.equal(result.filter(x=>x.kind==='kills_over_15_5').length,8);
 assert.ok(result.every(x=>x.mapConfirmed===false));
 assert.ok(result.every(x=>x.sample>=4));
});
test('rank and limit a combo to one forecast per distinct game',()=>{
 const signals=core.assemble({forecasts:f},{matches:fixtures},'2026-11-17T18:00:00Z');
 const combinations=core.initialSelections(signals,8);
 assert.equal(combinations.length,8);
 assert.equal(new Set(combinations.map(x=>x.matchId)).size,8);
 assert.equal(core.initialSelections(signals,3).length,3);
 assert.equal(core.initialSelections(signals,2).length,2);
 assert.throws(()=>core.combinationStats([signals[0],signals.find(x=>x.matchId===signals[0].matchId&&x.id!==signals[0].id)]),/one market per match/);
});
test('probability product is mathematical only and not calibrated',()=>{
 const input=core.initialSelections(core.assemble({forecasts:f},{matches:fixtures},'2026-11-17T18:00:00Z'),8);
 const stats=core.combinationStats(input);
 assert.equal(stats.legs,8);
 assert.equal(stats.unconfirmedMaps,8);
 assert.equal(stats.strictlyHypothetical,true);
 assert.ok(Math.abs(stats.independentProbability-input.reduce((a,x)=>a*x.probability,1))<1e-12);
 assert.ok(Math.abs(stats.indicativeFairOdd-1/stats.independentProbability)<1e-12);
});
test('event and market filters do not cross-contaminate other matches',()=>{
 const signals=core.assemble({forecasts:f},{matches:fixtures},'2026-11-17T18:00:00Z');
 const chosen=core.filtered(signals,{event:'cs2-event-9258',market:'map_a',minimum:.60,quality:'12'});
 assert.ok(chosen.length>0);
 assert.ok(chosen.every(x=>x.eventId==='cs2-event-9258'&&x.kind==='map_a'&&x.sample>=12&&x.probability>=.6));
 const qualified=core.filtered(signals,{quality:'8'});
 assert.ok(qualified.every(x=>x.sample>=8));
});
test('HTML contains new landing page and controls',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 assert.match(html,/<section class="view active" id="opportunities">/);
 for(const id of ['radar-ranked-list','radar-combo-legs','radar-game-grid','radar-copy','radar-event','radar-market']){
  assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 }
 assert.match(html,/src="opportunities-core.js"/);
 assert.match(html,/src="opportunities.js"/);
});
