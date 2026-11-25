'use strict';
/* Map → teams → player kills. Browser-only analysis; prices entered locally, never submitted. */
(function(root){
 const core=root.AtlasMajorMaps,C=root.AtlasRadarCore,I=root.AtlasMajorIntel;
 if(!core)return;
 const mk=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
 const fmt=p=>typeof p==='number'&&Number.isFinite(p)?(100*p).toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+'%':'—';
 const val=n=>typeof n==='number'?n.toLocaleString('pt-BR',{maximumFractionDigits:1}):'—';
 const read=(k)=>{try{return JSON.parse(localStorage.getItem(k)||'{}')}catch{return{}}};
 const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
 const mapStore=read('atlas_major_maps_v2'),oddsStore=read('atlas_major_player_prices_v2');
 const data=new Map(),pending=new Map();
 let rankPromise=null;
 const getRanks=()=>rankPromise||(rankPromise=fetch('data/major-opponent-rank-history.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('rank history '+r.status);return r.json()}).catch(()=>null));
 const FREEZE='atlas_major_frozen_v1';
 const allFrozen=()=>{try{const a=JSON.parse(localStorage.getItem(FREEZE)||'[]');return Array.isArray(a)?a:[]}catch{return[]}};
 const setFrozen=records=>{try{localStorage.setItem(FREEZE,JSON.stringify(records));return true}catch{return false}};
 let activePlayer=null,days=90,line=16.5,scope='current';
 function getTeam(id){
  if(data.has(id))return Promise.resolve(data.get(id));
  if(pending.has(id))return pending.get(id);
  const promise=fetch('data/major-teams/'+encodeURIComponent(id)+'.json',{cache:'no-store'})
   .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()})
   .then(x=>{if(x.teamId!==id||!Array.isArray(x.players))throw Error('Dados inconsistentes');data.set(id,x);return x})
   .finally(()=>pending.delete(id));
  pending.set(id,promise);return promise;
 }
 function labeledSelect(title,choices,selected,handler){
  const box=mk('label','atlas-map-field');box.append(mk('span','',title));
  const select=mk('select','atlas-map-select');
  for(const [value,label]of choices){const opt=mk('option','',label);opt.value=String(value);select.append(opt)}
  select.value=String(selected);
  select.addEventListener('change',()=>handler(select.value));
  box.append(select);return box;
 }
 function textBlock(title,description){
  const b=mk('div','atlas-workspace-heading');b.append(mk('h3','',title));
  if(description)b.append(mk('p','',description));return b;
 }
 function appendTeamStat(container,team,mapName){
  const m=core.getTeamMap(team,mapName),box=mk('div','atlas-map-stat');
  box.append(mk('strong','',team.teamName));
  if(!m){box.append(mk('p','atlas-map-empty','Sem histórico de 90 dias neste mapa.'));container.append(box);return}
  box.append(mk('b','atlas-map-stat-large',m.played+' mapas · '+m.wins+' vitórias'));
  const rounds=Number.isFinite(m.roundsFor)&&Number.isFinite(m.roundsAgainst)&&m.played?(m.roundsFor+m.roundsAgainst)/m.played:null;
  box.append(mk('small','',val(m.winPercent)+'% de vitórias · '+(rounds?val(rounds):'—')+' rounds por mapa'));
  box.append(mk('small','',Number.isFinite(m.ctWinPercent)?'CT '+val(m.ctWinPercent)+'%  ·  TR '+val(m.tWinPercent)+'%':'Lados CT/TR indisponíveis'));
  container.append(box);
 }
 function linePrice(key,kind,summary,container,prediction){
  const field=mk('label','atlas-odds-field');
  field.append(mk('span','',kind==='over'?'Odd MAIS kills':'Odd MENOS kills'));
  const input=mk('input','atlas-odds-input');input.type='number';input.min='1.01';input.step='0.01';input.placeholder='Ex.: 1,85';
  if(oddsStore[key]!==undefined)input.value=String(oddsStore[key]);
  field.append(input);
  const note=mk('small','atlas-odds-note');
  const refresh=()=>{
   const odd=Number(String(input.value).replace(',','.'));
   if(odd>1&&Number.isFinite(odd))oddsStore[key]=odd;else delete oddsStore[key];
   write('atlas_major_player_prices_v2',oddsStore);
   const historical=kind==='over'?summary.overRate:summary.underRate;
   const modeled=kind==='over'?prediction?.overProbability:prediction?.underProbability;
   const rate=Number.isFinite(modeled)?modeled:historical;
   const info=core.comparePrice(odd,rate,summary.n,summary.sourceTruncated);
   if(!Number.isFinite(info.implied))note.textContent='Digite uma odd para visualizar o ponto de equilíbrio.';
   else if(prediction?.priceComparisonAllowed!==true)note.textContent='Ponto de equilíbrio '+fmt(info.implied)+' · comparação suspensa: histórico de kills da Cito não foi validado.';
   else if(!info.sufficient)note.textContent='Breakeven '+fmt(info.implied)+' · amostra insuficiente para comparar.';
   else note.textContent='Modelo experimental '+fmt(rate)+' · histórico '+fmt(historical)+' · preço exige '+fmt(info.implied)+' · diferença exploratória '+(info.gap>=0?'+':'')+val(info.gap*100)+' p.p. (não calibrada).';
  };
  input.addEventListener('change',refresh);
  refresh();field.append(note);container.append(field);
 }
 function renderSelectedPlayer(container,game,map,rows){
  const chosen=rows.find(x=>x.player.id===activePlayer);
  if(!chosen){container.append(mk('p','atlas-map-hint','Clique em “Detalhes” de um jogador para comparar linhas e odds de kills.'));return}
  const s=chosen.summary,p=chosen.player,k=chosen.prediction;
  const detail=mk('div','atlas-player-detail');detail.append(textBlock(p.nickname+' · '+chosen.team.teamName,'Mapa '+map+' · últimos '+days+' dias · linha '+line+' kills'));
  detail.append(mk('p','atlas-map-alert','ALERTA DE DADOS: a Cito apresentou divergência entre o total de kills e as kills CT+TR em 75 de 80 jogadores da estreia. Projeção e comparação de vantagem em kills ficam bloqueadas até a correção histórica.'));
  detail.append(mk('p','',s.n+' partidas no histórico BRUTO ('+(scope==='current'?'equipe atual':'inclui equipes anteriores')+') · '+s.currentTeamN+' na equipe atual. Média informada pela Cito: '+val(s.meanKills)+' kills em '+val(s.meanRounds)+' rounds; ainda não validada.'));
  if(k?.priceComparisonAllowed===true&&k.expectedKills!==null)
   detail.append(mk('p','atlas-kills-forecast','Projeção auditada: '+val(k.expectedKills)+' kills · MAIS '+line+' '+fmt(k.overProbability)+' · MENOS '+line+' '+fmt(k.underProbability)+'.'));
  if(s.lastFive.length)detail.append(mk('p','atlas-map-hint','Últimos 5 (kills informadas, não auditadas): '+s.lastFive.map(x=>x.kills+' ('+x.rounds+' rounds)').join(' · ')));
  if(s.n<5){detail.append(mk('p','atlas-map-alert','Menos de 5 mapas nesta condição. Dados exibidos sem qualquer avaliação de linhas.'));container.append(detail);return}
  const prices=mk('div','atlas-prices-grid'),prefix=game.id+'|'+map+'|'+p.id+'|'+line+'|';
  linePrice(prefix+'over','over',s,prices,k);linePrice(prefix+'under','under',s,prices,k);
  detail.append(prices);
  detail.append(mk('p','atlas-map-hint','Odds digitadas ficam apenas no navegador. O sistema mostra o ponto de equilíbrio, mas NÃO calcula oportunidades de kills usando a fonte inconsististente.'));
  container.append(detail);
 }
 function draw(game,container,left,right,onMapProjection,rankHistory){
  if(!container.isConnected||container.dataset.matchId!==game.id)return;
  container.textContent='';
  container.append(textBlock(game.isMajorSeries?'Mapas 1, 2 e 3 — série MD3':'Mapa e kills dos jogadores',
   game.isMajorSeries?'Escolha os mapas individualmente e alterne entre eles para comparar as equipes. As odds BR365 abaixo são da SÉRIE inteira; não usamos essas odds para nenhum mapa isolado.':
   'Selecione o mapa do BO1 quando o veto sair. A análise abaixo muda conforme o mapa, não usa a média genérica.'));
  const allMaps=core.getMaps(left,right);
  const oldChoice=mapStore[game.id];
  const seriesState=game.isMajorSeries&&oldChoice&&typeof oldChoice==='object'?oldChoice:{map1:'',map2:'',map3:'',active:1};
  const activeSlot=[1,2,3].includes(Number(seriesState.active))?Number(seriesState.active):1;
  const seriesChosen=seriesState['map'+activeSlot]||'';
  const chosen=game.isMajorSeries?(allMaps.includes(seriesChosen)?seriesChosen:''):
    (allMaps.includes(oldChoice)?oldChoice:'');
  const projection=chosen?(I?I.winner(game,left,right,chosen,rankHistory):core.projectMap(game,left,right,chosen)):null;
  if(typeof onMapProjection==='function')onMapProjection(chosen,projection);
  const controls=mk('div','atlas-map-controls');
  if(game.isMajorSeries){
   for(const slot of [1,2,3]){
    const field=mk('div','atlas-series-map-field'+(slot===activeSlot?' is-active':''));
    const selected=allMaps.includes(seriesState['map'+slot])?seriesState['map'+slot]:'';
    field.append(labeledSelect('Mapa '+slot,[['','A definir'],...allMaps.map(m=>[m,m])],selected,newValue=>{
     const next={...seriesState,['map'+slot]:newValue,active:slot};
     mapStore[game.id]=next;write('atlas_major_maps_v2',mapStore);activePlayer=null;
     draw(game,container,left,right,onMapProjection,rankHistory);
    }));
    const view=mk('button','atlas-player-button',slot===activeSlot?'Mapa '+slot+' em análise':'Analisar mapa '+slot);
    view.type='button';view.disabled=!selected;
    view.addEventListener('click',()=>{
     mapStore[game.id]={...seriesState,active:slot};write('atlas_major_maps_v2',mapStore);
     activePlayer=null;draw(game,container,left,right,onMapProjection,rankHistory);
    });
    field.append(view);controls.append(field);
   }
   controls.append(mk('div','atlas-map-status','Cada seleção analisa apenas aquele mapa; as odds de BO3 continuam sendo da série inteira. Mapas ainda não confirmados pela Cito.'));
  }else{
   controls.append(labeledSelect('Mapa disputado',[['','Selecione o mapa'],...allMaps.map(m=>[m,m])],chosen,newValue=>{
    mapStore[game.id]=newValue;write('atlas_major_maps_v2',mapStore);activePlayer=null;draw(game,container,left,right,onMapProjection,rankHistory);
   }));
   controls.append(mk('div','atlas-map-status','Mapa selecionado manualmente. A Cito ainda não confirmou o veto no snapshot.'));
  }
  container.append(controls);
  if(!chosen){container.append(mk('p','atlas-map-placeholder',game.isMajorSeries?'Defina o mapa 1, 2 ou 3 para analisar estatísticas de cada mapa. Não presumimos o veto.':'Escolha o mapa acima para ver as duas equipes e os jogadores. Nenhum mapa é presumido.'));return}
  const sides=mk('div','atlas-map-teams');
  appendTeamStat(sides,left,chosen);appendTeamStat(sides,right,chosen);
  container.append(sides);
  const strength=mk('div','atlas-strength-brief');
  for(const side of [{p:projection?.strengthA,name:game.teamA.name},{p:projection?.strengthB,name:game.teamB.name}]){
   const s=side.p;
   strength.append(mk('span','',side.name+': '+(s?.ranked? s.ranked+' adversários ranqueados / '+s.played+' mapas; posição média '+val(s.averageOpponentRank):'força adversária indisponível')));
  }
  if(projection?.modelStatus==='opponent_adjusted')strength.append(mk('b','','Ajuste histórico de adversários aplicado · modelo NÃO calibrado'));
  else strength.append(mk('b','','Sem cobertura suficiente para ajuste histórico · estimativa base não ajustada'));
  container.append(strength);
  if(Number.isFinite(projection?.rounds?.expected)){
   const rr=projection.rounds;
   const tail=Number.isFinite(rr.rangeLow)&&Number.isFinite(rr.rangeHigh)?' · faixa histórica P10–P90: '+val(rr.rangeLow)+'–'+val(rr.rangeHigh)+' rounds ('+rr.observedRoundMaps+' mapas)':' · dispersão de rounds indisponível';
   container.append(mk('p','atlas-map-hint','Rounds esperados: '+val(rr.expected)+tail+'. Esta faixa não é intervalo de confiança.'));
  }
  if(Number.isFinite(projection?.probabilityA)&&Math.abs(projection.probabilityA-.5)<.05)
   container.append(mk('p','atlas-map-alert','Confronto estatisticamente equilibrado: diferença inferior a 5 pontos percentuais em relação a 50%. Não trate este favoritismo pequeno como vantagem comprovada.'));
  container.append(mk('p',projection?.status==='estimated'?'atlas-map-hint':'atlas-map-alert',projection?.status==='estimated'?
   'No mapa '+chosen+': '+game.teamA.name+' '+fmt(projection.probabilityA)+' × '+game.teamB.name+' '+fmt(projection.probabilityB)+'. '+(projection.modelStatus==='opponent_adjusted'?'Corrigido pela força histórica dos adversários.':'Modelo base sem ajuste suficiente de adversários.')+' NÃO calibrado. '+(game.isMajorSeries?'Isso NÃO é chance de vencer a série MD3.':''):
   (projection?.reason||'Estimativa por mapa indisponível; veja os históricos das equipes abaixo.')));
  const bar=mk('div','atlas-kills-toolbar');
  bar.append(labeledSelect('Linha de kills',[[12.5,'12,5'],[14.5,'14,5'],[16.5,'16,5'],[18.5,'18,5'],[20.5,'20,5'],[22.5,'22,5'],[24.5,'24,5']],line,x=>{line=Number(x);draw(game,container,left,right,onMapProjection,rankHistory)}));
  bar.append(labeledSelect('Amostragem',[[90,'Últimos 90 dias'],[180,'Últimos 180 dias']],days,x=>{days=Number(x);draw(game,container,left,right,onMapProjection,rankHistory)}));
  bar.append(labeledSelect('Histórico', [['current','Somente time atual'],['all','Todas as equipes']],scope,x=>{scope=x;draw(game,container,left,right,onMapProjection,rankHistory)}));
  container.append(bar);
  container.append(mk('p','atlas-map-alert','Mercados de kills EM AUDITORIA: 75/80 divergências no total reportado pela Cito em 24/11. Históricos exibidos apenas para investigação; projeções e diferenças para odds bloqueadas.'));
  const players=[...left.players.map(player=>({player,team:left,opponent:right})),...right.players.map(player=>({player,team:right,opponent:left}))].map(row=>({
   ...row,summary:core.summarize(row.player,chosen,days,line,row.team.teamId,game.startTime,scope),
   prediction:I?I.playerKills(row.player,row.team,row.opponent,game,chosen,days,line,scope,rankHistory,projection?.rounds):null
  }));
  if(!players.length){container.append(mk('p','atlas-map-alert','Nenhum jogador com estatísticas importadas.'));return}
  const wrapper=mk('div','hscroll atlas-map-table-wrap'),table=mk('table','atlas-map-table'),head=mk('thead'),tr=mk('tr');
  for(const str of ['Jogador','Equipe','Mapas','Média bruta*','Kills/round*','Modelo kills','Linha '+line,'Hist. mais*',''])tr.append(mk('th','',str));
  head.append(tr);table.append(head);const body=mk('tbody');
  for(const item of players){
   const s=item.summary,row=mk('tr',activePlayer===item.player.id?'atlas-player-active':'');
   const nam=mk('td');nam.append(mk('b','',item.player.nickname),mk('small','',s.currentTeamN+' na equipe atual'));row.append(nam);
   row.append(mk('td','',item.team.teamName),mk('td','',s.n+(s.sourceTruncated?'*':'')),mk('td','',val(s.meanKills)),mk('td','',s.killsPerRound===null?'—':String(s.killsPerRound).replace('.',',')));
   const enough=s.n>=5;
   row.append(mk('td','','Em auditoria'));
   row.append(mk('td','','Não validado'));
   row.append(mk('td','',enough?fmt(s.overRate)+' ('+s.over+'/'+s.n+')':'amostra curta'));
   const action=mk('td'),button=mk('button','atlas-player-button',activePlayer===item.player.id?'Aberto':'Detalhes');
   button.type='button';button.addEventListener('click',()=>{activePlayer=item.player.id;draw(game,container,left,right,onMapProjection,rankHistory)});
   action.append(button);row.append(action);body.append(row);
  }
  table.append(body);wrapper.append(table);container.append(wrapper);
  const csvButton=mk('button','atlas-player-button atlas-csv-export','Exportar partidas em CSV');
  csvButton.type='button';
  csvButton.addEventListener('click',()=>{
   const rows=[['jogador','equipe_atual','equipe_no_mapa','mapa','data_utc','kills_cito_nao_verificadas','rounds','kills_por_round_nao_verificado','match_id','integridade_kills']];
   for(const item of players){
    const games=core.filterRows(item.player,chosen,days,game.startTime).filter(x=>scope!=='current'||x.teamId===item.team.teamId);
    for(const g of games)rows.push([item.player.nickname,item.team.teamName,g.teamId,chosen,g.at,g.kills,g.rounds,(g.kills/g.rounds).toFixed(4),g.matchId,'NAO_VALIDADO']);
   }
   const cell=v=>{const raw=String(v??'');const safe=/^[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"'};
   const csv='\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
   const a=document.createElement('a');a.href=url;a.download='atlas_'+game.id+'_'+chosen+'_'+days+'d.csv';document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),500);
  });
  container.append(csvButton);
  const freezeButton=mk('button','atlas-player-button atlas-freeze-button','Registrar previsão antes do jogo');
  freezeButton.type='button';
  const frozenExists=allFrozen().some(x=>x.matchId===game.id);
  freezeButton.disabled=game.isMajorSeries||frozenExists||Date.now()>=Date.parse(game.startTime)||!I||!projection||projection.status!=='estimated';
  if(game.isMajorSeries)freezeButton.textContent='Registro de série MD3 indisponível';
  else if(frozenExists)freezeButton.textContent='Previsão já registrada (não editável)';
  freezeButton.addEventListener('click',()=>{
   if(game.isMajorSeries||Date.now()>=Date.parse(game.startTime)||allFrozen().some(x=>x.matchId===game.id))return;
   const winOdds=(game.markets||[]).filter(x=>x.family==='winner').map(x=>({key:x.key,odd:x.odd,source:x.source||null}));
   const current=allFrozen(),createdAt=new Date().toISOString();
   const record=I.makeFrozen(game,chosen,projection,players.map(x=>x.prediction).filter(Boolean),createdAt,
    {line,scope,days,odds:winOdds});
   if(!record)return;
   if(setFrozen([...current,record])){freezeButton.disabled=true;freezeButton.textContent='Previsão registrada no navegador';}
  });
  container.append(freezeButton);
  container.append(mk('p','atlas-map-hint',game.isMajorSeries?'As análises individuais não constituem previsão da série MD3. O registro de série permanece bloqueado até existir um modelo de melhor de três validado.':'O registro é imutável e fica apenas neste navegador. Exporte o JSON em Resultados. Não é uma previsão validada.')); 
  const details=mk('div');renderSelectedPlayer(details,game,chosen,players);container.append(details);
  container.append(mk('p','atlas-map-hint','* Dados brutos da Cito ainda não reconciliados contra placares individuais. Não usar para recomendação de aposta. Os filtros e a exportação mantêm a origem visível.'));
 }
 function render(game,container,onMapProjection){
  if(!(game?.major||game?.isMajorSeries)||!container||!core)return;
  container.dataset.matchId=game.id;
  container.textContent='';container.append(mk('p','atlas-map-placeholder','Carregando mapas e estatísticas individuais da Cito…'));
  Promise.all([getTeam(game.teamA.id),getTeam(game.teamB.id),getRanks()]).then(([a,b,ranks])=>{
   if(container.isConnected&&container.dataset.matchId===game.id)draw(game,container,a,b,onMapProjection,ranks);
  }).catch(error=>{
   if(!container.isConnected||container.dataset.matchId!==game.id)return;
   container.textContent='';container.append(mk('p','atlas-map-alert','Dados por mapa indisponíveis: '+error.message+'. Não será exibida uma projeção inventada.'));
  });
 }
 root.AtlasMapWorkspace={render};
})(window);
