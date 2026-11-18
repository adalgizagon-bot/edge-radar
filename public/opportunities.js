'use strict';
(function(){
 const core=window.AtlasOpportunityCore;
 if(!core)return;
 const $=id=>document.getElementById(id);
 const el=(tag,cls='',value)=>{const d=document.createElement(tag);if(cls)d.className=cls;if(value!==undefined)d.textContent=String(value);return d};
 const pct=p=>Number.isFinite(p)?(p*100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%':'—';
 const odds=p=>Number.isFinite(p)?p.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const date=s=>s?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(s)):'—';
 const matchTitle=g=>g.teamA.name+' × '+g.teamB.name;
 const eventName=g=>g.eventId==='cs2-event-9258'?'Stake Ranked':'Tipsport RUSH Brno';
 const quality=s=>s.sample>=12?'Amostra maior':s.sample>=8?'Amostra intermediária':'Amostra reduzida';
 const qualityStyle=s=>s.sample>=12?'quality-good':s.sample>=8?'quality-mid':'quality-low';
 const tag=(value,cls)=>el('span','radar-tag '+(cls||''),value);
 const state={signals:[],matches:[],picks:new Map(),show:9,preset:3,expanded:null};
 const perMatch=id=>state.signals.filter(x=>x.matchId===id).sort((a,b)=>b.score-a.score);
 function renderRanking(){
  const root=$('radar-ranked-list');root.textContent='';
  const candidates=core.filtered(state.signals,{event:$('radar-event').value,market:$('radar-market').value,minimum:Number($('radar-minimum').value),quality:$('radar-quality').value});
  $('radar-filter-count').textContent=candidates.length+' sinais';$('radar-more').hidden=candidates.length<=state.show;
  $('radar-more').textContent='Mostrar mais '+Math.min(12,candidates.length-state.show)+' mercados';
  if(!candidates.length){root.append(el('p','radar-empty','Nenhum sinal neste filtro. Reduza a probabilidade mínima ou a exigência de amostra.'));return;}
  candidates.slice(0,state.show).forEach((s,i)=>{
    const card=el('article','radar-signal-card');
    const main=el('div','radar-signal-main');
    const meta=el('div','radar-signal-meta');
    meta.append(el('span','radar-event-tag',eventName(s.game)),el('span','',date(s.startsAt)),tag('Mapa não confirmado','veto-tag'));
    const heading=el('div','radar-signal-head');
    heading.append(el('h3','',s.label),tag(core.MARKET_NAMES[s.kind]||s.kind,'type-tag'));
    const line=el('p','radar-signal-fixture',matchTitle(s.game));
    const foot=el('div','radar-signal-foot');
    foot.append(tag(quality(s),qualityStyle(s)),el('span','',s.sample+' mapas mínimos de histórico'),el('span','','Odd de equilíbrio teórica: '+odds(s.fairOdd)));
    main.append(meta,heading,line,foot);
    const right=el('div','radar-signal-right');
    right.append(el('div','radar-large-percent',pct(s.probability)),el('div','radar-percent-label','Probabilidade estimada'));
    const button=el('button','radar-add-button',state.picks.get(s.matchId)?.id===s.id?'Selecionada ✓':'Adicionar ao cenário');
    button.type='button';button.disabled=!s.upcoming;
    if(!s.upcoming)button.textContent='Jogo já iniciado';
    button.addEventListener('click',()=>{state.picks.set(s.matchId,s);state.preset=0;refreshAll()});
    right.append(button);
    card.append(el('div','radar-signal-index',String(i+1).padStart(2,'0')),main,right);root.append(card);
  });
 }
 function renderGames(){
  const root=$('radar-game-grid');root.textContent='';
  $('radar-games-counter').textContent=state.matches.length+' jogos';
  const matches=state.matches.slice().sort((a,b)=>a.startTime.localeCompare(b.startTime));
  for(const game of matches){
    const choices=perMatch(game.id),first=choices[0],box=el('article','radar-game-card');
    const top=el('div','radar-game-top');top.append(el('span','',eventName(game)),el('span','',date(game.startTime)));
    box.append(top,el('h3','',matchTitle(game)));
    if(!first){box.append(el('p','radar-empty','Dados insuficientes.'));root.append(box);continue;}
    const best=el('div','radar-game-best'),left=el('div','');
    left.append(el('span','radar-game-kicker','MAIOR SINAL PARA INVESTIGAR'),el('strong','',first.label));
    best.append(left,el('strong','radar-game-percent',pct(first.probability)));box.append(best);
    const tags=el('div','radar-game-meta');
    tags.append(tag('Mapa não confirmado','veto-tag'),tag(quality(first),qualityStyle(first)),el('span','',choices.length+' mercados'));
    box.append(tags);
    const button=el('button','radar-game-toggle',state.expanded===game.id?'Recolher mercados −':'Comparar mercados +');
    button.type='button';button.setAttribute('aria-expanded',String(state.expanded===game.id));
    button.addEventListener('click',()=>{state.expanded=state.expanded===game.id?null:game.id;renderGames()});
    box.append(button);
    if(state.expanded===game.id){
      const details=el('div','radar-game-alt');
      choices.slice(0,10).forEach(s=>{
        const choice=el('button','radar-game-alt-row'+(state.picks.get(game.id)?.id===s.id?' is-selected':''));choice.type='button';
        choice.disabled=!s.upcoming;
        choice.append(el('span','',s.label),el('small','',pct(s.probability)+' · '+s.sample+' mapas'));
        choice.addEventListener('click',()=>{state.picks.set(s.matchId,s);state.preset=0;refreshAll()});
        details.append(choice);
      });
      if(choices.length>10)details.append(el('p','muted','Mostrando os 10 maiores sinais. Veja todos na Validação Cito.'));
      box.append(details);
    }
    root.append(box);
  }
 }
 function renderCombos(){
  const list=$('radar-combo-legs'),summary=$('radar-combo-summary');list.textContent='';summary.textContent='';
  const picks=[...state.picks.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  $('radar-combo-help').textContent=picks.length?picks.length+' partidas selecionadas. Troque o mercado de cada jogo abaixo.':'Adicione mercados ou escolha uma configuração pronta acima.';
  document.querySelectorAll('[data-radar-preset]').forEach(b=>b.classList.toggle('is-active',state.preset===Number(b.dataset.radarPreset)));
  $('radar-clear').disabled=!picks.length;$('radar-copy').disabled=!picks.length;
  if(!picks.length){list.append(el('p','radar-empty','Nenhum jogo escolhido.'));return}
  picks.forEach((s,i)=>{
    const row=el('div','radar-leg'),head=el('div','radar-leg-header');
    head.append(el('span','radar-leg-number',String(i+1).padStart(2,'0')),el('span','radar-leg-fixture',matchTitle(s.game)),el('b','radar-leg-percent',pct(s.probability)));
    const sel=el('select','radar-leg-select');sel.setAttribute('aria-label','Mercado para '+matchTitle(s.game));
    const options=perMatch(s.matchId).filter(x=>x.upcoming).slice(0,50);
    if(!options.some(x=>x.id===s.id))options.push(s);
    for(const x of options){const opt=el('option','',x.label+' — '+pct(x.probability));opt.value=x.id;sel.append(opt)}
    sel.value=s.id;
    sel.addEventListener('change',()=>{const next=perMatch(s.matchId).find(x=>x.id===sel.value);if(next){state.picks.set(next.matchId,next);state.preset=0;refreshAll()}});
    const foot=el('div','radar-leg-foot');foot.append(el('span','',s.map+' · '+quality(s)),tag('Veto pendente','veto-tag'));
    const remove=el('button','radar-leg-remove','Remover ×');remove.type='button';
    remove.addEventListener('click',()=>{state.picks.delete(s.matchId);state.preset=0;refreshAll()});
    row.append(head,sel,foot,remove);list.append(row);
  });
  const stats=core.combinationStats(picks),pair=el('div','radar-combo-metrics');
  const prob=el('div','');prob.append(el('small','','Chance conjunta ilustrativa'),el('strong','',pct(stats.independentProbability)));
  const price=el('div','');price.append(el('small','','Odd de equilíbrio teórica'),el('strong','',odds(stats.indicativeFairOdd)));
  pair.append(prob,price);summary.append(pair);
  summary.append(el('p','radar-combo-meta',stats.legs+' jogos diferentes · '+stats.tournaments+' campeonatos · '+stats.unconfirmedMaps+' mapas sem veto · '+stats.smallSamples+' amostras reduzidas'));
  summary.append(el('div','radar-combo-alert','Produto de probabilidades condicionais, assumindo independência não verificada. Sem odds reais ou vantagem comprovada.'));
 }
 function refreshAll(){renderCombos();renderRanking();renderGames()}
 function preset(count){
   state.preset=count;state.picks.clear();
   for(const s of core.initialSelections(state.signals,count))state.picks.set(s.matchId,s);
   refreshAll();
 }
 async function copyScenario(){
   const picks=[...state.picks.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
   const stats=core.combinationStats(picks);if(!stats)return;
   const lines=['ATLAS — Cenário estatístico experimental','Não é uma recomendação validada. Mapas não confirmados.',''];
   picks.forEach((s,i)=>lines.push((i+1)+'. '+matchTitle(s.game)+' | '+date(s.startsAt)+' | '+s.label+' | '+pct(s.probability)+' | amostra '+s.sample));
   lines.push('','Produto hipotético sob independência: '+pct(stats.independentProbability),
     'Odd de equilíbrio matemática: '+odds(stats.indicativeFairOdd),'Sem odds reais e sem calibração; seleções valem apenas se o mapa for jogado.');
   const text=lines.join('\n');
   try{
     if(!navigator.clipboard?.writeText)throw Error('clipboard');
     await navigator.clipboard.writeText(text);
     $('radar-copy').textContent='Copiado ✓';setTimeout(()=>$('radar-copy').textContent='Copiar cenário para análise',2200);
   }catch(err){const input=el('textarea','');input.value=text;input.style.cssText='position:fixed;left:-9999px;opacity:0';document.body.append(input);input.select();
     const ok=document.execCommand('copy');input.remove();
     $('radar-copy').textContent=ok?'Copiado ✓':'Cópia indisponível';
     setTimeout(()=>$('radar-copy').textContent='Copiar cenário para análise',2500)}
 }
 async function init(){
   try{
     const r=await Promise.all(['data/predictions.json','data/tournaments.json','data/sync-state.json'].map(x=>fetch(x,{cache:'no-store'})));
     if(r.some(x=>!x.ok))throw Error('Dados não encontrados');
     const [forecasts,fixtures,sync]=await Promise.all(r.map(x=>x.json()));
     if(!Array.isArray(forecasts.forecasts)||!Array.isArray(fixtures.matches))throw Error('Arquivos com formato inválido');
     state.matches=fixtures.matches;state.signals=core.assemble(forecasts,fixtures,new Date().toISOString());
     $('radar-count-games').textContent=String(state.matches.length);
     $('radar-count-markets').textContent=String(state.signals.length);
     $('radar-refresh').textContent=date(sync.updatedAt||fixtures.fetchedAt);
     preset(3);
     if(!state.signals.some(s=>s.upcoming))$('radar-combo-help').textContent='Jogos encerrados ou iniciados. Use Validação Cito para resultados.';
   }catch(e){$('radar-ranked-list').textContent='Não foi possível carregar as previsões: '+e.message;
     $('radar-game-grid').textContent='Tente recarregar a página.';
     $('radar-combo-help').textContent='Sem dados para combinações.'}
 }
 for(const id of ['radar-event','radar-market','radar-minimum','radar-quality'])$(id).addEventListener('change',()=>{state.show=9;renderRanking()});
 $('radar-more').addEventListener('click',()=>{state.show+=12;renderRanking()});
 document.querySelectorAll('[data-radar-preset]').forEach(b=>b.addEventListener('click',()=>preset(Number(b.dataset.radarPreset))));
 $('radar-copy').addEventListener('click',copyScenario);
 $('radar-clear').addEventListener('click',()=>{state.picks.clear();state.preset=0;refreshAll()});
 init();
})();
