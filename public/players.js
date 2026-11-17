'use strict';
// Cito player statistics are historical observations, never guaranteed projections.
let atlasPlayers=null,atlasFixtures=null,atlasSelectedPlayer=null;
const pEl=(tag,cls='',value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el};
const pPct=v=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:2}):'—';
const rosterFor=id=>atlasPlayers?.teams?.find(t=>t.id===id);
const playerHistory=id=>atlasPlayers?.players?.find(p=>p.id===id);
const mapRecordPlayer=(p,name)=>p?.maps?.find(m=>m.name?.toLowerCase()===name?.toLowerCase());
const activeMatch=()=>atlasFixtures?.matches?.find(m=>m.id===document.getElementById('players-match-select').value);
function playerInputs(){
 const select=document.getElementById('players-match-select'),chosen=select.value;select.textContent='';
 for(const m of atlasFixtures?.matches||[]){const op=pEl('option','',m.teamA.name+' × '+m.teamB.name+' — '+m.event);op.value=m.id;select.append(op)}
 if(atlasFixtures?.matches?.some(m=>m.id===chosen))select.value=chosen;
 select.addEventListener('change',()=>{atlasSelectedPlayer=null;playerMaps()});
 playerMaps();
}
function playerMaps(){
 const m=activeMatch(),select=document.getElementById('players-map-select');select.textContent='';
 if(!m)return;
 const a=atlasFixtures.teams.find(t=>t.id===m.teamA.id),b=atlasFixtures.teams.find(t=>t.id===m.teamB.id);
 const maps=a?.maps?.filter(x=>b?.maps?.some(y=>y.name.toLowerCase()===x.name.toLowerCase()))?.map(x=>x.name)||[];
 const prior=select.dataset.previous;
 for(const name of maps){const op=pEl('option','',name);op.value=name;select.append(op)}
 if(maps.includes(prior))select.value=prior;
 select.dataset.previous=select.value;
 renderPlayerList();
}
function renderPlayerList(){
 const root=document.getElementById('players-card-list');root.textContent='';
 atlasSelectedPlayer=null;
 const m=activeMatch();if(!m)return;
 const map=document.getElementById('players-map-select').value;
 for(const side of [m.teamA,m.teamB]){
  const section=pEl('section','player-team');
  section.append(pEl('h3','player-team-title',side.name));
  const roster=rosterFor(side.id);
  if(!roster?.players?.length){section.append(pEl('p','muted','Escalação indisponível na última consulta.'));root.append(section);continue}
  for(const p of roster.players){
   const stats=playerHistory(p.id),record=mapRecordPlayer(stats,map),has=record&&record.count>=4&&Number.isFinite(record.kpr);
   const card=pEl('button','player-card'+(has?' player-ready':''));
   card.type='button';card.disabled=!has;
   const head=pEl('div','player-head');
   head.append(pEl('strong','',p.nickname),pEl('span','player-role',p.role||'Jogador'));
   const values=pEl('div','player-values');
   values.append(pEl('b','',has?pPct(record.kpr)+' KPR':'— KPR'),pEl('span','',has?record.count+' mapas • '+record.rounds+' rounds':'Aguardando histórico individual'));
   const foot=pEl('div','player-aux',has?'ADR '+pPct(record.adr)+' · '+record.kills+' kills observadas':'Sem estimativa exibida');
   card.append(head,values,foot);
   if(has)card.addEventListener('click',()=>{
    root.querySelectorAll('.player-card').forEach(x=>x.classList.remove('chosen'));
    card.classList.add('chosen');atlasSelectedPlayer={player:p,stat:record,team:side,map,match:m};
    const btn=document.getElementById('player-to-simulator');btn.disabled=false;
    document.getElementById('players-choice-help').textContent=
      p.nickname+' · '+side.name+' · '+map+' · '+pPct(record.kpr)+' kills/round calculadas sobre '+record.count+' mapas. Esta média não é uma previsão calibrada.';
   });
   section.append(card);
  }
  root.append(section);
 }
 document.getElementById('player-to-simulator').disabled=true;
 document.getElementById('players-source-note').textContent=
  'Fonte: Cito API · escalações capturadas em '+(atlasPlayers?.fetchedAt?new Date(atlasPlayers.fetchedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'data não disponível')+
  ' · taxa por mapa limitada ao histórico individual retornado. Jogadores sem quatro mapas não recebem KPR para simular.';
}
function sendSelectedPlayer(){
 const item=atlasSelectedPlayer;if(!item)return toast('Escolha um jogador com dados suficientes.');
 if(typeof showMatch!=='function'||typeof sendTournamentToSimulator!=='function')return toast('Simulador não está disponível.');
 showMatch(item.match.id);sendTournamentToSimulator();
 const ta=atlasFixtures.teams.find(t=>t.id===item.match.teamA.id),tb=atlasFixtures.teams.find(t=>t.id===item.match.teamB.id);
 const common=ta.maps.map(x=>x.name).filter(name=>tb.maps.some(y=>y.name===name));
 common.sort((x,y)=>(ta.maps.find(m=>m.name===y)?.played||0)+(tb.maps.find(m=>m.name===y)?.played||0)-
                        (ta.maps.find(m=>m.name===x)?.played||0)-(tb.maps.find(m=>m.name===x)?.played||0));
 const selectedMaps=[item.map,...common.filter(name=>name!==item.map)].slice(0,3);
 for(let i=0;i<selectedMaps.length;i++){
  const map=selectedMaps[i],sel=document.getElementById('map-'+(i+1));
  if(![...sel.options].some(x=>x.value===map)){const option=pEl('option','',map);option.value=map;sel.append(option)}
  sel.value=map;
  const a=ta.maps.find(x=>x.name===map),b=tb.maps.find(x=>x.name===map);
  if(a&&b&&typeof estimatedRound==='function')document.getElementById('prob-'+(i+1)).value=(100*estimatedRound(a,b)).toFixed(1);
 }
 document.getElementById('player').value=item.player.nickname;
 document.getElementById('player-side').value=item.team.id===item.match.teamA.id?'A':'B';
 document.getElementById('kpr').value=item.stat.kpr.toFixed(3);
 document.getElementById('model-report').textContent+=' KPR de '+item.player.nickname+
  ' em '+item.map+': '+pPct(item.stat.kpr)+' em '+item.stat.count+' mapas (Cito). Outras posições do BO3 podem não ser o veto real.';
 toast('Jogador e mapa preenchidos usando histórico da Cito, sem calibração.');
}
async function startPlayerView(){
 try{
 const [rosterR,fixtureR]=await Promise.all([fetch('data/players.json',{cache:'no-store'}),fetch('data/tournaments.json',{cache:'no-store'})]);
 if(!rosterR.ok||!fixtureR.ok)throw Error('Arquivo de histórico indisponível');
 atlasPlayers=await rosterR.json();atlasFixtures=await fixtureR.json();
 if(!Array.isArray(atlasPlayers.teams)||!Array.isArray(atlasPlayers.players))throw Error('Estrutura de jogadores inválida');
 document.getElementById('roster-teams').textContent=atlasPlayers.teams.length;
 document.getElementById('roster-players').textContent=atlasPlayers.teams.reduce((n,t)=>n+t.players.length,0);
 document.getElementById('kills-coverage').textContent=atlasPlayers.players.length;
 playerInputs();
 }catch(e){document.getElementById('players-source-note').textContent='Erro ao carregar escalações: '+e.message;
 document.getElementById('players-card-list').textContent='Nenhuma escalação disponível. Tente recarregar a página.'}
}
document.getElementById('players-map-select').addEventListener('change',e=>{
 e.target.dataset.previous=e.target.value;renderPlayerList()});
document.getElementById('player-to-simulator').addEventListener('click',sendSelectedPlayer);
startPlayerView();
