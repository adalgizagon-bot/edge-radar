// ATLAS BO3 pre-veto model: exploratory, equal-weight ordered three-map scenarios.
// Never use it as a calibrated estimate of betting value without backtests and veto data.
export const SERIES_MODEL_VERSION='atlas-bo3-pre-veto-uniform-v1';
const clip=p=>Math.max(0,Math.min(1,p));
const numeric=n=>typeof n==='number'&&Number.isFinite(n);
function choose(n,k){let a=1;for(let i=1;i<=k;i++)a*=((n-k+i)/i);return a}
export function mapWinChance(roundP){
 if(!numeric(roundP)||roundP<=0||roundP>=1)return null;
 const p=roundP,q=1-p;
 let regA=0;
 for(let x=0;x<=11;x++)regA+=choose(12+x,x)*p**13*q**x;
 const tied=choose(24,12)*p**12*q**12;
 let otA=0,otB=0;
 for(let x=0;x<=2;x++){
  otA+=choose(3+x,x)*p**4*q**x;
  otB+=choose(3+x,x)*q**4*p**x;
 }
 return clip(regA+tied*(otA/(otA+otB)));
}
export function roundWinChance(teamA,teamB){
 if(!teamA||!teamB||Math.min(teamA.played||0,teamB.played||0)<4)return null;
 const k=140;
 const pa=(teamA.roundsFor+k*.5)/(teamA.roundsFor+teamA.roundsAgainst+k);
 const pb=(teamB.roundsFor+k*.5)/(teamB.roundsFor+teamB.roundsAgainst+k);
 if(!numeric(pa)||!numeric(pb)||pa<=0||pa>=1||pb<=0||pb>=1)return null;
 const logit=p=>Math.log(p/(1-p));
 return clip(1/(1+Math.exp(-(logit(pa)-logit(pb)))));
}
export function scoreOfOrderedTriplet(p1,p2,p3){
 const tie=p1*(1-p2)+(1-p1)*p2;
 return {a20:p1*p2,a21:tie*p3,b20:(1-p1)*(1-p2),b21:tie*(1-p3)};
}
const KEYS=['a20','a21','b20','b21'];
export function preVetoSeries(teamA,teamB){
 const common=[];
 for(const ma of teamA?.maps||[]){
  const mb=teamB?.maps?.find(x=>x.name.toLowerCase()===ma.name.toLowerCase());
  if(!mb)continue;
  const roundP=roundWinChance(ma,mb);
  if(roundP===null)continue;
  common.push({map:ma.name,obsA:ma.played,obsB:mb.played,roundP,mapP:mapWinChance(roundP)});
 }
 if(common.length<3)return null;
 const scenarios=[];
 for(let i=0;i<common.length;i++)for(let j=0;j<common.length;j++)for(let k=0;k<common.length;k++){
  if(i===j||i===k||j===k)continue;
  const trio=[common[i],common[j],common[k]];
  const outcome=scoreOfOrderedTriplet(...trio.map(x=>x.mapP));
  scenarios.push({scores:outcome,triplet:trio.map(x=>x.map),minHistory:Math.min(...trio.map(x=>Math.min(x.obsA,x.obsB)))});
 }
 const mean={},ranges={};
 for(const name of KEYS){
  const v=scenarios.map(s=>s.scores[name]);
  mean[name]=v.reduce((sum,p)=>sum+p,0)/v.length;
  ranges[name]={min:Math.min(...v),max:Math.max(...v)};
 }
 const calc=score=>({
  aWin:score.a20+score.a21,bWin:score.b20+score.b21,
  a20:score.a20,a21:score.a21,b20:score.b20,b21:score.b21,
  over2_5:score.a21+score.b21,under2_5:score.a20+score.b20,
  aMinus1_5:score.a20,bPlus1_5:1-score.a20,
  aPlus1_5:1-score.b20,bMinus1_5:score.b20
 });
 const allScenarios=scenarios.map(x=>calc(x.scores));
 const probabilities=calc(mean);
 const sensitivity={};
 for(const key of Object.keys(probabilities)){
  sensitivity[key]={min:Math.min(...allScenarios.map(x=>x[key])),max:Math.max(...allScenarios.map(x=>x[key]))};
 }
 return {
  probabilities,sensitivity,commonMaps:common.map(({map,obsA,obsB,mapP})=>({name:map,observationsA:obsA,observationsB:obsB,winProbA:mapP})),
  orderedTriplets:scenarios.length,minCommonMapHistory:Math.min(...common.map(x=>Math.min(x.obsA,x.obsB))),
  method:'Equal-weight all ordered three-map selections from maps with >=4 matches for both teams; map outcomes use independent round Bernoulli MR12 plus overtime.'
 };
}
export function expandBookMarkets(oddsEntry,model){
 const prices=oddsEntry;
 const families=[
  ['winner',[['aWin',prices.a+' vence série',prices.winner.a],['bWin',prices.b+' vence série',prices.winner.b]]],
  ['handicap',Object.entries(prices.handicap).map(([k,v])=>[k,k==='aMinus1_5'?prices.a+' -1,5 mapas':k==='aPlus1_5'?prices.a+' +1,5 mapas':k==='bMinus1_5'?prices.b+' -1,5 mapas':prices.b+' +1,5 mapas',v])],
  ['score',[['a20',prices.a+' 2–0',prices.score.a20],['a21',prices.a+' 2–1',prices.score.a21],['b20',prices.b+' 2–0',prices.score.b20],['b21',prices.b+' 2–1',prices.score.b21]]],
  ['total',[['over2_5','Acima de 2,5 mapas',prices.total.over2_5],['under2_5','Abaixo de 2,5 mapas',prices.total.under2_5]]]
 ];
 const rows=[];
 for(const [family,options] of families){
  const valid=options.filter(([key,label,odds])=>numeric(odds)&&odds>1);
  if(valid.length!==options.length)continue;
  const overround=valid.reduce((s,x)=>s+1/x[2],0);
  for(const [key,label,bookOdds] of valid){
   const modelP=model.probabilities[key],marketRaw=1/bookOdds,marketNoVig=marketRaw/overround;
   const sens=model.sensitivity[key];
   rows.push({
    id:oddsEntry.matchId+'|bo3|'+key,key,marketFamily:family,label,bookOdds,
    marketRaw,marketNoVig,marketOverround:overround,
    modelP,modelRange:sens,
    deltaPP:(modelP-marketNoVig)*100,
    hypotheticalROI:(modelP*bookOdds-1)*100,
    consistentAcrossVeto:sens.min>marketNoVig,
    confirmation:'unconfirmed_veto',
    priceStatus:'screenshot_only',
    independentOfMapVetoForSettlement:true
   });
  }
 }
 return rows;
}
export function freezeSeries(existing,snapshot,odds,nowIso){
 if(!snapshot?.matches||!snapshot.teams||!odds?.odds)throw Error('Missing series snapshot');
 const result=Array.isArray(existing?.matches)?[...existing.matches]:[],
  saved=new Set(result.map(x=>x.matchId)),now=Date.parse(nowIso),teams=new Map(snapshot.teams.map(t=>[t.id,t]));
 const priceCapturedAt=Date.parse(odds.capturedApprox);
 if(!Number.isFinite(priceCapturedAt)||!Number.isFinite(now))throw Error('Date invalid');
 for(const m of snapshot.matches){
  if(saved.has(m.id)||Date.parse(m.startTime)<=now)continue;
  if(Date.parse(snapshot.fetchedAt)>=Date.parse(m.startTime)||priceCapturedAt>=Date.parse(m.startTime))continue;
  const a=teams.get(m.teamA.id),b=teams.get(m.teamB.id),book=odds.odds.find(x=>x.matchId===m.id);
  if(!a||!b||!book)continue;
  const sim=preVetoSeries(a,b);
  if(!sim)continue;
  const markets=expandBookMarkets(book,sim);
  result.push({matchId:m.id,eventId:m.eventId,event:m.event,startsAt:m.startTime,
   modelSnapshotAt:snapshot.fetchedAt,oddsCapturedApprox:odds.capturedApprox,
   frozenAt:nowIso,modelVersion:SERIES_MODEL_VERSION,
   teamA:m.teamA,teamB:m.teamB,bookTeamA:book.a,bookTeamB:book.b,
   br365EventId:book.br365EventId,model:sim,markets,status:'pending',
   warnings:['Veto desconhecido; igual probabilidade para cada ordem de 3 mapas elegíveis',
    'Modelos de rounds e vetos não calibrados. Diferenca em odds não é vantagem validada',
    'Odds de print podem estar alteradas ou indisponíveis']});
 }
 return{modelVersion:SERIES_MODEL_VERSION,generatedAt:existing?.generatedAt||nowIso,
   lastProcessedAt:nowIso,source:'Cito CS2 history + BR365 odds transcribed from user screenshots',matches:result,
   note:'Modelo exploratório, não validado; somente mercados de séries BO3 independentes da divulgação dos mapas.'};
}
export function validateSeries(frozen,official,nowIso){
 const idx=new Map((official.matches||[]).map(x=>[x.id,x]));
 const assessed=[];
 for(const m of frozen.matches||[]){
  const r=idx.get(m.matchId);
  const completed=r?.status==='completed'&&Number.isInteger(r.scoreA)&&Number.isInteger(r.scoreB)&&
    ((r.scoreA===2&&r.scoreB<=1)||(r.scoreB===2&&r.scoreA<=1));
  if(!completed)continue;
  const truth={aWin:r.scoreA>r.scoreB,bWin:r.scoreB>r.scoreA,
   a20:r.scoreA===2&&r.scoreB===0,a21:r.scoreA===2&&r.scoreB===1,
   b20:r.scoreB===2&&r.scoreA===0,b21:r.scoreB===2&&r.scoreA===1};
  truth.over2_5=truth.a21||truth.b21;truth.under2_5=truth.a20||truth.b20;
  truth.aMinus1_5=truth.a20;truth.bPlus1_5=!truth.a20;
  truth.aPlus1_5=!truth.b20;truth.bMinus1_5=truth.b20;
  for(const market of m.markets){
   const outcome=Number(truth[market.key]);
   assessed.push({id:market.id,matchId:m.matchId,key:market.key,marketFamily:market.marketFamily,
    probability:market.modelP,marketNoVig:market.marketNoVig,bookOdds:market.bookOdds,
    outcome,brier:(market.modelP-outcome)**2,finalScore:r.scoreA+'–'+r.scoreB,verifiedAt:nowIso});
  }
 }
 const summary=[...new Set(assessed.map(x=>x.marketFamily))].map(family=>{
  const list=assessed.filter(x=>x.marketFamily===family);
  return{family,n:list.length,brier:list.reduce((s,x)=>s+x.brier,0)/list.length};
 });
 return{updatedAt:nowIso,total:(frozen.matches||[]).reduce((s,m)=>s+m.markets.length,0),
   resolved:assessed.length,byFamily:summary,assessed};
}
