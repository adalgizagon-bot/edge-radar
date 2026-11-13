/* Read-only A/B paper dashboard: no wallet connection or trading endpoints. */
(function(root){
'use strict';
const API_DEFAULT='https://edge-radar-cloud.adalgizagon.workers.dev';
const $=id=>document.getElementById(id);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const usd=n=>Number.isFinite(Number(n))&&n!==null?'US$ '+Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const pct=n=>Number.isFinite(Number(n))&&n!==null?(Number(n)>=0?'+':'')+Number(n).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
const date=ms=>Number.isFinite(Number(ms))?new Date(Number(ms)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';
const strategy=x=>x==='ai'?'Agente IA':'Regras fixas';
let payload=null,last=0,loading=false,error='';
function api(){try{const stored=localStorage.getItem('edgeradar.cloud.api.v1')||API_DEFAULT;const u=new URL(stored);return u.protocol==='https:'?u.origin:API_DEFAULT}catch{return API_DEFAULT}}
function cards(){
 const accounts=payload?.accounts||[],positions=payload?.positions||[],performance=payload?.performance||[];
 return ['baseline','ai'].map(s=>{
  const a=accounts.find(x=>x.strategy===s),open=positions.filter(x=>x.strategy===s);
  const pf=performance.find(x=>x.strategy===s)||{},sold=Number(pf.sells)||0,wins=Number(pf.wins)||0;
  const realized=Number(pf.realized_pnl)||0;
  const invested=open.reduce((v,x)=>v+(Number(x.invested_usd)||0),0);
  const active=s==='ai'&&!payload.aiConfigured?'Inativo: configurar IA':s==='baseline'?'Regras automáticas':'Modelo conectado';
  return '<article class="agent-card"><div class="agent-card-header"><div><small>'+(s==='ai'?'MODELO DE IA':'REFERÊNCIA')+'</small><h3>'+strategy(s)+'</h3></div><span>'+safe(active)+'</span></div>'+
   '<div class="agent-metrics"><div><label>Saldo disponível</label><strong>'+usd(a?.cash_usd??null)+'</strong></div>'+
   '<div><label>Patrimônio estimado*</label><strong>'+usd(a?.equity_usd??null)+'</strong></div>'+
   '<div><label>Lucro realizado*</label><strong class="'+(realized>=0?'positive':'negative')+'">'+(a?usd(realized):'—')+'</strong></div>'+
   '<div><label>Lucro não realizado*</label><strong>'+usd(a?.unrealized_pnl??null)+'</strong></div>'+
   '<div><label>Posições abertas</label><strong>'+open.length+'</strong></div>'+
   '<div><label>Capital em aberto</label><strong>'+usd(invested)+'</strong></div>'+
   '<div><label>Vendas simuladas</label><strong>'+sold+'</strong></div>'+
   '<div><label>Taxa de acerto*</label><strong>'+(sold?pct(100*wins/sold):'—')+'</strong></div></div></article>';
 }).join('');
}
function tradesHTML(){
 const rows=(payload?.trades||[]).slice(0,35);
 if(!rows.length)return '<p class="cloud-empty">Nenhuma negociação simulada registrada. O sistema não inventa operações.</p>';
 return '<div class="agent-tablewrap"><table class="paper-table"><thead><tr><th>Horário</th><th>Estratégia</th><th>Moeda</th><th>Movimento</th><th>Valor líquido</th><th>Resultado</th><th>Motivo</th></tr></thead><tbody>'+rows.map(t=>
  '<tr><td>'+date(t.created_at)+'</td><td>'+strategy(t.strategy)+'</td><td>'+safe(t.symbol||String(t.mint).slice(0,8))+'</td><td>'+(t.action==='buy'?'Compra':'Venda')+'</td><td>'+usd(Math.abs(Number(t.cash_usd)||0))+'</td>'+
  '<td class="'+(Number(t.pnl_usd)>=0?'positive':'negative')+'">'+(t.action==='sell'?usd(t.pnl_usd):'—')+'</td><td>'+safe(t.reason)+'</td></tr>').join('')+'</tbody></table></div>';
}
function decisionsHTML(){
 const rows=(payload?.decisions||[]).slice(0,30);
 if(!rows.length)return '<p class="cloud-empty">Aguardando sinais elegíveis ou decisões da IA.</p>';
 return '<div class="agent-tablewrap"><table class="paper-table"><thead><tr><th>Horário</th><th>Estratégia</th><th>Token</th><th>Decisão</th><th>Justificativa</th></tr></thead><tbody>'+rows.map(d=>
  '<tr><td>'+date(d.created_at)+'</td><td>'+strategy(d.strategy)+'</td><td>'+safe(String(d.mint).slice(0,8))+'…</td><td>'+safe(d.decision)+'</td><td>'+safe(d.reason)+'</td></tr>').join('')+'</tbody></table></div>';
}
function redraw(){
 const status=$('agentStatus'),metrics=$('agentAccounts'),open=$('agentPositions'),history=$('agentTrades'),decisions=$('agentDecisions'),usage=$('agentUsage');
 if(!status)return;
 if(error){status.textContent='Falha ao consultar a simulação: '+error;return;}
 if(!payload){status.textContent=loading?'Consultando o Worker…':'Abra a aba para carregar o estado da simulação.';return;}
 if(!payload.enabled){
  status.textContent='Teste ainda não habilitado no servidor. Configure PAPER_EXPERIMENT_ENABLED=true na Cloudflare e publique a migração D1.';
  if(metrics)metrics.innerHTML='';if(open)open.innerHTML='';if(history)history.innerHTML='';if(decisions)decisions.innerHTML='';
  if(usage)usage.textContent='Nenhuma chamada de IA.';
  return;
 }
 status.textContent='Experimento fictício ativo · IA '+(payload.aiConfigured?'configurada':'não configurada')+' · Consulta '+date(payload.checkedAt);
 if(metrics)metrics.innerHTML=cards();
 if(open)open.innerHTML=(payload.positions||[]).length?'<div class="agent-tablewrap"><table class="paper-table"><thead><tr><th>Estratégia</th><th>Moeda</th><th>Investido</th><th>Preço de entrada</th><th>Aberta em</th></tr></thead><tbody>'+payload.positions.map(p=>
  '<tr><td>'+strategy(p.strategy)+'</td><td>'+safe(p.symbol||String(p.mint).slice(0,8))+'</td><td>'+usd(p.invested_usd)+'</td><td>'+Number(p.entry_price).toPrecision(5)+'</td><td>'+date(p.opened_at)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="cloud-empty">Nenhuma posição aberta.</p>';
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
