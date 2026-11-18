'use strict';
(function(){
 const $=id=>document.getElementById(id);
 const el=(tag,cls='',value)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(value!==undefined)x.textContent=String(value);return x};
 const pct=v=>Number.isFinite(v)?(v*100).toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+'%':'—';
 const n=v=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:3,minimumFractionDigits:3}):'—';
 const pp=v=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:1,minimumFractionDigits:1})+' p.p.':'—';
 const marketNames={map_a:'Vencedor do mapa',rounds_over_21_5:'Mais de 21,5 rounds',
  handicap_a_minus_2_5:'Handicap −2,5 rounds',kills_over_15_5:'Mais de 15,5 kills'};
 const display=(id,value)=>{const t=$(id);if(t)t.textContent=value};
 function summaryPanel(review){
  display('audit-finished',review.completed+' / '+(review.completed+review.unmodeled.length+review.pending));
  display('audit-hit',review.winner.correctModel+' / '+review.winner.n);
  display('audit-model-brier',n(review.winner.brierModel));
  display('audit-market-brier',n(review.winner.brierMarket));
  display('audit-v2-brier',n(review.challenger.brier));
  display('audit-v2-wins',review.challenger.correct+' / '+review.challenger.n);
  display('audit-last-checked',new Date(review.evaluatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}));
 }
 function rows(review){
  const table=$('audit-match-body');table.textContent='';
  if(!review.games.length){const tr=el('tr','');const cell=el('td','','Nenhum confronto concluído');cell.colSpan=7;tr.append(cell);table.append(tr);return}
  for(const row of review.games){
   const tr=el('tr','');
   tr.append(el('td','',row.teams.join(' × ')),el('td','',row.actualScore));
   tr.append(el('td',row.modelCorrect?'audit-ok':'audit-bad',row.modelFav+(row.modelCorrect?' ✓':' ✕')));
   tr.append(el('td','audit-prob',pct(row.modelP_A)),el('td','audit-prob',pct(row.marketP_A)));
   tr.append(el('td','audit-prob',pp(row.absMarketGapPP)),el('td','audit-prob',row.minMapHistory+' jogos mín. / mapa'));
   table.append(tr);
  }
 }
 function markets(review){
  const grid=$('audit-market-stats');grid.textContent='';
  for(const v of review.mapMarkets){
   const item=el('div','audit-metric');item.append(el('span','',marketNames[v.kind]||v.kind),
    el('b',v.worseThanNeutral?'audit-bad':'',pct(v.accuracy)),
    el('small','',v.n+' resolvidas · Brier '+n(v.brier)));
   grid.append(item);
  }
 }
 function observations(review){
  const root=$('audit-errors');root.textContent='';
  const high=review.games.filter(x=>x.absMarketGapPP>=20).sort((a,b)=>b.absMarketGapPP-a.absMarketGapPP);
  for(const g of high){
   const box=el('div','audit-tile');box.append(el('h3','',g.teams.join(' × ')));
   box.append(el('b','',pp(g.absMarketGapPP)),el('p','',
    'Distância entre probabilidade do modelo e probabilidade BR365 sem margem. Favorito do ATLAS: '+g.modelFav+'. Vencedor: '+g.winner+'.'));
   root.append(box);
  }
  if(!high.length)root.append(el('p','audit-timestamp','Sem discrepâncias superiores a 20 pontos percentuais nesta fotografia.'));
 }
 async function init(){
  try{
   const r=await fetch('data/audit-2026-11-18.json',{cache:'no-store'});
   if(!r.ok)throw Error('Arquivo de auditoria indisponível');
   const review=await r.json();
   summaryPanel(review);rows(review);markets(review);observations(review);
   display('audit-pending-note',review.unmodeled.length?
    'Uma partida não recebeu previsão BO3 por falta de três mapas comparáveis. Somente placares confirmados foram contabilizados.':
    'Todas as previsões elegíveis possuem conferência de resultados.');
   display('audit-posthoc-disclaimer','O protótipo V2 foi criado DEPOIS dos resultados: '+review.challenger.correct+
    '/'+review.challenger.n+' favoritos corretos e Brier '+n(review.challenger.brier)+
    '. Isso é apenas uma comparação retrospectiva, NÃO demonstra que melhorará previsões futuras.');
  }catch(e){display('audit-pending-note','Falha ao carregar auditoria: '+e.message)}
 }
 init();
})();
