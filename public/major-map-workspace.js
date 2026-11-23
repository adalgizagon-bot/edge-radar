'use strict';
/* Map → teams → player kills. Browser-only analysis; prices entered locally, never submitted. */
(function(root){
 const core=root.AtlasMajorMaps,C=root.AtlasRadarCore;
 if(!core)return;
 const mk=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
 const fmt=p=>typeof p==='number'&&Number.isFinite(p)?(100*p).toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+'%':'—';
 const val=n=>typeof n==='number'?n.toLocaleString('pt-BR',{maximumFractionDigits:1}):'—';
 const read=(k)=>{try{return JSON.parse(localStorage.getItem(k)||'{}')}catch{return{}}};
 const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
 const mapStore=read('atlas_major_maps_v2'),oddsStore=read('atlas_major_player_prices_v2');
 const data=new Map(),pending=new Map();
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
 function linePrice(key,kind,summary,container){
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
   const rate=kind==='over'?summary.overRate:summary.underRate;
   const info=core.comparePrice(odd,rate,summary.n,summary.sourceTruncated);
   if(!Number.isFinite(info.implied))note.textContent='Digite uma odd para comparar.';
   else if(!info.sufficient)note.textContent='Breakeven '+fmt(info.implied)+' · amostra insuficiente para comparar.';
   else note.textContent='Histórico '+fmt(rate)+' · preço exige '+fmt(info.implied)+' · diferença '+(info.gap>=0?'+':'')+val(info.gap*100)+' p.p.';
  };
  input.addEventListener('change',refresh);
  refresh();field.append(note);container.append(field);
 }
 function renderSelectedPlayer(container,game,map,rows){
  const chosen=rows.find(x=>x.player.id===activePlayer);
  if(!chosen){container.append(mk('p','atlas-map-hint','Clique em “Detalhes” de um jogador para comparar linhas e odds de kills.'));return}
  const s=chosen.summary,p=chosen.player;
  const detail=mk('div','atlas-player-detail');detail.append(textBlock(p.nickname+' · '+chosen.team.teamName,'Mapa '+map+' · últimos '+days+' dias · linha '+line+' kills'));
  detail.append(mk('p','',s.n+' mapas válidos na seleção ('+(scope==='current'?'apenas equipe atual':'todas as equipes')+') · '+s.currentTeamN+' nesta equipe · '+s.priorTeamN+' em equipes anteriores. Média '+val(s.meanKills)+' kills e '+val(s.meanRounds)+' rounds por mapa.'));
  if(s.lastFive.length)detail.append(mk('p','atlas-map-hint','Últimos 5 mapas: '+s.lastFive.map(x=>x.kills+' kills ('+x.rounds+' rounds)').join(' · ')));
  if(s.n<5){detail.append(mk('p','atlas-map-alert','Menos de 5 mapas nesta condição. Dados exibidos sem qualquer avaliação de linhas.'));container.append(detail);return}
  const prices=mk('div','atlas-prices-grid'),prefix=game.id+'|'+map+'|'+p.id+'|'+line+'|';
  linePrice(prefix+'over','over',s,prices);linePrice(prefix+'under','under',s,prices);
  detail.append(prices);
  detail.append(mk('p','atlas-map-hint','Odds inseridas manualmente, só neste navegador. Taxas históricas não são probabilidades calibradas. Kills também dependem da duração do mapa, da escalação e do adversário.'));
  container.append(detail);
 }
 function draw(game,container,left,right){
  if(!container.isConnected||container.dataset.matchId!==game.id)return;
  container.textContent='';
  container.append(textBlock('Mapa e kills dos jogadores','Selecione o mapa real quando o veto sair. A análise abaixo muda para o mapa escolhido, não usa a média genérica de BO1.'));
  const allMaps=core.getMaps(left,right),chosen=allMaps.includes(mapStore[game.id])?mapStore[game.id]:'';
  const controls=mk('div','atlas-map-controls');
  controls.append(labeledSelect('Mapa disputado',[['','Selecione o mapa'],...allMaps.map(m=>[m,m])],chosen,newValue=>{
   mapStore[game.id]=newValue;write('atlas_major_maps_v2',mapStore);activePlayer=null;draw(game,container,left,right);
  }));
  controls.append(mk('div','atlas-map-status','Mapa selecionado manualmente. A Cito ainda não confirmou o veto no snapshot.'));
  container.append(controls);
  if(!chosen){container.append(mk('p','atlas-map-placeholder','Escolha o mapa acima para ver o desempenho das duas equipes e dos 10 jogadores. Nenhum mapa é presumido.'));return}
  const sides=mk('div','atlas-map-teams');appendTeamStat(sides,left,chosen);appendTeamStat(sides,right,chosen);container.append(sides);
  const scenario=game.model?.mapScenarios?.find(x=>core.norm(x.map)===core.norm(chosen));
  container.append(mk('p','atlas-map-hint',scenario?'Estimativa experimental para '+chosen+': '+game.teamA.name+' '+fmt(scenario.projectionA)+' · '+game.teamB.name+' '+fmt(scenario.projectionB)+'. NÃO calibrada; sem ajuste completo por adversários.':'Sem projeção confiável de vitória neste mapa. As estatísticas de jogadores continuam disponíveis.'));
  const bar=mk('div','atlas-kills-toolbar');
  bar.append(labeledSelect('Linha de kills',[[12.5,'12,5'],[14.5,'14,5'],[16.5,'16,5'],[18.5,'18,5'],[20.5,'20,5'],[22.5,'22,5'],[24.5,'24,5']],line,x=>{line=Number(x);draw(game,container,left,right)}));
  bar.append(labeledSelect('Amostragem',[[90,'Últimos 90 dias'],[180,'Últimos 180 dias']],days,x=>{days=Number(x);draw(game,container,left,right)}));
  bar.append(labeledSelect('Histórico', [['current','Somente time atual'],['all','Todas as equipes']],scope,x=>{scope=x;draw(game,container,left,right)}));
  container.append(bar);
  const players=[...left.players.map(player=>({player,team:left})),...right.players.map(player=>({player,team:right}))].map(row=>({...row,summary:core.summarize(row.player,chosen,days,line,row.team.teamId,game.startTime,scope)}));
  if(!players.length){container.append(mk('p','atlas-map-alert','Nenhum jogador com estatísticas importadas.'));return}
  const wrapper=mk('div','hscroll atlas-map-table-wrap'),table=mk('table','atlas-map-table'),head=mk('thead'),tr=mk('tr');
  for(const str of ['Jogador','Equipe','Mapas','Kills/média','Kills/round','Mais '+line,'Menos '+line,''])tr.append(mk('th','',str));
  head.append(tr);table.append(head);const body=mk('tbody');
  for(const item of players){
   const s=item.summary,row=mk('tr',activePlayer===item.player.id?'atlas-player-active':'');
   const nam=mk('td');nam.append(mk('b','',item.player.nickname),mk('small','',s.currentTeamN+' na equipe atual'));row.append(nam);
   row.append(mk('td','',item.team.teamName),mk('td','',s.n+(s.sourceTruncated?'*':'')),mk('td','',val(s.meanKills)),mk('td','',s.killsPerRound===null?'—':String(s.killsPerRound).replace('.',',')));
   const enough=s.n>=5;
   row.append(mk('td','',enough?fmt(s.overRate)+' ('+s.over+'/'+s.n+')':'amostra curta'),mk('td','',enough?fmt(s.underRate)+' ('+s.under+'/'+s.n+')':'amostra curta'));
   const action=mk('td'),button=mk('button','atlas-player-button',activePlayer===item.player.id?'Aberto':'Detalhes');
   button.type='button';button.addEventListener('click',()=>{activePlayer=item.player.id;draw(game,container,left,right)});
   action.append(button);row.append(action);body.append(row);
  }
  table.append(body);wrapper.append(table);container.append(wrapper);
  const csvButton=mk('button','atlas-player-button atlas-csv-export','Exportar partidas em CSV');
  csvButton.type='button';
  csvButton.addEventListener('click',()=>{
   const rows=[['jogador','equipe_atual','equipe_no_mapa','mapa','data_utc','kills','rounds','kills_por_round','match_id']];
   for(const item of players){
    const games=core.filterRows(item.player,chosen,days,game.startTime).filter(x=>scope!=='current'||x.teamId===item.team.teamId);
    for(const g of games)rows.push([item.player.nickname,item.team.teamName,g.teamId,chosen,g.at,g.kills,g.rounds,(g.kills/g.rounds).toFixed(4),g.matchId]);
   }
   const cell=v=>{const raw=String(v??'');const safe=/^[=+@-]/.test(raw)?"'"+raw:raw;return '"'+safe.replace(/"/g,'""')+'"'};
   const csv='\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
   const a=document.createElement('a');a.href=url;a.download='atlas_'+game.id+'_'+chosen+'_'+days+'d.csv';document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),500);
  });
  container.append(csvButton);
  const details=mk('div');renderSelectedPlayer(details,game,chosen,players);container.append(details);
  container.append(mk('p','atlas-map-hint','Taxas acima/abaixo são frequências observadas, não odds justas. O filtro de equipe controla se resultados antigos de outras escalações entram no cálculo.'));
 }
 function render(game,container){
  if(!game?.major||!container||!core)return;
  container.dataset.matchId=game.id;
  const left=data.get(game.teamA.id),right=data.get(game.teamB.id);
  if(left&&right){draw(game,container,left,right);return}
  container.textContent='';container.append(mk('p','atlas-map-placeholder','Carregando mapas e estatísticas individuais da Cito…'));
  Promise.all([getTeam(game.teamA.id),getTeam(game.teamB.id)]).then(([a,b])=>{
   if(container.isConnected&&container.dataset.matchId===game.id)draw(game,container,a,b);
  }).catch(error=>{
   if(!container.isConnected||container.dataset.matchId!==game.id)return;
   container.textContent='';container.append(mk('p','atlas-map-alert','Dados por mapa indisponíveis: '+error.message+'. Não será exibida uma projeção inventada.'));
  });
 }
 root.AtlasMapWorkspace={render};
})(window);
