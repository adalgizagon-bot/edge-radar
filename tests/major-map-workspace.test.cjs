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

test('selected-map projection reproduces frozen pre-veto per-map scenarios, not their average',()=>{
 const feed=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/radar-feed.json'),'utf8'));
 const game=feed.games.find(g=>g.id==='cs2-match-2400494');
 const left=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-teams',game.teamA.id+'.json'),'utf8'));
 const right=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-teams',game.teamB.id+'.json'),'utf8'));
 const inferno=M.projectMap(game,left,right,'Inferno');
 const mirage=M.projectMap(game,left,right,'Mirage');
 assert.equal(inferno.status,'estimated');
 assert.equal(mirage.status,'estimated');
 assert.ok(Math.abs(inferno.probabilityA+inferno.probabilityB-1)<1e-12);
 assert.ok(Math.abs(mirage.probabilityA+mirage.probabilityB-1)<1e-12);
 assert.ok(Math.abs(inferno.probabilityA-.575319041466435)<1e-12);
 assert.ok(Math.abs(mirage.probabilityA-.49742728654123314)<1e-12);
 assert.notEqual(inferno.probabilityA,mirage.probabilityA);
 assert.notEqual(inferno.probabilityA,game.model.v2);
});
test('winner table follows map selection and clears stale pre-veto percentage without mutating frozen odds',()=>{
 const feed=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/radar-feed.json'),'utf8'));
 const game=feed.games.find(g=>g.id==='cs2-match-2400494');
 const left=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-teams',game.teamA.id+'.json'),'utf8'));
 const right=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-teams',game.teamB.id+'.json'),'utf8'));
 const original=JSON.stringify(game);
 const blank=M.withSelectedMap(game,null,null);
 assert.equal(blank.selectedMap,null);
 assert.ok(blank.markets.every(m=>m.v2P===null));
 const inferno=M.projectMap(game,left,right,'Inferno');
 const filled=M.withSelectedMap(game,'Inferno',inferno);
 const a=filled.markets.find(m=>m.key==='aWin');
 const b=filled.markets.find(m=>m.key==='bWin');
 assert.equal(a.v2P,inferno.probabilityA);
 assert.equal(b.v2P,inferno.probabilityB);
 assert.equal(a.odd,game.markets.find(m=>m.key==='aWin').odd);
 assert.equal(b.odd,game.markets.find(m=>m.key==='bWin').odd);
 assert.equal(a.odd,null); // completed match; photographed odds were retired, not live
 const photographed=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-br365-odds.json'),'utf8'));
 const quote=photographed.matches.find(x=>x.matchId===game.id);
 assert.equal(quote.oddA,1.43);
 assert.equal(quote.oddB,2.75);
 assert.equal(a.impliedNoVig,game.markets[0].impliedNoVig);
 const mirage=M.withSelectedMap(game,'Mirage',M.projectMap(game,left,right,'Mirage'));
 assert.notEqual(mirage.markets[0].v2P,a.v2P);
 assert.equal(JSON.stringify(game),original);
});
test('insufficient sample never displays a winner probability on an unobserved map',()=>{
 const game={bestOf:1,major:{format:'BO1'},form:{a:{rank:23},b:{rank:48}},markets:[{key:'aWin',family:'winner',v2P:.55},{key:'bWin',family:'winner',v2P:.45}]};
 const a={teamMaps:[{name:'Dust2',played:12,wins:8,inPool:true}]};
 const b={teamMaps:[{name:'Dust2',played:3,wins:1,inPool:true}]};
 const p=M.projectMap(game,a,b,'Dust2');
 assert.equal(p.status,'insufficient_data');
 assert.equal(p.probabilityA,null);
 const show=M.withSelectedMap(game,'Dust2',p);
 assert.ok(show.markets.every(m=>m.v2P===null));
 assert.equal(M.projectMap(game,a,b,'Mirage').status,'insufficient_data');
});
test('frontend refreshes both header and winner market from same map-specific view',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../public/radar-app.js'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'../public/major-map-workspace.js'),'utf8');
 assert.ok(js.includes('withSelectedMap(game,map,projection)'));
 assert.ok(js.includes('teamBox(game.teamA,pA'));
 assert.ok(js.includes('marketHost.replaceChildren(marketSection(visibleGame))'));
 assert.ok(panel.includes('onMapProjection(chosen,projection)'));
 assert.ok(!panel.includes('game.model?.mapScenarios'));
});

