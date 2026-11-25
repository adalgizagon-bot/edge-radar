'use strict';
/* Public, deterministic, map-selected historical CS2 indicators. No bookmaker odds are generated. */
(function(root){
 const good=n=>typeof n==='number'&&Number.isFinite(n);
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const round=(n,d=1)=>good(n)?Math.round(n*10**d)/10**d:null;
 const getTeamMap=(team,map)=>(team?.teamMaps||[]).find(x=>norm(x.name)===norm(map))||null;
 const getMaps=(a,b)=>{
  const map=new Map();
  for(const team of [a,b])for(const item of team?.teamMaps||[]){
   if(item.inPool===false||!item.name)continue;
   map.set(norm(item.name),item.name);
  }
  return[...map.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 };
 const logistic=x=>1/(1+Math.exp(-x));
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 const logit=x=>Math.log(clamp(x,.000001,.999999)/(1-clamp(x,.000001,.999999)));
 /* Selected-map formula is applied independently to each BO1/BO3 map; NEVER equate it to BO3 series odds.
    It is exploratory, not calibrated and never borrows bookmaker odds. */
 const projectMap=(game,teamA,teamB,map)=>{
  if(!game||![1,3].includes(game.bestOf)||!map)return null;
  const a=getTeamMap(teamA,map),b=getTeamMap(teamB,map);
  const sample={map,playedA:a?.played??0,playedB:b?.played??0,
   rawWinA:a&&good(a.played)&&a.played>0&&good(a.wins)?a.wins/a.played:null,
   rawWinB:b&&good(b.played)&&b.played>0&&good(b.wins)?b.wins/b.played:null};
  if(!a||!b||a.inPool===false||b.inPool===false||
     !good(a.played)||!good(b.played)||!good(a.wins)||!good(b.wins)||
     a.played<5||b.played<5)
   return{...sample,status:'insufficient_data',probabilityA:null,probabilityB:null,
    reason:'Mínimo de 5 mapas por equipe neste mapa, nos últimos 90 dias.'};
  const rankA=game.form?.a?.rank,rankB=game.form?.b?.rank;
  if(!good(rankA)||rankA<=0||!good(rankB)||rankB<=0)
   return{...sample,status:'insufficient_data',probabilityA:null,probabilityB:null,
    reason:'Ranking do evento indisponível; vitórias brutas não bastam para estimar.'};
  const rankPrior=logistic(clamp(.45*Math.log(rankB/rankA),-1,1));
  const aSmooth=(a.wins+6)/(a.played+12),bSmooth=(b.wins+6)/(b.played+12);
  const probabilityA=logistic(.60*logit(rankPrior)+.40*(logit(aSmooth)-logit(bSmooth)));
  return{...sample,status:'estimated',probabilityA,probabilityB:1-probabilityA,
   rankA,rankB,source:'Cito: últimos 90 dias do mapa + ranking do evento',
   version:'Major mapa individual (BO1 ou BO3) - heurística experimental v1',
   opponentAdjusted:false,rosterAdjusted:false,calibrated:false,
   reason:'Estimativa exploratória; não ajusta integralmente força dos adversários nem elenco.'};
 };
 /* View only. Frozen pre-veto predictions and photographed odds remain unchanged. */
 const withSelectedMap=(game,map,projection)=>{
  if(!game?.major)return game;
  const valid=Boolean(map&&projection?.status==='estimated'&&good(projection.probabilityA));
  return{...game,selectedMap:map||null,mapProjection:projection||null,
   markets:(game.markets||[]).map(m=>m.family!=='winner'?m:
    {...m,v2P:valid?(m.key==='aWin'?projection.probabilityA:m.key==='bWin'?projection.probabilityB:null):null})};
 };
 const filterRows=(player,map,days,at)=>{
  const end=Date.parse(at);
  if(!Number.isFinite(end)||![90,180].includes(days))return[];
  const start=end-days*86400000,seen=new Set();
  return(player?.history||[]).filter(x=>{
   const date=Date.parse(x.at);
   if(norm(x.map)!==norm(map)||!good(x.kills)||!good(x.rounds)||x.rounds<13||date<start||date>=end)return false;
   const key=x.matchId+'|'+norm(x.map);
   if(seen.has(key))return false;
   seen.add(key);return true;
  }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 };
 const summarize=(player,map,days,line,teamId,at,scope='all')=>{
  const rows=filterRows(player,map,days,at).filter(x=>scope!=='current'||x.teamId===teamId);
  const n=rows.length,over=rows.filter(x=>x.kills>line).length,under=n-over;
  const kills=rows.reduce((s,x)=>s+x.kills,0),rounds=rows.reduce((s,x)=>s+x.rounds,0);
  const ordered=rows.map(x=>x.kills).sort((a,b)=>a-b);
  const mid=n?((ordered[Math.floor((n-1)/2)]+ordered[Math.floor(n/2)])/2):null;
  const current=rows.filter(x=>x.teamId===teamId).length;
  return{id:player.id,nickname:player.nickname,role:player.role,n,currentTeamN:current,priorTeamN:n-current,
   meanKills:n?round(kills/n):null,medianKills:mid,killsPerRound:rounds?round(kills/rounds,3):null,
   meanRounds:n?round(rounds/n):null,over,under,overRate:n?over/n:null,underRate:n?under/n:null,
   lastFive:rows.slice(0,5).map(x=>({kills:x.kills,rounds:x.rounds,map:x.map,teamId:x.teamId,at:x.at})),
   sampleStatus:n<5?'muito curta':n<12?'curta':'moderada',
   sourceTruncated:!!player.sourceTruncated,sourceError:player.error||null};
 };
 const comparePrice=(odd,observedRate,n,sourceTruncated=false)=>{
  const implied=good(odd)&&odd>1?1/odd:null;
  if(implied===null||!good(observedRate))return{implied,observed:observedRate,gap:null,sufficient:false};
  return{implied,observed:observedRate,
   gap:n>=12&&!sourceTruncated?observedRate-implied:null,
   sufficient:n>=12&&!sourceTruncated};
 };
 const api={norm,round,getMaps,getTeamMap,projectMap,withSelectedMap,filterRows,summarize,comparePrice};
 root.AtlasMajorMaps=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
