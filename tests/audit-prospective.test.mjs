import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildChallenger,expectedByRank} from '../scripts/challenger.mjs';
import {audit} from '../scripts/audit.mjs';
import {appendProspective,gradeProspective} from '../scripts/prospective.mjs';
const root=path.join(import.meta.dirname,'../public/data/');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const originals=read('series-forecasts.json'),results=read('results.json'),form=read('team-opponents.json'),
 ranks=read('team-rankings.json'),maps=read('validation.json'),storedAudit=read('audit-2026-11-18.json'),snapshot=read('tournaments.json');
test('frozen Nov 18 source integrity and minimum seven completions',()=>{
 assert.equal(originals.matches.length,7);
 assert.ok(results.matches.length>=7);
 for(const m of originals.matches){
  assert.ok(Date.parse(m.frozenAt)<Date.parse(m.startsAt));
  assert.ok(Date.parse(m.modelSnapshotAt)<Date.parse(m.startsAt));
  assert.ok(Date.parse(m.oddsCapturedApprox)<Date.parse(m.startsAt));
 }
});
test('audit reproduces seven real results without altering frozen probabilities',()=>{
 const before=JSON.stringify(originals);
 const review=audit(originals,results,maps,null,'2026-11-18T23:50:00Z');
 assert.ok(review.completed>=7);
 assert.equal(review.winner.correctModel,3);
 assert.equal(review.winner.correctMarket,2);
 assert.ok(Math.abs(review.winner.brierModel-.2893054395952625)<1e-9);
 assert.ok(Math.abs(review.winner.brierMarket-.28745145102653363)<1e-9);
 assert.equal(storedAudit.completed,review.completed);
 assert.equal(JSON.stringify(originals),before);
});
test('post-hoc challenger is not misrepresented as future validation',()=>{
 const challenged=buildChallenger(originals,form,ranks,'2026-11-18T23:45:00Z');
 assert.equal(challenged.prospectivelyValidated,false);
 assert.equal(challenged.createdAfterResults,true);
 assert.equal(challenged.trainedOnToday,false);
 assert.equal(challenged.forecasts.length,7);
 assert.ok(challenged.forecasts.every(x=>x.probabilities.aWin>0&&x.probabilities.aWin<1));
 assert.equal(expectedByRank(72,27)<.5,true);
});
test('future prospective A/B snapshot is immutable and rejects post-kickoff data',()=>{
 const fixture={...snapshot.matches[0],id:'synthetic-FUTURE-001',startTime:'2026-11-20T15:00:00Z',status:'upcoming'};
 const fake={...snapshot,fetchedAt:'2026-11-18T08:21:48Z',matches:[fixture]};
 const now='2026-11-19T10:00:00Z';
 const saved=appendProspective({forecasts:[]},fake,form,ranks,now);
 assert.equal(saved.forecasts.length,1);
 assert.equal(saved.forecasts[0].frozenAt,now);
 assert.equal(saved.forecasts[0].matchId,fixture.id);
 const again=appendProspective(saved,fake,form,ranks,'2026-11-19T11:00:00Z');
 assert.deepEqual(saved.forecasts,again.forecasts);
 const late=appendProspective({forecasts:[]},fake,form,ranks,'2026-11-20T15:01:00Z');
 assert.equal(late.forecasts.length,0);
 const unsafe=appendProspective({forecasts:[]},{...fake,fetchedAt:'2026-11-21T12:00:00Z'},form,ranks,'2026-11-21T12:00:00Z');
 assert.equal(unsafe.forecasts.length,0);
});
test('only verified completed matches grade future A/B predictions',()=>{
 const fixture={...snapshot.matches[0],id:'synthetic-FUTURE-002',startTime:'2026-11-20T15:00:00Z',status:'upcoming'};
 const input=appendProspective({forecasts:[]},{...snapshot,fetchedAt:'2026-11-18T08:21:48Z',matches:[fixture]},form,ranks,'2026-11-19T10:00:00Z');
 assert.equal(gradeProspective(input,{matches:[{id:fixture.id,status:'live',scoreA:1,scoreB:0}]},'2026-11-20T16:00:00Z').resolved,0);
 const score=gradeProspective(input,{matches:[{id:fixture.id,status:'completed',scoreA:2,scoreB:0}]},'2026-11-20T20:00:00Z');
 assert.equal(score.resolved,1);
 assert.ok(score.meanBrierV1>=0&&score.meanBrierV1<=1);
 assert.ok(score.meanBrierV2>=0&&score.meanBrierV2<=1);
});
test('audited UI and scripts remain available',()=>{
 const html=fs.readFileSync(path.join(import.meta.dirname,'../public/laboratorio.html'),'utf8');
 assert.ok(html.includes('data-tab="audit"'));
 assert.ok(html.includes('<section class="view" id="audit">'));
 for(const needle of ['src="audit.js"','href="audit.css"','id="audit-match-body"','id="audit-model-brier"'])assert.ok(html.includes(needle));
});
