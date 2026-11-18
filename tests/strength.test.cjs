'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'public/data',name),'utf8'));
const core=require('../public/strength-core.js');
const ranks=read('team-rankings.json'),form=read('team-opponents.json'),
 long=read('team-long-history.json'),short=read('tournaments.json');
test('365-day history covers all 16 teams and includes the 90-day sample',()=>{
 assert.equal(long.teams.length,16);
 for(const t of short.teams){
  const old=long.teams.find(x=>x.id===t.id);
  assert.ok(old,'missing 365 days '+t.name);
  assert.ok(old.totalMaps>=t.totalMaps,'365 days should not be smaller '+t.name);
 }
});
test('recent opponent sample has 15 completed matches per team with true opponent identifiers',()=>{
 assert.equal(form.teams.length,16);
 for(const t of form.teams){
  assert.ok(t.recent.length>0&&t.recent.length<=15,t.name);
  assert.equal(new Set(t.recent.map(m=>m.id)).size,t.recent.length);
  assert.ok(t.recent.every(x=>['W','L'].includes(x.result)&&x.opponent.id&&x.opponent.id!==t.id));
  assert.ok(t.recent.every(x=>Date.parse(x.startsAt)<Date.parse(form.fetchedAt)));
 }
});
test('ranking comparisons and tiers are descriptive, not calibrated probabilities',()=>{
 assert.ok(ranks.ranks.length>50);
 assert.equal(core.tier(8),'Top 20');
 assert.equal(core.tier(32),'21–50');
 assert.equal(core.tier(78),'51–100');
 assert.equal(core.tier(150),'101+');
 assert.equal(core.tier(null),'Sem ranking');
 assert.ok(core.expectedByRank(20,50)>.5);
 assert.ok(Math.abs(core.expectedByRank(20,50)+core.expectedByRank(50,20)-1)<1e-12);
});
test('Nexus and BIG historical map sample is larger at 365 days',()=>{
 const nexus=short.teams.find(t=>t.name==='Nexus'),big=short.teams.find(t=>t.name==='BIG');
 assert.ok(long.teams.find(x=>x.id===nexus.id).totalMaps>nexus.totalMaps);
 assert.ok(long.teams.find(x=>x.id===big.id).totalMaps>big.totalMaps);
});
test('comparison keeps teams separate and computes opponent difficulty',()=>{
 const game=short.matches.find(x=>x.teamA.name==='Betclic'&&x.teamB.name==='BIG');
 const v=core.compare(game,form,short,long,ranks,15);
 assert.equal(v.sides.length,2);
 assert.equal(v.sides[0].name,'Betclic');
 assert.equal(v.sides[1].name,'BIG');
 assert.ok(v.sides[0].form.medianOpponentRank>v.sides[1].form.medianOpponentRank);
 assert.ok(v.sides.every(t=>t.form.vsTop50.games<=15));
 assert.ok(v.sides.every(t=>t.form.expectedSamples<=t.form.n));
 assert.ok(v.sides.every(t=>t.mapStats.length>0));
});
test('selecting 5 or 10 series never changes the underlying data',()=>{
 const record=form.teams.find(x=>x.name==='BIG');
 const original=record.recent.length;
 const five=core.summary(record,34,5,form.fetchedAt),ten=core.summary(record,34,10,form.fetchedAt);
 assert.equal(five.n,5);assert.equal(ten.n,10);assert.equal(record.recent.length,original);
 assert.ok([five,ten].every(x=>x.wins+x.losses===x.n));
});
test('front-end includes reachable strength page and loadable scripts',()=>{
 const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
 assert.ok(html.includes('data-tab="strength"'));
 assert.ok(html.includes('<section class="view" id="strength">'));
 for(const t of ['id="strength-game"','id="strength-limit"','id="strength-versus"','id="strength-history"','id="strength-opponents"','src="strength-core.js"','src="strength.js"','href="strength.css"'])
  assert.ok(html.includes(t),'missing '+t);
});
