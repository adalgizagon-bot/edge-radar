'use strict';
/* Major forecasts display: frozen pre-veto scenarios, distinct from dynamic ATLAS model. */
(function(){
 const h=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
 const fmt=x=>Number.isFinite(x)?(100*x).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
 const get=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(url+' '+r.status);return r.json()};
 const roundOdds=x=>Number.isFinite(x)?x.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
 function showForecasts(host,data){
  host.replaceChildren();
  const note=h('p','atlas-preview-note','Seis MD3 de 26/11 • cenário anterior aos vetos, NÃO é a previsão dinâmica calibrada. Odds Betaro fotografadas em 25/11; selecione um confronto para ajustar mapas no radar.');
  host.append(note);
  const grid=h('div','atlas-preview-grid');host.append(grid);
  for(const match of data.matches){
   const item=h('article','atlas-preview-card');
   const title=h('div','atlas-preview-title');title.append(h('strong','',match.a+' × '+match.b),h('small','',match.time+' · Brasília'));
   item.append(title);
   const projection=match.scenario;
   const favorite=projection.aWin>=projection.bWin?match.a:match.b;
   item.append(h('p','atlas-preview-winner','Cenário da série: '+favorite+' · '+fmt(Math.max(projection.aWin,projection.bWin))));
   const odds=h('div','atlas-preview-odds','Betaro: '+match.a+' '+roundOdds(match.odds[0])+' | '+match.b+' '+roundOdds(match.odds[1]));item.append(odds);
   const details=h('details','atlas-preview-details');
   details.append(h('summary','','Mapas e placares possíveis'));
   const table=h('table','atlas-preview-table');
   const head=h('tr');for(const label of ['Mapa hipotético',match.a,match.b])head.append(h('th','',label));table.append(head);
   for(const [name,p] of match.maps){
    const row=h('tr');row.append(h('td','',name),h('td','',fmt(p)),h('td','',fmt(1-p)));table.append(row);
   }
   details.append(table);
   const scores=projection.scores;
   details.append(h('p','atlas-preview-note','Placar: '+match.a+' 2–0 '+fmt(scores.a20)+' · 2–1 '+fmt(scores.a21)+' | '+match.b+' 2–0 '+fmt(scores.b20)+' · 2–1 '+fmt(scores.b21)));
   item.append(details);
   const btn=h('button','atlas-preview-open','Abrir no radar e selecionar mapas');
   btn.type='button';btn.addEventListener('click',()=>{
    document.querySelector('[data-view="radar"]')?.click();
    const cards=[...document.querySelectorAll('#game-list .game-card')];
    const target=cards.find(c=>c.textContent.includes(match.a+' × '+match.b));
    if(target){target.click();document.getElementById('detail-panel')?.scrollIntoView({behavior:'smooth',block:'start'})}
    else alert('Partida fora da janela do radar. Consulte o histórico ou atualize os dados.');
   });item.append(btn);grid.append(item);
  }
 }
 function showAudit(host,data){
  host.replaceChildren();
  const info=h('div','atlas-audit-day2');
  info.append(h('h3','','25/11 — auditoria das 8 partidas'));
  info.append(h('p','atlas-preview-note','8 resultados registrados (4 MD1 e 4 MD3). Apenas 4 previsões MD3 foram recuperadas: 2 acertos e 2 erros. As 4 MD1 não têm previsão original verificada e não entram na taxa.'));
  const table=h('table','atlas-preview-table');
  const header=h('tr');for(const label of ['Jogo','Resultado','Previsão anterior','Avaliação'])header.append(h('th','',label));table.append(header);
  for(const row of data.games){
   const tr=h('tr'),previous=row.frozenModelPick,answer=previous?(row.modelCorrect?'Acertou':'Errou'):'Sem registro';
   tr.append(h('td','',row.teamA+' × '+row.teamB),h('td','',row.winner+' ('+row.score+')'),
    h('td','',previous?previous.winner+' '+fmt(previous.probability):'Não recuperada'),
    h('td',row.modelCorrect===true?'atlas-day1-hit':row.modelCorrect===false?'atlas-day1-miss':'',answer));
   table.append(tr);
  }
  const wrap=h('div','hscroll atlas-preview-scroll');wrap.append(table);info.append(wrap);
  info.append(h('p','atlas-preview-note','As odds e os resultados não substituem os palpites originais. A previsão da série não deve ser reconstruída após conhecer o vencedor.'));
  host.append(info);
 }
 async function run(){
  const forecastHost=document.getElementById('major-day3-preview');
  const auditHost=document.getElementById('major-day2-audit');
  try{const [forecast,audit]=await Promise.all([get('data/major-day3-scenarios-2026-11-26.json'),get('data/major-day2-audit.json')]);
   if(forecastHost)showForecasts(forecastHost,forecast);
   if(auditHost)showAudit(auditHost,audit);
  }catch(e){if(forecastHost)forecastHost.textContent='Não foi possível carregar as previsões: '+e.message}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
