import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildRadarFeed} from '../scripts/radar-feed.mjs';
const require=createRequire(import.meta.url);
const C=require('../public/radar-core.js');
const root=path.join(import.meta.dirname,'../public');
const load=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const feed=load('radar-feed.json');
const t=Date.parse('2026-11-19T00:25:00Z');
test('radar shows only three future Nov 19 fixtures, never the eight Nov 18 games',()=>{
 const next=C.getUpcoming(feed,t);
 assert.equal(next.length,3);
 assert.equal(next.filter(C.hasOdds).length,3);
 assert.ok(next.every(x=>x.startTime.startsWith('2026-11-19')));
 assert.ok(next.every(x=>x.markets.length===12));
 assert.equal(C.getHistory(feed,t).length,8);
});
test('past matches cannot re-enter radar even if old snapshot still calls them upcoming',()=>{
 assert.equal(C.getUpcoming(feed,Date.parse('2026-11-20T12:00:00Z')).length,0);
 assert.equal(C.getHistory(feed,Date.parse('2026-11-20T12:00:00Z')).length,11);
});
test('study allows only one selection per game and expires it at kickoff',()=>{
 const ids=C.getUpcoming(feed,t).map(x=>x.id);
 const picks=[{matchId:ids[0],key:'aWin'},{matchId:ids[0],key:'a20'},{matchId:ids[1],key:'bWin'}];
 const s=C.studySummary(picks,feed,t);
 assert.equal(s.items.length,2);assert.equal(s.removed,1);
 assert.ok(s.product>1);
 const late=C.studySummary(picks,feed,Date.parse('2026-11-20T12:00:00Z'));
 assert.equal(late.items.length,0);assert.equal(late.product,null);
});
test('unknown future game is clearly unpriced and never assigned model odds',()=>{
 const extra={id:'synthetic-future',startTime:'2026-11-25T17:00:00Z',status:'scheduled',
 event:'Tier 1',teamA:{name:'A'},teamB:{name:'B'},quotes:null,markets:[]};
 const all={...feed,games:[...feed.games,extra]};
 assert.equal(C.hasOdds(extra),false);
 assert.ok(C.filterUpcoming(all,{filter:'waiting'},t).some(x=>x.id===extra.id));
 assert.ok(!C.filterUpcoming(all,{filter:'odds'},t).some(x=>x.id===extra.id));
});
test('stored prices always reuse existing frozen probabilities, without rewriting forecasts',()=>{
 const records=load('prospective.json').forecasts;
 for(const g of C.getUpcoming(feed,t)){
  const original=records.find(x=>x.matchId===g.id);
  assert.ok(original&&Date.parse(original.frozenAt)<Date.parse(g.startTime));
  assert.ok(g.quotes&&Date.parse(g.quotes.capturedAt)<Date.parse(g.startTime));
  for(const row of g.markets){
   assert.ok(Math.abs(row.v1P-original.v1.score[row.key])<1e-9);
   assert.ok(Math.abs(row.v2P-original.v2.score[row.key])<1e-9);
  }
 }
});
test('unified feed regenerates deterministically from stored source snapshots',()=>{
 const params={snapshot:load('tournaments.json'),nov19Context:load('nov19-context.json'),
 nov19Predictions:load('nov19-forecasts.json'),nov19Quotes:load('nov19-br365-all-markets.json'),
 prospective:load('prospective.json'),completed:load('results.json'),
 previousQuotes:load('br365-series-odds.json'),seriesFrozen:load('series-forecasts.json'),
 forms:load('team-opponents.json'),ranks:load('team-rankings.json'),sync:load('sync-state.json'),
 nowIso:'2026-11-19T00:30:00Z'};
 const generated=buildRadarFeed(params);
 assert.deepEqual(generated.games,feed.games);
 assert.equal(generated.games.length,11);
});
test('navigation is exactly one active radar, plus study, results; old pages archived',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const legacy=fs.readFileSync(path.join(root,'laboratorio.html'),'utf8');
 for(const name of ['radar','study','history']){
  assert.ok(html.includes('data-view="'+name+'"'));
  assert.ok(html.includes('id="page-'+name+'"'));
 }
 assert.ok(html.includes('src="radar-app.js"')&&html.includes('src="radar-core.js"'));
 assert.ok(!html.includes('src="nextday.js"'));
 assert.ok(legacy.includes('id="nextday"'));
});