test('browser does not reuse old BO1 JS bundles; update button refreshes HTML + code',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 const js=fs.readFileSync(path.join(__dirname,'../public/radar-app.js'),'utf8');
 const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'../vercel.json'),'utf8'));
 assert.ok(html.includes('meta name="atlas-build"'));
 for(const name of ['radar-app.js','radar-core.js','major-map-core.js','major-map-workspace.js'])
  assert.match(html,new RegExp(name.replace(/[.]/g,'\\.')+'\\?v=atlas-25nov-md3-previsao-serie-v1'));
 assert.ok(js.includes("url.searchParams.set('atlas_refresh'"));
 assert.ok(js.includes('window.location.replace(url.toString())'));
 assert.ok(cfg.headers.some(x=>x.headers.some(h=>h.key==='Cache-Control'&&/must-revalidate/.test(h.value))));
});

test('asynchronous team profile delivery forwards map projection callback into all later map changes',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../public/major-map-workspace.js'),'utf8');
 assert.ok(source.includes('draw(game,container,a,b,onMapProjection,ranks)'), 'promise data path must forward projection callback');
 assert.ok(source.includes('draw(game,container,left,right,onMapProjection,rankHistory)'), 'selected map changes must forward projection callback');
 assert.ok(source.includes('onMapProjection(chosen,projection)'), 'selected map must notify winner table');
 assert.ok(!source.includes('if(container.isConnected&&container.dataset.matchId===game.id)draw(game,container,a,b);'),
  'the callback-less asynchronous path must never return');
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 assert.ok(html.includes('major-map-workspace.js?v=atlas-25nov-md3-previsao-serie-v1'));
});

test('BO3 map selection calculates each individual map but preserves SERIES winner odds unchanged',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/radar-feed.json'),'utf8'));
 const game=data.games.find(x=>x.id==='cs2-match-2400570');
 assert.equal(game.bestOf,3);assert.equal(game.isMajorSeries,true);assert.equal(game.major,null);
 const left=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-teams',game.teamA.id+'.json'),'utf8'));
 const right=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/major-teams',game.teamB.id+'.json'),'utf8'));
 const choices=M.getMaps(left,right);
 assert.ok(choices.length>=3);
 const original=JSON.stringify(game);
 const sample=M.projectMap(game,left,right,choices[0]);
 assert.ok(sample);assert.equal(sample.map,choices[0]);
 assert.ok(['estimated','insufficient_data'].includes(sample.status));
 const unchanged=M.withSelectedMap(game,choices[0],sample);
 assert.strictEqual(unchanged,game);
 assert.ok(game.markets.every(m=>m.settlementScope==='series_winner_bo3'&&m.v2P===null));
 assert.equal(JSON.stringify(game),original);
});
test('BO3 offers three independent editable map slots and still separates series betting odds',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../public/radar-app.js'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'../public/major-map-workspace.js'),'utf8');
 assert.ok(app.includes('game.major||game.isMajorSeries'));
 assert.ok(app.includes('game.isMajorSeries?{'));
 assert.ok(app.includes('seriesProjection.probabilityA'));
 assert.ok(app.includes('seriesProjection.probabilityB'));
 assert.ok(app.includes('Vencedor da série BO3'));
 assert.ok(app.includes('Vencedor da série BO3'));
 assert.ok(panel.includes('for(const slot of [1,2,3])'));
 assert.ok(panel.includes("['map'+slot]:newValue"));
 assert.ok(panel.includes("mapStore[game.id]={...seriesState,active:slot}"));
 assert.ok(panel.includes('game?.isMajorSeries'));
 assert.ok(panel.includes('game.isMajorSeries||frozenExists'));
 assert.ok(panel.includes('Isso NÃO é chance de vencer a série MD3'));
});
