'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../public/major-map-core.js'),I=require('../public/major-intelligence-core.js');
const root=path.join(__dirname,'../public/data'),load=x=>JSON.parse(fs.readFileSync(path.join(root,x),'utf8'));
const feed=load('radar-feed.json'),rankHistory=load('major-opponent-rank-history.json');
const game=feed.games.find(g=>g.id==='cs2-match-2400494');
const a=load('major-teams/'+game.teamA.id+'.json'),b=load('major-teams/'+game.teamB.id+'.json');
test('historical rank reference uses only published snapshots before a match',()=>{
 assert.equal(rankHistory.rankings.length,7);
 const pre=I.historicalRank(rankHistory,'cs2-team-8297','2026-08-23T00:00:00Z');
 assert.equal(pre,null);
 const later=I.historicalRank(rankHistory,'cs2-team-8297','2026-11-17T12:00:00Z');
 assert.ok(later?.rank>0);
 assert.ok(Date.parse(later.rankingDate)<Date.parse('2026-11-17T12:00:00Z'));
 assert.equal(I.historicalRank(rankHistory,'not-listed','2026-11-17T12:00:00Z'),null);
});
test('map opponent coverage uses historical match IDs once despite 5 players per map',()=>{
 const ctx=I.teamContext(a,'Inferno',rankHistory,game.startTime);
 assert.ok(ctx.played>=5);
 assert.ok(ctx.observed<=ctx.played+2);
 assert.ok(ctx.ranked<=ctx.observed);
 assert.ok(ctx.coverage>=0&&ctx.coverage<=1);
 assert.ok(ctx.opponents.every(x=>Date.parse(x.rankDate)<Date.parse(x.at)));
 if(ctx.status==='ranked')assert.ok(Number.isFinite(ctx.averageOpponentRank));
});
test('winner model is map-conditional, normalized, and transparently flags adjustments',()=>{
 const mirage=I.winner(game,a,b,'Mirage',rankHistory);
 const inferno=I.winner(game,a,b,'Inferno',rankHistory);
 for(const p of [mirage,inferno]){
  assert.ok(p.probabilityA>0&&p.probabilityA<1);
  assert.ok(Math.abs(p.probabilityA+p.probabilityB-1)<1e-10);
  assert.ok(['unadjusted','opponent_adjusted'].includes(p.modelStatus));
  assert.equal(p.calibrated,false);
  assert.ok(p.rounds.expected>=16&&p.rounds.expected<=31);
  if(p.modelStatus==='opponent_adjusted'){
   assert.equal(p.strengthA.status,'ranked');
   assert.equal(p.strengthB.status,'ranked');
  }
 }
 assert.notEqual(mirage.probabilityA,inferno.probabilityA);
 assert.equal(game.model.v2,0.5335027130384907);
});
test('kills distribution responds monotonically to lines and to expected rounds',()=>{
 const rows=a.players[0],model=I.winner(game,a,b,'Inferno',rankHistory);
 const low=I.playerKills(rows,a,b,game,'Inferno',90,12.5,'current',rankHistory,model.rounds);
 const high=I.playerKills(rows,a,b,game,'Inferno',90,20.5,'current',rankHistory,model.rounds);
 if(low.n>=5){
  assert.ok(low.expectedKills>=0&&low.expectedKills<=55);
  assert.ok(low.overProbability>=high.overProbability);
  assert.ok(Math.abs(low.overProbability+low.underProbability-1)<1e-10);
  const longer=I.playerKills(rows,a,b,game,'Inferno',90,12.5,'current',rankHistory,
   {...model.rounds,expected:model.rounds.expected+3});
  assert.ok(longer.expectedKills>low.expectedKills);
 }
 assert.ok(I.nbUnder(12,16,9)<I.nbUnder(20,16,9));
});
test('prospective freeze rejected after kickoff and predictions cannot grade wrong map',()=>{
 const selected=I.winner(game,a,b,'Inferno',rankHistory);
 assert.equal(I.makeFrozen(game,'Inferno',selected,[],'2026-11-24T04:01:00Z'),null);
 const f=I.makeFrozen(game,'Inferno',selected,[],'2026-11-23T20:30:00Z',{line:16.5});
 assert.ok(f&&f.createdAt<f.startsAt);
 const checked={id:game.id,status:'completed',maps:[{name:'Inferno',scoreA:13,scoreB:11}]};
 const graded=I.grade(f,checked);
 assert.equal(graded.status,'graded');
 assert.ok(graded.brier>=0&&graded.brier<=1);
 assert.equal(I.grade(f,{...checked,maps:[{name:'Mirage',scoreA:13,scoreB:11}]}).status,'map_mismatch');
 const s=I.audit([f],[checked]);assert.equal(s.graded,1);
 assert.equal(I.audit([f],[]).graded,0);
});
test('preflight script refuses retroactive forecasting, and UI loads models and validation',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../scripts/major-preflight.mjs'),'utf8');
 assert.ok(script.includes("Date.parse(g.startTime)<=Date.parse(frozenAt)"));
 assert.ok(script.includes("fs.existsSync(destination)"));
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 for(const file of ['major-intelligence-core.js','major-audit-ui.js','major-map-workspace.js'])
  assert.ok(html.includes(file));
 const workspace=fs.readFileSync(path.join(__dirname,'../public/major-map-workspace.js'),'utf8');
 assert.ok(workspace.includes('I.winner(game,left,right,chosen,rankHistory)'));
 assert.ok(workspace.includes('I.playerKills('));
 assert.ok(workspace.includes('getRanks()'));
 assert.ok(workspace.includes('I.makeFrozen('));
 const app=fs.readFileSync(path.join(__dirname,'../public/radar-app.js'),'utf8');
 assert.ok(app.includes('window.AtlasMajorAuditUI.render(root)'));
});
