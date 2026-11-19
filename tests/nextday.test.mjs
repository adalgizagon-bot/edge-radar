import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const base=path.join(import.meta.dirname,'../public');
const read=p=>JSON.parse(fs.readFileSync(path.join(base,p),'utf8'));
const v=read('data/nov19-forecasts.json'),p=read('data/prospective.json'),context=read('data/nov19-context.json');
test('three Nov 19 predictions frozen before starting each match',()=>{
 assert.equal(v.metrics.length,3);assert.equal(p.forecasts.filter(x=>v.metrics.some(m=>m.id===x.matchId)).length,3);
 for(const m of v.metrics){
  const f=p.forecasts.find(x=>x.matchId===m.id);
  assert.ok(Date.parse(v.frozenAt)<Date.parse(m.scheduledAt));
  assert.ok(Date.parse(f.frozenAt)<Date.parse(f.startsAt));
  assert.equal(m.vetoStatus,'not_confirmed');assert.equal(m.odds.verifiedLive,false);
  assert.ok(Math.abs(m.v1.pA-f.v1.pA)<1e-10);
  assert.ok(Math.abs(m.v2.pA-f.v2.pA)<1e-10);
  assert.ok(Math.abs(m.v2.pA+m.v2.pB-1)<1e-10);
  assert.ok(Math.abs(m.odds.noVigA+m.odds.noVigB-1)<1e-10);
  assert.ok(m.v1.sampleFloor>=4);
 }
});
test('19 Nov snapshots include six distinct teams, recent form and ranking',()=>{
 assert.equal(context.teams.length,6);assert.equal(new Set(context.teams.map(x=>x.id)).size,6);
 assert.equal(context.recent.teams.length,6);
 assert.ok(context.fixtures.every(g=>g.eventId==='cs2-event-9258'&&g.bestOf===3));
 assert.ok(context.recent.teams.every(t=>t.recent.length>=10&&t.recent.every(m=>Date.parse(m.startsAt)<Date.parse(context.fetchedAt))));
 assert.ok(context.ranking.ranks.length>=50);
});
test('dashboard is the Nov 19 starting page, without invented post-veto markets',()=>{
 const html=fs.readFileSync(path.join(base,'laboratorio.html'),'utf8');
 assert.ok(html.includes('data-tab="nextday"'));
 assert.ok(html.includes('<section class="view active" id="nextday">'));
 assert.ok(html.includes('src="nextday.js"'));
 assert.ok(html.includes('id="nd-resolved-count"'));
 assert.ok(html.includes('href="nextday.css"'));
});

test('56 captured market prices consist of 36 modeled and 20 unmodeled round handicaps',()=>{
 const quotes=read('data/nov19-br365-all-markets.json');
 assert.equal(quotes.matches.length,3);
 assert.equal(quotes.matches.reduce((n,m)=>n+m.markets.length,0),36);
 assert.equal(quotes.matches.reduce((n,m)=>n+m.unmodeledRoundHandicaps.length,0),20);
 for(const m of quotes.matches){
  assert.equal(m.markets.length,12);
  assert.ok(Date.parse(m.screenshotCapturedAtApprox)<Date.parse(m.scheduledAt));
  assert.ok(Date.parse(m.frozenForecastAt)<Date.parse(m.screenshotCapturedAtApprox));
  const frozen=p.forecasts.find(x=>x.matchId===m.matchId);
  assert.ok(frozen,'original frozen V1 and V2 must exist');
  const grouped=new Map();
  for(const r of m.markets){
   assert.equal(r.status,'research_only_unvalidated');
   assert.ok(Number.isFinite(r.odd)&&r.odd>1);
   assert.ok(Math.abs(r.v1P-frozen.v1.score[r.key])<1e-7);
   assert.ok(Math.abs(r.v2P-frozen.v2.score[r.key])<1e-7);
   const group=r.family==='map_handicap'?(r.key.includes('Plus1_5')||r.key.includes('Minus1_5')?
    ['aPlus1_5','bMinus1_5'].includes(r.key)?'map_handicap_aPlus':'map_handicap_aMinus':r.family):r.family;
   const arr=grouped.get(group)||[];arr.push(r);grouped.set(group,arr);
  }
  assert.equal(grouped.size,5);
  for(const group of grouped.values()){
   const probability=group.reduce((sum,r)=>sum+r.impliedNoVig,0);
   assert.ok(Math.abs(probability-1)<1e-6);
  }
  assert.ok(m.unmodeledRoundHandicaps.every(x=>x.modelAvailable===false&&Number.isFinite(x.odd)));
 }
});
test('recorded pricing discrepancy is explicitly informational and requires checking settlement rules',()=>{
 const m=read('data/nov19-br365-all-markets.json').matches.find(x=>x.matchId==='cs2-match-2400445');
 const exact=m.markets.find(x=>x.key==='a20'),hand=m.markets.find(x=>x.key==='aMinus1_5');
 assert.equal(exact.odd,4.25);
 assert.equal(hand.odd,3.85);
 const d=m.pricingConsistency.find(x=>x.outcome.includes('BIG 2–0'));
 assert.ok(d.relativeDifferencePercent>10);
 assert.equal(d.settlementRulesNeedChecking,true);
});
test('dashboard exposes full-market odds without changing models',()=>{
 const js=fs.readFileSync(path.join(base,'nextday.js'),'utf8');
 assert.ok(js.includes('nov19-br365-all-markets.json'));
 assert.ok(js.includes('nd-market-details'));
 assert.ok(js.includes('nd-round-markets'));
 assert.ok(js.includes('pricingConsistency'));
});
