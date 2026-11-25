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
 assert.equal(major.filter(C.hasOdds).length,8);
 assert.ok(major.every(g=>g.result===null));
 const extra=major.find(g=>g.id==='cs2-match-2400572');
 assert.ok(extra&&C.hasOdds(extra));
 assert.equal(extra.markets.find(m=>m.key==='aWin').odd,1.11);
 assert.equal(extra.markets.find(m=>m.key==='bWin').odd,5.4);
 assert.equal(extra.quotes.captureMethod,'user_text');
 for(const g of major.filter(C.hasOdds)){
  assert.equal(g.markets.length,2);
  assert.ok(g.quotes&&!g.quotes.live);
  assert.ok(Date.parse(g.quotes.capturedAt)<Date.parse(g.startTime));
  assert.ok(Math.abs(g.markets.reduce((v,m)=>v+m.impliedNoVig,0)-1)<1e-12);
  if(g.bestOf===3){
   assert.equal(g.isMajorSeries,true);
   assert.equal(g.quotes.settlementScope,'series_winner_bo3');
   assert.ok(g.markets.every(m=>m.settlementScope==='series_winner_bo3'&&m.v2P===null));
   assert.ok(g.markets.every(m=>m.label.includes('série BO3')));
  }else{
   assert.equal(g.quotes.settlementScope,'map_winner_bo1');
   assert.ok(g.markets.every(m=>m.label.includes('mapa BO1')));
  }
 }
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
  majorLive:live,majorQuotes:load('major-br365-odds.json'),
  majorNov25Quotes:load('major-br365-odds-2026-11-25.json'),nowIso:feed.generatedAt};
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
test('Nov 25 has 7 pictured prices plus 1 text-only quote: 4 BO1 and 4 BO3',()=>{
 const screenshot=load('major-br365-odds-2026-11-25.json');
 assert.equal(screenshot.screenshotMatchCount,7);
 assert.equal(screenshot.additionalUserTextMatchCount,1);
 assert.equal(screenshot.matches.length,8);
 assert.equal(screenshot.matches.filter(q=>q.bestOf===1).length,4);
 assert.equal(screenshot.matches.filter(q=>q.bestOf===3).length,4);
 assert.deepEqual(screenshot.missingOdds,[]);
 assert.deepEqual(screenshot.matches.filter(x=>x.captureMethod==='user_text').map(x=>x.matchId),['cs2-match-2400572']);
 for(const q of screenshot.matches){
  const game=feed.games.find(g=>g.id===q.matchId);
  assert.ok(game&&game.eventId===screenshot.eventId);
  assert.equal(game.bestOf,q.bestOf);
  assert.equal(game.teamA.name,q.teamA);
  assert.equal(game.teamB.name,q.teamB);
  assert.equal(game.markets.find(m=>m.key==='aWin')?.odd,q.oddA);
  assert.equal(game.markets.find(m=>m.key==='bWin')?.odd,q.oddB);
  assert.ok(Date.parse(q.capturedAt)<Date.parse(game.startTime));
 }
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

test('radar keeps BO1 and BO3 selectable for five hours after their scheduled kickoff',()=>{
 const g=feed.games.find(g=>g.id==='cs2-match-2400570');
 const start=Date.parse(g.startTime);
 for(const delta of [-60000,0,1,60*60*1000,5*60*60*1000-1]){
  const now=start+delta;
  assert.ok(C.isRadarVisible(g,now),'missing '+delta);
  assert.ok(C.getRadarGames({games:[g]},now).some(x=>x.id===g.id));
  assert.ok(C.filterUpcoming({games:[g]},{filter:'all'},now).some(x=>x.id===g.id));
 }
 assert.equal(C.isRadarVisible(g,start+5*60*60*1000),false);
 assert.equal(C.getRadarGames({games:[g]},start+5*60*60*1000).length,0);
 assert.equal(C.getHistory({games:[g]},start+5*60*60*1000).length,1);
});
test('a completed or late-starting game stays readable in 5h radar, but kickoff blocks new study selections',()=>{
 const g=feed.games.find(g=>g.id==='cs2-match-2400570'),start=Date.parse(g.startTime);
 const gLive={...g,status:'live'},gCompleted={...g,status:'completed'};
 for(const recent of [gLive,gCompleted]){
  assert.equal(C.getRadarGames({games:[recent]},start+4*60*60*1000+59000).length,1);
  assert.equal(C.getHistory({games:[recent]},start+4*60*60*1000+59000).length,0);
  assert.equal(C.getUpcoming({games:[recent]},start+1000).length,0);
  assert.equal(C.isFuture(recent,start+1000),false);
  const selections=[{matchId:recent.id,key:'aWin'}];
  assert.equal(C.cleanSelections(selections,{games:[recent]},start+1000).length,0);
  assert.equal(C.studySummary(selections,{games:[recent]},start+1000).items.length,0);
 }
 const before=C.getUpcoming({games:[g]},start-1000);
 assert.equal(before.length,1);
 assert.equal(C.getHistory({games:[g]},start-1000).length,0);
});
test('generation keeps dated photographed odds for read-only five-hour review even when Major match completes',()=>{
 const g=feed.games.find(g=>g.id==='cs2-match-2400570');
 const start=Date.parse(g.startTime);
 const params={snapshot:load('tournaments.json'),nov19Context:load('nov19-context.json'),
  nov19Predictions:load('nov19-forecasts.json'),nov19Quotes:load('nov19-br365-all-markets.json'),
  prospective:load('prospective.json'),completed:load('results.json'),
  previousQuotes:load('br365-series-odds.json'),seriesFrozen:load('series-forecasts.json'),
  forms:load('team-opponents.json'),ranks:load('team-rankings.json'),sync:load('sync-state.json'),
  majorOpening:load('major-opening-snapshot.json'),majorAnalysis:load('major-opening-analysis.json'),
  majorLive:{...live,results:[...live.results,{id:g.id,status:'completed',scoreA:2,scoreB:1}]},
  majorQuotes:load('major-br365-odds.json'),majorNov25Quotes:load('major-br365-odds-2026-11-25.json'),
  nowIso:new Date(start+2*60*60*1000).toISOString()};
 const recent=buildRadarFeed(params).games.find(x=>x.id===g.id);
 assert.equal(recent.status,'completed');
 assert.equal(recent.markets.find(x=>x.key==='aWin')?.odd,1.74);
 assert.equal(recent.quotes.live,false);
 assert.equal(C.isFuture(recent,start+2*60*60*1000),false);
 const old=buildRadarFeed({...params,nowIso:new Date(start+5*60*60*1000+1).toISOString()}).games.find(x=>x.id===g.id);
 assert.equal(C.hasOdds(old),false);
});
