'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),src=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const pure=src.slice(0,src.indexOf("document.querySelectorAll('[data-tab]')"))+';({simulate,playMap,seeded,parseHistory,roundProb,estimateKills,mapProbability})';
const {simulate,playMap,seeded,parseHistory,roundProb,estimateKills,mapProbability}=vm.runInNewContext(pure,{setTimeout,clearTimeout,Math,Number,String,JSON,Date});
const cfg={a:'A',b:'B',p:[.53,.50,.48],kpr:.72,side:'A',n:10000,roundLine:21.5,handicap:-2.5,killLine:15.5,seriesKillLine:32.5};
const one=simulate(cfg),two=simulate(cfg);assert.deepEqual(one.counts,two.counts);
assert.equal(one.counts.a20+one.counts.a21+one.counts.b20+one.counts.b21,cfg.n);
assert.equal(one.counts.seriesA,one.counts.a20+one.counts.a21);
assert.ok(one.avgMaps>=2&&one.avgMaps<=3);
const sym=simulate({...cfg,p:[.5,.5,.5],n:20000});assert.ok(Math.abs(sym.counts.seriesA/sym.n-.5)<.03);
const fav=simulate({...cfg,p:[.75,.75,.75],n:5000});assert.ok(fav.counts.seriesA/fav.n>.95);
for(let i=0;i<1000;i++){const m=playMap(.5,.70,'A',seeded(i+1));assert.ok(m.a!==m.b&&m.rounds>=13&&m.rounds<=96)}
const csv='date;match_id;team_a;team_b;map;rounds_a;rounds_b;player;player_team;kills\n2026-01-01;1;AAA;BBB;Mirage;13;9;Alice;AAA;18\n2026-01-02;2;BBB;AAA;Mirage;12;13;Alice;AAA;20';
const rows=parseHistory(csv);assert.equal(rows.length,2);assert.equal(rows[0].ra,13);
assert.ok(roundProb('AAA','BBB','Mirage',rows).p>.5);
assert.ok(estimateKills('Alice',rows).rounds>0);
assert.ok(Math.abs(mapProbability(.5,3000)-.5)<.05);
console.log('PASS: deterministic simulation, BO3, rounds, symmetry, CSV parsing, historical rates, map probability');