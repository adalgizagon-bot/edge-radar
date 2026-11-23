'use strict';
/* ATLAS BO1 map intelligence v1. Transparent, prospective, uncalibrated.
   No future match outcomes, live bookmaker scraping, or guaranteed value. */
(function(root){
 const M=root.AtlasMajorMaps||(typeof require==='function'?require('./major-map-core.js'):null);
 const num=x=>typeof x==='number'&&Number.isFinite(x);
 const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
 const logistic=x=>1/(1+Math.exp(-x));
 const logit=x=>Math.log(clamp(x,1e-6,1-1e-6)/(1-clamp(x,1e-6,1-1e-6)));
 const date=s=>Date.parse(s||'');
 const norm=s=>M.norm(s);
 const round=(x,d=3)=>num(x)?Math.round(x*10**d)/10**d:null;
 const activeSnapshots=(history,time)=>((history?.rankings||[]).filter(x=>
  Number.isFinite(date(x.rankingDate))&&date(x.rankingDate)<date(time)
 )).sort((a,b)=>date(b.rankingDate)-date(a.rankingDate));
 const historicalRank=(history,id,at)=>{
  if(!id||!Number.isFinite(date(at)))return null;
  const s=activeSnapshots(history,at)[0];
  if(!s||date(at)-date(s.rankingDate)>35*86400000)return null;
  const rank=s.ranks?.[id];
  return num(rank)&&rank>0?{rank,rankingDate:s.rankingDate}:null;
 };
 const rankExpectation=(a,b)=>logistic(clamp(.45*Math.log(b/a),-1,1));
 function teamContext(profile,map,history,before,days=90){
  const stats=M.getTeamMap(profile,map);
  if(!stats||!num(stats.played)||!num(stats.wins)||stats.played<5)
   return{status:'insufficient',played:stats?.played??0,ranked:0,reason:'Menos de cinco mapas nesta equipe.'};
  const end=date(before),start=end-days*86400000,seen=new Map();
  for(const player of profile?.players||[]){
   for(const r of player.history||[]){
    const at=date(r.at);
    if(r.teamId!==profile.teamId||norm(r.map)!==norm(map)||!r.matchId||!r.opponentId||at<start||at>=end)continue;
    const key=r.matchId+'|'+norm(r.map);
    if(!seen.has(key))seen.set(key,r);
   }
  }
  const observations=[...seen.values()].sort((a,b)=>date(b.at)-date(a.at));
  const ranked=observations.map(r=>{
   const own=historicalRank(history,profile.teamId,r.at),opp=historicalRank(history,r.opponentId,r.at);
   return own&&opp?{at:r.at,opponentId:r.opponentId,rank:opp.rank,rankDate:opp.rankingDate,
    expected:rankExpectation(own.rank,opp.rank),rounds:r.rounds}:null;
  }).filter(Boolean);
  const coverage=clamp(ranked.length/Math.max(stats.played,observations.length,1),0,1);
  const exp=ranked.length?ranked.reduce((a,r)=>a+r.expected,0)/ranked.length:null;
  const oppRank=ranked.length?ranked.reduce((a,r)=>a+r.rank,0)/ranked.length:null;
  const roundDiff=num(stats.roundsFor)&&num(stats.roundsAgainst)?
   (stats.roundsFor-stats.roundsAgainst)/stats.played:null;
  const nRequired=Math.max(5,Math.ceil(stats.played*.55));
  const eligible=!profile?.sourceTruncated&&ranked.length>=nRequired&&coverage>=.55;
  const rawWinRate=stats.wins/stats.played;
  return{status:eligible?'ranked':'partial',played:stats.played,wins:stats.wins,
   observed:observations.length,ranked:ranked.length,coverage:round(coverage),
   averageOpponentRank:round(oppRank,1),expectedWinAgainstHistory:round(exp),
   actualWinRate:round(rawWinRate),roundDiffPerMap:round(roundDiff,2),
   residual:eligible?(rawWinRate-exp)*ranked.length/(ranked.length+12):null,
   opponents:ranked.slice(0,5).map(r=>({opponentId:r.opponentId,rank:r.rank,at:r.at,rankDate:r.rankDate})),
   reason:eligible?'Ranking histórico anterior a cada partida, quando disponível.':
     'Cobertura de ranking dos adversários insuficiente; não aplicada correção de dificuldade.'};
 }
 const projectRounds=(a,b,map)=>{
  const ma=M.getTeamMap(a,map),mb=M.getTeamMap(b,map);
  const t=x=>x&&num(x.played)&&x.played>=5&&num(x.roundsFor)&&num(x.roundsAgainst)?
    (x.roundsFor+x.roundsAgainst)/x.played:null;
  const x=t(ma),y=t(mb);
  return x!==null&&y!==null?{expected:round(clamp((x+y)/2,16,31),1),fromA:round(x,1),fromB:round(y,1),
    nA:ma.played,nB:mb.played,source:'mean rounds/map, 90d; not a calibrated round distribution'}:
    {expected:null,source:'insufficient rounds/sample'};
 };
 const winner=(game,a,b,map,history)=>{
  const base=M.projectMap(game,a,b,map);
  if(!base)return null;
  const rounds=projectRounds(a,b,map);
  const A=teamContext(a,map,history,game.startTime),B=teamContext(b,map,history,game.startTime);
  if(base.status!=='estimated')return{...base,modelStatus:'insufficient_data',strengthA:A,strengthB:B,rounds,
    method:'insufficient',calibrated:false};
  if(A.status!=='ranked'||B.status!=='ranked'||!history?.rankings?.length)
   return{...base,modelStatus:'unadjusted',strengthA:A,strengthB:B,rounds,
    method:'baseline 90d: ranking + win rates; opponent adjustment unavailable',calibrated:false};
  const rA=game.form?.a?.rank,rB=game.form?.b?.rank;
  const prior=rankExpectation(rA,rB),mA=M.getTeamMap(a,map),mB=M.getTeamMap(b,map);
  const smoothA=(mA.wins+6)/(mA.played+12),smoothB=(mB.wins+6)/(mB.played+12);
  const mapTerm=.25*(logit(smoothA)-logit(smoothB));
  const residual=.85*(A.residual-B.residual);
  const roundTerm=clamp(.018*((A.roundDiffPerMap??0)-(B.roundDiffPerMap??0)),-.22,.22);
  const probabilityA=logistic(.60*logit(prior)+mapTerm+residual+roundTerm);
  return{...base,probabilityA,probabilityB:1-probabilityA,rounds,
   strengthA:A,strengthB:B,modelStatus:'opponent_adjusted',
   method:'pre-match rank prior + shrunk map outcomes vs historical opponent ranks + round differential',
   contributions:{prior:round(prior),mapLogit:round(mapTerm),opponentResidualLogit:round(residual),roundLogit:round(roundTerm)},
   calibrated:false,opponentAdjusted:true};
 };
 const nbUnder=(floor,mean,k)=>{
  if(!num(mean)||mean<0||!num(k)||k<=0)return null;
  if(floor<0)return 0;
  const p=k/(k+mean);let pr=Math.pow(p,k),sum=pr;
  for(let i=0;i<Math.min(floor,200);i++){
   pr*=((k+i)/(i+1))*(1-p);sum+=pr;
  }
  return clamp(sum,0,1);
 };
 const playerKills=(player,profile,opponent,game,map,days,line,scope,history,rounds)=>{
  const rows=M.filterRows(player,map,days,game.startTime).filter(r=>scope!=='current'||r.teamId===profile.teamId);
  const n=rows.length,playedRounds=rows.reduce((s,x)=>s+x.rounds,0);
  const hits=rows.filter(x=>x.kills>line).length;
  const base={id:player.id,nickname:player.nickname,teamId:profile.teamId,n,
   empiricalOver:n?hits/n:null,empiricalUnder:n?1-hits/n:null,source:'Cito historical player kills by map',
   calibrated:false,modelStatus:'insufficient',expectedKills:null,overProbability:null,underProbability:null};
  if(n<5||!rounds||!num(rounds.expected)||playedRounds<=0)return base;
  const kills=rows.reduce((s,x)=>s+x.kills,0),kpr=kills/playedRounds;
  const oppRanks=rows.map(r=>historicalRank(history,r.opponentId,r.at)?.rank).filter(num);
  const targetRank=game.teamA.id===profile.teamId?game.form?.b?.rank:game.form?.a?.rank;
  const historicalOpp=oppRanks.length>=5?oppRanks.reduce((s,x)=>s+x,0)/oppRanks.length:null;
  const adjustment=historicalOpp!==null&&num(targetRank)&&targetRank>0?
   clamp(Math.pow(targetRank/historicalOpp,.075),.9,1.1):1;
  const projectedRounds=rounds.expected,mean=clamp(kpr*projectedRounds*adjustment,0,55);
  const normalized=rows.map(r=>r.kills*projectedRounds/r.rounds);
  const variance=normalized.reduce((s,x)=>s+(x-mean)**2,0)/Math.max(1,n-1);
  const overdisp=Math.max(mean*1.05,variance);
  const dispersion=clamp(mean*mean/Math.max(.001,overdisp-mean),4,150);
  const under=nbUnder(Math.floor(line),mean,dispersion);
  return{...base,modelStatus:n>=10?'exploratory':'low_sample',expectedKills:round(mean,1),
   expectedRounds:round(projectedRounds,1),killsPerRound:round(kpr),
   dispersion:round(dispersion,1),opponentAdjustment:round(adjustment),
   rankedOpponentRows:oppRanks.length,averageOpponentRank:round(historicalOpp,1),
   underProbability:under,overProbability:under===null?null:1-under,
   uncertainty:'Negative-binomial moment model; needs prospective calibration.'};
 };
 const makeFrozen=(game,map,winnerModel,players,createdAt,extra={})=>{
  if(!game?.id||!map||!winnerModel||!Number.isFinite(date(createdAt))||
   !Number.isFinite(date(game.startTime))||date(createdAt)>=date(game.startTime))return null;
  return{version:'atlas-pregame-map-v1',matchId:game.id,startsAt:game.startTime,
   createdAt,matchTeams:[game.teamA.id,game.teamB.id],map,
   modelStatus:winnerModel.modelStatus,probabilityA:num(winnerModel.probabilityA)?winnerModel.probabilityA:null,
   probabilityB:num(winnerModel.probabilityB)?winnerModel.probabilityB:null,
   expectedRounds:winnerModel.rounds?.expected??null,
   playerForecasts:(players||[]).map(p=>({playerId:p.id,teamId:p.teamId,line:extra.line,
     n:p.n,mean:p.expectedKills,pOver:p.overProbability,pUnder:p.underProbability})),
   capturedOdds:extra.odds||null,scope:extra.scope||'current',days:extra.days||90,
   source:'Cito files captured 2026-11-23; no post-match revisions',calibrated:false};
 };
 const grade=(frozen,result,observed=null)=>{
  if(!frozen||!result||result.status!=='completed')return{status:'pending'};
  if(!Number.isFinite(date(frozen.createdAt))||date(frozen.createdAt)>=date(frozen.startsAt))
   return{status:'invalid_post_kickoff'};
  const maps=(result.maps||[]).filter(x=>x.name||x.mapName);
  if(maps.length!==1)return{status:'pending_map_verification'};
  const map=maps[0];
  if(norm(map.name||map.mapName)!==norm(frozen.map))return{status:'map_mismatch'};
  const scoreA=map.scoreA??map.team1Score,scoreB=map.scoreB??map.team2Score;
  if(!num(scoreA)||!num(scoreB)||scoreA===scoreB)return{status:'pending_score'};
  const outcomeA=scoreA>scoreB?1:0;
  const resultBase={status:'graded',matchId:frozen.matchId,map:frozen.map,outcomeA,score:[scoreA,scoreB]};
  if(!num(frozen.probabilityA))return{...resultBase,status:'no_winner_forecast'};
  const p=clamp(frozen.probabilityA,1e-6,1-1e-6);
  const playerObserved=Array.isArray(observed?.players)?observed.players:[];
  const joined=frozen.playerForecasts.filter(x=>num(x.mean)).map(x=>{
   const a=playerObserved.find(y=>y.playerId===x.playerId&&num(y.kills));
   return a?{playerId:x.playerId,mean:x.mean,kills:a.kills,absoluteError:Math.abs(x.mean-a.kills),
    line:x.line,pOver:x.pOver,actualOver:a.kills>x.line?1:0}:null;
  }).filter(Boolean);
  return{...resultBase,brier:(p-outcomeA)**2,logLoss:-(outcomeA*Math.log(p)+(1-outcomeA)*Math.log(1-p)),
   winnerCorrect:(p>=.5?1:0)===outcomeA,playerResults:joined};
 };
 const audit=(frozen,results,observedMatches=[])=>{
  const byResult=new Map((results||[]).map(x=>[x.id||x.matchId,x]));
  const byObserved=new Map((observedMatches||[]).map(x=>[x.matchId,x]));
  const graded=(frozen||[]).map(s=>({frozen:s,outcome:grade(s,byResult.get(s.matchId),byObserved.get(s.matchId))}));
  const valid=graded.filter(x=>x.outcome.status==='graded');
  const playerRows=valid.flatMap(x=>x.outcome.playerResults);
  const avg=(rows,key)=>rows.length?rows.reduce((sum,x)=>sum+x[key],0)/rows.length:null;
  return{total:graded.length,graded:valid.length,pending:graded.filter(x=>x.outcome.status==='pending').length,
   mismatched:graded.filter(x=>x.outcome.status==='map_mismatch').length,
   winnerBrier:avg(valid.map(x=>x.outcome),'brier'),
   winnerLogLoss:avg(valid.map(x=>x.outcome),'logLoss'),
   winnerAccuracy:valid.length?valid.filter(x=>x.outcome.winnerCorrect).length/valid.length:null,
   gradedPlayerMaps:playerRows.length,killMae:avg(playerRows,'absoluteError'),
   records:graded};
 };
 const api={historicalRank,teamContext,projectRounds,winner,playerKills,nbUnder,makeFrozen,grade,audit};
 root.AtlasMajorIntel=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
