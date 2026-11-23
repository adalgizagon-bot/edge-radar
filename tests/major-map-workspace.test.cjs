'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../public/major-map-core.js');
const at='2026-11-24T04:00:00.000Z';
const p={id:'p1',nickname:'Player',history:[
 {map:'Mirage',at:'2026-11-10T04:00:00Z',kills:22,rounds:25,teamId:'a',matchId:'match-1'},
 {map:'Mirage',at:'2026-10-10T04:00:00Z',kills:13,rounds:18,teamId:'a',matchId:'match-2'},
 {map:'Mirage',at:'2026-06-10T04:00:00Z',kills:17,rounds:23,teamId:'old',matchId:'match-3'},
 {map:'Nuke',at:'2026-11-10T04:00:00Z',kills:30,rounds:26,teamId:'a',matchId:'match-4'},
 {map:'Mirage',at:'2026-11-24T06:00:00Z',kills:99,rounds:27,teamId:'a',matchId:'future'},
 {map:'Mirage',at:'2026-11-10T04:00:00Z',kills:22,rounds:25,teamId:'a',matchId:'match-1'}
 ]};
test('map selector lists active map pool without forcing a veto',()=>{
 const a={teamMaps:[{name:'Mirage',inPool:true},{name:'Dust2',inPool:false}]};
 const b={teamMaps:[{name:'Inferno',inPool:true},{name:'Mirage',inPool:true}]};
 assert.deepEqual(M.getMaps(a,b),['Inferno','Mirage']);
 assert.equal(M.getTeamMap(a,'MIRAGE').name,'Mirage');
});
test('kills are scoped to selected map, cutoff and distinct match; old teams stay visible',()=>{
 const m=M.summarize(p,'Mirage',180,16.5,'a',at);
 assert.equal(m.n,3);
 assert.equal(m.currentTeamN,2);assert.equal(m.priorTeamN,1);
 assert.equal(m.over,2);assert.equal(m.under,1);assert.equal(m.meanKills,17.3);
 assert.equal(M.summarize(p,'Mirage',90,16.5,'a',at).n,2);
 assert.equal(M.summarize(p,'Mirage',180,16.5,'a',at,'current').n,2);
 assert.equal(M.summarize(p,'Nuke',90,16.5,'a',at).n,1);
});
test('observed frequency never becomes claimed edge with too few maps or a partial source',()=>{
 assert.equal(M.comparePrice(1.85,.6,3).gap,null);
 assert.equal(M.comparePrice(1.85,.6,18,true).gap,null);
 const p=M.comparePrice(2,.6,18,false);
 assert.equal(p.implied,.5);assert.ok(Math.abs(p.gap-.1)<1e-10);
});
test('single radar loads map-first component and all sixteen Major team snapshots',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 assert.ok(html.includes('major-map-workspace.js'));
 assert.ok(html.includes('major-map-core.js'));
 const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-opening-snapshot.json'),'utf8'));
 for(const team of fixture.teams){
  const profile=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-teams',team.id+'.json'),'utf8'));
  assert.equal(profile.teamId,team.id);
  assert.equal(profile.players.length,5);
  assert.ok(profile.players.every(p=>Array.isArray(p.history)));
  assert.ok(profile.teamMaps.length>=5);
 }
});
