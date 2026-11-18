// Reproducible ATLAS post-match audit. Input forecasts are immutable pre-match records.
export const AUDIT_VERSION='atlas-audit-v1';
const mean=(a,f)=>a.length?a.reduce((s,x)=>s+f(x),0)/a.length:null;
const brier=(p,y)=>(p-y)**2;
const acc=(p,y)=>(p>=.5?1:0)===y?1:0;
export function audit(frozen,completed,mapGrading,challenger=null,nowIso=new Date().toISOString()){
 const byResult=new Map((completed.matches||[]).filter(x=>x.status==='completed'&&Number.isInteger(x.scoreA)&&Number.isInteger(x.scoreB)).map(x=>[x.id,x]));
 const challengerById=new Map((challenger?.forecasts||[]).map(x=>[x.matchId,x]));
 const games=[];
 for(const item of frozen.matches||[]){
  const result=byResult.get(item.matchId);
  const am=item.markets.find(x=>x.key==='aWin');
  if(!result||!am)continue;
  const event=result.scoreA>result.scoreB?1:0,pModel=am.modelP,pMarket=am.marketNoVig;
  const v2=challengerById.get(item.matchId);
  const availableMaps=new Set((item.model?.commonMaps||[]).map(x=>x.name.toLowerCase()));
  const outOfModelMaps=(result.maps||[]).filter(m=>!availableMaps.has(m.name.toLowerCase())).map(x=>x.name);
  games.push({matchId:item.matchId,event:item.event,startsAt:item.startsAt,
   teams:[item.teamA.name,item.teamB.name],
   actualScore:result.scoreA+'–'+result.scoreB,
   winner:result.scoreA>result.scoreB?item.teamA.name:item.teamB.name,
   modelP_A:pModel,marketP_A:pMarket,challengerP_A:v2?.probabilities?.aWin??null,
   modelFav:pModel>=.5?item.teamA.name:item.teamB.name,
   marketFav:pMarket>=.5?item.teamA.name:item.teamB.name,
   v2Fav:v2?(v2.probabilities.aWin>=.5?item.teamA.name:item.teamB.name):null,
   modelCorrect:acc(pModel,event)===1,marketCorrect:acc(pMarket,event)===1,
   v2Correct:v2?acc(v2.probabilities.aWin,event)===1:null,
   modelBrier:brier(pModel,event),marketBrier:brier(pMarket,event),
   v2Brier:v2?brier(v2.probabilities.aWin,event):null,
   absMarketGapPP:Math.abs(pModel-pMarket)*100,
   minMapHistory:item.model?.minCommonMapHistory??null,
   modelCommonMaps:item.model?.commonMaps?.length??0,
   playedMaps:result.maps?.map(x=>x.name)||[],outOfModelMaps,
   verifiedAt:result.verifiedAt
  });
 }
 const unmodeledResults=(frozen.unmodeled||[]).map(x=>{
  const actual=byResult.get(x.matchId);
  return{matchId:x.matchId,reason:x.reason,verified:Boolean(actual),
   actualScore:actual?actual.scoreA+'–'+actual.scoreB:null,
   teams:actual?[actual.teamA,actual.teamB]:null};
 });
 const totalVerified=games.length+unmodeledResults.filter(x=>x.verified).length;
 const finished=games.length;
 const winner={n:finished,correctModel:games.filter(x=>x.modelCorrect).length,correctMarket:games.filter(x=>x.marketCorrect).length,
  brierModel:mean(games,x=>x.modelBrier),brierMarket:mean(games,x=>x.marketBrier),
  avgAbsoluteGapPP:mean(games,x=>x.absMarketGapPP),
  severeDisagreements:games.filter(x=>x.absMarketGapPP>=20).length};
 const challengers=games.filter(x=>x.v2Brier!==null);
 const challengerResult={n:challengers.length,correct:challengers.filter(x=>x.v2Correct).length,
   brier:mean(challengers,x=>x.v2Brier),
   interpretation:'POST-HOC PROTOTYPE — created after the results and NOT an out-of-sample improvement claim.'};
 const mapMarkets=(mapGrading?.byMarket||[]).map(m=>({kind:m.kind,n:m.observations,brier:m.brier,accuracy:m.classificationAccuracy,
    worseThanNeutral:m.observations>0&&m.brier>0.25}));
 return{version:AUDIT_VERSION,evaluatedAt:nowIso,source:'Cito completed series vs immutable pregame ATLAS and BR365 screenshots',
  completed:finished,totalScheduled:(frozen.matches||[]).length+(frozen.unmodeled||[]).length,totalVerified,pending:(frozen.matches||[]).length-finished,unmodeled:frozen.unmodeled||[],unmodeledResults,marketModel: {snapshot:frozen.generatedAt,version:frozen.modelVersion},
  samplesSmall:finished<30,
  winner,challenger:challengerResult,mapMarkets,
  games,actionItems:[
   'Keep v1 pregame forecasts immutable. Challenger v2 is retrospective and must be tested in future games.',
   'Ranked strength-of-opponent context must be known before the match. Do not use after-match form or ranking.',
   'Do not call model-market gaps an edge before calibration, line availability and sample audit.',
   'For map kills and totals, do not recommend bets until prospectively validated and veto is known.',
   'Map selection must use veto probabilities rather than uniform permutations after enough historical data exists.'
  ],
  note:'Brier compares probability quality; accuracy is just 50% threshold classification. Small sample; price snapshots are not tradable quotes.'};
}
