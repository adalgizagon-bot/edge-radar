// Major event result sync via ONE Cito API event-matches call per scheduled run.
// Immutable pregame estimates are read for evaluation only.
export const MAJOR_SYNC_VERSION='major-event-sync-v1';
const good=s=>Number.isFinite(Date.parse(s));
export function reconcileMajorLive(previous,rawMatches,eventId,fetchedAt){
 if(!Array.isArray(rawMatches)||!good(fetchedAt))throw Error('Event responses must be dated arrays');
 const existing=new Map((previous?.fixtures||[]).map(x=>[x.id,x]));
 const results=new Map((previous?.results||[]).map(x=>[x.id,x]));
 for(const m of rawMatches){
  if(m.eventId!==eventId||!m.id||!good(m.startsAt)||!m.team1Id||!m.team2Id)continue;
  const status=m.status==='completed'?'completed':m.status==='live'?'live':'upcoming';
  const prior=existing.get(m.id);
  // Do not turn a previously confirmed result into a transient pregame entry.
  if(prior?.status==='completed'&&status!=='completed')continue;
  const fixture={id:m.id,eventId:m.eventId,eventName:m.eventName,startsAt:m.startsAt,
    snapshotAt:fetchedAt,status,bestOf:m.bestOf??null,stage:m.stageName||null,
    teamA:{id:m.team1Id,name:m.team1Name},teamB:{id:m.team2Id,name:m.team2Name},
    veto:{status:'unconfirmed',confirmedMap:null}};
  existing.set(m.id,fixture);
  if(status==='completed'&&Number.isInteger(m.team1Score)&&Number.isInteger(m.team2Score)&&m.team1Score!==m.team2Score){
   const maps=(m.maps||[]).filter(map=>map.status==='completed'&&map.statsEligible!==false&&
     Number.isInteger(map.team1Score)&&Number.isInteger(map.team2Score)).map(map=>({name:map.mapName,
     scoreA:map.team1Score,scoreB:map.team2Score,rounds:map.team1Score+map.team2Score}));
   results.set(m.id,{id:m.id,eventId:m.eventId,startsAt:m.startsAt,status:'completed',
     teamA:m.team1Name,teamB:m.team2Name,scoreA:m.team1Score,scoreB:m.team2Score,
     winnerTeamId:m.winnerTeamId|| (m.team1Score>m.team2Score?m.team1Id:m.team2Id),
     maps,verifiedAt:fetchedAt});
  }
 }
 return{version:MAJOR_SYNC_VERSION,eventId,fetchedAt,
   fixtures:[...existing.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)),
   results:[...results.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)),
   note:'Cito event-matches; no postgame editing of frozen BO1 forecasts. Veto placeholders are not trusted.'};
}
export function gradeMajorBO1(research,live,at){
 const byId=new Map((live?.results||[]).filter(x=>x.status==='completed').map(x=>[x.id,x]));
 const samples=[];
 for(const p of research?.forecasts||[]){
  const actual=byId.get(p.matchId);
  if(!actual||p.status!=='exploratory'||p.bestOf!==1||!good(p.frozenAt)||Date.parse(p.frozenAt)>=Date.parse(p.startsAt))continue;
  const y=actual.winnerTeamId===p.teamA.id?1:actual.winnerTeamId===p.teamB.id?0:null;
  if(y===null)continue;
  samples.push({matchId:p.matchId,teams:[p.teamA.name,p.teamB.name],result:actual.scoreA+'–'+actual.scoreB,
    frozenAt:p.frozenAt,probabilityA:p.modelProbabilityA,outcomeA:y,
    brier:(p.modelProbabilityA-y)**2,correct:(p.modelProbabilityA>=.5?1:0)===y});
 }
 const brier=samples.length?samples.reduce((a,x)=>a+x.brier,0)/samples.length:null;
 return{evaluatedAt:at,modelVersion:research?.version||null,registered:research?.forecasts?.length||0,
   modeled:research?.modeled||0,resolved:samples.length,meanBrier:brier,
   correct:samples.filter(x=>x.correct).length,records:samples,
   warning:'Prospective accuracy only from predictions frozen before kickoff. This does not measure profit or establish market edge.'};
}
