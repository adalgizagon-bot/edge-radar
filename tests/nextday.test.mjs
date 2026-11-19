import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const base=path.join(import.meta.dirname,'../public');
const read=p=>JSON.parse(fs.readFileSync(path.join(base,p),'utf8'));
const v=read('data/nov19-forecasts.json'),p=read('data/prospective.json'),context=read('data/nov19-context.json');
test('three Nov 19 predictions frozen before starting each match',()=>{
 assert.equal(v.metrics.length,3);assert.equal(p.forecasts.filter(x=>v.metrics.some(m=>m.id===x.matchId)).length,3);
 for(const m of v.metrics){
  const f=p.forecasts.find(x=>x.matchId===m.id);
  assert.ok(Date.parse(v.frozenAt)<Date.parse(m.scheduledAt));
  assert.ok(Date.parse(f.frozenAt)<Date.parse(f.startsAt));
  assert.equal(m.vetoStatus,'not_confirmed');assert.equal(m.odds.verifiedLive,false);
  assert.ok(Math.abs(m.v1.pA-f.v1.pA)<1e-10);
  assert.ok(Math.abs(m.v2.pA-f.v2.pA)<1e-10);
  assert.ok(Math.abs(m.v2.pA+m.v2.pB-1)<1e-10);
  assert.ok(Math.abs(m.odds.noVigA+m.odds.noVigB-1)<1e-10);
  assert.ok(m.v1.sampleFloor>=4);
 }
});
test('19 Nov snapshots include six distinct teams, recent form and ranking',()=>{
 assert.equal(context.teams.length,6);assert.equal(new Set(context.teams.map(x=>x.id)).size,6);
 assert.equal(context.recent.teams.length,6);
 assert.ok(context.fixtures.every(g=>g.eventId==='cs2-event-9258'&&g.bestOf===3));
 assert.ok(context.recent.teams.every(t=>t.recent.length>=10&&t.recent.every(m=>Date.parse(m.startsAt)<Date.parse(context.fetchedAt))));
 assert.ok(context.ranking.ranks.length>=50);
});
test('dashboard is the Nov 19 starting page, without invented post-veto markets',()=>{
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 assert.ok(html.includes('data-tab="nextday"'));
 assert.ok(html.includes('<section class="view active" id="nextday">'));
 assert.ok(html.includes('src="nextday.js"'));
 assert.ok(html.includes('id="nd-resolved-count"'));
 assert.ok(html.includes('href="nextday.css"'));
});
