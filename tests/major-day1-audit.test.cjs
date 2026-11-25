'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const I=require('../public/major-intelligence-core.js');
const root=path.join(__dirname,'../public/data'),load=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const audit=load('major-day1-audit.json'),provenance=load('major-day1-kills-source-quality.json');
const pre=load('major-preflight-v1.json'),live=load('major-live.json');
test('Day1 audit is aligned only with the 8 immutable pregame forecasts, not all day 1 matches',()=>{
 assert.equal(pre.forecasts.length,8);
 assert.equal(audit.records.length,8);
 assert.equal(audit.summary.games,8);
 assert.ok(Date.parse(pre.frozenAt)<Math.min(...pre.forecasts.map(x=>Date.parse(x.startsAt))));
 assert.equal(audit.frozenAt,pre.frozenAt);
 const ids=new Set(pre.forecasts.map(x=>x.matchId));
 assert.ok(audit.records.every(x=>ids.has(x.matchId)));
 assert.ok(live.results.length>=16);
});
test('first round winners, maps and Brier are computed from the frozen scenarios',()=>{
 let hits=0,total=0,brier=0,roundAbs=0;
 for(const f of pre.forecasts){
  const outcome=live.results.find(x=>x.id===f.matchId);
  assert.ok(outcome&&outcome.status==='completed'&&outcome.maps.length===1);
  const scenario=f.maps.find(x=>x.map.toLowerCase()===outcome.maps[0].name.toLowerCase());
  const auditRow=audit.records.find(x=>x.matchId===f.matchId);
  assert.ok(scenario);
  assert.equal(auditRow.map,outcome.maps[0].name);
  assert.equal(auditRow.probabilityA,scenario.probabilityA);
  const winnerA=outcome.winnerTeamId===f.teamA.id?1:0;
  if((scenario.probabilityA>=.5?1:0)===winnerA)hits++;
  const loss=(scenario.probabilityA-winnerA)**2;
  assert.ok(Math.abs(auditRow.brier-loss)<1e-12);
  brier+=loss;roundAbs+=Math.abs(outcome.maps[0].rounds-scenario.expectedRounds);total++;
 }
 assert.equal(hits,6);assert.equal(total,8);
 assert.ok(Math.abs(audit.summary.winner.brier-brier/total)<1e-12);
 assert.ok(Math.abs(audit.summary.rounds.mae-roundAbs/total)<1e-12);
});
test('Cito top-level kills conflict with CT+T in 75 of 80; labels are explicit',()=>{
 assert.equal(provenance.records.length,80);
 assert.equal(provenance.records.filter(x=>x.conflicting).length,75);
 assert.equal(provenance.summary.firstSampleHLTV.killsExpectedFromSide,6);
 assert.equal(provenance.summary.firstSampleHLTV.killsReported,3);
 assert.equal(provenance.records.filter(x=>x.independentlyVerified===true).length,0);
 assert.equal(audit.summary.kills.observations,79);
 assert.ok(audit.summary.kills.mae>4);
});
test('display gates bookmaker comparisons until source quality is independently reconciled',()=>{
 const game=load('radar-feed.json').games.find(x=>x.id==='cs2-match-2400494');
 const team=load('major-teams/'+game.teamA.id+'.json');
 const opponents=load('major-teams/'+game.teamB.id+'.json');
 const ranks=load('major-opponent-rank-history.json');
 const proj=I.winner(game,team,opponents,'Mirage',ranks);
 const sample=I.playerKills(team.players[0],team,opponents,game,'Mirage',90,16.5,'current',ranks,proj.rounds);
 assert.equal(sample.priceComparisonAllowed,false);
 assert.match(sample.sourceQuality,/not independently reconciled/);
 const ui=fs.readFileSync(path.join(__dirname,'../public/major-map-workspace.js'),'utf8');
 assert.ok(ui.includes('prediction?.priceComparisonAllowed!==true'));
 assert.ok(ui.includes("row.append(mk('td','','Em auditoria'))"));
 assert.ok(ui.includes('NAO_VALIDADO'));
 assert.ok(ui.includes("Mercados de kills EM AUDITORIA"));
});
test('historical round uncertainty is made visible without retrofitting old freeze',()=>{
 const game=load('radar-feed.json').games.find(x=>x.id==='cs2-match-2400494');
 const a=load('major-teams/'+game.teamA.id+'.json'),b=load('major-teams/'+game.teamB.id+'.json');
 const rounds=I.projectRounds(a,b,'Mirage',game.startTime);
 assert.ok(rounds.expected>0);
 assert.ok(rounds.observedRoundMaps>=10);
 assert.ok(rounds.rangeLow>=13&&rounds.rangeHigh<=31);
 assert.ok(rounds.rangeLow<=rounds.rangeHigh);
 assert.ok(pre.forecasts[0].maps.some(s=>s.map==='Mirage'));
 assert.ok(!pre.forecasts[0].maps.some(s=>s.map==='Mirage'&&'rangeLow' in s));
});
test('Results panel shows day one audit rather than suggesting those wins prove edge',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../public/major-audit-ui.js'),'utf8');
 assert.ok(ui.includes('major-day1-audit.json'));
 assert.ok(ui.includes('Brier Score'));
 assert.ok(ui.includes('PROVISORIAMENTE'));
 assert.ok(ui.includes('não é uma validação independente'));
});
