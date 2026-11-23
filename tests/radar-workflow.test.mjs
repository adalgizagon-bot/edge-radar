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
const t19=Date.parse('2026-11-19T00:25:00Z');
const tMajor=Date.parse('2026-11-23T19:00:00Z');
test('Nov 19 historic screen is preserved in archive and never mistaken for current Major',()=>{
 // Historical records are correctly marked completed now; inspect their immutable archive,
 // not the future-only Radar, even when evaluating their old scheduled date.
 const prior=feed.games.filter(g=>g.startTime.startsWith('2026-11-19'));
 assert.equal(prior.length,3);
 assert.ok(prior.every(C.hasOdds));
 assert.ok(prior.every(g=>g.markets.length===12));
 const today=C.getUpcoming(feed,tMajor);
 assert.equal(today.length,8);
 assert.ok(today.every(g=>g.eventId==='cs2-event-9303'&&g.bestOf===1));
});
test('Nov 18 results stay archived; November Major expires after kickoff',()=>{
 assert.equal(feed.games.filter(g=>g.startTime.startsWith('2026-11-18')).length,8);
 assert.equal(C.getUpcoming(feed,Date.parse('2026-11-24T12:00:00Z')).filter(g=>g.eventId==='cs2-event-9303').length,0);
});
test('study accepts only one quoted selection per match and expires it at kickoff',()=>{
 const ids=feed.games.filter(g=>g.startTime.startsWith('2026-11-19')).map(x=>x.id);
 const picks=[{matchId:ids[0],key:'aWin'},{matchId:ids[0],key:'a20'},{matchId:ids[1],key:'bWin'}];
 const earlier={...feed,games:feed.games.map(g=>g.startTime.startsWith('2026-11-19')?
  {...g,status:'scheduled'}:g)};
 const s=C.studySummary(picks,earlier,t19);
 assert.equal(s.items.length,2);assert.equal(s.removed,1);assert.ok(s.product>1);
 assert.equal(C.studySummary(picks,feed,tMajor).items.length,0);
});
test('Major BO1 has seven dated screenshot quotes, not live odds or BO3-only markets',()=>{
 const major=C.getUpcoming(feed,tMajor);
 assert.equal(major.length,8);
 assert.equal(major.filter(g=>Number.isFinite(g.model?.v2)).length,4);
 assert.equal(major.filter(C.hasOdds).length,7);
 for(const g of major){
  assert.ok(g.markets.every(m=>m.family==='winner'));
  assert.equal(g.major?.vetoConfirmed,false);
  if(C.hasOdds(g)){
   assert.equal(g.quotes.live,false);
   assert.equal(g.markets.length,2);
   assert.ok(Date.parse(g.quotes.capturedAt)<Date.parse(g.startTime));
   assert.ok(g.markets.every(m=>Number.isFinite(m.odd)&&Number.isFinite(m.impliedNoVig)));
   assert.ok(Math.abs(g.markets.reduce((s,m)=>s+m.impliedNoVig,0)-1)<1e-10);
  }else{
   assert.equal(g.id,'cs2-match-2400498');
   assert.ok(g.markets.every(m=>m.odd===null));
  }
 }
 const quoted=major.find(g=>g.id==='cs2-match-2400495');
 assert.equal(C.studySummary([{matchId:quoted.id,key:'aWin'}],feed,tMajor).items.length,1);
});
test('no map history means odds can be shown without inventing a model probability',()=>{
 const noModel=C.getUpcoming(feed,tMajor).filter(g=>!g.model);
 assert.equal(noModel.length,4);
 assert.ok(noModel.every(g=>g.markets.every(m=>m.v2P===null)));
 assert.ok(noModel.every(g=>g.major?.modelStatus==='insufficient_data'));
});
test('old frozen Nov 19 odds and models are preserved unchanged',()=>{
 const records=load('prospective.json').forecasts;
 for(const g of feed.games.filter(x=>x.startTime.startsWith('2026-11-19'))){
  const original=records.find(x=>x.matchId===g.id);
  assert.ok(original&&Date.parse(original.frozenAt)<Date.parse(g.startTime));
  assert.ok(g.quotes&&Date.parse(g.quotes.capturedAt)<Date.parse(g.startTime));
  for(const row of g.markets){
   assert.ok(Math.abs(row.v1P-original.v1.score[row.key])<1e-9);
   assert.ok(Math.abs(row.v2P-original.v2.score[row.key])<1e-9);
  }
 }
});
test('radar feed reconstructs from dated sources without modifying frozen forecasts',()=>{
 const params={snapshot:load('tournaments.json'),nov19Context:load('nov19-context.json'),
 nov19Predictions:load('nov19-forecasts.json'),nov19Quotes:load('nov19-br365-all-markets.json'),
 prospective:load('prospective.json'),completed:load('results.json'),
 previousQuotes:load('br365-series-odds.json'),seriesFrozen:load('series-forecasts.json'),
 forms:load('team-opponents.json'),ranks:load('team-rankings.json'),sync:load('sync-state.json'),
 majorOpening:load('major-opening-snapshot.json'),majorAnalysis:load('major-opening-analysis.json'),
 majorLive:load('major-live.json'),majorQuotes:load('major-br365-odds.json'),nowIso:'2026-11-23T19:00:00Z'};
 const generated=buildRadarFeed(params);
 assert.deepEqual(generated.games,feed.games);
 assert.equal(generated.games.filter(x=>x.major).length,8);
});
test('current source freshness uses Cito Major snapshot rather than old daily sync',()=>{
 assert.equal(C.isSourceStale(feed,tMajor),false);
});
test('single front page and archived laboratory still exist',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const legacy=fs.readFileSync(path.join(root,'laboratorio.html'),'utf8');
 for(const name of ['radar','study','history']){
  assert.ok(html.includes('data-view="'+name+'"'));
  assert.ok(html.includes('id="page-'+name+'"'));
 }
 assert.ok(html.includes('Major Singapura'));
 assert.ok(legacy.includes('id="nextday"'));
});
