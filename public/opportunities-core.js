'use strict';
// Pure data logic for the research dashboard. No betting execution.
(function (root) {
  const MARKET_NAMES = Object.freeze({
    map_a:'Vencedor de mapa',
    rounds_over_21_5:'Total de rounds',
    handicap_a_minus_2_5:'Handicap de mapa',
    kills_over_15_5:'Kills de jogadores'
  });
  function safeProbability(n){return Number.isFinite(n)&&n>0&&n<1?n:null}
  function sampleSize(f){
    const a=Number(f.observationsA),b=Number(f.observationsB);
    if(!Number.isFinite(a)||!Number.isFinite(b))return 0;
    const base=Math.min(a,b);
    if(f.kind==='kills_over_15_5')return Math.min(base,Number(f.observedPlayerMaps)||0);
    return base;
  }
  function isEligible(f){
    return Boolean(f && MARKET_NAMES[f.kind] && safeProbability(Number(f.probability))!==null &&
      f.matchId && f.map && f.snapshotAt && f.startsAt &&
      Date.parse(f.snapshotAt)<Date.parse(f.startsAt) && sampleSize(f)>=4);
  }
  function rankValue(signal){
    const n=signal.sample;
    // Explicit heuristic to de-prioritize thin historical coverage. Not calibration or a confidence interval.
    return signal.probability - 0.12*Math.max(0,(10-n)/10);
  }
  function assemble(forecasts,fixtures,nowIso){
    const byId=new Map((fixtures.matches||[]).map(m=>[m.id,m]));
    const now=Number.isFinite(Date.parse(nowIso))?Date.parse(nowIso):Date.now();
    const signals=[];
    for(const f of forecasts.forecasts||[]){
      if(!isEligible(f))continue;
      const game=byId.get(f.matchId);
      if(!game)continue;
      const p=Number(f.probability),s=sampleSize(f);
      signals.push({
        ...f, game, probability:p,sample:s,quality:s>=12?'boa':s>=8?'moderada':'limitada',
        score:rankValue({probability:p,sample:s}),
        fairOdd:1/p,upcoming:Date.parse(game.startTime)>now && game.status!=='completed',
        mapConfirmed:false, // We never infer veto from historical candidate maps.
        eventId:game.eventId
      });
    }
    return signals.sort((a,b)=>b.score-a.score||b.probability-a.probability||a.matchId.localeCompare(b.matchId));
  }
  function filtered(signals,{event='all',market='all',minimum=0.5,quality='all',upcomingOnly=false}={}){
    return (signals||[]).filter(s=>
      (event==='all'||s.eventId===event)&&
      (market==='all'||s.kind===market)&&
      s.probability>=minimum&&
      (quality==='all'||(quality==='8'&&s.sample>=8)||(quality==='12'&&s.sample>=12))&&
      (!upcomingOnly||s.upcoming)
    ).sort((a,b)=>b.score-a.score||b.probability-a.probability);
  }
  function onePerGame(signals){
    const done=new Set(),chosen=[];
    for(const s of (signals||[]).slice().sort((a,b)=>b.score-a.score||b.probability-a.probability)){
      if(done.has(s.matchId))continue;
      chosen.push(s);done.add(s.matchId);
    }
    return chosen;
  }
  function groupedGames(signals,fixtureList){
    const map=new Map();for(const s of signals||[]){if(!map.has(s.matchId))map.set(s.matchId,[]);map.get(s.matchId).push(s)}
    return (fixtureList||[]).map(game=>({game,signals:(map.get(game.id)||[]).sort((a,b)=>b.score-a.score)}));
  }
  function combinationStats(signals){
    if(!signals||!signals.length)return null;
    if(new Set(signals.map(s=>s.matchId)).size!==signals.length)throw new Error('Choose at most one market per match');
    const independentProbability=signals.reduce((p,s)=>p*s.probability,1);
    return {
      legs:signals.length,independentProbability,indicativeFairOdd:1/independentProbability,
      unconfirmedMaps:signals.filter(s=>!s.mapConfirmed).length,
      smallSamples:signals.filter(s=>s.sample<8).length,
      tournaments:new Set(signals.map(s=>s.eventId)).size,
      strictlyHypothetical:true
    };
  }
  function initialSelections(signals,slots){
    const future=(signals||[]).filter(s=>s.upcoming);
    // Prefer at least eight map observations when available. Some matches have no such market;
    // only then fall back to smaller samples and label that exposure in the UI.
    const selected=new Map();
    for(const s of onePerGame(future.filter(s=>s.sample>=8)))selected.set(s.matchId,s);
    for(const s of onePerGame(future))if(!selected.has(s.matchId))selected.set(s.matchId,s);
    return [...selected.values()].sort((a,b)=>b.score-a.score).slice(0,Math.max(0,Math.min(8,slots)));
  }
  const publicAPI={MARKET_NAMES,assemble,filtered,onePerGame,groupedGames,combinationStats,initialSelections,isEligible,sampleSize,rankValue};
  root.AtlasOpportunityCore=publicAPI;
  if(typeof module!=='undefined'&&module.exports)module.exports=publicAPI;
})(typeof window!=='undefined'?window:globalThis);
