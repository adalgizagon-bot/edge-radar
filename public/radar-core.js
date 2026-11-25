'use strict';
/* One ATLAS workspace; pure helpers for browser and Node tests. */
(function(global){
 const toTime=value=>Date.parse(value||'');
 const numeric=n=>typeof n==='number'&&Number.isFinite(n);
 const isFuture=(g,now=Date.now())=>numeric(toTime(g?.startTime))&&toTime(g.startTime)>now&&g.status!=='completed';
 /* Only for the read-only radar: retain matches for five hours after scheduled kickoff.
    This does NOT permit new market selections after kickoff (isFuture stays strict). */
 const RADAR_GRACE_MS=5*60*60*1000;
 const isRadarVisible=(g,now=Date.now())=>numeric(toTime(g?.startTime))&&
   toTime(g.startTime)+RADAR_GRACE_MS>now&&
   ['upcoming','scheduled','live','in_progress','ongoing','completed','finished'].includes(g.status);
 const getRadarGames=(feed,now=Date.now())=>[...(feed?.games||[])].filter(g=>isRadarVisible(g,now))
   .sort((a,b)=>toTime(a.startTime)-toTime(b.startTime)||a.id.localeCompare(b.id));
 const getUpcoming=(feed,now=Date.now())=>[...(feed?.games||[])].filter(g=>isFuture(g,now))
   .sort((a,b)=>toTime(a.startTime)-toTime(b.startTime)||a.id.localeCompare(b.id));
 const getHistory=(feed,now=Date.now())=>[...(feed?.games||[])].filter(g=>numeric(toTime(g.startTime))&&toTime(g.startTime)+RADAR_GRACE_MS<=now)
   .sort((a,b)=>toTime(b.startTime)-toTime(a.startTime)||a.id.localeCompare(b.id));
 const hasOdds=g=>Boolean(g?.quotes?.capturedAt&&Array.isArray(g.markets)&&g.markets.some(m=>numeric(m.odd)&&m.odd>1));
 const winnerMarket=g=>(g?.markets||[]).filter(m=>m.family==='winner');
 const familyLabel={winner:'Vencedor',map_handicap:'Handicap de mapas',correct_score:'Placar exato',total_maps:'Total de mapas'};
 const cleanSelections=(all,feed,now=Date.now())=>{
  const map=new Map(getUpcoming(feed,now).map(g=>[g.id,g]));
  const output=new Map();
  for(const x of Array.isArray(all)?all:[]){
   const match=map.get(x.matchId);
   const market=match?.markets?.find(m=>m.key===x.key&&numeric(m.odd)&&m.odd>1);
   if(match&&market&&!output.has(match.id))output.set(match.id,{matchId:match.id,key:market.key});
  }
  return[...output.values()];
 };
 const getSelectionMarket=(selection,feed)=>{
  const g=(feed?.games||[]).find(x=>x.id===selection.matchId);
  return{game:g,market:g?.markets?.find(x=>x.key===selection.key)};
 };
 const studySummary=(selections,feed,now=Date.now())=>{
  const valid=cleanSelections(selections,feed,now);
  const items=valid.map(x=>getSelectionMarket(x,feed)).filter(x=>x.game&&x.market);
  const product=items.length?items.reduce((n,x)=>n*x.market.odd,1):null;
  return{items,selections:valid,product,removed:(selections||[]).length-valid.length};
 };
 const marketGap=m=>numeric(m?.v2P)&&numeric(m?.impliedNoVig)?(m.v2P-m.impliedNoVig)*100:null;
 const formatPercent=p=>numeric(p)?(p*100).toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+'%':'—';
 const round2=p=>numeric(p)?p.toLocaleString('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:2}):'—';
 const gapPP=m=>{const x=marketGap(m);return x===null?'—':(x>0?'+':'')+x.toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+' p.p.'};
 const isSourceStale=(feed,now=Date.now(),hours=30)=>{
  const at=Math.max(...[feed?.dataStatus?.majorAt,feed?.dataStatus?.dailySyncAt,feed?.dataStatus?.citoAt].map(toTime).filter(Number.isFinite),0);
  return !numeric(at)||now-at>hours*3600000;
 };
 const dateOnly=(str)=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(str));
 const filterUpcoming=(feed,{filter='all',query='',event='all',today=false}={},now=Date.now())=>{
  const nowDay=dateOnly(now);
  return getRadarGames(feed,now).filter(g=>(filter==='all'||(filter==='odds'&&hasOdds(g))||(filter==='waiting'&&!hasOdds(g)))&&
   (event==='all'||g.eventId===event)&&
   (!today||dateOnly(g.startTime)===nowDay)&&
   (!query||((g.teamA.name+' '+g.teamB.name+' '+g.event).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))));
 };
 const sourceLabel=g=>hasOdds(g)?'Odds capturadas (não ao vivo)':'Sem odds cadastradas';
 const api={isFuture,isRadarVisible,getRadarGames,RADAR_GRACE_MS,getUpcoming,getHistory,hasOdds,winnerMarket,familyLabel,cleanSelections,
  studySummary,getSelectionMarket,marketGap,formatPercent,round2,gapPP,isSourceStale,dateOnly,filterUpcoming,sourceLabel};
 global.AtlasRadarCore=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
