// ATLAS scheduled Cito updater. Runs only in GitHub Actions with CITO_API_KEY secret.
// Conservative daily cap; never exposes the key in commits or browser bundles.
import fs from 'node:fs/promises';
import { generateFrozen, assess, metrics } from './model.mjs';
import { validateSeries } from './series-model.mjs';
import {buildRadarFeed} from './radar-feed.mjs';
import {reconcileMajorLive,gradeMajorBO1} from './major-sync.mjs';
import {audit} from './audit.mjs';
import {appendProspective,gradeProspective} from './prospective.mjs';
import { recentOpponents,longMapHistory,rankedSnapshot } from './strength-sync.mjs';
const dir='public/data/';
const read=async file=>JSON.parse(await fs.readFile(dir+file,'utf8'));
const save=async(file,data)=>fs.writeFile(dir+file,JSON.stringify(data,null,2)+'\n');
const secret=process.env.CITO_API_KEY;
if(!secret){console.log('CITO_API_KEY missing: no API requests made.');process.exit(0)}
const hardMax=Math.min(7,Math.max(1,Number(process.env.CITO_MAX_CALLS||7)));
let calls=0,lastAt=0;const warnings=[];const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function cito(path,params={}){
 if(calls>=hardMax)throw new Error('Daily request cap reached');
 const url=new URL('https://api.citoapi.com/api/v1'+path);
 for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
 const diff=Date.now()-lastAt; if(diff<7000)await delay(7000-diff);
 lastAt=Date.now();calls++;
 const res=await fetch(url,{headers:{'x-api-key':secret,accept:'application/json'},signal:AbortSignal.timeout(18000)});
 if(res.status===429){warnings.push('Cito 429: limit reached; stopping this run.');throw new Error('CITO_RATE_LIMIT')}
 if(!res.ok)throw new Error('Cito API HTTP '+res.status+' at '+path);
 const json=await res.json();
 if(json?.success!==true)throw new Error('Cito response invalid at '+path);
 return json.data;
}
const seriesFrozen=await read('series-forecasts.json'),challengerFrozen=await read('challenger-review.json'),prospective=await read('prospective.json');
const opponentForm=await read('team-opponents.json'),annual=await read('team-long-history.json'),rankings=await read('team-rankings.json');
const nov19Context=await read('nov19-context.json'),nov19Predictions=await read('nov19-forecasts.json'),nov19Quotes=await read('nov19-br365-all-markets.json'),previousQuotes=await read('br365-series-odds.json');
const majorOpening=await read('major-opening-snapshot.json'),majorAnalysis=await read('major-opening-analysis.json');
let majorLive=await read('major-live.json');
const snapshot=await read('tournaments.json'),players=await read('players.json'),predictions=await read('predictions.json'),
 results=await read('results.json'),sync=await read('sync-state.json');
