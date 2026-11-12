/* Edge Radar v6: escudo conservador. Consulta publica de risco; nao executa trocas. */
(function(root){
'use strict';
const API='https://edge-radar-cloud.adalgizagon.workers.dev';
const $=id=>document.getElementById(id);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validMint=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const num=x=>x===null||x===undefined||!Number.isFinite(Number(x))?null:Number(x);
const usd=n=>num(n)===null?'—':'US$ '+Number(n).toLocaleString('pt-BR',{maximumFractionDigits:0});
const reasons=r=>{try{return JSON.parse(r.reasons||'[]').filter(x=>typeof x==='string').slice(0,5)}catch{return ['Avisos indisponiveis']}};
const label=l=>l==='blocked'?'BLOQUEADA':l==='watch'?'EM OBSERVACAO':'NAO VERIFICADA';
const fresh=r=>r&&Number(r.assessed_at)>0&&Date.now()-Number(r.assessed_at)<180000&&Date.now()>=Number(r.assessed_at);
let items=[],quotes=[],error='';
const quoteFor=mint=>quotes.find(q=>q.mint===mint&&Number(q.checked_at)>0&&Date.now()-Number(q.checked_at)<180000)||null;
const quoteText=q=>!q?'SAIDA NAO COTADA':q.status==='quoted'?'ROTA ESTIMADA: '+Number(q.estimated_sol).toFixed(5)+' SOL':q.status==='large_impact'?'ALERTA: IMPACTO NA SAIDA':q.status==='unavailable'?'SEM ROTA CONFIRMADA':'COTACAO INCONCLUSIVA';
const status=()=>({items:items.length,error});
function url(){try{return new URL(localStorage.getItem('edgeradar.cloud.api.v1')||API).origin}catch{return API}}
function card(r){
 const list=reasons(r),st=fresh(r)?label(r.level):'DADOS ANTIGOS',name=r.symbol||r.name||r.mint.slice(0,9);
 const quote=quoteFor(r.mint);
 return '<article class="risk-card '+safe(r.level)+'"><header class="risk-card-head"><div><strong>'+safe(name)+'</strong><small>'+safe(r.mint.slice(0,6))+'…'+safe(r.mint.slice(-5))+'</small></div><span class="risk-pill '+safe(r.level)+'">'+st+'</span></header><div class="risk-mini"><span>Forca <b>'+safe(r.market_score)+'/100</b></span><span>Organico <b>'+(num(r.organic_score)===null?'—':Number(r.organic_score).toFixed(0)+'/100')+'</b></span><span>Liquidez <b>'+usd(r.pool_liquidity)+'</b></span></div><p>'+safe(list.slice(0,2).join(' · ')||'Sem dados suficientes para validar entrada')+'</p><footer class="risk-links"><span>'+safe(quoteText(quote))+'</span><a rel="noopener noreferrer" target="_blank" href="https://jup.ag/tokens/'+encodeURIComponent(r.mint)+'">Auditar ↗</a></footer></article>';
}
function annotate(){
 const byMint=new Map(items.filter(fresh).map(r=>[r.mint,r]));
 document.querySelectorAll('#tokenGrid .token-card').forEach(el=>{
  const a=el.querySelector('a[href*="pump.fun/coin/"]'),gate=el.querySelector('.risk-gate');
  if(!a||!gate)return;
  const mint=a.getAttribute('href').split('/').pop();if(!validMint(mint))return;
  const r=byMint.get(mint);if(!r){if(gate.dataset.riskMint){gate.dataset.riskMint='';gate.classList.remove('risk-red');gate.innerHTML='<strong>◷ SEM AUDITORIA ATUAL · ENTRADA NAO VALIDADA</strong><span>Nota de atividade nao mede seguranca. Cotacao de venda nao testada.</span>';}return}
  const q=quoteFor(mint),version=mint+':'+r.assessed_at+':'+(q?.checked_at||'');
  if(gate.dataset.riskMint===version)return;
  gate.dataset.riskMint=version;gate.classList.toggle('risk-red',r.level==='blocked');
  gate.innerHTML='<strong>'+(r.level==='blocked'?'⛔ RISCO CRITICO · BLOQUEADA':'◷ '+label(r.level)+' · ENTRADA NAO VALIDADA')+'</strong><span>'+safe(reasons(r).slice(0,2).join(' · ')||'Dados parciais. Entrada nao validada.')+' · '+safe(quoteText(q))+' (cotacao nao garante execucao)</span>';
 });
}
function redraw(){
 const current=items.filter(fresh),blocked=current.filter(x=>x.level==='blocked').length,unverified=current.filter(x=>x.level==='unverified').length,watch=current.filter(x=>x.level==='watch').length;
 const head=$('riskSummary');if(head)head.innerHTML='<div class="risk-summary-icon">◈</div><div><strong>Escudo de risco · '+(current.length?'triagem ativa':'aguardando dados')+'</strong><p>'+(current.length?blocked+' bloqueadas · '+unverified+' nao verificadas · '+watch+' em observacao. Nenhuma entrada esta liberada.':'Nota 100 indica movimento, nao seguranca. Sem auditoria e cotacao de venda, entrada bloqueada.')+'</p></div><button class="btn ghost" data-risk-open="1">Abrir Escudo →</button>';
 const st=$('cloudRiskStats');if(st)st.innerHTML='<span><strong>'+current.length+'</strong> analisadas</span><span class="risk-count-critical"><strong>'+blocked+'</strong> bloqueadas</span><span><strong>'+unverified+'</strong> sem verificacao</span><span><strong>'+watch+'</strong> observacao</span>';
 const grid=$('cloudRiskGrid');if(grid)grid.innerHTML=current.length?current.slice(0,18).map(card).join(''):'<p class="cloud-empty">'+safe(error||'Aguardando a primeira analise. Nenhuma entrada esta validada.')+'</p>';
 annotate();
}
async function refresh(){
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),11000);
 try{const res=await fetch(url()+'/api/risk?limit=80',{signal:abort.signal,cache:'no-store'});
  if(!res.ok)throw Error('HTTP '+res.status);
  const data=await res.json();if(!Array.isArray(data.risk))throw Error('Formato inesperado');
  items=data.risk.filter(r=>validMint(r.mint));error='';
  try{const q=await fetch(url()+'/api/exit-quotes?limit=80',{signal:abort.signal,cache:'no-store'});
   if(q.ok){const body=await q.json();quotes=Array.isArray(body.quotes)?body.quotes.filter(x=>validMint(x.mint)):[];}
   else quotes=[];
  }catch{quotes=[];}
 }catch(e){error='Triagem de risco indisponivel: '+String(e?.message||e).slice(0,75);items=[];quotes=[];}
 finally{clearTimeout(timeout);redraw();}
}
function init(){
 redraw();refresh();setInterval(refresh,45000);setInterval(annotate,2500);
 document.addEventListener('click',e=>{if(e.target.closest('[data-risk-open]')){document.querySelector('[data-view="cloud"]')?.click();}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
root.EdgeRisk={status,refresh,redraw};
})(window);
