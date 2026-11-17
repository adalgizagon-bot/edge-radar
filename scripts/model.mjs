// ATLAS model v1.1 - exploratory, not calibrated.
// Every forecast uses a timestamped pre-match snapshot and remains immutable.
export const MODEL_VERSION = 'atlas-map-round-iid-v1.1';
const finite=(n)=>typeof n==='number'&&Number.isFinite(n);
export function roundWinRate(a,b){
  if(!a||!b||Math.min(a.played||0,b.played||0)<4)return null;
  const k=140;
  const pA=(a.roundsFor+70)/(a.roundsFor+a.roundsAgainst+k);
  const pB=(b.roundsFor+70)/(b.roundsFor+b.roundsAgainst+k);
  if(!finite(pA)||!finite(pB)||pA<=0||pA>=1||pB<=0||pB>=1)return null;
  const l=p=>Math.log(p/(1-p));
  return 1/(1+Math.exp(-(l(pA)-l(pB))));
}
export function scoreDistribution(p){
 if(!finite(p)||p<=0||p>=1)throw new Error('Invalid round probability');
 const final=new Map();const add=(a,b,w)=>{const key=a+':'+b;final.set(key,(final.get(key)||0)+w)};
 // Terminal regular score or 12-12 after 24 rounds.
 let states=new Map([['0:0',1]]);
 for(let step=0;step<24;step++){
  const next=new Map();
  for(const [key,w] of states){const [a,b]=key.split(':').map(Number);
   for(const [aa,bb,prob] of [[a+1,b,p],[a,b+1,1-p]]){
    const weight=w*prob;
    if(aa>=13||bb>=13)add(aa,bb,weight);
    else {const k=aa+':'+bb;next.set(k,(next.get(k)||0)+weight);}
   }
  }states=next;
 }
 // Only remaining state is 12-12. OT uses six-round blocks (win four, or 3-3 extends).
 const tied=states.get('12:12')||0;
 const block=(sA,sB,weight,period)=>{
  let positions=new Map([['0:0',weight]]);
  for(let r=0;r<6;r++){const next=new Map();
   for(const [key,w] of positions){const [a,b]=key.split(':').map(Number);
    for(const [aa,bb,prob] of [[a+1,b,p],[a,b+1,1-p]]){
     const mass=w*prob;
     if(aa===4||bb===4)add(sA+aa,sB+bb,mass);
     else {const k=aa+':'+bb;next.set(k,(next.get(k)||0)+mass)}
    }
   }positions=next;
  }
  const remain=positions.get('3:3')||0;
  if(remain>0){if(period<12)block(sA+3,sB+3,remain,period+1);
   else { // pathological tail (<1e-5 at p=0.5), split without invented deterministic winner
     add(sA+4,sB+3,remain*p);add(sA+3,sB+4,remain*(1-p));
   }}
 };
 if(tied)block(12,12,tied,0);
 const raw=[...final.entries()].map(([key,prob])=>{const [a,b]=key.split(':').map(Number);return{a,b,rounds:a+b,prob}});
 const total=raw.reduce((n,x)=>n+x.prob,0);
 return raw.map(x=>({...x,prob:x.prob/total}));
}
export function probabilityOverPoisson(lambda,line){
 if(!finite(lambda)||lambda<0||!finite(line))return null;
 const upper=Math.floor(line); if(upper<0)return 1;
 let mass=Math.exp(-lambda),sum=mass;
 for(let i=1;i<=upper;i++){mass*=lambda/i;sum+=mass;}
 return Math.max(0,Math.min(1,1-sum));
}
export function forecastMap(m,teamA,teamB,mapName,snapshotTime,playersDataset){
 const as=teamA?.maps?.find(x=>x.name.toLowerCase()===mapName.toLowerCase());
 const bs=teamB?.maps?.find(x=>x.name.toLowerCase()===mapName.toLowerCase());
 const p=roundWinRate(as,bs);if(p===null)return[];
 const dist=scoreDistribution(p), keyBase=m.id+'|'+mapName.toLowerCase();
 const base={matchId:m.id,event:m.event,startsAt:m.startTime,snapshotAt:snapshotTime,model:MODEL_VERSION,
   teamA:m.teamA.name,teamB:m.teamB.name,map:mapName,
   observationsA:as.played,observationsB:bs.played,roundWinProbA:+p.toFixed(6), status:'pending'};
 const make=(kind,label,probability,extra={})=>({id:keyBase+'|'+kind+(extra.playerId?'|'+extra.playerId:''),kind,label,
   probability:+probability.toFixed(6),...base,...extra});
 const result=[
 make('map_a',m.teamA.name+' vence '+mapName,dist.reduce((v,x)=>v+(x.a>x.b?x.prob:0),0)),
 make('rounds_over_21_5','Mais de 21,5 rounds em '+mapName,dist.reduce((v,x)=>v+(x.rounds>21.5?x.prob:0),0)),
 make('handicap_a_minus_2_5',m.teamA.name+' -2,5 rounds em '+mapName,dist.reduce((v,x)=>v+(x.a-x.b>2.5?x.prob:0),0))
 ];
 const players=playersDataset?.players||[];
 const rosters=playersDataset?.teams||[];
 const rosterIds=new Set(rosters.filter(t=>t.id===m.teamA.id||t.id===m.teamB.id)
   .flatMap(t=>t.players.map(p=>p.id)));
 for(const player of players.filter(p=>rosterIds.has(p.id))){
  if(player.fetchedAt && Date.parse(player.fetchedAt)>=Date.parse(m.startTime))continue;
  const pm=player.maps?.find(x=>x.name.toLowerCase()===mapName.toLowerCase());
  if(!pm||pm.count<4||!finite(pm.kpr)||pm.kpr<=0)continue;
  const chance=dist.reduce((sum,x)=>sum+x.prob*probabilityOverPoisson(pm.kpr*x.rounds,15.5),0);
  result.push(make('kills_over_15_5',player.nickname+' mais de 15,5 kills em '+mapName,chance,
   {playerId:player.id,playerName:player.nickname,playerTeamId:player.teamId,
    observedPlayerMaps:pm.count,playerKPR:pm.kpr}));
 }
 return result;
}
export function generateFrozen(existing,snapshot,players,now){
 const forecasts=Array.isArray(existing?.forecasts)?[...existing.forecasts]:[],ids=new Set(forecasts.map(x=>x.id));
 const sourceAt=snapshot?.fetchedAt;
 if(!sourceAt||!Array.isArray(snapshot.matches)||!Array.isArray(snapshot.teams))throw Error('Missing source data');
 const tMap=new Map(snapshot.teams.map(x=>[x.id,x]));
 const clock=Date.parse(now||new Date().toISOString());
 for(const m of snapshot.matches){
  if(!m.id||Date.parse(m.startTime)<=clock||Date.parse(sourceAt)>=Date.parse(m.startTime))continue;
  const a=tMap.get(m.teamA.id),b=tMap.get(m.teamB.id);
  if(!a||!b)continue;
  const maps=a.maps.map(x=>x.name).filter(name=>b.maps.some(y=>y.name.toLowerCase()===name.toLowerCase()));
  for(const name of maps){
   for(const f of forecastMap(m,a,b,name,sourceAt,players)){
    if(!ids.has(f.id)){ids.add(f.id);forecasts.push(f)}
   }
  }
 }
 return {generatedAt:existing?.generatedAt||now||new Date().toISOString(),
  lastCheckedAt:now||new Date().toISOString(),model:MODEL_VERSION,
  note:'Previsões exploratórias congeladas antes da partida; não são recomendações de apostas.',
  forecasts};
}
export function assess(forecasts,results){
 const indexed=new Map((results?.matches||[]).map(x=>[x.id,x]));
 return(forecasts||[]).map(f=>{
  const match=indexed.get(f.matchId),map=match?.maps?.find(x=>x.name?.toLowerCase()===f.map.toLowerCase());
  if(!map||!Number.isFinite(map.scoreA)||!Number.isFinite(map.scoreB)||map.scoreA===map.scoreB)return {...f,status:'pending'};
  let outcome;
  if(f.kind==='map_a')outcome=map.scoreA>map.scoreB?1:0;
  else if(f.kind==='rounds_over_21_5')outcome=map.scoreA+map.scoreB>21.5?1:0;
  else if(f.kind==='handicap_a_minus_2_5')outcome=map.scoreA-map.scoreB>2.5?1:0;
  else if(f.kind==='kills_over_15_5'){
   const ps=map.players?.find(p=>p.id===f.playerId);
   if(!ps||!Number.isFinite(ps.kills))return {...f,status:'pending'};
   outcome=ps.kills>15.5?1:0;
  }else return {...f,status:'pending'};
  return {...f,status:'resolved',outcome,brier:+((f.probability-outcome)**2).toFixed(6),
    resultVerifiedAt:match.verifiedAt||null,actualScore:map.scoreA+'–'+map.scoreB};
 });
}
export function metrics(assessed){
 const values=(assessed||[]).filter(x=>x.status==='resolved');
 const kinds=[...new Set((assessed||[]).map(x=>x.kind))];
 return {total:(assessed||[]).length,resolved:values.length,
  byMarket:kinds.map(kind=>{const rows=values.filter(x=>x.kind===kind);
   const brier=rows.length?rows.reduce((s,x)=>s+x.brier,0)/rows.length:null;
   const correct=rows.filter(x=>(x.probability>=.5?1:0)===x.outcome).length;
   return {kind,observations:rows.length,brier:brier===null?null:+brier.toFixed(4),
    classificationAccuracy:rows.length?+(correct/rows.length).toFixed(4):null}})};
}
