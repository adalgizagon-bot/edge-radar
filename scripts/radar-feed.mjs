// ATLAS Radar — single source of truth for the interface.
// This module never recomputes or rewrites an already frozen probability.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const RADAR_VERSION='atlas-radar-unificado-v1';
const goodDate=s=>Number.isFinite(Date.parse(s));
const prop=(o,k,d=null)=>o&&o[k]!==undefined?o[k]:d;
const byId=(xs=[],k='id')=>new Map((xs||[]).filter(Boolean).map(x=>[x[k],x]));
const normStatus=s=>s==='completed'?'completed':s==='live'?'live':'scheduled';
function scoreMarketsFromFrozen(entry){
 if(!entry?.v1?.score||!entry?.v2?.score)return [];
 const keys=['aWin','bWin','aPlus1_5','bMinus1_5','aMinus1_5','bPlus1_5','a20','b20','a21','b21','over2_5','under2_5'];
 const families=['winner','winner','map_handicap','map_handicap','map_handicap','map_handicap','correct_score','correct_score','correct_score','correct_score','total_maps','total_maps'];
 const labels={
 aWin:entry.teamA.name+' vence',bWin:entry.teamB.name+' vence',
 aPlus1_5:entry.teamA.name+' +1,5 mapas',bMinus1_5:entry.teamB.name+' −1,5 mapas',
 aMinus1_5:entry.teamA.name+' −1,5 mapas',bPlus1_5:entry.teamB.name+' +1,5 mapas',
 a20:entry.teamA.name+' 2–0',b20:entry.teamB.name+' 2–0',
 a21:entry.teamA.name+' 2–1',b21:entry.teamB.name+' 2–1',
 over2_5:'Mais de 2,5 mapas',under2_5:'Menos de 2,5 mapas'};
 return keys.map((key,i)=>({key,family:families[i],label:labels[key],
  odd:null,impliedNoVig:null,impliedRaw:null,v1P:entry.v1.score[key],v2P:entry.v2.score[key],
  marketOverround:null,source:'sem_odds',status:'unquoted'}));
}
export function buildRadarFeed({snapshot,nov19Context,nov19Predictions,nov19Quotes,prospective,completed,previousQuotes,seriesFrozen,forms,ranks,sync,majorOpening=null,majorAnalysis=null,majorLive=null,majorQuotes=null,majorNov25Quotes=null,nowIso}){
 if(!goodDate(nowIso))throw Error('Invalid generatedAt');
 const majorBase=(majorOpening?.fixtures||[]).map(g=>({...g,event:g.eventName||majorOpening.event?.name||'Major',
   snapshotAt:majorOpening.capturedAt}));
 const majorUpdates=(majorLive?.fixtures||[]).map(g=>({...g,event:g.eventName||'Major',
   snapshotAt:g.snapshotAt||majorLive.fetchedAt}));
 const snapshots=[...(snapshot?.matches||[]),...(nov19Context?.fixtures||[]),...majorBase,...majorUpdates];
 const matches=new Map();
 for(const g of snapshots){
  const id=g?.id||g?.matchId,at=g?.startTime||g?.startsAt;
  if(!id||!goodDate(at)||!g.teamA?.id||!g.teamB?.id)continue;
  const row={id,event:g.event||'CS2',eventId:g.eventId||null,startTime:at,teamA:g.teamA,teamB:g.teamB,
   status:normStatus(g.status),bestOf:g.bestOf??null,stage:g.stage||null,source:g.snapshotAt||snapshot?.fetchedAt||null};
  // Prefer the specifically verified 19 Nov Cito snapshot over the older tournament photo.
  if(!matches.has(id)||(g.snapshotAt&&(!matches.get(id).source||Date.parse(g.snapshotAt)>=Date.parse(matches.get(id).source))))matches.set(id,row);
 }
 const done=byId([...(completed?.matches||[]),...(majorLive?.results||[])],'id');
 const pre=byId(prospective?.forecasts||[],'matchId'),quote=byId(nov19Quotes?.matches||[],'matchId'),old=byId(seriesFrozen?.matches||[],'matchId');
 const snapshots19=byId(nov19Predictions?.metrics||[],'id');
 const formById=byId(forms?.teams||[]),rankById=byId(ranks?.ranks||[]);
 const priceOld=byId(previousQuotes?.odds||[],'matchId');
 const majorById=byId(majorAnalysis?.forecasts||[],'matchId');
 const majorOddsById=byId(majorQuotes?.matches||[],'matchId');
 const majorNextOddsById=byId(majorNov25Quotes?.matches||[],'matchId');
 const majorTeamById=byId(majorOpening?.teams||[],'id');
 const out=[];
 for(const game of matches.values()){
  const resolved=done.get(game.id);
  const frozen=pre.get(game.id),legacy=old.get(game.id),odds=quote.get(game.id),nov19=snapshots19.get(game.id);
  const start=Date.parse(game.startTime);
  const isFinished=Boolean(resolved?.status==='completed')||game.status==='completed';
  const status=isFinished?'completed':game.status;
  const forecastValid=Boolean(frozen&&goodDate(frozen.frozenAt)&&Date.parse(frozen.frozenAt)<start);
  const fore=forecastValid?frozen:null;
  let model=fore?{v1:fore.v1?.pA??null,v2:fore.v2?.pA??null,
    frozenAt:fore.frozenAt,version:'V1 vs V2',status:'experimental',v1Score:fore.v1.score,v2Score:fore.v2.score}:
    legacy&&goodDate(legacy.frozenAt)&&Date.parse(legacy.frozenAt)<start?
    {v1:legacy.model?.probabilities?.aWin??null,v2:null,frozenAt:legacy.frozenAt,version:'V1',status:'experimental',v1Score:legacy.model?.probabilities||null,v2Score:null}:null;
  const isBo1=game.bestOf===1;
  const fresh=majorNextOddsById.get(game.id);
  const freshValid=Boolean(!isFinished&&fresh&&goodDate(fresh.capturedAt)&&
   Date.parse(fresh.capturedAt)<start&&
   (fresh.bestOf===1||fresh.bestOf===3)&&fresh.bestOf===game.bestOf&&
   fresh.marketType===(fresh.bestOf===1?'bo1_winner':'bo3_series_winner')&&
   Number.isFinite(fresh.oddA)&&fresh.oddA>1&&
   Number.isFinite(fresh.oddB)&&fresh.oddB>1&&
   fresh.teamA===game.teamA.name&&fresh.teamB===game.teamB.name&&
   game.eventId===majorNov25Quotes?.eventId);
  const bo1Price=isBo1?(freshValid?fresh:majorOddsById.get(game.id)):null;
  const bo1PriceValid=Boolean(!isFinished&&bo1Price&&goodDate(bo1Price.capturedAt)&&
   Date.parse(bo1Price.capturedAt)<start&&
   Number.isFinite(bo1Price.oddA)&&bo1Price.oddA>1&&
   Number.isFinite(bo1Price.oddB)&&bo1Price.oddB>1&&
   bo1Price.teamA===game.teamA.name&&bo1Price.teamB===game.teamB.name);
  const majorFrozen=majorById.get(game.id);
  if(isBo1){
   const usable=majorFrozen?.status==='exploratory'&&goodDate(majorFrozen.frozenAt)&&
    Date.parse(majorFrozen.frozenAt)<start;
   model=usable?{v1:null,v2:majorFrozen.modelProbabilityA,frozenAt:majorFrozen.frozenAt,
      version:'Major BO1 experimental',status:'unvalidated',
      format:'BO1',rankPriorA:majorFrozen.rankPriorA,
      vetoSensitivity:majorFrozen.vetoSensitivity,
      mapScenarios:majorFrozen.mapScenarios,
      mapsEligible:majorFrozen.mapsEligible}:null;
  }
  const priceValid=!isBo1&&odds&&goodDate(odds.screenshotCapturedAtApprox)&&Date.parse(odds.screenshotCapturedAtApprox)<start;
  let markets=[];
  if(fore)markets=scoreMarketsFromFrozen(fore);
  if(priceValid){
   const seen=new Set();
   markets=(odds.markets||[]).map(q=>{
    seen.add(q.key);
    return {key:q.key,family:q.family,label:q.label,odd:q.odd,
      impliedNoVig:q.impliedNoVig,impliedRaw:q.impliedRaw,
      v1P:fore?.v1?.score?.[q.key]??q.v1P??null,v2P:fore?.v2?.score?.[q.key]??q.v2P??null,
      marketOverround:q.marketOverround,source:'br365_screenshot',status:'research_only_unvalidated'};
   });
   if(fore)markets.push(...scoreMarketsFromFrozen(fore).filter(q=>!seen.has(q.key)));
  }
  if(isBo1){
   const overround=bo1PriceValid?1/bo1Price.oddA+1/bo1Price.oddB:null;
   const makeWinMarket=(key,name,odd,p,marketProb)=>({
    key,family:'winner',label:name+' vence o mapa BO1',odd,
    impliedNoVig:bo1PriceValid?(1/odd)/overround:null,
    impliedRaw:bo1PriceValid?1/odd:null,
    v1P:null,v2P:p,marketOverround:overround,
    source:bo1PriceValid?'br365_screenshot':'sem_odds',
    status:bo1PriceValid?'research_only_unvalidated':'unquoted_major_bo1'
   });
   markets=(bo1PriceValid||model)?[
    makeWinMarket('aWin',game.teamA.name,bo1PriceValid?bo1Price.oddA:null,model?.v2??null),
    makeWinMarket('bWin',game.teamB.name,bo1PriceValid?bo1Price.oddB:null,Number.isFinite(model?.v2)?1-model.v2:null)
   ]:[];
  }
  if(freshValid&&game.bestOf===3){
   const overround=1/fresh.oddA+1/fresh.oddB;
   const makeSeriesWinner=(key,name,odd)=>({
    key,family:'winner',label:name+' vence a série BO3',odd,
    impliedNoVig:(1/odd)/overround,impliedRaw:1/odd,
    v1P:null,v2P:null,marketOverround:overround,
    source:fresh.captureMethod==='user_text'?'br365_user_text':'br365_screenshot',status:'research_only_unvalidated',
    settlementScope:'series_winner_bo3'
   });
   markets=[
    makeSeriesWinner('aWin',game.teamA.name,fresh.oddA),
    makeSeriesWinner('bWin',game.teamB.name,fresh.oddB)
   ];
  }
  const matchingNov19=nov19;
  const side=(team,code)=>{
   if(isBo1){
    const captured=majorTeamById.get(team.id);
    return{rank:captured?.worldRankAtEvent??null,maps90:captured?.mapStats?.totalMaps??null,
      form:{n:0,wins:0,losses:0,vsTop50:0,winsVsTop50:0},
      available:Boolean(captured?.mapStats),
      asOf:majorOpening?.capturedAt??null};
   }
   const frozenHistory=matchingNov19?.history?.[code];
   const current=formById.get(team.id);
   const played=current?.recent||[];
   const result=frozenHistory?.form||{last15:played.length,wins:played.filter(x=>x.result==='W').length,
     losses:played.filter(x=>x.result==='L').length,
     vsTop50:played.filter(x=>Number.isInteger(x.opponent?.rank)&&x.opponent.rank<=50).length,
     winsVsTop50:played.filter(x=>Number.isInteger(x.opponent?.rank)&&x.opponent.rank<=50&&x.result==='W').length};
   return{rank:frozenHistory?.rank??rankById.get(team.id)?.rank??null,
    maps90:frozenHistory?.maps90??snapshot?.teams?.find(x=>x.id===team.id)?.totalMaps??null,
    form:{n:result.last15||0,wins:result.wins||0,losses:result.losses||0,vsTop50:result.vsTop50||0,
      winsVsTop50:result.winsVsTop50||0},
    asOf:matchingNov19?nov19Context?.fetchedAt:(current?.fetchedAt||forms?.fetchedAt||null)};
  };
  out.push({id:game.id,startTime:game.startTime,event:game.event,eventId:game.eventId,status,
    bestOf:game.bestOf,stage:game.stage,
    major:isBo1?{event:'PGL Major Singapore 2026',format:'BO1',vetoConfirmed:false,
      modelStatus:majorFrozen?.status||'not_modeled',
      limitation:majorFrozen?.reason||'No pregame model',noOdds:!bo1PriceValid}:null,
    isMajorSeries:game.eventId==='cs2-event-9303'&&game.bestOf===3,
    teamA:{id:game.teamA.id,name:game.teamA.name},teamB:{id:game.teamB.id,name:game.teamB.name},
    result:resolved?.status==='completed'?{scoreA:resolved.scoreA,scoreB:resolved.scoreB,verifiedAt:resolved.verifiedAt}:null,
    model,quotes:bo1PriceValid?{source:'BR365 / print enviado',capturedAt:bo1Price.capturedAt,eventId:game.eventId,live:false,
      settlementScope:'map_winner_bo1'}:
      freshValid&&game.bestOf===3?{source:fresh.source||'BR365 / print enviado',capturedAt:fresh.capturedAt,
       eventId:game.eventId,live:false,settlementScope:'series_winner_bo3',
       ...(fresh.captureMethod?{captureMethod:fresh.captureMethod}:{})}:
      priceValid?{source:'BR365 / prints enviados',capturedAt:odds.screenshotCapturedAtApprox,eventId:odds.br365EventId,live:false}:null,
    markets,unmodeledRoundHandicaps:priceValid?odds.unmodeledRoundHandicaps||[]:[],
    pricingConsistency:priceValid?odds.pricingConsistency||[]:[],
    form:{a:side(game.teamA,'a'),b:side(game.teamB,'b')},
    comparisonNote:'Probabilidades experimentais não calibradas; odds de prints não são preços atuais.',
    legacyMarketPrices:!priceValid&&isFinished&&priceOld.has(game.id)?{availableForAudit:true}:null
  });
 }
 out.sort((a,b)=>a.startTime.localeCompare(b.startTime)||a.id.localeCompare(b.id));
 return{version:RADAR_VERSION,generatedAt:nowIso,
  dataStatus:{citoAt:snapshot?.fetchedAt||null,majorAt:majorLive?.fetchedAt||majorOpening?.capturedAt||null,
    majorOddsAt:majorNov25Quotes?.capturedAt||majorQuotes?.capturedAt||null,
    formAt:forms?.fetchedAt||null,rankingsAt:ranks?.fetchedAt||null,
    dailySyncAt:sync?.updatedAt||null,oddsType:'prints_manualmente_enviados',
    automaticOdds:false,dailyCitoUpdatesDependOnGitHubActions:true},
  games:out,
  rules:{upcomingOnly:'filter at render time using game.startTime > Date.now(); never show expired fixtures on radar',
   history:'completed results and past matches only, separate from the radar',
   noPrice:'show awaiting odds, never fabricate',
   oneMarketPerMatch:true,
   warnings:'model uncalibrated; price photographed; not an automated bet or recommendation'},
  archive:{count:out.filter(x=>x.status==='completed').length}};
}
async function run(){
 const load=async f=>JSON.parse(await fs.readFile('public/data/'+f,'utf8'));
 const [snapshot,nov19Context,nov19Predictions,nov19Quotes,prospective,completed,previousQuotes,seriesFrozen,forms,ranks,sync,majorOpening,majorAnalysis,majorLive,majorQuotes,majorNov25Quotes]=await Promise.all(
  ['tournaments.json','nov19-context.json','nov19-forecasts.json','nov19-br365-all-markets.json',
   'prospective.json','results.json','br365-series-odds.json','series-forecasts.json','team-opponents.json',
   'team-rankings.json','sync-state.json','major-opening-snapshot.json','major-opening-analysis.json','major-live.json','major-br365-odds.json','major-br365-odds-2026-11-25.json'].map(load)
 );
 const result=buildRadarFeed({snapshot,nov19Context,nov19Predictions,nov19Quotes,prospective,
   completed,previousQuotes,seriesFrozen,forms,ranks,sync,majorOpening,majorAnalysis,majorLive,majorQuotes,majorNov25Quotes,nowIso:new Date().toISOString()});
 await fs.writeFile('public/data/radar-feed.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({radar:result.version,all:result.games.length,upcoming:result.games.filter(g=>Date.parse(g.startTime)>Date.now()).length,withOdds:result.games.filter(g=>Date.parse(g.startTime)>Date.now()&&g.quotes).length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run();
