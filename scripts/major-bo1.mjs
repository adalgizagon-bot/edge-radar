// Major Singapore BO1: transparent PRE-VETO exploratory research, not calibrated betting probabilities.
// Never reuse BO3 probabilities or infer confirmed map from the Cito pre-match veto placeholders.
export const MAJOR_MODEL_VERSION='major-bo1-pre-veto-v1-experimental';
const number=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
const logistic=x=>1/(1+Math.exp(-x));
const logit=x=>Math.log(clamp(x,0.000001,0.999999)/(1-clamp(x,0.000001,0.999999)));
const normMap=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const normalizeRanks=(rankA,rankB)=>number(rankA)&&rankA>0&&number(rankB)&&rankB>0?
 logistic(clamp(.45*Math.log(rankB/rankA),-1,1)):null;
export function buildBo1Scenario(match,teamA,teamB,asOf){
 if(!match||match.bestOf!==1||!teamA||!teamB)throw Error('BO1 input required');
 const at=Date.parse(asOf),starts=Date.parse(match.startsAt);
 if(!Number.isFinite(at)||!Number.isFinite(starts)||at>=starts)throw Error('Pregame snapshot required');
 const base={matchId:match.id,startsAt:match.startsAt,bestOf:1,
  teamA:match.teamA,teamB:match.teamB,
  estimatedWithConfirmedVeto:false,confirmedMap:null,vetoStatus:'unconfirmed',
  frozenAt:asOf,modelVersion:MAJOR_MODEL_VERSION,oddsAvailable:false,prices:[],
  validForBettingRecommendation:false,
  limitation:'Ranking e aproveitamento bruto de mapas não ajustam todos os adversários, escalações e vetos; projeções NÃO calibradas.'};
 const rankPrior=normalizeRanks(teamA.worldRankAtEvent,teamB.worldRankAtEvent);
 const mapsA=teamA.mapStats?.maps||[],mapsB=new Map((teamB.mapStats?.maps||[]).map(m=>[normMap(m.name),m]));
 if(rankPrior===null||!mapsA.length||!mapsB.size)return{...base,status:'insufficient_data',rankPriorA:rankPrior,
  modelProbabilityA:null,modelProbabilityB:null,mapScenarios:[],
  reason:'Histórico recente por mapa indisponível para uma ou as duas equipes; ranking isolado não é previsão suficiente.'};
 const scenarios=[];
 for(const a of mapsA){
  const b=mapsB.get(normMap(a.name));
  if(!b||a.inPool===false||b.inPool===false||!number(a.played)||!number(b.played)||a.played<5||b.played<5||!number(a.wins)||!number(b.wins))continue;
  const aSmoothed=(a.wins+6)/(a.played+12),bSmoothed=(b.wins+6)/(b.played+12);
  const difference=logit(aSmoothed)-logit(bSmoothed);
  // Conservative heuristic; calibrated only after tracking future tournament results.
  const p=logistic(.60*logit(rankPrior)+.40*difference);
  scenarios.push({map:a.name,playedA:a.played,playedB:b.played,rawWinA:a.wins/a.played,
    rawWinB:b.wins/b.played,projectionA:p,projectionB:1-p,
    source:'Cito team 90-day map-stats',usable:true});
 }
 scenarios.sort((x,y)=>x.map.localeCompare(y.map));
 if(scenarios.length<3)return{...base,status:'insufficient_data',rankPriorA:rankPrior,modelProbabilityA:null,modelProbabilityB:null,
  mapScenarios:scenarios,reason:'Menos de três mapas compartilhados com pelo menos cinco partidas por equipe.'};
 const avg=scenarios.reduce((s,x)=>s+x.projectionA,0)/scenarios.length;
 const min=Math.min(...scenarios.map(x=>x.projectionA)),max=Math.max(...scenarios.map(x=>x.projectionA));
 const n=Math.min(...scenarios.map(x=>Math.min(x.playedA,x.playedB)));
 return{...base,status:'exploratory',modelProbabilityA:avg,modelProbabilityB:1-avg,
  rankPriorA:rankPrior,rankA:teamA.worldRankAtEvent,rankB:teamB.worldRankAtEvent,
  mapsEligible:scenarios.length,minMapsPerTeamPerScenario:n,
  mapScenarios:scenarios,vetoSensitivity:{minA:min,maxA:max,kind:'range across maps, NOT statistical confidence interval'},
  modelInputs:{mapStatsDays:90,smoothingPseudoGames:12,rankLogitWeight:.60,mapLogitWeight:.40,scenarioWeight:'uniform across common maps',
   opponentAdjusted:false,rosterVerified:false},
  reason:'Projeção BO1 pré-veto apenas exploratória. Não há odds nem mapa confirmado; sem indicação de aposta.'};
}
export function createMajorOpeningResearch(snapshot,frozenAt){
 const teams=new Map((snapshot?.teams||[]).map(t=>[t.id,t]));
 const forecasts=(snapshot?.fixtures||[]).map(m=>buildBo1Scenario(m,teams.get(m.teamA.id),teams.get(m.teamB.id),frozenAt));
 return{version:MAJOR_MODEL_VERSION,eventId:snapshot.event?.id,capturedAt:snapshot.capturedAt,frozenAt,
   createdBeforeKickoff:forecasts.every(f=>Date.parse(f.frozenAt)<Date.parse(f.startsAt)),
   status:'pre-veto model research; cannot infer bets without odds and prospective calibration',
   modeled:forecasts.filter(f=>f.status==='exploratory').length,
   unmodeled:forecasts.filter(f=>f.status==='insufficient_data').length,
   forecasts,warnings:[
     'BO1 single map; BO3 exact scores and map handicaps are not applicable.',
     'No verified veto / chosen map, even if the raw source contains pre-match placeholders.',
     'Map samples are opponent- and roster-unadjusted. Formula was not trained or calibrated on Major games.',
     'Do not infer financial edge from these percentages; no bookmaker prices were supplied.',
     'All forecasts are frozen before kickoff and must never be overwritten.']};
}
