'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const node=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
 const fmt=p=>Number.isFinite(p)?(100*p).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%':'—';
 const odd=p=>Number.isFinite(p)?p.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 const when=s=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(s));
 function teamBox(t,history,bookOdd){
  const box=node('div','nd-team-box');
  box.append(node('b','',t.name),node('span','','Ranking #'+history.rank+' · '+history.maps90+' mapas em 90 dias'),
    node('span','',history.form.wins+' vitórias em '+history.form.last15+' séries recentes · '+history.form.winsVsTop50+'/'+history.form.vsTop50+' contra top 50'),
    node('strong','','BR365 '+odd(bookOdd)));
  return box;
 }
 function line(name,a,b,cls){
  const r=node('div','nd-market-line'),label=node('span','',name),
  left=node('span','pct '+(cls||''),fmt(a)),right=node('span','pct '+(cls||''),fmt(b));
  r.append(label,left,right);return r;
 }
 function reason(m){
  const floor=m.v1.sampleFloor,delta=Math.abs(m.marketGapPP),v1fav=m.v1.pA>=.5,v2fav=m.v2.pA>=.5;
  if(v1fav!==v2fav)return 'Os modelos discordam sobre o favorito. É um sinal para investigar a qualidade dos dados, não para apostar.';
  if(delta>=10)return 'Há uma divergência de '+delta.toLocaleString('pt-BR',{maximumFractionDigits:1})+' p.p. entre a V2 e a casa. Como a V2 não está validada e o histórico é limitado, isso não comprova vantagem.';
  if(delta<3)return 'A V2 está próxima da probabilidade da BR365 sem margem. Não há diferença relevante demonstrada.';
  if(floor<8)return 'A diferença entre V2 e mercado existe, mas a amostra mínima por mapa é pequena. A conclusão permanece incerta.';
  return 'Diferença observada entre o modelo e o mercado. Ainda é necessário validar o modelo prospectivamente.';
 }

 const grouped={winner:'Vencedor da série',map_handicap:'Handicap de mapas',correct_score:'Placar exato',total_maps:'Total de mapas'};
 function marketDetails(m,quotes){
  const wrap=node('details','nd-market-details');
  const head=node('summary','','Consultar todos os mercados, handicap e placar');
  wrap.append(head);
  if(!quotes){wrap.append(node('p','nd-market-empty','Não foram recebidos preços complementares para este confronto.'));return wrap;}
  wrap.append(node('p','nd-table-desc',
   'Odds de screenshots da BR365 (não ao vivo). V1/V2: probabilidades experimentais congeladas antes da partida. A diferença V2–mercado não é vantagem validada.'));
  const box=node('div','nd-market-scroll'),table=node('table','nd-market-table');
  const thead=node('thead',''),titles=node('tr','');
  for(const title of ['Seleção','Odd','Mercado sem margem','ATLAS V1','ATLAS V2','Diferença V2'])titles.append(node('th','',title));
  thead.append(titles);table.append(thead);
  const tbody=node('tbody','');
  let last=null;
  for(const row of quotes.markets){
   if(row.family!==last){
    const grp=node('tr','nd-group-head'),title=node('td','',grouped[row.family]||row.family);
    title.colSpan=6;grp.append(title);tbody.append(grp);last=row.family;
   }
   const tr=node('tr','');
   tr.append(node('td','',row.label),
    node('td','nd-num',row.odd.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})),
    node('td','nd-num',fmt(row.impliedNoVig)),node('td','nd-num',fmt(row.v1P)),node('td','nd-num',fmt(row.v2P)),
    node('td','nd-num '+(Math.abs(row.v2DifferencePP)>=10?'nd-large-gap':''),
      (row.v2DifferencePP>0?'+':'')+row.v2DifferencePP.toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+' p.p.'));
   tbody.append(tr);
  }
  table.append(tbody);box.append(table);wrap.append(box);
  const splits=(quotes.pricingConsistency||[]).filter(x=>x.relativeDifferencePercent>=5);
  if(splits.length){
   const warn=node('div','nd-price-warning');
   for(const issue of splits){
    const msg=node('p','',
     'Preços diferentes para um possível mesmo resultado ('+issue.outcome+'): placar exato '+
     issue.correctScoreOdd.toLocaleString('pt-BR',{minimumFractionDigits:2})+
     ' × handicap de mapas '+issue.mapHandicapOdd.toLocaleString('pt-BR',{minimumFractionDigits:2})+
     '. Diferença de '+issue.relativeDifferencePercent.toLocaleString('pt-BR',{maximumFractionDigits:1})+
     '%. Conferir regras de liquidação e disponibilidade; não representa arbitragem confirmada.');
    warn.append(msg);
   }
   wrap.append(warn);
  }
  const rounds=node('details','nd-round-markets'),rh=node('summary','','Handicap de rodadas: odds capturadas, ainda sem modelo');
  rounds.append(rh);
  const explanation=node('p','nd-table-desc','Ainda não confirmamos se as linhas se aplicam ao saldo de rodadas da série completa ou a outra regra de liquidação. Não usamos probabilidades de vitória por mapa para estimar handicap de rodadas.');
  rounds.append(explanation);
  const group=node('div','nd-round-grid');
  for(const r of quotes.unmodeledRoundHandicaps||[]){
   const item=node('div','nd-round-line');
   item.append(node('span','',r.label),node('b','',r.odd.toLocaleString('pt-BR',{minimumFractionDigits:2})));
   group.append(item);
  }
  rounds.append(group);wrap.append(rounds);
  return wrap;
 }

 function card(m,quotes){
  const article=node('article','nd-game');
  const main=node('div',''),top=node('div','nd-game-top'),status=node('span','nd-status');
  const started=Date.now()>=Date.parse(m.scheduledAt);
  status.textContent=started?'Pré-jogo encerrado':'Pré-jogo congelado';
  if(started)status.classList.add('closed');
  top.append(node('span','tag','Stake Ranked Episode 6'),node('span','',when(m.scheduledAt)+' BRT'),status);
  main.append(top,node('h3','',m.teamA.name+' × '+m.teamB.name));
  const pair=node('div','nd-team-pair');
  pair.append(teamBox(m.teamA,m.history.a,m.odds.a),teamBox(m.teamB,m.history.b,m.odds.b));
  main.append(pair);
  const insight=node('p','nd-game-summary');
  insight.append(node('b','','Leitura estatística: '),document.createTextNode(reason(m)));
  main.append(insight);
  const right=node('div','nd-game-table');
  right.append(node('h4','','Probabilidade de vencer a série BO3'));
  const heads=node('div','heading');
  heads.append(node('span','','Referência'),node('span','',m.teamA.name),node('span','',m.teamB.name));
  right.append(heads,line('BR365 sem margem',m.odds.noVigA,m.odds.noVigB,'market'),
    line('ATLAS V1',m.v1.pA,m.v1.pB),line('ATLAS V2*',m.v2.pA,m.v2.pB));
  right.append(node('div','nd-data-foot',
   'Mapas elegíveis: '+m.v1.eligibleMaps+' · sequências teóricas: '+m.v1.orderedTriplets+
   ' · amostra mínima por mapa: '+m.v1.sampleFloor+
   '. Veto pendente; probabilidades não calibradas. *V2 em teste fora da amostra.'));
  article.append(main,right,marketDetails(m,quotes));
  return article;
 }
 async function init(){
  try{
   const [r,p,q]=await Promise.all([
    fetch('data/nov19-forecasts.json',{cache:'no-store'}),
    fetch('data/prospective-validation.json',{cache:'no-store'}),
    fetch('data/nov19-br365-all-markets.json',{cache:'no-store'})
   ]);
   if(!r.ok||!p.ok||!q.ok)throw Error('Dados de análise ou odds indisponíveis');
   const [data,validation,prices]=await Promise.all([r.json(),p.json(),q.json()]);
   const quotesByMatch=new Map((prices.matches||[]).map(x=>[x.matchId,x]));
   const root=$('nd-games');root.textContent='';
   if(!data?.metrics?.length)throw Error('Sem partidas identificadas');
   for(const m of data.metrics)root.append(card(m,quotesByMatch.get(m.id)));
   $('nd-game-count').textContent=data.metrics.length+' confrontos';
   $('nd-resolved-count').textContent=String(validation.resolved||0);
   $('nd-frozen').textContent='Probabilidades congeladas em '+when(data.frozenAt)+' (Brasília). Odds dos prints de 18/11; não são cotações atuais.';
   $('nd-validation').textContent='V1 × V2: '+(validation.resolved||0)+' partidas futuras avaliadas até agora.';
  }catch(e){$('nd-games').textContent='Não foi possível carregar as previsões: '+e.message;}
 }
 init();
})();
