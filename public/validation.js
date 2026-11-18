'use strict';
let validationBundle=null;
const vNode=(tag,cls='',value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=String(value);return node};
const vPct=p=>Number.isFinite(p)?(100*p).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
const vWhen=s=>s?new Date(s).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const MARKET_NAMES={map_a:'Vencedor do mapa',rounds_over_21_5:'Total de rounds',handicap_a_minus_2_5:'Handicap de rounds',kills_over_15_5:'Kills de jogadores'};
function showValidationStats(){
 const root=document.getElementById('validation-stats');root.textContent='';
 const {predictions,checks}=validationBundle;
 const categories=[...new Set(predictions.forecasts.map(x=>x.kind))];
 for(const kind of categories){
  const list=predictions.forecasts.filter(x=>x.kind===kind);
  const done=checks.assessed.filter(x=>x.kind===kind);
  const source=checks.byMarket?.find(x=>x.kind===kind);
  const card=vNode('div','validation-stat-card');
  card.append(vNode('strong','',MARKET_NAMES[kind]||kind));
  card.append(vNode('span','large-value',source?.brier==null?'—':Number(source.brier).toFixed(3)));
  card.append(vNode('small','','Brier Score • '+done.length+'/'+list.length+' verificadas'));
  card.append(vNode('div','small-stats',done.length?'Taxa de classificação: '+vPct(source?.classificationAccuracy):'Ainda sem resultados; nenhuma conclusão sobre acertos.'));
  root.append(card);
 }
}
function renderValidationTable(){
 if(!validationBundle)return;
 const {predictions,checks}=validationBundle,kind=document.getElementById('validation-filter').value,status=document.getElementById('validation-status').value,
 byId=new Map((checks.assessed||[]).map(x=>[x.id,x]));
 const selected=predictions.forecasts.filter(f=>(kind==='all'||f.kind===kind)&&
   (status==='all'||(status==='resolved'===byId.has(f.id))));
 const root=document.getElementById('validation-table');root.textContent='';
 if(!selected.length){root.append(vNode('p','muted','Nenhuma previsão neste filtro.'));return}
 const table=vNode('table','records');table.innerHTML='<thead><tr><th>Partida</th><th>Mapa</th><th>Mercado</th><th>Probabilidade</th><th>Registro pré-jogo</th><th>Resultado</th></tr></thead><tbody></tbody>';
 for(const f of selected){
  const tr=vNode('tr'),assessment=byId.get(f.id);
  for(const content of [f.teamA+' × '+f.teamB,f.map,f.label,vPct(f.probability),vWhen(f.snapshotAt),
   assessment?(assessment.outcome?'Ocorreu':'Não ocorreu')+' · Brier '+assessment.brier:'Pendente']){
    tr.append(vNode('td','',content))}
  table.querySelector('tbody').append(tr);
 }
 root.append(table);
 root.append(vNode('p','muted','Exibindo '+selected.length+' previsões filtradas.'));
}
async function startValidation(){
 try{
 const urls=['data/predictions.json','data/validation.json','data/sync-state.json'];
 const res=await Promise.all(urls.map(path=>fetch(path,{cache:'no-store'})));
 if(res.some(r=>!r.ok))throw Error('Dados de validação indisponíveis');
 const [predictions,checks,sync]=await Promise.all(res.map(r=>r.json()));
 if(!Array.isArray(predictions.forecasts)||!Array.isArray(checks.assessed))throw Error('Arquivo de validação incompleto');
 validationBundle={predictions,checks,sync};
 document.getElementById('validation-total').textContent=predictions.forecasts.length;
 document.getElementById('validation-resolved').textContent=checks.resolved||0;
 document.getElementById('validation-market-count').textContent=new Set(predictions.forecasts.map(x=>x.kind)).size;
 const markets=new Set(predictions.forecasts.map(x=>x.kind)).size;
 const homeTotal=document.getElementById('home-cito-total');
 const homeResolved=document.getElementById('home-cito-resolved');
 const homeMarkets=document.getElementById('home-cito-markets');
 const homeBrier=document.getElementById('home-cito-brier');
 if(homeTotal)homeTotal.textContent=String(predictions.forecasts.length);
 if(homeResolved)homeResolved.textContent=String(checks.resolved||0);
 if(homeMarkets)homeMarkets.textContent=String(markets);
 if(homeBrier){const verified=checks.assessed||[];const score=verified.length?verified.reduce((a,r)=>a+Number(r.brier||0),0)/verified.length:null;homeBrier.textContent=score===null?'—':score.toFixed(3)}
 document.getElementById('validation-last').textContent=vWhen(checks.computedAt||predictions.generatedAt);
 document.getElementById('validation-model').textContent=predictions.model||'Modelo não informado';
 document.getElementById('validation-source-note').textContent=
  'Previsões de CS2 congeladas a partir da fotografia histórica da Cito. Os 108 registros iniciais foram produzidos antes das partidas de 18/11/2026. Mercados dependentes de jogador entram quando há KPR histórico. Não houve comparação com odds reais.';
 const state=sync.lastRun||{};
 document.getElementById('sync-status-detail').textContent=state.status==='pending_secret'?
 'A atualização automática está programada, mas falta configurar CITO_API_KEY nos Secrets do GitHub. As consultas estão usando somente fotografias já capturadas.':
 'Última execução: '+vWhen(sync.updatedAt)+' · estado '+(state.status||'não informado')+
 ' · chamadas Cito '+(state.requests??0)+'.'+(state.warnings?.length?' Avisos: '+state.warnings.join(' | '):'');
 showValidationStats();renderValidationTable();
 }catch(e){document.getElementById('validation-source-note').textContent='Falha ao ler dados: '+e.message}
}
document.getElementById('validation-filter').addEventListener('change',renderValidationTable);
document.getElementById('validation-status').addEventListener('change',renderValidationTable);
startValidation();
