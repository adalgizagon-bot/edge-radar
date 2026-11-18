'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const text=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
 const fmtProb=n=>Number.isFinite(n)?(n*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%':'—';
 const fmtOdd=n=>Number.isFinite(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const fmtPP=n=>Number.isFinite(n)?(n>0?'+':'')+n.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' p.p.':'—';
 const fmtDate=s=>s?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(s)):'—';
 const familyNames={winner:'Vencedor da série',handicap:'Handicap de mapas',score:'Placar exato',total:'Total de mapas'};
 const state={matches:[],selected:new Map(),preset:2,visible:9,expanded:null};
 const active=g=>new Date(g.startsAt).getTime()>Date.now()&&g.status!=='completed';
 const risk=m=>!m.model?'Histórico insuficiente':m.model.commonMaps.length<4?'Apenas 3 mapas elegíveis':m.model.minCommonMapHistory<8?'Amostra reduzida':'Veto não conhecido';
 const riskClass=m=>!m.model||m.model.commonMaps.length<4||m.model.minCommonMapHistory<8?'high':'warning';
 const key=o=>o.matchId+'|bo3|'+o.key;
 const sum=(arr,f)=>arr.reduce((a,x)=>a+f(x),0);
 const rankRow=(row,match)=>{
  if(row.modelP===null)return -1e5;
  const spread=(row.modelRange.max-row.modelRange.min)*100;
  const low=match.model?.minCommonMapHistory||0;
  const maps=match.model?.commonMaps.length||0;
  return row.deltaPP-0.22*spread-(low<8?4:0)-(maps<4?5:0);
 };
 function flattenBook(book){
  const groups=[
    ['winner',[['aWin',book.a+' vence série',book.winner.a],['bWin',book.b+' vence série',book.winner.b]]],
    ['handicap',Object.entries(book.handicap).map(([k,p])=>[k,
      k==='aMinus1_5'?book.a+' -1,5 mapas':k==='aPlus1_5'?book.a+' +1,5 mapas':
      k==='bMinus1_5'?book.b+' -1,5 mapas':book.b+' +1,5 mapas',p])],
    ['score',[['a20',book.a+' 2–0',book.score.a20],['a21',book.a+' 2–1',book.score.a21],
      ['b20',book.b+' 2–0',book.score.b20],['b21',book.b+' 2–1',book.score.b21]]],
    ['total',[['over2_5','Acima de 2,5 mapas',book.total.over2_5],['under2_5','Abaixo de 2,5 mapas',book.total.under2_5]]]
  ];
  return groups.flatMap(([marketFamily,choices])=>{
    const round=sum(choices,x=>1/x[2]);
    return choices.map(([keyName,label,bookOdds])=>({id:book.matchId+'|bo3|'+keyName,
      matchId:book.matchId,key:keyName,marketFamily,label,bookOdds,marketRaw:1/bookOdds,
      marketNoVig:(1/bookOdds)/round,marketOverround:round,
      modelP:null,modelRange:null,deltaPP:null,hypotheticalROI:null,
      priceStatus:'screenshot_only'}));
  });
 }
 function allOpportunities(){return state.matches.flatMap(m=>m.markets.map(row=>({...row,match:m,
    rank:rankRow(row,m),hasModel:row.modelP!==null})))}
 function sortedForMatch(m){return m.markets.slice().sort((a,b)=>rankRow(b,m)-rankRow(a,m))}
 function rankedList(){
   const filters={event:$('series-filter-event').value,family:$('series-filter-market').value,show:$('series-filter-show').value};
   let rows=allOpportunities().filter(x=>x.hasModel &&
     (filters.event==='all'||x.match.eventId===filters.event) &&
     (filters.family==='all'||x.marketFamily===filters.family));
   if(filters.show==='positive')rows=rows.filter(x=>x.deltaPP>0);
   if(filters.show==='caution')rows=rows.filter(x=>x.deltaPP>12);
   rows.sort((a,b)=>b.rank-a.rank||b.deltaPP-a.deltaPP);
   const root=$('series-ranked-list');root.textContent='';
   $('series-rank-count').textContent=rows.length+' comparações';
   if(!rows.length){root.append(text('p','series-empty','Nenhum mercado corresponde aos filtros escolhidos.'));$('series-more').hidden=true;return}
   rows.slice(0,state.visible).forEach(x=>{
     const m=x.match;
     const card=text('article','series-signal');
     const main=text('div','');
     const meta=text('div','series-signal-where');
     meta.append(text('span','event',m.event),text('span','',fmtDate(m.startsAt)),text('span','',familyNames[x.marketFamily]));
     main.append(meta,text('h3','',x.label),text('p','muted',m.bookTeamA+' × '+m.bookTeamB));
     const stats=text('div','series-signal-stats');
     stats.append(text('span','','BR365 '+fmtOdd(x.bookOdds)),
      text('span','','Mercado sem margem '+fmtProb(x.marketNoVig)),
      text('span','','Modelo '+fmtProb(x.modelP)));
     main.append(stats);
     const more=text('div','series-signal-details');
     more.textContent='Faixa entre vetos simulados '+fmtProb(x.modelRange.min)+'–'+fmtProb(x.modelRange.max)+
       ' · '+m.model.commonMaps.length+' mapas elegíveis · '+risk(m);
     main.append(more);
     const side=text('div','series-signal-side');
     side.append(text('strong','series-model-delta',fmtPP(x.deltaPP)),text('small','','Diferença entre modelo e mercado'));
     const select=text('button','',state.selected.get(m.matchId)?.id===x.id?'No cenário ✓':'Adicionar ao estudo');
     select.type='button';select.disabled=!active(m);
     if(!active(m))select.textContent='Pré-jogo encerrado';
     select.addEventListener('click',()=>{state.selected.set(m.matchId,x);state.preset=0;renderCombo();rankedList();renderGames()});
     side.append(select);card.append(main,side);root.append(card);
   });
   $('series-more').hidden=rows.length<=state.visible;
   $('series-more').textContent='Mostrar mais '+Math.min(12,rows.length-state.visible)+' comparações';
 }
 function renderGames(){
   const root=$('series-games');root.textContent='';
   $('series-game-counter').textContent=state.matches.length+' jogos · '+state.matches.filter(x=>!x.model).length+' sem modelo';
   for(const m of state.matches.slice().sort((a,b)=>a.startsAt.localeCompare(b.startsAt))){
     const box=text('article','series-game'),head=text('div','series-game-top');
     head.append(text('span','',m.event),text('span','',fmtDate(m.startsAt)));
     box.append(head,text('h3','',m.bookTeamA+' × '+m.bookTeamB));
     const recap=text('div','series-game-summary');
     const a=m.markets.find(x=>x.key==='aWin'),b=m.markets.find(x=>x.key==='bWin');
     for(const opt of [a,b]){
       const col=text('div','');col.append(text('span','',opt.label),
       text('strong','',opt.modelP===null?'Sem modelo':fmtProb(opt.modelP)),
       text('small','','Odd BR365: '+fmtOdd(opt.bookOdds)));
       recap.append(col);
     }
     box.append(recap);
     if(m.bookTeamA!==m.teamA.name||m.bookTeamB!==m.teamB.name){
       box.append(text('p','series-section-foot','Nome na Cito: '+m.teamA.name+' × '+m.teamB.name+' (identificação conferida para este confronto).'));
     }
     const flags=text('div','series-snapshot-line');
     flags.append(text('span','series-chip '+riskClass(m),risk(m)),
       text('span','series-chip neutral',m.model?m.model.commonMaps.length+' mapas em comum':'Somente odds capturadas'));
     if(!active(m))flags.append(text('span','series-chip warning','Jogo já iniciado / encerrado'));
     box.append(flags);
     const toggle=text('button','series-game-expand',
       state.expanded===m.matchId?'Ocultar os mercados −':'Ver 10 mercados da série +');
     toggle.type='button';toggle.setAttribute('aria-expanded',String(state.expanded===m.matchId));
     toggle.addEventListener('click',()=>{state.expanded=state.expanded===m.matchId?null:m.matchId;renderGames()});
     box.append(toggle);
     if(state.expanded===m.matchId){
       const rows=text('div','series-game-details');
       for(const opt of sortedForMatch(m)){
         const row=text('div','series-game-detail-row');
         row.append(text('span','',opt.label),text('b','',fmtOdd(opt.bookOdds)),
           text('small','',opt.modelP===null?'Sem estimativa':fmtProb(opt.modelP)));
         rows.append(row);
       }
       box.append(rows);
     }
     root.append(box);
   }
 }
 function pickForGame(m){
   const valid=sortedForMatch(m).filter(x=>x.modelP!==null);
   if(valid.length)return valid[0];
   return m.markets.slice().sort((a,b)=>b.marketNoVig-a.marketNoVig)[0]||null;
 }
 function preset(count){
   state.selected.clear();state.preset=count;
   const comparable=state.matches.filter(m=>active(m)&&m.model).sort((a,b)=>rankRow(pickForGame(b),b)-rankRow(pickForGame(a),a));
   const selections=comparable.slice(0,count);
   if(count===8){
     for(const m of state.matches.filter(m=>active(m)&&!m.model))selections.push(m);
   }
   for(const m of selections){const selection=pickForGame(m);if(selection)state.selected.set(m.matchId,selection)}
   renderCombo();rankedList();renderGames();
 }
 function renderCombo(){
   const root=$('series-combo-legs'),summary=$('series-combo-summary');
   root.textContent='';summary.textContent='';
   const chosen=[...state.selected.values()].sort((a,b)=>a.match.startsAt.localeCompare(b.match.startsAt));
   document.querySelectorAll('[data-series-preset]').forEach(btn=>btn.classList.toggle('active',Number(btn.dataset.seriesPreset)===state.preset));
   $('series-clear').disabled=!chosen.length;$('series-copy').disabled=!chosen.length;
   $('series-builder-note').textContent=chosen.length?
     chosen.length+' jogos distintos. Aqui só entram mercados da série BO3, sem necessidade do veto.':
     'Escolha uma quantidade acima ou selecione um mercado para estudar.';
   if(!chosen.length){root.append(text('p','series-empty','Nenhuma seleção adicionada.'));return}
   for(let i=0;i<chosen.length;i++){
     const s=chosen[i],m=s.match;
     const row=text('div','series-leg'),head=text('div','series-leg-head');
     head.append(text('span','series-leg-index',String(i+1).padStart(2,'0')),text('span','series-leg-game',m.bookTeamA+' × '+m.bookTeamB),
       text('strong','series-leg-odd',fmtOdd(s.bookOdds)));
     const label=text('label','','Mercado da série (não depende do veto)');
     const menu=text('select','series-leg-select');
     menu.setAttribute('aria-label','Mercado para '+m.bookTeamA+' × '+m.bookTeamB);
     for(const choice of m.markets){const option=text('option','',choice.label+' • '+fmtOdd(choice.bookOdds));option.value=choice.id;menu.append(option)}
     menu.value=s.id;
     menu.disabled=!active(m);
     menu.addEventListener('change',()=>{const next=m.markets.find(x=>x.id===menu.value);if(next){
       state.selected.set(m.matchId,{...next,match:m});state.preset=0;renderCombo();rankedList();renderGames();}});
     label.append(menu);
     const foot=text('div','series-leg-foot');
     foot.append(text('span','',s.modelP===null?'Sem modelo para este confronto':'Modelo '+fmtProb(s.modelP)));
     const rm=text('button','series-leg-remove','Remover ×');rm.type='button';
     rm.addEventListener('click',()=>{state.selected.delete(m.matchId);state.preset=0;renderCombo();rankedList();renderGames()});
     foot.append(rm);row.append(head,label,foot);root.append(row);
   }
   const priceProduct=chosen.reduce((a,b)=>a*b.bookOdds,1);
   const complete=chosen.every(x=>x.modelP!==null);
   const modelProduct=complete?chosen.reduce((a,b)=>a*b.modelP,1):null;
   const out=text('div','series-combo-kpis'),left=text('div',''),right=text('div','');
   left.append(text('small','','Produto das odds dos prints'),text('strong','',fmtOdd(priceProduct)));
   right.append(text('small','','Produto hipotético de probabilidades'),text('strong','',modelProduct===null?'N/D':fmtProb(modelProduct)));
   out.append(left,right);summary.append(out);
   const caution=text('div','series-combo-note',complete?
     'Produto das probabilidades presume independência, não verificada. Modelo não calibrado; preços podem ter mudado. Isto NÃO comprova uma múltipla vantajosa.':
     'Uma ou mais partidas estão sem previsão válida (histórico insuficiente). A probabilidade conjunta do modelo NÃO é calculável.');
   summary.append(caution);
 }
 async function copyCombo(){
   const picks=[...state.selected.values()].sort((a,b)=>a.match.startsAt.localeCompare(b.match.startsAt));
   if(!picks.length)return;
   const oddsProduct=picks.reduce((a,b)=>a*b.bookOdds,1);
   const lines=['ATLAS — Comparação teórica de mercados BO3','Odds de screenshots BR365; não são preços ao vivo.',
    'Não é uma recomendação validada.',...picks.map((s,i)=>(i+1)+'. '+s.match.bookTeamA+' x '+s.match.bookTeamB+' | '+s.label+' | odd '+fmtOdd(s.bookOdds)+' | modelo '+fmtProb(s.modelP)),
    'Produto matemático das odds (não cotação atual): '+fmtOdd(oddsProduct),
    'Modelos sem calibração; séries independentes apenas por hipótese.'];
   const value=lines.join('\n');
   try{await navigator.clipboard.writeText(value);$('series-copy').textContent='Copiado ✓';setTimeout(()=>$('series-copy').textContent='Copiar análise',2300)}
   catch(e){$('series-builder-note').textContent='Não foi possível copiar automaticamente neste navegador.'}
 }
 function init(){
   Promise.all(['data/series-forecasts.json','data/br365-series-odds.json','data/tournaments.json','data/series-validation.json'].map(path=>fetch(path,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(path);return r.json()})))
   .then(([series,book,fixtures,validation])=>{
     const modelMap=new Map(series.matches.map(x=>[x.matchId,x]));
     state.matches=fixtures.matches.map(g=>{
       const odds=book.odds.find(x=>x.matchId===g.id),model=modelMap.get(g.id);
       if(!odds)return null;
       const baseline=model?model.markets:flattenBook(odds);
       const item={matchId:g.id,event:g.event,eventId:g.eventId,startsAt:g.startTime,status:g.status,
         teamA:g.teamA,teamB:g.teamB,bookTeamA:odds.a,bookTeamB:odds.b,
         model:model?.model||null,markets:[]};
       item.markets=baseline.map(x=>({...x,match:item}));
       return item;
     }).filter(Boolean);
     const marketCount=state.matches.reduce((a,m)=>a+m.markets.length,0);
     $('series-kpi-games').textContent=String(state.matches.length);
     $('series-kpi-markets').textContent=String(marketCount);
     $('series-kpi-covered').textContent=String(state.matches.filter(x=>x.model).length);
     $('series-snapshot').textContent='Odds BR365: capturas em '+fmtDate(book.capturedApprox)+' (aprox.) · Cito: '+fmtDate(series.matches[0]?.modelSnapshotAt)+' · odds NÃO atualizadas automaticamente.';
     const n=Number(validation.resolved)||0,total=Number(validation.total)||0;
     const status=$('series-validation-status');
     if(status)status.textContent=n+' de '+total+' mercados de série com resultados oficiais conferidos. '+(n===0?
       'Ainda não há acertos ou erros calculados para este modelo.':
       'A amostra de séries deve ser interpretada junto com calibração e cobertura, não apenas taxa de acerto.');

     rankedList();renderGames();preset(2);
   }).catch(e=>{
     $('series-ranked-list').textContent='Falha ao carregar mercados: '+e.message;
     $('series-games').textContent='Dados indisponíveis; atualize a página.';
     $('series-builder-note').textContent='Cenários indisponíveis.';
   });
 }
 for(const id of ['series-filter-event','series-filter-market','series-filter-show'])$(id).addEventListener('change',()=>{state.visible=9;rankedList()});
 $('series-more').addEventListener('click',()=>{state.visible+=12;rankedList()});
 document.querySelectorAll('[data-series-preset]').forEach(b=>b.addEventListener('click',()=>preset(Number(b.dataset.seriesPreset))));
 $('series-clear').addEventListener('click',()=>{state.selected.clear();state.preset=0;renderCombo();rankedList();renderGames()});
 $('series-copy').addEventListener('click',copyCombo);
 init();
})();
