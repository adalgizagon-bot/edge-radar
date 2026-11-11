'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../public/map-intelligence.js'),'utf8');
const kv=new Map();let odds=[];
const sandbox={
  window:{addEventListener(){}}, document:{getElementById(){return null;}},
  localStorage:{getItem:k=>kv.get(k)||null,setItem:(k,v)=>kv.set(k,v),removeItem:k=>kv.delete(k)},
  oddsLoad:()=>odds, oddsSave:list=>{odds=list;}, Date, Intl, Math, JSON, Map, Set, Number, String,console,
};
vm.runInNewContext(script,sandbox);
const model=sandbox.window.EdgeIntelligence;
const m={id:'fixture',team1Id:'A',team2Id:'B',team1:'Alpha',team2:'Bravo',bestOf:3,tier:'Tier 1'};
const past=[],player_maps=[];
for(let j=0;j<13;j++){
  for(let k=0;k<3;k++){
    const map=['Nuke','Mirage','Inferno'][k],id=`match${j}map${k}`;
    const winnerA=map==='Nuke'?j<11:map==='Mirage'?j<3:j<7;
    const scoreA=winnerA?13:8, scoreB=winnerA?8:13;
    past.push({id:`match${j}${k}`,status:'completed',bestOf:3,team1Id:'A',team2Id:'B',team1:'Alpha',team2:'Bravo',
      team1Score:2,team2Score:1,maps:[{mapId:id,name:map,team1Score:scoreA,team2Score:scoreB,status:'completed',statsEligible:true}]});
    for(const tid of ['A','B'])for(let p=0;p<5;p++){
      const kills=(tid==='A'?14:12)+p+(k*2)+j%4;
      player_maps.push({matchId:`match${j}${k}`,mapId:id,mapName:map,teamId:tid,team:tid==='A'?'Alpha':'Bravo',playerId:`${tid}${p}`,player:`P${tid}${p}`,kills,deaths:kills-2,
        assists:4,firstKills:2,headshots:6,roundsPlayed:scoreA+scoreB,startsAt:'2026-11-10T01:00:00Z'});
    }
  }
}
// Um mapa adicional incompleto — não pode ser usado em totais de equipe.
for(let i=0;i<4;i++)player_maps.push({matchId:'partial',mapId:'partial-map',mapName:'Nuke',teamId:'A',team:'Alpha',playerId:`A${i}`,player:`PA${i}`,kills:15,deaths:12,roundsPlayed:23});
model.init({upcoming:[m],past,player_maps,rosters:[],rankings:[]});
let stats=model.snapshotStats();
assert.equal(stats.completeTeamMaps, 13*3*2);
assert.equal(stats.maps, 13*3+1);
assert.equal(model.teamKillRecords('A','Nuke').length,13);
assert.equal(model.teamRounds('A','Nuke').length,14); // rounds podem ser verificados mesmo com kills incompletas
assert.equal(model.teamKillRecords('B','Mirage').length,13);
assert(model.getSequence('fixture').every(x=>x===''));
assert.equal(model.setSequence('fixture',0,'Nuke'),true);
assert.equal(model.setSequence('fixture',1,'Mirage'),true);
assert.equal(model.setSequence('fixture',2,'Inferno'),true);
assert.equal(model.setSequence('fixture',1,'Nuke'),false,'repeated maps forbidden');
assert.equal(kv.get('cs2edge.mapSequence.v1.fixture'),JSON.stringify(['Nuke','Mirage','Inferno']));
let cards=model.allMarketCards(m);
assert(cards.some(s=>s.market==='kills'&&s.target==='map1'&&s.mapName==='Nuke'));
assert(cards.some(s=>s.market==='kills'&&s.target==='map2'&&s.mapName==='Mirage'));
assert(cards.some(s=>s.market==='kills'&&s.target==='map3'&&s.mapName==='Inferno'));
assert(cards.some(s=>s.market==='team_kills'&&s.subject==='Alpha'&&s.target==='map1'));
assert(cards.some(s=>s.market==='rounds_total'&&s.target==='map1'&&s.n===14));
const over=cards.find(s=>s.market==='maps_total'&&s.direction==='over');
assert(over.p!==null && over.p>0 && over.p<1);
const oldProb=over.p;
assert.equal(model.setSequence('fixture',1,'Inferno'),false,'map 3 already Inferno, remove first');
assert.equal(model.setSequence('fixture',2,''),true);
assert.equal(model.setSequence('fixture',1,'Inferno'),true);
const revised=model.allMarketCards(m).find(s=>s.market==='maps_total'&&s.direction==='over');
assert(Math.abs(revised.p-oldProb)>0.02,'changing M2 must change projected 3-map probability');
const teamLine=model.allMarketCards(m).find(s=>s.market==='team_kills'&&s.target==='map1');
assert(teamLine.valid,'13 complete maps should activate exploratory model');
odds=[{matchId:'fixture',target:'map1',mapName:'Mirage',market:teamLine.market,subject:teamLine.subject,direction:teamLine.direction,line:teamLine.line,odd:5,book:'Casa 1'}];
assert.equal(model.oddsFor(teamLine),null,'odds for Mirage must not contaminate Nuke M1');
odds.push({...odds[0],mapName:'Nuke',odd:1.8,book:'Casa 2'});
assert.equal(model.oddsFor(teamLine).odd,1.8);
assert(model.status(teamLine).label,'no market may have undefined status');
console.log('PASS map intelligence: order, M3 conditional, market recalculation, team totals (5 players), odds isolation, rounds.');