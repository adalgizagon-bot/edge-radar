'use strict';
/* ATLAS Major BO3 series estimator. Independent map probabilities -> best-of-three,
   with transparent weighted veto SCENARIOS while maps have not been confirmed.
   No bookmaker odds feed this estimator; uncalibrated and exploratory. */
(function(root){
 const I=root.AtlasMajorIntel||(typeof require==='function'?require('./major-intelligence-core.js'):null);
 const M=root.AtlasMajorMaps||(typeof require==='function'?require('./major-map-core.js'):null);
 const num=n=>typeof n==='number'&&Number.isFinite(n);
 const round=(x,d=4)=>num(x)?Math.round(x*10**d)/10**d:null;
 const norm=s=>M.norm(s);
 const seriesOdds=(p1,p2,p3)=>{
  if(![p1,p2,p3].every(x=>num(x)&&x>=0&&x<=1))return null;
  const tied=p1*(1-p2)+(1-p1)*p2;
  const a20=p1*p2,a21=tied*p3,b20=(1-p1)*(1-p2),b21=tied*(1-p3);
  return{probabilityA:a20+a21,probabilityB:b20+b21,a20,a21,b20,b21};
 };
 const weight=(profile,map)=>{
  const value=M.getTeamMap(profile,map)?.pickPercent;
  return num(value)&&value>=0?value:0;
 };
 const projectSeries=(game,a,b,rankHistory,slots={})=>{
  if(game?.bestOf!==3||!I||!M)return{status:'not_bo3',probabilityA:null,probabilityB:null};
  const selections=[1,2,3].map(i=>String(slots?.['map'+i]||'').trim());
  const chosen=selections.filter(Boolean),normalized=chosen.map(norm);
  const allRows=M.getMaps(a,b).map(map=>({
   map,model:I.winner(game,a,b,map,rankHistory),
   pickA:weight(a,map),pickB:weight(b,map),
   sampleA:M.getTeamMap(a,map)?.played??0,sampleB:M.getTeamMap(b,map)?.played??0
  }));
  const pool=allRows.filter(x=>x.model?.status==='estimated'&&num(x.model.probabilityA));
  const allMapProjections=allRows.map(x=>({
   name:x.map,probabilityA:x.model?.status==='estimated'?x.model.probabilityA:null,
   probabilityB:x.model?.status==='estimated'?x.model.probabilityB:null,
   sampleA:x.sampleA,sampleB:x.sampleB,pickA:x.pickA,pickB:x.pickB,
   adjusted:x.model?.modelStatus==='opponent_adjusted',status:x.model?.status||'insufficient_data',
   reason:x.model?.reason||'Amostra insuficiente'
  }));
  const common={selectedMaps:selections,selectedCount:chosen.length,candidates:pool.length,allMapProjections};
  if(new Set(normalized).size!==normalized.length)return{
   ...common,status:'duplicate_maps',probabilityA:null,probabilityB:null,
   reason:'Em uma MD3, cada mapa só pode aparecer uma vez. Corrija os mapas repetidos.'};
  const byName=new Map(pool.map(x=>[norm(x.map),x]));
  const notModelable=chosen.filter(x=>!byName.has(norm(x)));
  if(notModelable.length)return{
   status:'insufficient_selected_map',probabilityA:null,probabilityB:null,
   reason:'Mapa sem amostra suficiente para uma das equipes: '+notModelable.join(', ')+'. Exigimos no mínimo 5 mapas por equipe.',
   ...common};
  if(pool.length<3)return{
   status:'insufficient_pool',probabilityA:null,probabilityB:null,
   reason:'É preciso ter pelo menos 3 mapas distintos com amostras válidas das duas equipes.',
   ...common};
  const slotsPool=selections.map(n=>n?[byName.get(norm(n))]:pool);
  let totalWeight=0,weightedA=0,weightedA20=0,weightedA21=0,weightedB20=0,weightedB21=0;
  let low=1,high=0,scenarios=0;
  const slotWeight=(candidate,index)=>{
   if(selections[index])return 1;
   // Heuristic only, never a prediction of the actual veto order.
   const wA=candidate.pickA,wB=candidate.pickB;
   return 5+(index===0 ? (0.6*wA+0.4*wB) : index===1 ? (0.4*wA+0.6*wB) : (0.5*(wA+wB)));
  };
  for(const x of slotsPool[0])for(const y of slotsPool[1]){
   if(norm(x.map)===norm(y.map))continue;
   for(const z of slotsPool[2]){
    if(norm(z.map)===norm(x.map)||norm(z.map)===norm(y.map))continue;
    const result=seriesOdds(x.model.probabilityA,y.model.probabilityA,z.model.probabilityA);
    if(!result)continue;
    const w=slotWeight(x,0)*slotWeight(y,1)*slotWeight(z,2);
    totalWeight+=w;weightedA+=w*result.probabilityA;
    weightedA20+=w*result.a20;weightedA21+=w*result.a21;
    weightedB20+=w*result.b20;weightedB21+=w*result.b21;
    low=Math.min(low,result.probabilityA);high=Math.max(high,result.probabilityA);
    scenarios++;
   }
  }
  if(!scenarios||totalWeight<=0)return{
   status:'no_valid_scenarios',probabilityA:null,probabilityB:null,
   reason:'Não há três mapas diferentes compatíveis com as escolhas.',
   ...common};
  const aSeries=weightedA/totalWeight;
  const weightedP=x=>x/totalWeight;
  const adjusted=pool.filter(x=>x.model.modelStatus==='opponent_adjusted').length;
  const result={
   status:'estimated',scenarioType:chosen.length===3?'confirmed_map_scenario':'provisional_veto_scenarios',
   ...common,scenarioCount:scenarios,
   probabilityA:aSeries,probabilityB:1-aSeries,
   scores:{a2_0:weightedP(weightedA20),a2_1:weightedP(weightedA21),
    b2_0:weightedP(weightedB20),b2_1:weightedP(weightedB21)},
   rangeA:[low,high],adjustedCandidates:adjusted,calibrated:false,
   assumption:'Mapas independentes condicionalmente; cenários restantes ponderados pelo pickPercent histórico (não por veto confirmado).',
   modelVersion:'atlas-bo3-series-scenarios-v1',
   asOf:{teamA:a.capturedAt||null,teamB:b.capturedAt||null},
   selectedMaps:selections,
   eligibleMaps:pool.map(x=>({name:x.map,probabilityA:x.model.probabilityA,
    sampleA:x.sampleA,sampleB:x.sampleB,pickA:x.pickA,pickB:x.pickB,
    adjusted:x.model.modelStatus==='opponent_adjusted'}))
  };
  return result;
 };
 const api={seriesOdds,projectSeries};
 root.AtlasSeriesModel=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
