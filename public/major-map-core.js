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
 const api={norm,round,getMaps,getTeamMap,filterRows,summarize,comparePrice};
 root.AtlasMajorMaps=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
