import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildRadarFeed} from '../scripts/radar-feed.mjs';
const require=createRequire(import.meta.url),C=require('../public/radar-core.js');
const root=path.join(import.meta.dirname,'../public');
const load=n=>JSON.parse(fs.readFileSync(path.join(root,'data',n),'utf8'));
const feed=load('radar-feed.json'),live=load('major-live.json'),pre=load('major-preflight-v1.json');
const firstRound=pre.forecasts.map(x=>x.matchId);
test('old Nov 19 odds and models remain in historical archive',()=>{
 const prior=feed.games.filter(g=>g.startTime.startsWith('2026-11-19'));
 assert.equal(prior.length,3);
 assert.ok(prior.every(g=>g.status==='completed'&&C.hasOdds(g)&&g.markets.length===12));
 const records=load('prospective.json').forecasts;
 for(const g of prior){
  const orig=records.find(x=>x.matchId===g.id);
  assert.ok(orig&&Date.parse(orig.frozenAt)<Date.parse(g.startTime));
  assert.ok(g.quotes&&Date.parse(g.quotes.capturedAt)<Date.parse(g.startTime));
  for(const row of g.markets){
   assert.ok(Math.abs(row.v1P-orig.v1.score[row.key])<1e-9);
   assert.ok(Math.abs(row.v2P-orig.v2.score[row.key])<1e-9);
  }
 }
});
test('completed day one Major BO1 is not advertised as upcoming or live quoted',()=>{
 const day1=feed.games.filter(g=>firstRound.includes(g.id));
 assert.equal(day1.length,8);
 assert.ok(day1.every(g=>g.status==='completed'&&g.bestOf===1&&g.result));
 assert.ok(day1.every(g=>g.markets.every(m=>m.odd===null||m.odd===undefined)));
 assert.equal(C.getUpcoming(feed,Date.parse('2026-11-25T01:00:00Z')).filter(g=>firstRound.includes(g.id)).length,0);
 assert.equal(live.results.filter(g=>firstRound.includes(g.id)).length,8);
});
test('Nov 25 matches have a clean upcoming panel and retain BO1/BO3 distinction',()=>{
 const upcoming=C.getUpcoming(feed,Date.parse('2026-11-25T01:00:00Z'));
 const major=upcoming.filter(g=>g.eventId==='cs2-event-9303');
 assert.equal(major.length,8);
 assert.equal(major.filter(g=>g.bestOf===1).length,4);
 assert.equal(major.filter(g=>g.bestOf===3).length,4);
 assert.ok(major.every(g=>!C.hasOdds(g)));
 assert.ok(major.every(g=>g.result===null));
});
test('study selections expire after kickoff, even when old screenshots remain archived',()=>{
 const ids=feed.games.filter(g=>g.startTime.startsWith('2026-11-19')).map(x=>x.id);
 const picks=[{matchId:ids[0],key:'aWin'},{matchId:ids[0],key:'a20'},{matchId:ids[1],key:'bWin'}];
 const earlier={...feed,games:feed.games.map(g=>g.startTime.startsWith('2026-11-19')?{...g,status:'scheduled'}:g)};
 const study=C.studySummary(picks,earlier,Date.parse('2026-11-19T00:25:00Z'));
 assert.equal(study.items.length,2);
 assert.equal(study.removed,1);
 assert.equal(C.studySummary(picks,feed,Date.parse('2026-11-25T01:00:00Z')).items.length,0);
});
test('original seven BR365 screenshots remain dated and are never re-labelled live',()=>{
 const quotes=load('major-br365-odds.json');
 assert.equal(quotes.matches.length,7);
 assert.equal(new Set(quotes.matches.map(x=>x.matchId)).size,7);
 assert.equal(quotes.missingOdds.length,1);
 assert.ok(quotes.matches.every(x=>Number.isFinite(x.oddA)&&Number.isFinite(x.oddB)));
 assert.ok(quotes.matches.every(x=>Date.parse(x.capturedAt)<Date.parse('2026-11-24T04:00:00Z')));
 for(const fixture of pre.forecasts)assert.ok(Date.parse(pre.frozenAt)<Date.parse(fixture.startsAt));
});
test('major outcomes are reconstructed from event-level published data without editing frozen files',()=>{
 const oldForecasts=JSON.stringify(load('major-opening-analysis.json'));
 const oldPreflight=JSON.stringify(pre);
 const params={snapshot:load('tournaments.json'),nov19Context:load('nov19-context.json'),
  nov19Predictions:load('nov19-forecasts.json'),nov19Quotes:load('nov19-br365-all-markets.json'),
  prospective:load('prospective.json'),completed:load('results.json'),
  previousQuotes:load('br365-series-odds.json'),seriesFrozen:load('series-forecasts.json'),
  forms:load('team-opponents.json'),ranks:load('team-rankings.json'),sync:load('sync-state.json'),
  majorOpening:load('major-opening-snapshot.json'),majorAnalysis:load('major-opening-analysis.json'),
  majorLive:live,majorQuotes:load('major-br365-odds.json'),nowIso:feed.generatedAt};
 const generated=buildRadarFeed(params);
 assert.equal(new Set(generated.games.map(g=>g.id)).size,generated.games.length);
 for(const result of live.results){
  const game=generated.games.find(g=>g.id===result.id);
  assert.ok(game&&game.status==='completed',result.id);
  assert.equal(game.result.scoreA,result.scoreA);
  assert.equal(game.result.scoreB,result.scoreB);
 }
 assert.equal(JSON.stringify(load('major-opening-analysis.json')),oldForecasts);
 assert.equal(JSON.stringify(pre),oldPreflight);
});
test('archive and one unified radar screen stay available',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const legacy=fs.readFileSync(path.join(root,'laboratorio.html'),'utf8');
 for(const name of ['radar','study','history']){
  assert.ok(html.includes('data-view="'+name+'"'));
  assert.ok(html.includes('id="page-'+name+'"'));
 }
 assert.ok(html.includes('Major Singapura'));
 assert.ok(legacy.includes('id="nextday"'));
});
