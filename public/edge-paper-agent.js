/* Read-only A/B paper dashboard: no wallet connection or trading endpoints. */
(function(root){
'use strict';
const API_DEFAULT='https://edge-radar-cloud.adalgizagon.workers.dev';
const $=id=>document.getElementById(id);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const usd=n=>Number.isFinite(Number(n))&&n!==null?'US$ '+Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const pct=n=>Number.isFinite(Number(n))&&n!==null?(Number(n)>=0?'+':'')+Number(n).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
const date=ms=>Number.isFinite(Number(ms))?new Date(Number(ms)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';
const strategy=x=>x==='ai'?'Agente IA':x==='scalp'?'Edge Scalp Rápido':'Regras tradicionais';
let payload=null,last=0,loading=false,error='';
function api(){try{const stored=localStorage.getItem('edgeradar.cloud.api.v1')||API_DEFAULT;const u=new URL(stored);return u.protocol==='https:'?u.origin:API_DEFAULT}catch{return API_DEFAULT}}
function cards(){
 const accounts=payload?.accounts||[],positions=payload?.positions||[],performance=payload?.performance||[];
 const active=payload?.aiConfigured?['baseline','scalp','ai']:['baseline','scalp'];
 return active.map(s=>{
  const a=accounts.find(x=>x.strategy===s),open=positions.filter(x=>x.strategy===s);
  const pf=performance.find(x=>x.strategy===s)||{},sold=Number(pf.sells)||0,wins=Number(pf.wins)||0;
  const realized=Number(pf.realized_pnl)||0,stress=pf.stress_pnl===undefined?null:Number(pf.stress_pnl);
  const invested=open.reduce((v,x)=>v+(Number(x.invested_usd)||0),0);
  const target=payload?.profiles?.[s];
  const title=s==='scalp'?'SCALP · SAÍDA RÁPIDA':s==='baseline'?'REFERÊNCIA · HISTÓRICO PRESERVADO':'IA OPCIONAL';
  const stat=(label,value,cls='')=>'<div><label>'+label+'</label><strong class="'+cls+'">'+value+'</strong></div>';
  const info=target?'Alvo +'+target.targetPct+'% · stop '+target.stopPct+'% · até '+target.holdMinutes+' min':
   'Agente opcional (sem custo enquanto desligado)';
  const factor=Number(pf.total_losses)>0?(Number(pf.total_gains)/Number(pf.total_losses)):null;
  const openLabel=a?.prices_fresh===false?'Sem cotação recente':'Estimativa, não executável';
  return '<article class="agent-card '+(s==='scalp'?'scalp':'')+'"><div class="agent-card-header"><div><small>'+
   title+'</small><h3>'+strategy(s)+'</h3><p>'+info+'</p></div><span>'+openLabel+'</span></div>'+
   '<div class="agent-metrics">'+
   stat('Saldo disponível',usd(a?.cash_usd??null))+
   stat('Patrimônio estimado*',usd(a?.equity_usd??null))+
   stat('Lucro fechado · 1%/lado',a?usd(realized):'—',realized>=0?'positive':'negative')+
   stat('Resultado com 2,5%/lado*',sold?usd(stress):'—',stress>=0?'positive':'negative')+
   stat('Posições abertas',String(open.length))+
   stat('Capital em posições',usd(invested))+
   stat('Operações encerradas',String(sold))+
   stat('Taxa de acerto*',sold?pct(100*wins/sold):'—')+
   stat('Pior recuo acumulado*',sold?usd(pf.max_drawdown_usd):'—')+
   stat('Fator de lucro*',sold&&factor!==null?factor.toLocaleString('pt-BR',{maximumFractionDigits:2}):'—')+
   '</div><div class="agent-card-bottom">Resultados encerrados desde o início da comparação. Valores observados, não ordens executadas.</div></article>';
 }).join('');
}
function comparisonHTML(){
 const since=payload?.comparisonSince?date(payload.comparisonSince):'Aguardando início';
 const fees=payload?.fees||{};
 return '<div class="agent-comparison-head"><div><strong>Mesma janela de comparação</strong><span>Início: '+since+'</span></div>'+
 '<div><strong>Custo padrão</strong><span>'+(fees.baseEachSidePct??1)+'% em cada lado</span></div>'+
 '<div><strong>Teste de estresse</strong><span>'+(fees.stressEachSidePct??2.5)+'% em cada lado</span></div></div>'+
 '<p>Um alvo de +5% no preço pode gerar lucro quase nulo sob custos elevados. Sem dados novos, o valor das posições não é inventado.</p>';
}
function classFor(trade){
 const evidence=payload?.evidence||[];
 const match=trade.action==='buy'?evidence.find(e=>e.buy_id===trade.id):
  evidence.find(e=>e.strategy===trade.strategy&&e.mint===trade.mint&&Number(e.created_at)<=Number(trade.created_at));
 return match?.tier==='exploratory'?'Exploratória (não validada)':match?.tier==='audited'?'Auditada p/ estudo':'Sem classificação';
}
function diagnosticsHTML(){
 const d=payload?.diagnostics;
 if(!d)return '<p class="cloud-empty">Aguardando primeira varredura de diagnóstico no coletor.</p>';
 const cells=[['Avaliadas',d.candidates],['Aptas p/ simulação',d.eligible],['Exploratórias',d.exploratory],
  ['Auditadas p/ estudo',d.audited],['Sem preço',d.without_price],['Risco crítico',d.critical],
  ['Pouca liquidez',d.low_liquidity],['Atividade fraca',d.weak_activity],
  ['Pool muito novo',d.too_new],['Saída desfavorável',d.bad_exit]];
 return '<div class="agent-diagnostics-heading"><strong>Última triagem automática</strong><span>'+date(d.checked_at)+'</span></div>'+
 '<div class="agent-diagnostic-grid">'+cells.map(([k,v])=>'<div><span>'+safe(k)+'</span><strong>'+Number(v||0)+'</strong></div>').join('')+'</div>'+
 '<p>Contagem por rodada, não de moedas únicas. O laboratório pode testar oportunidades não validadas, mas nunca autoriza compras reais.</p>';
}
function tradesHTML(){
 const rows=(payload?.trades||[]).slice(0,35);
 if(!rows.length)return '<p class="cloud-empty">Nenhuma negociação simulada registrada. O sistema não inventa operações.</p>';
 return '<div class="agent-tablewrap"><table class="paper-table"><thead><tr><th>Horário</th><th>Estratégia</th><th>Moeda</th><th>Movimento</th><th>Classe</th><th>Valor líquido</th><th>Resultado</th><th>Motivo</th></tr></thead><tbody>'+rows.map(t=>
  '<tr><td>'+date(t.created_at)+'</td><td>'+strategy(t.strategy)+'</td><td>'+safe(t.symbol||String(t.mint).slice(0,8))+'</td><td>'+(t.action==='buy'?'Compra':'Venda')+'</td><td>'+safe(classFor(t))+'</td><td>'+usd(Math.abs(Number(t.cash_usd)||0))+'</td>'+
  '<td class="'+(Number(t.pnl_usd)>=0?'positive':'negative')+'">'+(t.action==='sell'?usd(t.pnl_usd):'—')+'</td><td>'+safe(t.reason)+'</td></tr>').join('')+'</tbody></table></div>';
}
function decisionsHTML(){
 const rows=(payload?.decisions||[]).slice(0,30);
 if(!rows.length)return '<p class="cloud-empty">Aguardando sinais elegíveis para a simulação.</p>';
 return '<div class="agent-tablewrap"><table class="paper-table"><thead><tr><th>Horário</th><th>Estratégia</th><th>Token</th><th>Decisão</th><th>Justificativa</th></tr></thead><tbody>'+rows.map(d=>
  '<tr><td>'+date(d.created_at)+'</td><td>'+strategy(d.strategy)+'</td><td>'+safe(String(d.mint).slice(0,8))+'…</td><td>'+safe(d.decision)+'</td><td>'+safe(d.reason)+'</td></tr>').join('')+'</tbody></table></div>';
}
function redraw(){
 const status=$('agentStatus'),metrics=$('agentAccounts'),open=$('agentPositions'),history=$('agentTrades'),decisions=$('agentDecisions'),usage=$('agentUsage'),diag=$('agentDiagnostics'),comp=$('agentComparisonInfo');
 if(!status)return;
 if(error){status.textContent='Falha ao consultar a simulação: '+error;return;}
 if(!payload){status.textContent=loading?'Consultando o Worker…':'Abra a aba para carregar o estado da simulação.';return;}
 if(!payload.enabled){
  status.textContent='Teste ainda não habilitado no servidor. Configure PAPER_EXPERIMENT_ENABLED=true na Cloudflare e publique a migração D1.';
  if(metrics)metrics.innerHTML='';if(open)open.innerHTML='';if(history)history.innerHTML='';if(decisions)decisions.innerHTML='';if(diag)diag.innerHTML='';if(comp)comp.innerHTML='';
  if(usage)usage.textContent='Nenhuma chamada de IA.';
  return;
 }
 status.textContent='Comparação fictícia ativa: regras tradicionais × Edge Scalp · '+(payload.aiConfigured?'IA opcional ativa':'100% grátis: IA desativada')+' · Consulta '+date(payload.checkedAt);
 if(metrics)metrics.innerHTML=cards();
 if(comp)comp.innerHTML=comparisonHTML();
 if(diag)diag.innerHTML=diagnosticsHTML();
 if(open)open.innerHTML=(payload.positions||[]).length?'<div class="agent-tablewrap"><table class="paper-table"><thead><tr><th>Estratégia</th><th>Moeda</th><th>Classificação</th><th>Investido</th><th>Preço de entrada</th><th>Aberta em</th></tr></thead><tbody>'+payload.positions.map(p=>
  '<tr><td>'+strategy(p.strategy)+'</td><td>'+safe(p.symbol||String(p.mint).slice(0,8))+'</td><td>'+safe(classFor({strategy:p.strategy,mint:p.mint,action:'sell',created_at:p.opened_at}))+'</td><td>'+usd(p.invested_usd)+'</td><td>'+Number(p.entry_price).toPrecision(5)+'</td><td>'+date(p.opened_at)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="cloud-empty">Nenhuma posição aberta.</p>';
 if(history)history.innerHTML=tradesHTML();
 if(decisions)decisions.innerHTML=decisionsHTML();
 if(usage){const u=payload.usage;usage.textContent=u?
  'Hoje: '+u.calls+'/'+(payload.aiCallLimit||480)+' chamadas · '+u.input_tokens+' tokens de entrada · '+u.output_tokens+' tokens de saída · '+u.last_status:
  'Ainda não há consumo registrado hoje.';}
}
async function refresh(){
 if(loading)return;
 loading=true;
 const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),12000);
 try{const response=await fetch(api()+'/api/paper',{cache:'no-store',signal:ctrl.signal});
  if(!response.ok)throw Error('HTTP '+response.status);
  const next=await response.json();if(typeof next.enabled!=='boolean')throw Error('Resposta inválida');
  payload=next;last=Date.now();error='';
 }catch(e){error=String(e?.message||e).slice(0,110);}
 finally{clearTimeout(timeout);loading=false;redraw();}
}
function show(){if(!payload||Date.now()-last>18000)refresh();else redraw();}
function init(){const btn=$('agentRefresh');if(btn)btn.onclick=refresh;redraw();
 setInterval(()=>{if($('agentSection')?.hidden===false)refresh();},30000);
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();}
root.EdgePaperAgent={redraw:show,refresh};
})(typeof window!=='undefined'?window:globalThis);
