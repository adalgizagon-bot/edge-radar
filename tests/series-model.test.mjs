import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {mapWinChance,preVetoSeries,freezeSeries,validateSeries} from '../scripts/series-model.mjs';
const dataFile=name=>JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'..','public','data',name),'utf8'));
const fixtures=dataFile('tournaments.json'),book=dataFile('br365-series-odds.json'),frozen=dataFile('series-forecasts.json');
const team=id=>fixtures.teams.find(x=>x.id===id);
test('map probability uses valid MR12 / OT symmetry and range',()=>{
 assert.ok(Math.abs(mapWinChance(.5)-.5)<1e-10);
 for(const p of [.1,.24,.36,.55,.78,.9]){
  const a=mapWinChance(p),b=mapWinChance(1-p);
  assert.ok(a>=0&&a<=1);
  assert.ok(Math.abs(a+b-1)<1e-8);
 }
});
test('BO3 score probabilities add to 1 and derived handicaps match exact score',()=>{
 for(const match of fixtures.matches){
  const model=preVetoSeries(team(match.teamA.id),team(match.teamB.id));
  if(!model)continue;
  const p=model.probabilities;
  assert.ok(Math.abs(p.a20+p.a21+p.b20+p.b21-1)<1e-9);
  assert.ok(Math.abs(p.aWin+p.bWin-1)<1e-9);
  assert.ok(Math.abs(p.over2_5+p.under2_5-1)<1e-9);
  assert.equal(p.aMinus1_5,p.a20);
  assert.equal(p.bMinus1_5,p.b20);
  assert.equal(p.aPlus1_5,1-p.b20);
  assert.equal(p.bPlus1_5,1-p.a20);
  assert.equal(model.orderedTriplets,model.commonMaps.length*(model.commonMaps.length-1)*(model.commonMaps.length-2));
 }
});
test('odds screenshots contain 8 games and each has exactly 10 outcome prices',()=>{
 assert.equal(book.odds.length,8);
 const matches=new Set(fixtures.matches.map(x=>x.id));
 for(const row of book.odds){
  assert.ok(matches.has(row.matchId));
  const prices=[...Object.values(row.winner),...Object.values(row.handicap),...Object.values(row.score),...Object.values(row.total)];
  assert.equal(prices.length,10);
  assert.ok(prices.every(x=>Number.isFinite(x)&&x>1));
 }
});
test('historical Cito model covers 7 games and marks BBL/Envy as unavailable',()=>{
 const result=freezeSeries(null,fixtures,book,'2026-11-18T01:00:00Z');
 assert.equal(result.matches.length,7);
 assert.equal(result.unmodeled.length,1);
 assert.equal(result.unmodeled[0].matchId,'cs2-match-2400525');
 assert.equal(result.matches.reduce((x,m)=>x+m.markets.length,0),70);
 assert.equal(frozen.matches.length,7);
 assert.ok(result.matches.every(m=>m.modelSnapshotAt<m.startsAt&&m.oddsCapturedApprox<m.startsAt));
});
test('market margin removed within distinct markets, not across them',()=>{
 for(const m of frozen.matches){
  for(const family of ['winner','handicap','score','total']){
   const xs=m.markets.filter(x=>x.marketFamily===family);
   const sum=xs.reduce((s,x)=>s+x.marketNoVig,0);
   assert.ok(Math.abs(sum-1)<1e-10);
   assert.ok(xs.every(x=>x.priceStatus==='screenshot_only'&&x.bookOdds>1));
  }
 }
});
test('frozen market quotes never overwritten after match start',()=>{
 const later=freezeSeries(frozen,fixtures,book,'2026-11-19T21:00:00Z');
 assert.deepEqual(later.matches,frozen.matches);
});
test('match result validation settles series markets correctly',()=>{
 const m=frozen.matches[0];
 const outcome=validateSeries({matches:[m]},{
  matches:[{id:m.matchId,status:'completed',scoreA:2,scoreB:1}]
 },'2026-11-18T20:00:00Z');
 assert.equal(outcome.resolved,10);
 const byKey=Object.fromEntries(outcome.assessed.map(x=>[x.key,x]));
 assert.equal(byKey.aWin.outcome,1);
 assert.equal(byKey.bWin.outcome,0);
 assert.equal(byKey.a20.outcome,0);
 assert.equal(byKey.a21.outcome,1);
 assert.equal(byKey.over2_5.outcome,1);
 assert.equal(byKey.under2_5.outcome,0);
 const invalid=validateSeries({matches:[m]},{matches:[{id:m.matchId,status:'started',scoreA:1,scoreB:0}]},'2026-11-18T20:00:00Z');
 assert.equal(invalid.resolved,0);
});
test('new interface displays independent series markets, not veto-dependent accumulator',()=>{
 const html=fs.readFileSync(path.join(import.meta.dirname,'..','public','index.html'),'utf8');
 for(const needle of ['id="series-ranked-list"','id="series-combo-legs"','id="series-games"','id="series-filter-market"','id="series-kpi-markets"','src="series-radar.js"']){
  assert.ok(html.includes(needle),'missing '+needle);
 }
 assert.ok(!html.includes('src="opportunities.js"'));
});
