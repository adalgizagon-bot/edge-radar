// Data shaping for daily Cito opponent-form refresh, without trusting unverified matches.
export function recentOpponents(raw,team,rankings,asOf){
 if(!Array.isArray(raw)||!team?.id||!Array.isArray(rankings?.ranks))return null;
 const rankById=new Map(rankings.ranks.map(x=>[x.id,x]));
 const now=Date.parse(asOf);
 const rows=raw.filter(x=>x?.status==='completed'&&
   (x.team1Id===team.id||x.team2Id===team.id)&&Date.parse(x.startsAt)<now)
   .sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt))
   .slice(0,15).map(x=>{
    const a=x.team1Id===team.id,oppId=a?x.team2Id:x.team1Id,opp=a?x.team2:x.team1,rankRow=rankById.get(oppId);
    const rank=rankRow?.rank??(Number.isInteger(opp?.worldRanking)?opp.worldRanking:null);
    return{id:x.id,startsAt:x.startsAt,endsAt:x.endsAt,event:x.eventName||x.event?.name||null,
      eventTier:x.event?.tier||null,bestOf:x.bestOf,
      ourScore:a?x.team1Score:x.team2Score,theirScore:a?x.team2Score:x.team1Score,
      result:x.winnerTeamId===team.id?'W':x.winnerTeamId===oppId?'L':'U',
      opponent:{id:oppId,name:a?x.team2Name:x.team1Name,rank,
       rankingSource:rankRow?'Cito ranking '+(rankings.rankingDate||'current'):rank!==null?'Cito match-card worldRanking':null},
      maps:(x.maps||[]).filter(m=>m.status==='completed'&&m.statsEligible!==false&&
       Number.isInteger(m.team1Score)&&Number.isInteger(m.team2Score))
       .map(m=>({name:m.mapName,ourRounds:a?m.team1Score:m.team2Score,
        theirRounds:a?m.team2Score:m.team1Score,pickTeamId:m.pickTeamId||null}))};
   }).filter(x=>x.opponent.id&&['W','L'].includes(x.result));
 return {id:team.id,name:team.name,totalReturned:raw.length,recent:rows,fetchedAt:asOf};
}
export function longMapHistory(raw,team){
 if(!raw||!Array.isArray(raw.maps)||!team?.id)return null;
 return{id:team.id,name:team.name,windowDays:raw.windowDays||365,totalMaps:raw.totalMaps,
   mapWins:raw.totalMapWins,mapWinPercent:raw.mapWinPercent,
   maps:raw.maps.map(m=>({name:m.mapName,played:m.played,wins:m.wins,
    winPercent:m.winPercent,roundsFor:m.roundsFor,roundsAgainst:m.roundsAgainst,
    inPool:m.inPool,poolStatus:m.poolStatus,latestPlayedAt:m.latestPlayedAt}))};
}
export function rankedSnapshot(raw,at){
 if(!Array.isArray(raw)||raw.length===0)return null;
 return{source:'Cito CS2 rankings',rankingDate:raw[0].rankingDate||null,fetchedAt:at,
  ranks:raw.filter(x=>x.teamId&&Number.isInteger(x.rank)).map(x=>({id:x.teamId,name:x.teamName,rank:x.rank,points:x.points,region:x.region})),
  note:'Ranking atual, não posição histórica em cada jogo.'};
}
