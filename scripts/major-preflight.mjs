// One-time prospective registration from public pregame files. No API key or live data.
// Must execute BEFORE every included fixture begins; never regenerate after recording.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Core=require('../public/major-map-core.js');
const Intel=require('../public/major-intelligence-core.js');
const root=path.resolve(import.meta.dirname,'../public/data');
const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const destination=path.join(root,'major-preflight-v1.json');
if(fs.existsSync(destination)){
 console.log('Pré-registro já existe. Não modificar previsões congeladas.');
 process.exit(0);
}
const feed=load('radar-feed.json');
const ranks=load('major-opponent-rank-history.json');
const frozenAt=new Date().toISOString();
const games=(feed.games||[]).filter(x=>x.major&&x.bestOf===1);
if(games.length!==8||games.some(g=>Date.parse(g.startTime)<=Date.parse(frozenAt)))
 throw Error('Pré-registro não pode ser criado após início de jogo. Esperados oito BO1 futuros.');
const teamCache=new Map();
const profile=id=>{
 if(!teamCache.has(id)){
  const data=load('major-teams/'+id+'.json');
  if(data.teamId!==id||Date.parse(data.capturedAt)>=Math.min(...games.map(g=>Date.parse(g.startTime))))
   throw Error('Perfil da Cito posterior à estreia ou inconsistente: '+id);
  teamCache.set(id,data);
 }
 return teamCache.get(id);
};
const forecasts=games.map(game=>{
 const A=profile(game.teamA.id),B=profile(game.teamB.id);
 const maps=Core.getMaps(A,B).map(map=>{
  const winner=Intel.winner(game,A,B,map,ranks);
  const all=[...A.players.map(p=>({p,profile:A,opponent:B})),...B.players.map(p=>({p,profile:B,opponent:A}))];
  const playerForecasts=all.map(x=>{
   const projected=Intel.playerKills(x.p,x.profile,x.opponent,game,map,90,16.5,'current',ranks,winner?.rounds);
   return{playerId:projected.id,teamId:projected.teamId,line:16.5,n:projected.n,
    mean:projected.expectedKills,pOver:projected.overProbability,pUnder:projected.underProbability};
  });
  return{map,probabilityA:winner?.probabilityA??null,probabilityB:winner?.probabilityB??null,
   modelStatus:winner?.modelStatus||'insufficient',method:winner?.method||null,
   expectedRounds:winner?.rounds?.expected??null,
   rankedOpponentsA:winner?.strengthA?.ranked??0,rankedOpponentsB:winner?.strengthB?.ranked??0,
   playerForecasts};
 });
 return{matchId:game.id,startsAt:game.startTime,teamA:game.teamA,teamB:game.teamB,maps};
});
if(forecasts.length!==8||forecasts.some(m=>!m.maps.length))throw Error('No forecast for one of eight matches');
const payload={version:'atlas-major-pre-veto-conditional-v1',frozenAt,generatedBeforeEveryMatch:true,
 source:'Cito player history and rank snapshots stored before kickoff',
 mapSelection:'all candidate maps were registered; evaluation uses ONLY the actually played map',
 rankTimeRule:'historical ranking snapshots <= match dates; no future rankings',
 calibrated:false,warning:'Exploratory estimates are not calibrated odds; a model advantage is not verified profit.',
 forecasts};
fs.writeFileSync(destination,JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({frozenAt,fixtures:forecasts.length,scenarioCount:forecasts.reduce((a,x)=>a+x.maps.length,0),
 playerScenarios:forecasts.reduce((a,x)=>a+x.maps.reduce((s,m)=>s+m.playerForecasts.length,0),0),
 opponentAdjusted:forecasts.reduce((a,x)=>a+x.maps.filter(m=>m.modelStatus==='opponent_adjusted').length,0)}));