const now=new Date().toISOString(),nowMs=Date.now();
const eventIds=new Set(['cs2-event-9258','cs2-event-9273']);
const unique=(xs,key)=>[...new Map(xs.map(x=>[key(x),x])).values()];
function normalizedFixture(m){
 const a=m.team1||m.teamA,b=m.team2||m.teamB;
 const id=m.matchId||m.id, event=m.event;
 const eventId=event?.id||m.eventId;
 if(!eventIds.has(eventId)||!id||!a?.id||!b?.id)return null;
 const date=m.startTime||m.startsAt;
 if(!date||!Number.isFinite(Date.parse(date)))return null;
 return {id,eventId,event:event?.name||m.eventName||'CS2',
  startTime:date,status:m.status||'upcoming',
  teamA:{id:a.id,name:a.name,slug:a.slug||null},
  teamB:{id:b.id,name:b.name,slug:b.slug||null}};
}
function normalizeResult(raw,match){
 const a=raw.team1Id,b=raw.team2Id,forward=a===match.teamA.id&&b===match.teamB.id,reverse=a===match.teamB.id&&b===match.teamA.id;
 if(!forward&&!reverse)return null;
 if(raw.status!=='completed')return null;
 const maps=(raw.maps||[]).filter(m=>m.status==='completed'&&m.statsEligible!==false&&Number.isInteger(m.team1Score)&&Number.isInteger(m.team2Score)).map(map=>({
   number:map.mapNumber,name:map.mapName,scoreA:forward?map.team1Score:map.team2Score,
   scoreB:forward?map.team2Score:map.team1Score,
   players:(map.playerStats||[]).filter(p=>p.playerId&&Number.isInteger(p.kills)).map(p=>({id:p.playerId,name:p.playerName,kills:p.kills,teamId:p.teamId}))
 }));
 return {id:match.id,event:match.event,startsAt:match.startTime,status:'completed',
  scoreA:forward?raw.team1Score:raw.team2Score,scoreB:forward?raw.team2Score:raw.team1Score,
  verifiedAt:now,maps};
}
function normalizeTeamStats(raw,id){
 if(!raw||!Array.isArray(raw.maps))return null;
 return {id,name:raw.teamName||snapshot.teams.find(t=>t.id===id)?.name||id,windowDays:raw.windowDays??90,matchWindow:raw.matchWindow,
 totalMaps:raw.totalMaps,mapWins:raw.totalMapWins,mapWinPercent:raw.mapWinPercent,
 sideEconomy:{ctWinPercent:raw.sideEconomy?.ctWinPercent,tWinPercent:raw.sideEconomy?.tWinPercent,pistolWinPercent:raw.sideEconomy?.pistolWinPercent},
 maps:raw.maps.filter(m=>m.inPool!==false).map(m=>({name:m.mapName,played:m.played,wins:m.wins,
 winPercent:m.winPercent,pickPercent:m.pickPercent,roundsFor:m.roundsFor,roundsAgainst:m.roundsAgainst,
 ctWinPercent:m.ctWinPercent,tWinPercent:m.tWinPercent,latestPlayedAt:m.latestPlayedAt,inPool:m.inPool})),fetchedAt:now};
}
function normalizeRoster(raw,id,name){
 if(!Array.isArray(raw))return null;
 return {id,name,rosterFetchedAt:now,players:raw.filter(p=>p.isActive&&p.role!=='coach').map(p=>({
 id:p.playerId,nickname:p.playerNickname,role:p.role,teamId:id,rating:p.rating??null}))};
}
function normalizePlayerMaps(raw,player){
 if(!raw||!Array.isArray(raw.maps))return null;
 return {id:player.id,nickname:player.nickname,teamId:player.teamId,role:player.role,
  fetchedAt:now,windowDays:raw.windowDays||30,
  maps:raw.maps.filter(x=>x.inPool!==false).map(x=>({name:x.mapName,count:x.count,
   kpr:x.killsPerRound,kills:x.kills,rounds:x.rounds,adr:x.damagePerRound,rating:x.averageRating}))};
}
let requestsBlocked=false;
const safe=async(label,path,query={})=>{if(requestsBlocked||calls>=hardMax)return null;
 try{return await cito(path,query)}catch(e){warnings.push(label+': '+String(e.message).slice(0,120));if(String(e.message).includes('RATE_LIMIT')||String(e.message).includes('HTTP 401')||String(e.message).includes('HTTP 403'))requestsBlocked=true;return null}};
