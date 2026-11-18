// Parallel prospective comparison: original v1 vs rank/opponent challenger v2.
// Does not require bookmaker odds. Only snapshots strictly older than kickoff are permitted.
import {preVetoSeries} from './series-model.mjs';
import {opponentAdjustedScenario,CHALLENGER_VERSION} from './challenger.mjs';
export const PROSPECTIVE_VERSION='atlas-prospective-a-b-v1';
const finite=n=>Number.isFinite(n);
export function appendProspective(existing,snapshot,forms,ranks,nowIso){
 const now=Date.parse(nowIso);
 if(!finite(now)||!snapshot?.fetchedAt||Date.parse(snapshot.fetchedAt)>now)throw Error('Invalid snapshot time');
 const values=Array.isArray(existing?.forecasts)?[...existing.forecasts]:[];
 const ids=new Set(values.map(x=>x.matchId));
 const byTeam=new Map((snapshot.teams||[]).map(x=>[x.id,x]));
 const byForm=new Map((forms.teams||[]).map(x=>[x.id,x]));
 const byRank=new Map((ranks.ranks||[]).map(x=>[x.id,x.rank]));
 for(const m of snapshot.matches||[]){
  const start=Date.parse(m.startTime);
  if(!m.id||!finite(start)||start<=now||ids.has(m.id))continue;
  if(Date.parse(snapshot.fetchedAt)>=start||Date.parse(forms.fetchedAt)>=start||Date.parse(ranks.fetchedAt)>=start)continue;
  if(m.status==='completed')continue;
  const a=byTeam.get(m.teamA.id),b=byTeam.get(m.teamB.id);
  if(!a||!b)continue;
  const v1=preVetoSeries(a,b);
  if(!v1)continue;
  const pseudo={matchId:m.id,teamA:m.teamA,teamB:m.teamB,startsAt:m.startTime,frozenAt:nowIso,model:v1};
  const v2=opponentAdjustedScenario(pseudo,byForm.get(m.teamA.id),byForm.get(m.teamB.id),
    byRank.get(m.teamA.id),byRank.get(m.teamB.id),forms.fetchedAt);
  if(!v2)continue;
  values.push({matchId:m.id,event:m.event,eventId:m.eventId,startsAt:m.startTime,teamA:m.teamA,teamB:m.teamB,
   frozenAt:nowIso,v1:{model:'atlas-bo3-pre-veto-uniform-v1',pA:v1.probabilities.aWin,score:v1.probabilities},
   v2:{model:CHALLENGER_VERSION,pA:v2.probabilities.aWin,score:v2.probabilities,
     rankPriorA:v2.rankPriorA,rankA:v2.rankA,rankB:v2.rankB,formDelta:v2.formDeltaLogit},
   snapshotAt:{teams:snapshot.fetchedAt,forms:forms.fetchedAt,rankings:ranks.fetchedAt},
   note:'Both predictions frozen concurrently strictly before kickoff. No odds. Do not overwrite.'});
  ids.add(m.id);
 }
 return{version:PROSPECTIVE_VERSION,lastChecked:nowIso,forecasts:values,
  note:'Only future scores count in prospective v1-v2 comparison. No bookmaker edge implied.'};
}
export function gradeProspective(records,results,nowIso){
 const byId=new Map((results.matches||[]).filter(x=>x.status==='completed'&&Number.isInteger(x.scoreA)&&Number.isInteger(x.scoreB)).map(x=>[x.id,x]));
 const graded=[];
 for(const f of records.forecasts||[]){
  const actual=byId.get(f.matchId);if(!actual)continue;
  if(Date.parse(f.frozenAt)>=Date.parse(f.startsAt))continue;
  const y=actual.scoreA>actual.scoreB?1:0;
  graded.push({matchId:f.matchId,startsAt:f.startsAt,score:actual.scoreA+'–'+actual.scoreB,
   y,pV1:f.v1.pA,pV2:f.v2.pA,brierV1:(f.v1.pA-y)**2,brierV2:(f.v2.pA-y)**2});
 }
 const avg=k=>graded.length?graded.reduce((s,x)=>s+x[k],0)/graded.length:null;
 return{gradedAt:nowIso,registered:(records.forecasts||[]).length,resolved:graded.length,
   meanBrierV1:avg('brierV1'),meanBrierV2:avg('brierV2'),
   records:graded,note:'Only snapshots made before each match. Sample remains too small for profit or calibration claims.'};
}
