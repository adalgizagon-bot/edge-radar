// ATLAS experimental challenger v2 — designed after observing Nov 18 results.
// This is a POST-HOC PROTOTYPE and never an out-of-sample test on those games.
// Inputs for historic replays must be snapshots captured before kickoff.
export const CHALLENGER_VERSION='atlas-rank-strength-challenger-v2-prototype';
const valid=n=>Number.isFinite(n),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const logistic=x=>1/(1+Math.exp(-x));
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6)));
const choose=(n,k)=>{let p=1;for(let i=1;i<=k;i++)p*=(n-k+i)/i;return p};
export function expectedByRank(a,b){
 if(!valid(a)||!valid(b)||a<1||b<1)return null;
 return logistic(.65*Math.log(b/a)); // heuristic based on ordinal rank, NOT calibrated
}
export function formResidual(team,rank,asOf){
 if(!team||!rank)return{residual:0,usable:0,weighted:null};
 const cutoff=Date.parse(asOf),recent=(team.recent||[]).filter(x=>Date.parse(x.startsAt)<cutoff&&['W','L'].includes(x.result));
 let num=0,den=0,n=0;
 for(const m of recent){
  const e=expectedByRank(rank,m.opponent?.rank);if(e===null)continue;
  const days=clamp((cutoff-Date.parse(m.startsAt))/86400000,0,366);
  const w=Math.pow(2,-days/45);num+=w*((m.result==='W'?1:0)-e);den+=w;n++;
 }
 const r=den>0?num/den:0;
 return{residual:clamp(r,-.5,.5),usable:n,weighted:den||null};
}
export function scoreOfBestOf3(p1,p2,p3){
 const tie=p1*(1-p2)+(1-p1)*p2;
 return{a20:p1*p2,a21:tie*p3,b20:(1-p1)*(1-p2),b21:tie*(1-p3)};
}
export function opponentAdjustedScenario(original,teamA,teamB,rankA,rankB,at){
 if(!original?.model?.commonMaps?.length||original.model.commonMaps.length<3)return null;
 const timestamp=Date.parse(original.startsAt);
 if(!valid(timestamp)||Date.parse(at)>=timestamp)return null;
 const rankP=expectedByRank(rankA,rankB);if(rankP===null)return null;
 const fa=formResidual(teamA,rankA,original.startsAt),fb=formResidual(teamB,rankB,original.startsAt);
 const weightA=fa.usable/(fa.usable+15),weightB=fb.usable/(fb.usable+15);
 const formDelta=clamp(.45*(fa.residual*weightA-fb.residual*weightB),-.12,.12);
 const minHistory=original.model.minCommonMapHistory||0;
 const mapWeight=minHistory>=8?.45:.30;
 const rankedWeight=1-mapWeight;
 const adjusted=original.model.commonMaps.map(m=>({
  name:m.name,obsA:m.observationsA,obsB:m.observationsB,oldMapP:m.winProbA,
  mapP:logistic(mapWeight*logit(m.winProbA)+rankedWeight*logit(rankP)+formDelta)
 }));
 const sums={a20:0,a21:0,b20:0,b21:0};const scores=[];
 for(let i=0;i<adjusted.length;i++)for(let j=0;j<adjusted.length;j++)for(let k=0;k<adjusted.length;k++){
  if(i===j||i===k||j===k)continue;
  const val=scoreOfBestOf3(adjusted[i].mapP,adjusted[j].mapP,adjusted[k].mapP);
  for(const key of Object.keys(sums))sums[key]+=val[key];
  scores.push(val);
 }
 for(const key of Object.keys(sums))sums[key]/=scores.length;
 const prob={aWin:sums.a20+sums.a21,bWin:sums.b20+sums.b21,
  ...sums,aMinus1_5:sums.a20,bPlus1_5:1-sums.a20,
  aPlus1_5:1-sums.b20,bMinus1_5:sums.b20,
  over2_5:sums.a21+sums.b21,under2_5:sums.a20+sums.b20};
 const sensitivity={};for(const key of Object.keys(prob)){
  const vals=scores.map(s=>key==='aWin'?s.a20+s.a21:key==='bWin'?s.b20+s.b21:
    key==='over2_5'?s.a21+s.b21:key==='under2_5'?s.a20+s.b20:
    key==='aMinus1_5'?s.a20:key==='bMinus1_5'?s.b20:
    key==='aPlus1_5'?1-s.b20:key==='bPlus1_5'?1-s.a20:s[key]);
  sensitivity[key]={min:Math.min(...vals),max:Math.max(...vals)};
 }
 return{matchId:original.matchId,startsAt:original.startsAt,teamA:original.teamA.name,teamB:original.teamB.name,
  version:CHALLENGER_VERSION,inputSnapshots:{original:original.frozenAt,form:at},
  rankA,rankB,rankPriorA:rankP,rankPriorFormula:'sigmoid(0.65 × ln(rankB/rankA))',
  formA:fa,formB:fb,formDeltaLogit:formDelta,mapWeight,rankedWeight,
  maps:adjusted.length,minimumMapHistory:minHistory,probabilities:prob,sensitivity,
  qualityWarning:'Exploratory rank and recent-form adjustment. NOT prospectively validated. Original forecasts are untouched.'};
}
export function buildChallenger(original,forms,rankings,generatedAt){
 const current=Date.parse(generatedAt);
 const rankAt=Date.parse(rankings.fetchedAt),formAt=Date.parse(forms.fetchedAt);
 if(!valid(rankAt)||!valid(formAt))throw Error('Undated context');
 const ranked=new Map((rankings.ranks||[]).map(x=>[x.id,x.rank]));
 const recent=new Map((forms.teams||[]).map(x=>[x.id,x]));
 const outputs=[],missing=[];
 for(const m of original.matches||[]){
  if(!(rankAt<Date.parse(m.startsAt)&&formAt<Date.parse(m.startsAt))){missing.push({id:m.matchId,why:'No pregame context snapshot'});continue}
  const rankA=ranked.get(m.teamA.id),rankB=ranked.get(m.teamB.id);
  const forecast=opponentAdjustedScenario(m,recent.get(m.teamA.id),recent.get(m.teamB.id),rankA,rankB,forms.fetchedAt);
  if(forecast)outputs.push(forecast);
  else missing.push({id:m.matchId,why:'No ranked map, opponent or team context'});
 }
 return{version:CHALLENGER_VERSION,generatedAt,trainedOnToday:false,
  createdAfterResults:true,prospectivelyValidated:false,
  note:'RETROSPECTIVE DESIGN, NOT AN OUT-OF-SAMPLE EVALUATION. Inputs were pregame snapshots; formula was designed after seeing results. Do not use as betting advice.',
  inputSnapshots:{rankingsAt:rankings.fetchedAt,opponentsAt:forms.fetchedAt,seriesAt:original.generatedAt},
  forecasts:outputs,unmodeled:missing};
}