try{
 // Major priority: ONE event-level Cito request per run, not seven obsolete team queries.
 // The free plan currently has very limited remaining monthly quota. Results and future
 // Swiss fixtures are obtained in the same event-matches response.
 const inMajor=nowMs>=Date.parse('2026-11-23T00:00:00Z')&&nowMs<Date.parse('2026-12-14T00:00:00Z');
 if(inMajor){
  const majorEvent=nowMs<Date.parse('2026-11-28T00:00:00Z')?'cs2-event-9303':
   nowMs<Date.parse('2026-12-02T00:00:00Z')?'cs2-event-9304':'cs2-event-8302';
  const eventRows=await safe('Major '+majorEvent,'/cs2/events/'+majorEvent+'/matches',{limit:100});
  if(Array.isArray(eventRows)){
   majorLive=reconcileMajorLive(majorLive,eventRows,majorEvent,now);
   const majorValidation=gradeMajorBO1(majorAnalysis,majorLive,now);
   sync.updatedAt=now;sync.lastRun={status:'ok',requests:calls,warnings,majorEvent};
   const radar=buildRadarFeed({snapshot,nov19Context,nov19Predictions,nov19Quotes,
    prospective,completed:results,previousQuotes,seriesFrozen,forms:opponentForm,
    ranks:rankings,sync,majorOpening,majorAnalysis,majorLive,nowIso:now});
   await Promise.all([save('major-live.json',majorLive),save('major-validation.json',majorValidation),
    save('radar-feed.json',radar),save('sync-state.json',sync)]);
   console.log(JSON.stringify({at:now,majorEvent,requests:calls,majorFixtures:majorLive.fixtures.length,
    results:majorLive.results.length,bo1Resolved:majorValidation.resolved,radarUpcoming:radar.games.filter(g=>
     Date.parse(g.startTime)>nowMs&&g.status!=='completed').length},null,2));
  }else{
   // Preserve last verified snapshot, do not reset to upcoming or manufacture scores.
   sync.lastRun={status:'partial',requests:calls,warnings,majorEvent};
   await save('sync-state.json',sync);
   console.warn('Major update unavailable: retained last verified radar and forecasts.');
  }
 }else{
 // 1) legacy fixture updater, kept for old historical projects only.
 const fixtures=await safe('upcoming','/cs2/matches/upcoming',{limit:100});
 const additions=(Array.isArray(fixtures)?fixtures:fixtures?.items||[]).map(normalizedFixture).filter(Boolean);
 const before=snapshot.matches.length;
 snapshot.matches=unique([...snapshot.matches,...additions],m=>m.id).sort((a,b)=>a.startTime.localeCompare(b.startTime));
 if(additions.length)console.log('Fixtures: '+before+' -> '+snapshot.matches.length);
 // 2) prioritize official completed match verification, up to four per day while respecting the seven-call cap.
 const unresolved=snapshot.matches.filter(m=>Date.parse(m.startTime)<nowMs-60*60*1000&&
  !(results.matches||[]).find(r=>r.id===m.id&&r.status==='completed'));
 const start=sync.matchCursor||0;
 const matchQueries=Math.min(4,unresolved.length,Math.max(0,hardMax-calls));
 for(let i=0;i<matchQueries;i++){
  const match=unresolved[(start+i)%unresolved.length];
  const raw=await safe('result '+match.id,'/cs2/matches/'+encodeURIComponent(match.id));
  if(!raw)continue;
  const parsed=normalizeResult(raw,match);
  if(parsed){results.matches=unique([...(results.matches||[]),parsed],x=>x.id);
   match.status='completed';match.scoreA=parsed.scoreA;match.scoreB=parsed.scoreB}
 }
 sync.matchCursor=unresolved.length?(start+matchQueries)%unresolved.length:0;
 // 3) refresh missing rosters only. Existing roster results are kept rather than re-querying every day.
 const missing=snapshot.teams.filter(t=>!(players.teams||[]).some(r=>r.id===t.id));
 const rosterTarget=missing[0];
 if(rosterTarget){
  const raw=await safe('roster '+rosterTarget.name,'/cs2/teams/'+encodeURIComponent(rosterTarget.id)+'/roster');
  const roster=normalizeRoster(raw,rosterTarget.id,rosterTarget.name);
  if(roster)players.teams=unique([...(players.teams||[]),roster],x=>x.id);
 }
 // 4) one 90-day team map refresh per day. Frozen forecasts stay immutable.
 if(snapshot.teams.length){
  const idx=(sync.teamCursor||0)%snapshot.teams.length,t=snapshot.teams[idx];
  const raw=await safe('90d map-stats '+t.name,'/cs2/teams/'+encodeURIComponent(t.id)+'/map-stats',{days:90});
  const updated=normalizeTeamStats(raw,t.id);
  if(updated){snapshot.teams=snapshot.teams.map(x=>x.id===t.id?updated:x);
   sync.teamCursor=(idx+1)%snapshot.teams.length}
 }
 // 5) one team's 15 latest completed matches per day, with their opponents' ranks.
 if(snapshot.teams.length){
  const idx=(sync.opponentCursor||0)%snapshot.teams.length,t=snapshot.teams[idx];
  const raw=await safe('opponents '+t.name,'/cs2/teams/'+encodeURIComponent(t.id)+'/matches',{limit:30,status:'completed'});
  const updated=recentOpponents(raw,t,rankings,now);
  if(updated){opponentForm.teams=unique([...(opponentForm.teams||[]),updated],x=>x.id);
   opponentForm.fetchedAt=now;sync.opponentCursor=(idx+1)%snapshot.teams.length}
 }
 // 6) long-term sample, or refresh the world-ranking context once each week.
 if(new Date(now).getUTCDay()===0){
  const raw=await safe('rankings','/cs2/rankings/teams',{limit:100});
  const updated=rankedSnapshot(raw,now);
  if(updated)Object.assign(rankings,updated);
 }else if(snapshot.teams.length){
  const idx=(sync.annualCursor||0)%snapshot.teams.length,t=snapshot.teams[idx];
  const raw=await safe('365d map-stats '+t.name,'/cs2/teams/'+encodeURIComponent(t.id)+'/map-stats',{days:365});
  const updated=longMapHistory(raw,t);
  if(updated){annual.teams=unique([...(annual.teams||[]),updated],x=>x.id);annual.fetchedAt=now;
   sync.annualCursor=(idx+1)%snapshot.teams.length}
 }
 // 7) player form only with remaining quota; do not sacrifice result verification.
 // Give missing player history priority within the remaining daily request budget.
 const universe=(players.teams||[]).flatMap(t=>t.players||[]).filter(p=>p.id);
 const need=universe.filter(p=>!(players.players||[]).some(x=>x.id===p.id));
 const have=universe.filter(p=>(players.players||[]).some(x=>x.id===p.id));
 const ordered=[...need,...have.sort((a,b)=>{
  const pa=players.players.find(x=>x.id===a.id),pb=players.players.find(x=>x.id===b.id);
  return(pa?.fetchedAt||'').localeCompare(pb?.fetchedAt||'')})];
 let fetched=0;
 for(const p of ordered){
  if(calls>=hardMax||fetched>=2)break;
  const raw=await safe('player '+p.nickname,'/cs2/players/'+encodeURIComponent(p.id)+'/maps',{days:30,aggregate:true});
  const item=normalizePlayerMaps(raw,p);
  if(item){players.players=unique([...(players.players||[]),item],x=>x.id);fetched++}
 }
 // 6) freeze *new* predictions only for future games, retaining all historical entries.
 snapshot.fetchedAt=now;players.fetchedAt=now;results.fetchedAt=now;
 const updated=generateFrozen(predictions,snapshot,players,now);
 const checked=assess(updated.forecasts,results);const evalSummary=metrics(checked);
 const evaluation={computedAt:now,...evalSummary,
  assessed:checked.filter(x=>x.status==='resolved').map(x=>({id:x.id,kind:x.kind,matchId:x.matchId,map:x.map,probability:x.probability,outcome:x.outcome,brier:x.brier,actualScore:x.actualScore})),
  note:'Avaliação retrospectiva dos registros congelados antes dos jogos; não comprova vantagem financeira.'};
 const seriesEval=validateSeries(seriesFrozen,results,now);
 const fullAudit=audit(seriesFrozen,results,evaluation,challengerFrozen,now);
 const prospectiveUpdated=appendProspective(prospective,snapshot,opponentForm,rankings,now);
 const prospectiveEval=gradeProspective(prospectiveUpdated,results,now);
 sync.updatedAt=now;sync.lastRun={status:warnings.length?'partial':'ok',requests:calls,warnings};
 const radar=buildRadarFeed({snapshot,nov19Context,nov19Predictions,nov19Quotes,prospective:prospectiveUpdated,completed:results,previousQuotes,seriesFrozen,forms:opponentForm,ranks:rankings,sync,majorOpening,majorAnalysis,majorLive,nowIso:now});
 await Promise.all([save('tournaments.json',snapshot),save('players.json',players),save('predictions.json',updated),save('results.json',results),
  save('validation.json',evaluation),save('series-validation.json',seriesEval),save('audit-2026-11-18.json',fullAudit),save('prospective.json',prospectiveUpdated),save('prospective-validation.json',prospectiveEval),save('team-opponents.json',opponentForm),save('team-long-history.json',annual),save('team-rankings.json',rankings),save('sync-state.json',sync),save('radar-feed.json',radar)]);
 console.log(JSON.stringify({at:now,requests:calls,fixtures:snapshot.matches.length,rosters:players.teams.length,
  playersWithStats:players.players.length,recentOpponentTeams:opponentForm.teams.length,annualTeams:annual.teams.length,frozen:updated.forecasts.length,resolved:evalSummary.resolved,seriesResolved:seriesEval.resolved,prospectiveRegistered:prospectiveUpdated.forecasts.length,prospectiveResolved:prospectiveEval.resolved,radarUpcoming:radar.games.filter(g=>Date.parse(g.startTime)>Date.parse(now)&&g.status!=='completed').length,warnings},null,2));
 }
}catch(e){console.error('Sync failed safely:',e.message);process.exitCode=1}
