'use strict';
(function(){
 const C=window.AtlasRadarCore;
 if(!C)return;
 const $=id=>document.getElementById(id);
 const el=(tag,cls='',str)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(str!==undefined)n.textContent=String(str);return n};
 const hours=s=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(s));
 const marketFamily=C.familyLabel;
 const STORE='atlas_unified_study_v1';
 const state={feed:null,view:'radar',filter:'all',event:'all',query:'',activeId:null,family:'winner',selections:[]};
 const loadSelections=()=>{try{const x=JSON.parse(localStorage.getItem(STORE)||'[]');return Array.isArray(x)?x:[]}catch{return []}};
 const saveSelections=()=>{try{localStorage.setItem(STORE,JSON.stringify(state.selections))}catch{}};
 let toastTimeout=null;
 function toast(message){
  const t=$('toast');t.textContent=message;t.classList.add('is-visible');clearTimeout(toastTimeout);
  toastTimeout=setTimeout(()=>t.classList.remove('is-visible'),3300);
 }
 function switchPage(view){
  if(!['radar','study','history'].includes(view))return;
  state.view=view;
  document.querySelectorAll('.page').forEach(n=>n.classList.toggle('is-active',n.id==='page-'+view));
  document.querySelectorAll('.nav-button').forEach(n=>{
   const selected=n.dataset.view===view;
   n.classList.toggle('is-current',selected);
   if(selected)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');
  });
  if(view==='study')renderStudy();
  if(view==='history')renderHistory();
  window.scrollTo({top:0,behavior:'instant'});
 }
 function updateTop(){
  const all=C.getUpcoming(state.feed);
  $('upcoming-total').textContent=String(all.length);
  $('priced-total').textContent=String(all.filter(C.hasOdds).length);
  $('next-kickoff').textContent=all.length?hours(all[0].startTime):'Aguardando';
  const sources=[state.feed.dataStatus?.majorAt,state.feed.dataStatus?.dailySyncAt,state.feed.dataStatus?.citoAt].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a));
  const last=sources[0]||null;
  const status=$('feed-status'),stale=C.isSourceStale(state.feed);
  status.classList.toggle('stale',stale);
  status.querySelector('span').textContent=last?'Cito: '+hours(last)+(stale?' · desatualizado':''):'Sem sincronização Cito';
  $('capture-status').textContent=all.some(g=>g.major)&&!all.some(C.hasOdds)?'Major: aguardando odds da casa':'Odds dos prints • não ao vivo';
  const warning=$('stale-alert');
  if(stale){
   warning.classList.add('is-visible');
   warning.textContent='A base da Cito não recebeu atualização recente. Os jogos e as probabilidades podem estar desatualizados. Recarregar busca apenas os dados publicados, não consulta a API ao vivo.';
  }else warning.classList.remove('is-visible');
  const summary=C.studySummary(state.selections,state.feed);
  state.selections=summary.selections;saveSelections();
  const count=summary.items.length;
  $('nav-count').textContent=String(count);$('nav-count').hidden=!count;
  const bar=$('slip-bar');bar.classList.toggle('is-visible',count>0);
  $('slip-title').textContent=count+' mercado'+(count===1?'':'s')+' selecionado'+(count===1?'':'s');
 }
 function eventFilters(){
  const elSelect=$('event-filter'),chosen=elSelect.value||'all',events=new Map();
  for(const g of C.getUpcoming(state.feed))if(g.eventId)events.set(g.eventId,g.event);
  elSelect.textContent='';const all=el('option','', 'Todos os campeonatos');all.value='all';elSelect.append(all);
  for(const [id,name]of [...events.entries()].sort((a,b)=>a[1].localeCompare(b[1]))){
   const opt=el('option','',name);opt.value=id;elSelect.append(opt);
  }
  elSelect.value=events.has(chosen)?chosen:'all';
  state.event=elSelect.value;
 }
 function winnerOdds(g){
  const markets=C.winnerMarket(g);
  return markets.length===2&&markets.every(x=>Number.isFinite(x.odd))?markets:null;
 }
 function renderList(){
  const items=C.filterUpcoming(state.feed,{filter:state.filter,query:state.query,event:state.event});
  const full=C.getUpcoming(state.feed);
  const list=$('game-list');list.textContent='';
  $('list-count').textContent=items.length+' de '+full.length;
  document.querySelectorAll('[data-price-filter]').forEach(btn=>{
   btn.classList.toggle('is-current',btn.dataset.priceFilter===state.filter);
  });
  if(!items.length){
   const empty=el('div','empty-list');
   empty.append(el('b','',full.length?'Nenhum jogo neste filtro':'Nenhuma partida futura na base'));
   empty.append(document.createTextNode(full.length?
    'Altere os filtros para encontrar outro confronto.':
    'O radar não reaproveita jogos encerrados. A sincronização gratuita consulta novos jogos diariamente; quando houver partidas confirmadas, aparecerão aqui.'));
   list.append(empty);$('detail-panel').textContent='';
   $('detail-panel').append(el('div','detail-placeholder','Não há confronto futuro selecionável. Confira novamente quando houver nova coleta.'));
   return;
  }
  if(!items.some(g=>g.id===state.activeId)){state.activeId=items[0].id;state.family='winner';}
  for(const g of items){
   const card=el('button','game-card'+(g.id===state.activeId?' is-selected':''));card.type='button';
   const meta=el('div','game-meta');
   meta.append(el('span','game-event',g.event),el('span','',hours(g.startTime)));
   const team=el('div','game-card-title',g.teamA.name+' × '+g.teamB.name);
   card.append(meta,team);
   const prices=el('div','game-prices'),win=winnerOdds(g);
   if(win){prices.append(el('span','','Vencedor'),el('b','',C.round2(win[0].odd)),el('b','',C.round2(win[1].odd)))}
   else prices.append(el('span','','Odds ainda não cadastradas'));
   const note=el('div','card-note');
   note.append(el('i','mini-dot'+(C.hasOdds(g)?'':' missing')),
    el('span','',g.major?(C.hasOdds(g)?'Major BO1 · mapa e kills · odds do print':'Major BO1 · mapa e kills · sem odds'):C.sourceLabel(g)));
   card.append(prices,note);
   card.addEventListener('click',()=>{state.activeId=g.id;state.family='winner';renderList()});
   list.append(card);
  }
  renderDetail(items.find(g=>g.id===state.activeId));
 }
 function teamBox(team,modelProb,win,major=false,selectedMap=null){
  const box=el('div','compare-team');
  box.append(el('strong','',team.name));
  if(major){
   box.append(el('span','price',C.formatPercent(modelProb)));
   box.append(el('small','',!selectedMap?'Selecione o mapa para estimar':
    Number.isFinite(modelProb)?'Estimativa em '+selectedMap+' · não calibrada':
    'Amostra insuficiente em '+selectedMap));
   box.append(el('small','',Number.isFinite(win?.odd)?'Odd do print: '+C.round2(win.odd):'Sem odd de vencedor'));
  }else{
   box.append(el('span','price',win?.odd?C.round2(win.odd):'—'));
   box.append(el('small','',Number.isFinite(modelProb)?
    'Modelo experimental: '+C.formatPercent(modelProb):'Sem projeção V2 disponível'));
  }
  return box;
 }
 function addSelection(matchId,key){
  const game=C.getUpcoming(state.feed).find(x=>x.id===matchId);
  const market=game?.markets.find(x=>x.key===key);
  if(!game||!market||!Number.isFinite(market.odd)||market.odd<=1){toast('Mercado indisponível para estudo.');return}
  const previous=state.selections.find(x=>x.matchId===matchId);
  if(previous?.key===key)state.selections=state.selections.filter(x=>x.matchId!==matchId);
  else state.selections=[...state.selections.filter(x=>x.matchId!==matchId),{matchId,key}];
  saveSelections();updateTop();renderDetail(game);
  toast(previous?.key===key?'Mercado retirado do estudo.':'Seleção adicionada ao estudo.');
 }
 function marketSection(game){
  const fragment=document.createDocumentFragment();
  const chosenMap=game.major?game.selectedMap:null;
  const head=el('div','subsection-top');
  const heading=el('div','');heading.append(el('h3','',game.bestOf===1?'Vencedor do mapa '+(chosenMap||'BO1'):'Mercados da série'),el('p','',game.bestOf===1?(chosenMap?'Estimativa específica de '+chosenMap+'. Confirme que é o mapa realmente escolhido.':'Selecione o mapa acima para calcular a probabilidade de cada equipe.'):'Uma análise de cada vez. Odds registradas, nunca ao vivo.'));
  head.append(heading,el('span','snapshot-note',game.quotes?'Print: '+hours(game.quotes.capturedAt):'Aguardando odds'));
  fragment.append(head);
  const families=[...new Set((game.markets||[]).map(x=>x.family))];
  if(!families.includes(state.family))state.family=families[0]||'winner';
  if(families.length){
   const tabs=el('div','market-tabs');
   for(const family of families){
    const b=el('button','market-tab'+(family===state.family?' is-current':''),marketFamily[family]||family);
    b.type='button';b.addEventListener('click',()=>{state.family=family;renderDetail(game)});
    tabs.append(b);
   }
   fragment.append(tabs);
  }
  const visible=(game.markets||[]).filter(x=>x.family===state.family);
  if(!visible.length){
   fragment.append(el('p','below-table','Sem mercados deste tipo para o confronto. Os dados não são inventados.'));
   return fragment;
  }
  const outer=el('div','hscroll'),table=el('table','market-table');
  const thead=el('thead',''),tr=el('tr','');
  for(const label of ['Seleção','Odd','Mercado*',game.major?'Estimativa':'Modelo','Dif.','Estudo'])tr.append(el('th','',label));
  thead.append(tr);table.append(thead);
  const tbody=el('tbody','');
  for(const m of visible){
   const tr=el('tr',''),label=el('td','');
   label.append(el('span','market-label',m.label));
   if(Number.isFinite(m.v1P))label.append(el('small','market-sub','V1 '+C.formatPercent(m.v1P)));
   tr.append(label);
   const price=el('td',Number.isFinite(m.odd)?'market-price':'',Number.isFinite(m.odd)?C.round2(m.odd):'—');
   tr.append(price,el('td','',C.formatPercent(m.impliedNoVig)),
    el('td','',C.formatPercent(m.v2P)),el('td','market-gap',C.gapPP(m)));
   const action=el('td','');
   const selected=state.selections.some(x=>x.matchId===game.id&&x.key===m.key);
   const add=el('button','market-pick'+(selected?' is-selected':''),selected?'Selecionado ✓':'Analisar +');
   add.type='button';add.disabled=!(Number.isFinite(m.odd)&&m.odd>1&&C.isFuture(game));
   add.addEventListener('click',()=>addSelection(game.id,m.key));action.append(add);tr.append(action);
   tbody.append(tr);
  }
  table.append(tbody);outer.append(table);fragment.append(outer);
  fragment.append(el('p','below-table',game.bestOf===1?
    (!chosenMap?'Selecione o mapa para ver a estimativa específica. A projeção média pré-veto foi desativada nesta tabela.':
     game.mapProjection?.status==='estimated'?
      'Estimativa de '+chosenMap+': '+(game.mapProjection?.modelStatus==='opponent_adjusted'?'corrigida pela dificuldade dos últimos adversários e diferença de rounds.':'sem cobertura suficiente de adversários; usando histórico base.')+' Probabilidades ainda NÃO calibradas. Diferenças para o preço não comprovam vantagem.':
      'Sem projeção para '+chosenMap+': '+(game.mapProjection?.reason||'histórico insuficiente')+' Odds fotografadas não são atuais.'):
    '*Mercado sem margem é uma normalização das odds do print. Dif. = V2 − mercado, em pontos percentuais. Não indica vantagem comprovada: a V2 ainda não foi calibrada.'));
  return fragment;
 }
 function contextSection(game){
  const details=el('details','context-details');
  details.append(el('summary','','Por trás da análise: adversários e amostragem'));
  const body=el('div','context-body'),columns=el('div','context-columns');
  for(const side of ['a','b']){
   const info=game.form?.[side],team=game[side==='a'?'teamA':'teamB'];
   const box=el('div','context-team');
   box.append(el('b','',team.name));
   if(info&&game.major){
    box.append(el('small','','Ranking registrado no evento: '+(info.rank?'#'+info.rank:'indisponível')),
     el('small','',info.maps90===null?'Histórico recente por mapa indisponível':info.maps90+' mapas em 90 dias'));
   }else if(info){
    box.append(el('small','','Ranking na captura: '+(info.rank?'#'+info.rank:'indisponível')),
      el('small','',info.form.wins+' vitórias em '+info.form.n+' séries documentadas'),
      el('small','',info.form.winsVsTop50+' de '+info.form.vsTop50+' jogos vencidos contra top 50'),
      el('small','',info.maps90===null?'Mapas 90d indisponíveis':info.maps90+' mapas no histórico de 90 dias'));
   }else box.append(el('small','','Sem amostra recente documentada.'));
   columns.append(box);
  }
  body.append(columns,el('p','context-warning','Ranking atual não é ranking histórico de cada confronto. A Cito disponibiliza fotografias do histórico; escalações e vetos podem mudar. Modelos V1 e V2 são experimentais.'));
  if(game.major){
   const p=game.mapProjection;
   const explanation=!game.selectedMap?'Selecione o mapa no radar para comparar as equipes. A projeção geral pré-veto não substitui a específica do mapa.':
    p?.status==='estimated'?'Mapa '+game.selectedMap+': '+game.teamA.name+' '+C.formatPercent(p.probabilityA)+
     ' x '+game.teamB.name+' '+C.formatPercent(p.probabilityB)+'. Amostras: '+p.playedA+' e '+p.playedB+
     ' mapas nos últimos 90 dias. A estimativa combina ranking e resultados no mapa, sem calibração ou ajuste completo de adversários.':
    'Mapa '+game.selectedMap+': '+(p?.reason||'dados insuficientes para estimar a vitória.');
   body.append(el('p','context-warning',explanation));
  }
  details.append(body);
  if(game.pricingConsistency?.some(x=>x.relativeDifferencePercent>=5)){
   const note=el('p','context-warning','Há preços distintos para resultados aparentemente equivalentes de 2–0 e handicap −1,5. É necessário conferir as regras da casa, pois isso não comprova arbitragem.');
   body.append(note);
  }
  if(game.unmodeledRoundHandicaps?.length){
   const sub=el('details','context-details rounds-details');
   sub.append(el('summary','','Handicap de rodadas (preços sem modelo)'));
   const wrap=el('div','context-body');
   wrap.append(el('p','','Essas linhas não receberam probabilidade. Precisamos confirmar a forma de liquidação antes de modelá-las.'));
   const rows=el('div','rounds-rows');
   for(const r of game.unmodeledRoundHandicaps){
    const row=el('div','rounds-line');row.append(el('span','',r.label),el('b','',C.round2(r.odd)));rows.append(row);
   }
   wrap.append(rows);sub.append(wrap);details.append(sub);
  }
  return details;
 }
 function renderDetail(game){
  const panel=$('detail-panel');panel.textContent='';
  if(!game){panel.append(el('div','detail-placeholder','Selecione uma partida futura para analisar.'));return}
  const header=el('div','detail-head'),meta=el('div','detail-super');
  meta.append(el('span','strong',game.event),el('span','',hours(game.startTime)+' · Brasília'));
  header.append(meta,el('h2','detail-title',game.teamA.name+' × '+game.teamB.name));
  const caption=el('p','detail-caption');
  header.append(caption);
  const left=C.winnerMarket(game).find(m=>m.key==='aWin'),right=C.winnerMarket(game).find(m=>m.key==='bWin');
  const compare=el('div','detail-compare');header.append(compare);panel.append(header);
  const mapArea=game.major?el('div','atlas-map-workspace'):null;
  if(mapArea)panel.append(mapArea);
  const body=el('div','detail-body'),marketHost=el('div',''),contextHost=el('div','');
  body.append(marketHost,contextHost);panel.append(body);
  const updateMap=(map,projection)=>{
   if(!panel.isConnected)return;
   const visibleGame=game.major&&window.AtlasMajorMaps?
    window.AtlasMajorMaps.withSelectedMap(game,map,projection):game;
   const markets=C.winnerMarket(visibleGame);
   const pA=markets.find(m=>m.key==='aWin')?.v2P??null;
   const pB=markets.find(m=>m.key==='bWin')?.v2P??null;
   compare.replaceChildren(
    teamBox(game.teamA,pA,left,!!game.major,map),
    teamBox(game.teamB,pB,right,!!game.major,map));
   if(game.major){
    caption.textContent=!map?'Major BO1 · escolha o mapa quando sair o veto. Odds do print de 23/11, não ao vivo.':
     projection?.status==='estimated'?'Major BO1 · '+map+' selecionado manualmente · comparação específica do mapa, ainda experimental.':
     'Major BO1 · '+map+' selecionado · dados insuficientes para projetar vencedor. Odds do print não são ao vivo.';
   }else caption.textContent=C.hasOdds(game)?'Odds dos prints da BR365, sem verificação ao vivo. Modelo V2 congelado antes do jogo.':
    'Ainda não há odds capturadas para este confronto. As probabilidades, quando disponíveis, não são cotações.';
   marketHost.replaceChildren(marketSection(visibleGame));
   contextHost.replaceChildren(contextSection(visibleGame));
  };
  updateMap(null,null);
  if(mapArea){
   if(window.AtlasMapWorkspace)window.AtlasMapWorkspace.render(game,mapArea,updateMap);
   else mapArea.append(el('p','atlas-map-alert','Painel por mapa não está disponível neste carregamento.'));
  }
 }
 function renderStudy(){
  const panel=$('study-body');panel.textContent='';
  const summary=C.studySummary(state.selections,state.feed);
  state.selections=summary.selections;saveSelections();
  if(!summary.items.length){
   const empty=el('div','empty-list');
   empty.append(el('b','','Nenhum mercado selecionado'));
   empty.append(document.createTextNode('Volte ao Radar, escolha um jogo futuro e toque em “Analisar +”. As seleções serão reunidas aqui, sem repetir a mesma partida.'));
   const back=el('button','primary-button','Ir para o Radar');back.style.display='block';back.style.margin='17px auto 0';back.addEventListener('click',()=>switchPage('radar'));
   empty.append(back);panel.append(empty);return;
  }
  panel.append(el('p','study-count',summary.items.length+' partida(s) • uma seleção por jogo • cotações históricas de prints'));
  const layout=el('div','study-layout'),list=el('div','study-selection-list');
  for(const {game,market} of summary.items){
   const card=el('div','study-choice'),head=el('div','study-choice-head');
   head.append(el('span','',game.teamA.name+' × '+game.teamB.name));
   const rm=el('button','','Remover ×');rm.addEventListener('click',()=>removeSelection(game.id));
   head.append(rm);
   card.append(head,el('p','study-choice-meta',hours(game.startTime)+' • '+game.event+' • '+C.round2(market.odd)));
   const dropdown=el('select','','');dropdown.setAttribute('aria-label','Selecionar mercado para '+game.teamA.name+' × '+game.teamB.name);
   for(const m of game.markets.filter(x=>Number.isFinite(x.odd)&&x.odd>1)){
    const opt=el('option','',(marketFamily[m.family]||'Mercado')+' · '+m.label+' · '+C.round2(m.odd));
    opt.value=m.key;dropdown.append(opt);
   }
   dropdown.value=market.key;
   dropdown.addEventListener('change',()=>{state.selections=state.selections.map(x=>x.matchId===game.id?{matchId:game.id,key:dropdown.value}:x);saveSelections();updateTop();renderStudy()});
   card.append(dropdown);list.append(card);
  }
  const total=el('div','study-total');
  total.append(el('span','eyebrow','PRODUTO MATEMÁTICO DAS ODDS'),el('strong','value',C.round2(summary.product)));
  total.append(el('p','','Este valor é apenas a multiplicação dos preços fotografados. Não é uma cotação atual, nem recomendação ou estimativa validada de probabilidade conjunta.'));
  const copy=el('button','primary-button','Copiar meu estudo');
  copy.addEventListener('click',()=>copyStudy(summary));
  const clear=el('button','ghost-button','Limpar seleções');
  clear.addEventListener('click',()=>{state.selections=[];saveSelections();updateTop();renderStudy()});
  total.append(copy,clear);
  layout.append(list,total);panel.append(layout);
 }
 async function copyStudy(summary){
  const lines=['ATLAS — estudo de mercados (não é bilhete enviado)','Odds dos screenshots da BR365; verificar preços atuais e regras antes de qualquer uso.'];
  for(const x of summary.items)lines.push(x.game.teamA.name+' × '+x.game.teamB.name+' | '+x.market.label+' | '+C.round2(x.market.odd));
  lines.push('Produto matemático das odds: '+C.round2(summary.product));
  lines.push('Modelos experimentais, sem vantagem financeira comprovada.');
  try{await navigator.clipboard.writeText(lines.join('\n'));toast('Estudo copiado.');}
  catch{toast('A cópia automática não está disponível neste navegador.')}
 }
 function removeSelection(id){state.selections=state.selections.filter(x=>x.matchId!==id);saveSelections();updateTop();renderStudy()}
 function renderHistory(){
  const root=$('history-body');root.textContent='';
  if(window.AtlasMajorAuditUI)window.AtlasMajorAuditUI.render(root);
  const games=C.getHistory(state.feed);
  if(!games.length){root.append(el('div','empty-list','Nenhum jogo passado na base ainda.'));return}
  for(const g of games){
   const row=el('div','history-row'),name=el('div','');
   name.append(el('div','history-name',g.teamA.name+' × '+g.teamB.name),
     el('div','history-sub',hours(g.startTime)+' · '+g.event));
   const score=el('div','history-score',g.result?g.result.scoreA+'–'+g.result.scoreB:'—');
   const stateBox=el('div','history-col');
   stateBox.append(el('b','',g.result?'Resultado confirmado':'Resultado pendente'),el('small','',g.result?'Cito':'Sem placar verificado'));
   const model=el('div','history-col');
   model.append(el('b','',g.major?(Number.isFinite(g.model?.v2)?'BO1: '+C.formatPercent(g.model.v2)+' (A)':'Sem projeção BO1'):
    Number.isFinite(g.model?.v1)?'V1: '+C.formatPercent(g.model.v1)+' (A)':'Sem previsão congelada'),
    el('small','',g.major?'Pré-veto; pesquisa experimental':Number.isFinite(g.model?.v2)?'V2: '+C.formatPercent(g.model.v2)+' (A)':'Sem V2'));
   row.append(name,score,stateBox,model);root.append(row);
  }
 }
 async function loadFeed(){
  $('reload-feed').disabled=true;
  try{
   const response=await fetch('data/radar-feed.json',{cache:'no-store'});
   if(!response.ok)throw Error('Catálogo não disponível (HTTP '+response.status+')');
   const result=await response.json();
   if(!result||!Array.isArray(result.games)||!result.version)throw Error('Estrutura inválida do catálogo');
   state.feed=result;
   const old=loadSelections();
   state.selections=C.cleanSelections(old,result);saveSelections();
   eventFilters();updateTop();renderList();renderStudy();renderHistory();
  }catch(error){
   $('game-list').textContent='Falha ao carregar o radar: '+String(error.message);
   $('feed-status').querySelector('span').textContent='Dados indisponíveis';
   toast('Erro ao carregar os jogos. Tente recarregar.');
  }finally{$('reload-feed').disabled=false;}
 }
 document.querySelectorAll('[data-view]').forEach(n=>n.addEventListener('click',()=>switchPage(n.dataset.view)));
 document.querySelectorAll('[data-price-filter]').forEach(n=>n.addEventListener('click',()=>{state.filter=n.dataset.priceFilter;renderList()}));
 $('search-games').addEventListener('input',e=>{state.query=e.target.value.trim();renderList()});
 $('event-filter').addEventListener('change',e=>{state.event=e.target.value;renderList()});
 $('reload-feed').addEventListener('click',()=>{
   const url=new URL(window.location.href);
   url.searchParams.set('atlas_refresh',String(Date.now()));
   window.location.replace(url.toString());
  });
 // A kickoff that passes while the tab remains open leaves the radar and expires its selections.
 setInterval(()=>{if(!state.feed)return;const n=C.getUpcoming(state.feed).length;
  if(n!==Number($('upcoming-total').textContent)){updateTop();renderList();renderStudy();renderHistory();}
 },60000);
 loadFeed();
})();
