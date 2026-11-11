'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname,'../public/edge-opportunities.js'),'utf8');
const context = { window:{addEventListener(){}},document:{getElementById:()=>null},Date,Map,Set,Intl,Number,String,Math,JSON,console };
vm.runInNewContext(src,context);
const model=context.window.EdgeIntelligence;
const s=model.estimate(Array(30).fill(0).map((_,i)=>i%4===0?8:20),15.5,'over');
assert.equal(s.n,30);assert.equal(s.hits,22);assert(s.low<s.p && s.p<s.high);assert(s.valid);
const insufficient=model.estimate([3,9,20],10.5,'over');assert.equal(insufficient.valid,false);
const d=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../public/data/snapshot.json'),'utf8'));
model.init(d);
const unique=new Set(d.player_maps.map(x=>x.mapId));assert(unique.size>0);
for(const match of d.upcoming){
 const cards=model.allMarketCards(match);
 assert(cards.some(c=>c.market==='maps_total' || match.bestOf!==3));
 assert(cards.some(c=>c.market==='series_winner'));
 assert(cards.some(c=>c.market==='rounds_total'));
 // All projected markets are paired with a real upstream match id.
 assert(cards.every(c=>c.matchId===match.id));
 for(const c of cards){assert(c.p===null || (c.p>=0 && c.p<=1));}
}
console.log(`PASS: ${d.upcoming.length} confrontos, ${unique.size} mapas únicos, intervalos, odds e amostras.`);