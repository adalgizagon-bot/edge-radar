import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildBo1Scenario,createMajorOpeningResearch} from '../scripts/major-bo1.mjs';
import {reconcileMajorLive,gradeMajorBO1} from '../scripts/major-sync.mjs';
const dir=path.join(import.meta.dirname,'../public/data');
const load=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const snapshot=load('major-opening-snapshot.json'),research=load('major-opening-analysis.json');
test('Major Stage 1 has 8 genuine BO1 fixtures and 16 unique teams',()=>{
 assert.equal(snapshot.fixtures.length,8);
 assert.equal(snapshot.teams.length,16);
 assert.equal(new Set(snapshot.teams.map(t=>t.id)).size,16);
 assert.ok(snapshot.fixtures.every(g=>g.bestOf===1&&Date.parse(g.startsAt)>Date.parse(snapshot.capturedAt)));
 assert.ok(snapshot.fixtures.every(g=>g.veto.confirmedMap===null));
});
test('only four complete 90d map samples support an experimental BO1 estimate',()=>{
 assert.equal(snapshot.teams.filter(t=>t.mapStats).length,8);
 assert.equal(research.forecasts.length,8);
 assert.equal(research.modeled,4);
 assert.equal(research.unmodeled,4);
 for(const f of research.forecasts){
  assert.ok(Date.parse(f.frozenAt)<Date.parse(f.startsAt));
  assert.equal(f.bestOf,1);
  assert.equal(f.confirmedMap,null);
  assert.equal(f.validForBettingRecommendation,false);
  assert.equal(f.oddsAvailable,false);
  if(f.status==='exploratory'){
    assert.ok(f.modelProbabilityA>0&&f.modelProbabilityA<1);
    assert.ok(f.mapsEligible>=3);
    assert.ok(f.vetoSensitivity.minA<=f.modelProbabilityA&&f.modelProbabilityA<=f.vetoSensitivity.maxA);
    assert.ok(Math.abs(f.modelProbabilityA+f.modelProbabilityB-1)<1e-12);
  }else assert.equal(f.modelProbabilityA,null);
 }
});
test('recomputing map scenarios from exactly the same pregame data yields identical model estimates',()=>{
 const generated=createMajorOpeningResearch(snapshot,research.frozenAt);
 for(let i=0;i<8;i++)assert.deepEqual(generated.forecasts[i],research.forecasts[i]);
});
test('BO3 or post-kickoff input never gets scored by BO1',()=>{
 const a=snapshot.teams.find(t=>t.id===snapshot.fixtures[0].teamA.id);
 const b=snapshot.teams.find(t=>t.id===snapshot.fixtures[0].teamB.id);
 assert.throws(()=>buildBo1Scenario({...snapshot.fixtures[0],bestOf:3},a,b,research.frozenAt));
 assert.throws(()=>buildBo1Scenario(snapshot.fixtures[0],a,b,'2026-11-24T04:00:01Z'));
});
test('one event-level Cito result call verifies completed games without editing pregame probabilities',()=>{
 const first=snapshot.fixtures[0],original=JSON.stringify(research);
 const fake=[{id:first.id,eventId:first.eventId,startsAt:first.startsAt,bestOf:1,
   team1Id:first.teamA.id,team2Id:first.teamB.id,team1Name:first.teamA.name,team2Name:first.teamB.name,
   eventName:'PGL Major Singapore',stageName:'Swiss Round 1',status:'completed',
   winnerTeamId:first.teamA.id,team1Score:1,team2Score:0,maps:[]}];
 const reconciled=reconcileMajorLive({fixtures:[],results:[]},fake,'cs2-event-9303','2026-11-24T08:00:00Z');
 assert.equal(reconciled.results.length,1);
 const graded=gradeMajorBO1(research,reconciled,'2026-11-24T08:01:00Z');
 assert.equal(graded.resolved,1);
 assert.equal(JSON.stringify(research),original);
 assert.ok(graded.meanBrier>=0&&graded.meanBrier<=1);
});
