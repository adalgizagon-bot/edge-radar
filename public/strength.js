'use strict';
(function(){
 const core=window.AtlasStrengthCore;
 if(!core)return;
 const $=id=>document.getElementById(id);
 const n=(tag,cls='',value)=>{const a=document.createElement(tag);if(cls)a.className=cls;if(value!==undefined)a.textContent=String(value);return a};
 const fmt=(v,d=1)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const p=(v)=>typeof v==='number'&&Number.isFinite(v)?fmt(100*v,1)+'%':'—';
 const days=s=>s?new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(s)):'—';
 const state={gameData:null,form:null,long:null,rankings:null,short:null};
 function metric(label,value,help){
  const card=n('div','strength-metric');
  card.append(n('label','',label),n('b','',value));
  if(help)card.append(n('small','',help));return card;
 }
 function teamCard(team){
   const card=n('article','strength-team-card'),top=n('div','strength-team-top');
   top.append(n('h3','',team.name),n('span','strength-rank',team.rank?'#'+team.rank+' no ranking':'Sem ranking'));
   card.append(top);
   const total=team.form;
   const record=n('div','strength-main-metric');
   record.append(n('strong','',total.wins+'V – '+total.losses+'D'),n('span','','Vitórias: '+p(total.winRate)+' · últimas '+total.n+' séries'));
   card.append(record);
   const grid=n('div','strength-metric-grid');
   grid.append(metric('Ranking mediano dos rivais',total.medianOpponentRank===null?'—':'#'+fmt(total.medianOpponentRank,0),
     total.rankedOpponents+' adversários com ranking'),
     metric('Contra equipes top 50',total.vsTop50.games?total.vsTop50.wins+' / '+total.vsTop50.games:'—','Vitórias / confrontos'),
     metric('Diferença média de rounds por mapa',(total.avgRoundDiff===null?'—':(total.avgRoundDiff>0?'+':'')+fmt(total.avgRoundDiff)),total.mapCount+' mapas disputados'),
     metric('Acima/abaixo do esperado por ranking',total.expectedSurplusPP===null?'—':(total.expectedSurplusPP>0?'+':'')+fmt(total.expectedSurplusPP)+' p.p.',
       'Heurística, não probabilidade')
   );
   card.append(grid);
   const bar=n('div','strength-ranking-distribution');
   const tiers=[['Top 20','elite'],['21–50','high'],['51–100','medium'],['101+','outside'],['Sem ranking','unknown']];
   for(const [title,style]of tiers){
     const segment=n('span',style);segment.title=title+': '+total.tierCounts[title]+' jogos';
     segment.style.width=(total.n?100*total.tierCounts[title]/total.n:0)+'%';
     bar.append(segment);
   }
   const legend=n('div','strength-ranking-legend');
   for(const [label]of tiers)legend.append(n('span','',label+': '+total.tierCounts[label]));
   card.append(bar,legend);return card;
 }
 function historyCard(t){
   const root=n('article','strength-history-card');
   root.append(n('h3','',t.name));
   const head=n('div','strength-windows');
   for(const [label,count,rate]of [
     ['90 dias',t.history.maps90,t.history.winPercent90],
     ['365 dias',t.history.maps365,t.history.winPercent365]
   ]){
     const item=n('div','strength-window');
     item.append(n('label','',label),n('strong','',count===null?'—':count),n('span','','mapas • '+(rate===null?'—':fmt(rate)+'%')+' vitórias'));
     head.append(item);
   }
   root.append(head);
   const table=n('table','strength-maps'),thead=n('thead',''),tr=n('tr','');
   for(const label of ['Mapa','90d (jogos)','90d vit.','365d (jogos)','365d vit.'])tr.append(n('th','',label));
   thead.append(tr);table.append(thead);
   const tbody=n('tbody','');
   for(const map of t.mapStats.slice(0,9)){
     const row=n('tr','');
     const first=n('td','',map.name);if(map.inCurrentPool===false)first.title='Fora do map pool atual';
     row.append(first);
     for(const [value,isPct]of [
       [map.short.played,false],[map.short.winPercent,true],[map.long.played,false],[map.long.winPercent,true]
     ]){
       const cell=n('td',value===null?'strength-muted-cell':'',value===null?'—':isPct?fmt(value)+'%':String(value));
       row.append(cell);
     }
     tbody.append(row);
   }
   table.append(tbody);root.append(table);
   root.append(n('p','strength-table-note','Os 90 dias já fazem parte dos 365 dias. Mapas antigos podem ter elencos e versões diferentes. A cobertura anual não é um aumento de observações independentes.'));
   return root;
 }
 function formRows(t){
   const wrap=n('article','strength-opponent-col');
   wrap.append(n('h3','',t.name+' · '+t.form.n+' partidas'));
   if(!t.recent.length){wrap.append(n('p','strength-muted','Sem partidas recentes com placar confirmado.'));return wrap}
   for(const game of t.recent){
     const line=n('div','strength-opponent-row');
     const outcome=n('span','strength-opponent-result '+(game.result==='W'?'win':'loss'),game.result==='W'?'V':'D');
     const middle=n('div','strength-opponent-main');
     middle.append(n('strong','',game.opponent?.name||'Adversário não informado'));
     const tier=core.tier(game.opponent?.rank);
     const known=game.opponent?.rank!==null&&game.opponent?.rank!==undefined;
     middle.append(n('small','',days(game.startsAt)+' · '+(game.event||'Competição não identificada')+' · '+(known?'Ranking atual #'+game.opponent.rank+' ('+tier+')':'Ranking indisponível')));
     const maps=game.maps||[];
     const diff=maps.reduce((a,b)=>a+b.ourRounds-b.theirRounds,0);
     const right=n('div','strength-opponent-score');
     right.append(n('b','',game.ourScore+'–'+game.theirScore),
       n('small','',maps.length+' mapa(s) · rounds '+(maps.length?(diff>0?'+':'')+diff:'—')));
     line.append(outcome,middle,right);wrap.append(line);
   }
   return wrap;
 }
 function render(){
   const id=$('strength-game').value;
   const game=state.gameData?.matches?.find(x=>x.id===id);
   if(!game)return;
   const count=Number($('strength-limit').value)||15;
   const result=core.compare(game,state.form,state.short,state.long,state.rankings,count);
   if(!result)return;
   const versus=$('strength-versus'),hist=$('strength-history'),form=$('strength-opponents');
   versus.textContent='';hist.textContent='';form.textContent='';
   for(const t of result.sides){versus.append(teamCard(t));hist.append(historyCard(t));form.append(formRows(t));}
   const [a,b]=result.sides;
   const ranks=[a.form.medianOpponentRank,b.form.medianOpponentRank];
   const diff=ranks.every(x=>x!==null)?Math.abs(ranks[0]-ranks[1]):null;
   const harder=diff===null?null:ranks[0]<ranks[1]?a:ranks[1]<ranks[0]?b:null;
   $('strength-context-note').textContent=harder?
    'Nesta amostra, '+harder.name+' enfrentou adversários com ranking mediano mais forte (menor posição). Diferença entre medianas: '+fmt(diff,0)+' posições. Rankings extraídos da consulta recente, sem representar o ranking histórico de cada jogo.':
    'A força dos adversários é apenas um contexto; rankings ausentes não são tratados como adversários fracos.';
 }
 async function init(){
   try{
     const paths=['data/tournaments.json','data/team-opponents.json','data/team-long-history.json','data/team-rankings.json'];
     const rs=await Promise.all(paths.map(path=>fetch(path,{cache:'no-store'})));
     if(rs.some(r=>!r.ok))throw Error('Não foi possível obter todos os arquivos da Cito');
     const [games,forms,long,rankings]=await Promise.all(rs.map(r=>r.json()));
     if(!Array.isArray(games.matches)||!Array.isArray(forms.teams)||!Array.isArray(long.teams)||!Array.isArray(rankings.ranks))throw Error('Dados incompletos');
     state.gameData=games;state.form=forms;state.long=long;state.rankings=rankings;state.short=games;
     $('strength-team-total').textContent=forms.teams.length;
     $('strength-games-total').textContent=forms.teams.reduce((s,t)=>s+(t.recent?.length||0),0);
     $('strength-updated').textContent='Ranking de '+days(rankings.rankingDate)+' · Dados coletados '+days(forms.fetchedAt);
     const select=$('strength-game');select.textContent='';
     for(const match of games.matches){
       const op=n('option','',match.teamA.name+' × '+match.teamB.name+' · '+match.event);op.value=match.id;select.append(op);
     }
     if(games.matches.length)render();
   }catch(e){
     $('strength-context-note').textContent='Não foi possível carregar análise dos adversários: '+e.message;
     $('strength-versus').textContent='Sem dados disponíveis';
   }
 }
 $('strength-game').addEventListener('change',render);
 $('strength-limit').addEventListener('change',render);
 init();
})();
