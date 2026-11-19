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
 function card(m){
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
  article.append(main,right);
  return article;
 }
 async function init(){
  try{
   const [r,p]=await Promise.all([
    fetch('data/nov19-forecasts.json',{cache:'no-store'}),
    fetch('data/prospective-validation.json',{cache:'no-store'})
   ]);
   if(!r.ok||!p.ok)throw Error('Dados de análise indisponíveis');
   const [data,validation]=await Promise.all([r.json(),p.json()]);
   const root=$('nd-games');root.textContent='';
   if(!data?.metrics?.length)throw Error('Sem partidas identificadas');
   for(const m of data.metrics)root.append(card(m));
   $('nd-game-count').textContent=data.metrics.length+' confrontos';
   $('nd-frozen').textContent='Probabilidades congeladas em '+when(data.frozenAt)+' (Brasília). Odds dos prints de 18/11; não são cotações atuais.';
   $('nd-validation').textContent='V1 × V2: '+(validation.resolved||0)+' partidas futuras avaliadas até agora.';
  }catch(e){$('nd-games').textContent='Não foi possível carregar as previsões: '+e.message;}
 }
 init();
})();
