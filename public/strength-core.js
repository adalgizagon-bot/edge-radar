'use strict';
// ATLAS opponent-context module: explanations only, NOT a calibrated betting model.
(function(root){
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 const tier=rank=>!finite(rank)?'Sem ranking':rank<=20?'Top 20':rank<=50?'21–50':rank<=100?'51–100':'101+';
 const sum=(rows,f)=>rows.reduce((n,x)=>n+f(x),0);
 const recent=(team,limit=15)=>[...(team?.recent||[])]
   .filter(x=>x.result==='W'||x.result==='L')
   .sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt))
   .slice(0,Math.min(15,Math.max(1,limit)));
 const median=x=>{if(!x.length)return null;const values=[...x].sort((a,b)=>a-b);return values.length%2?values[(values.length-1)/2]:(values[values.length/2]+values[values.length/2-1])/2};
 function expectedByRank(rankOwn,rankOpp){
  if(!(finite(rankOwn)&&rankOwn>0&&finite(rankOpp)&&rankOpp>0))return null;
  // An explicit, modest heuristic using ordinal ranks, NOT empirical win probabilities.
  return 1/(1+Math.exp(.55*Math.log(rankOwn/rankOpp)));
 }
 function summary(team,ownRanking,limit=15,asOf){
  const games=recent(team,limit),won=games.filter(x=>x.result==='W'),ranked=games.filter(x=>finite(x.opponent?.rank)),ranks=ranked.map(x=>x.opponent.rank);
  const mapRows=games.flatMap(x=>x.maps||[]).filter(m=>finite(m.ourRounds)&&finite(m.theirRounds));
  const opponentTierCounts=Object.fromEntries(['Top 20','21–50','51–100','101+','Sem ranking'].map(t=>[t,games.filter(x=>tier(x.opponent?.rank)===t).length]));
  const stronger=games.filter(x=>finite(x.opponent?.rank)&&x.opponent.rank<=50);
  const at=Date.parse(asOf||new Date().toISOString());
  let delta=0,weights=0,predictable=0;
  for(const g of games){
   const expected=expectedByRank(ownRanking,g.opponent?.rank);
   if(expected===null)continue;
   const days=Math.max(0,(at-Date.parse(g.startsAt))/86400000);
   const weight=Math.pow(2,-days/45);
   delta+=weight*((g.result==='W'?1:0)-expected);
   weights+=weight;predictable++;
  }
  return{n:games.length,wins:won.length,losses:games.filter(x=>x.result==='L').length,
   winRate:games.length?won.length/games.length:null,rankedOpponents:ranked.length,
   medianOpponentRank:median(ranks),averageOpponentRank:ranks.length?sum(ranks,x=>x)/ranks.length:null,
   tierCounts:opponentTierCounts,vsTop50:{games:stronger.length,wins:stronger.filter(x=>x.result==='W').length},
   mapCount:mapRows.length,mapWins:mapRows.filter(x=>x.ourRounds>x.theirRounds).length,
   mapWinRate:mapRows.length?mapRows.filter(x=>x.ourRounds>x.theirRounds).length/mapRows.length:null,
   avgRoundDiff:mapRows.length?sum(mapRows,m=>m.ourRounds-m.theirRounds)/mapRows.length:null,
   expectedSurplusPP:weights?100*delta/weights:null,expectedSamples:predictable,
   ownRank:ownRanking,rankDateNotHistorical:true};
 }
 function mapCompare(shortTeam,longTeam){
  const names=new Set([...(shortTeam?.maps||[]).map(x=>x.name),...(longTeam?.maps||[]).map(x=>x.name)]);
  return[...names].map(name=>{
    const a=shortTeam?.maps?.find(x=>x.name.toLowerCase()===name.toLowerCase());
    const b=longTeam?.maps?.find(x=>x.name.toLowerCase()===name.toLowerCase());
    return{name,short:{played:a?.played??0,winPercent:a?.winPercent??null},
      long:{played:b?.played??0,winPercent:b?.winPercent??null},
      inCurrentPool:a?.inPool??b?.inPool??null,
      windowsNested:true};
  }).sort((a,b)=>b.short.played-a.short.played||b.long.played-a.long.played);
 }
 function compare(game,formData,map90,map365,rankData,limit=15){
  if(!game)return null;
  const byId=new Map((formData?.teams||[]).map(t=>[t.id,t]));
  const short=new Map((map90?.teams||[]).map(t=>[t.id,t]));
  const long=new Map((map365?.teams||[]).map(t=>[t.id,t]));
  const ranks=new Map((rankData?.ranks||[]).map(t=>[t.id,t.rank]));
  const sides=[game.teamA,game.teamB].map(t=>{
   const form=byId.get(t.id),s=short.get(t.id),l=long.get(t.id),rank=ranks.get(t.id)??null;
   return{...t,rank,form:summary(form,rank,limit,formData?.fetchedAt),recent:recent(form,limit),
    history:{maps90:s?.totalMaps??null,maps365:l?.totalMaps??null,
       winPercent90:s?.mapWinPercent??null,winPercent365:l?.mapWinPercent??null,
       difference365vs90:(finite(s?.totalMaps)&&finite(l?.totalMaps))?Math.max(0,l.totalMaps-s.totalMaps):null},
    mapStats:mapCompare(s,l)};
  });
  return{game,sides,limits:{months12IncludesMonths3:true},rankingDate:rankData?.rankingDate||null,formFetchedAt:formData?.fetchedAt||null};
 }
 const api={tier,recent,expectedByRank,summary,mapCompare,compare};
 root.AtlasStrengthCore=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
