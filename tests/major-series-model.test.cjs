'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../public/major-map-core.js'),S=require('../public/major-series-model.js');
const root=path.join(__dirname,'../public/data');
const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const feed=load('radar-feed.json'),rankHistory=load('major-opponent-rank-history.json');
const bo3=feed.games.filter(g=>g.isMajorSeries&&g.bestOf===3&&g.startTime.startsWith('2026-11-25'));
const profile=id=>load('major-teams/'+id+'.json');
test('series math yields expected BO3 winner and mutually exclusive exact scores',()=>{
 const x=S.seriesOdds(.6,.7,.45);
 const manual=.6*.7+(.6*.3+.4*.7)*.45;
 assert.ok(Math.abs(x.probabilityA-manual)<1e-12);
 assert.ok(Math.abs(x.probabilityA+x.probabilityB-1)<1e-12);
 assert.ok(Math.abs(x.a20+x.a21+x.b20+x.b21-1)<1e-12);
 assert.equal(S.seriesOdds(1,1,0).probabilityA,1);
 assert.equal(S.seriesOdds(0,0,1).probabilityA,0);
 assert.equal(S.seriesOdds(.5,.5,1.2),null);
});
test('all four Major BO3 encounters receive independent per-map and overall series projections',()=>{
 assert.equal(bo3.length,4);
 for(const g of bo3){
  const a=profile(g.teamA.id),b=profile(g.teamB.id);
  const original=JSON.stringify(g),r=S.projectSeries(g,a,b,rankHistory);
  assert.equal(r.status,'estimated',g.id+': '+r.reason);
  assert.equal(r.scenarioType,'provisional_veto_scenarios');
  assert.equal(r.selectedCount,0);
  assert.ok(r.scenarioCount>=6);
  assert.ok(r.allMapProjections.length>=3);
  assert.ok(r.eligibleMaps.length>=3);
  assert.ok(r.probabilityA>=0&&r.probabilityA<=1);
  assert.ok(Math.abs(r.probabilityA+r.probabilityB-1)<1e-11);
  assert.ok(r.allMapProjections.every(x=>x.sampleA>=0&&x.sampleB>=0));
  for(const x of r.eligibleMaps){
   assert.ok(x.probabilityA>0&&x.probabilityA<1);
   assert.ok(x.sampleA>=5&&x.sampleB>=5);
  }
  assert.equal(r.calibrated,false);
  assert.equal(JSON.stringify(g),original,'game must stay unchanged');
 }
});
test('selecting three maps exactly composes map-by-map win chances into SERIES chance',()=>{
 for(const g of bo3){
  const a=profile(g.teamA.id),b=profile(g.teamB.id);
  const pre=S.projectSeries(g,a,b,rankHistory);
  const names=pre.eligibleMaps.slice(0,3).map(m=>m.name);
  const slots={map1:names[0],map2:names[1],map3:names[2]};
  const p=S.projectSeries(g,a,b,rankHistory,slots);
  assert.equal(p.status,'estimated',g.id);
  assert.equal(p.scenarioType,'confirmed_map_scenario');
  assert.equal(p.scenarioCount,1);
  assert.equal(p.selectedCount,3);
  const indiv=names.map(n=>pre.eligibleMaps.find(m=>M.norm(m.name)===M.norm(n)).probabilityA);
  const expected=S.seriesOdds(...indiv);
  assert.ok(Math.abs(p.probabilityA-expected.probabilityA)<1e-12);
  assert.ok(Math.abs(p.scores.a2_0-expected.a20)<1e-12);
  assert.deepEqual(p.selectedMaps,names);
  assert.equal(S.projectSeries(g,a,b,rankHistory,{...slots,map2:slots.map1}).status,'duplicate_maps');
 }
});
test('one map selected still generates a conditional series forecast, without guessing others',()=>{
 for(const game of bo3){
  const a=profile(game.teamA.id),b=profile(game.teamB.id);
  const base=S.projectSeries(game,a,b,rankHistory);
  const one=S.projectSeries(game,a,b,rankHistory,{map1:base.eligibleMaps[0].name});
  assert.equal(one.status,'estimated');
  assert.equal(one.selectedCount,1);
  assert.ok(one.scenarioCount>=2);
  assert.equal(one.selectedMaps[0],base.eligibleMaps[0].name);
  assert.equal(one.selectedMaps[1],'');
  assert.equal(one.calibrated,false);
 }
});
test('series probabilities are NOT read from or fitted to bookmaker odds',()=>{
 const g=bo3.find(x=>x.id==='cs2-match-2400572'),a=profile(g.teamA.id),b=profile(g.teamB.id);
 const before=S.projectSeries(g,a,b,rankHistory);
 const altered={...g,markets:g.markets.map(m=>({...m,odd:23.5,impliedNoVig:.5}))};
 const after=S.projectSeries(altered,a,b,rankHistory);
 assert.equal(before.probabilityA,after.probabilityA);
 assert.equal(before.probabilityB,after.probabilityB);
 assert.equal(before.scores.a2_0,after.scores.a2_0);
});
test('UI shows all map probabilities and series winner with score distributions',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 const workspace=fs.readFileSync(path.join(__dirname,'../public/major-map-workspace.js'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../public/radar-app.js'),'utf8');
 assert.ok(html.includes('major-series-model.js'));
 assert.ok(html.indexOf('major-intelligence-core.js')<html.indexOf('major-series-model.js'));
 assert.ok(html.indexOf('major-series-model.js')<html.indexOf('major-map-workspace.js'));
 assert.ok(workspace.includes('S.projectSeries(game,left,right,rankHistory,seriesState)'));
 assert.ok(workspace.includes('onMapProjection(chosen,projection,seriesPrediction)'));
 assert.ok(workspace.includes('stage.allMapProjections'));
 assert.ok(workspace.includes('stage.scores.a2_0'));
 assert.ok(app.includes('seriesProjection.probabilityA'));
 assert.ok(app.includes('ATLAS MD3'));
 assert.ok(app.includes('seriesProjection?.scenarioType'));
});
