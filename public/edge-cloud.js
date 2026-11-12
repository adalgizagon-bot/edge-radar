/* Edge Radar Crypto — optional cloud history reader. Pure GET, no API secrets. */
(function(root){
'use strict';
const KEY='edgeradar.cloud.api.v1',INTERVAL=45000;
const $=id=>typeof document==='undefined'?null:document.getElementById(id);
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const percent=x=>num(x)===null?'—':(x>=0?'+':'')+Number(x).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
const date=x=>num(x)===null?'—':new Date(Number(x)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'});
const validMint=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const urls=x=>{
 try{const u=new URL(String(x||''));return u.protocol==='https:'&&u.hostname&&!u.username&&!u.password&&!u.port&&u.pathname.replace(/\/$/,'')===''&&!u.search&&!u.hash?u.origin:null;}
 catch{return null}
};
let api='',connected=false,updating=false,rows=[],health=null,stats=null,timer=null,lastAt=0,error='';
function load(){try{return urls(localStorage.getItem(KEY)||root.EDGE_RADAR_CLOUD_URL||'')||''}catch{return urls(root.EDGE_RADAR_CLOUD_URL)||''}}
function save(){try{localStorage.setItem(KEY,api)}catch{}}
function getURL(){return api}
function remoteStatus(){return {api,connected,error,rows:rows.length,lastAt,health};}
function card(s){
 if(!validMint(s.mint)||num(s.triggered_at)===null)return '';
 const measured=[['m1','1 min'],['m5','5 min'],['m15','15 min'],['m30','30 min']];
 const cells=measured.map(([key,label])=>{const st=s[key+'_status'],result=st==='measured'?percent(s[key+'_return']):st==='missing'?'Sem amostra':'Aguardando';
  const cls=st==='measured'?(s[key+'_return']>0?'up':'down'):'';
  return `<div class="cloud-checkpoint"><span>${label}</span><strong class="${cls}">${safe(result)}</strong></div>`;}).join('');
 const name=s.symbol||s.name||s.mint.slice(0,8);
 return `<article class="cloud-signal"><div class="cloud-signal-header"><div><strong>${safe(name)}</strong><small>Detectado ${date(s.triggered_at)} · força ${safe(s.score)}/100</small></div><a href="https://pump.fun/coin/${encodeURIComponent(s.mint)}" target="_blank" rel="noopener noreferrer">Pump.fun</a></div><div class="cloud-checkpoints">${cells}</div><small>Preço registrado ${num(s.entry_price)>0?'US$ '+Number(s.entry_price).toPrecision(5):'—'} · Liquidez ${num(s.liquidity)===null?'—':'US$ '+Number(s.liquidity).toLocaleString('en-US',{maximumFractionDigits:0})} · amostras de mercado, não rentabilidade líquida</small></article>`;
}
function redraw(){
 const st=$('cloudStatus'),time=$('cloudLastUpdated'),list=$('cloudSignalGrid'),count=$('cloudSignalCount'),sum=$('cloudStats');
 if(st)st.textContent=!api?'Não configurado':error?'Erro: '+error:health?.online?'Coletor na nuvem ativo':health?.running?'Coletor com erro: '+String(health?.latest?.error||'verifique logs').slice(0,80):connected?'Coletor sem batimento recente':'Conectando…';
 if(time)time.textContent=health?.latest?.last_run?'Última verificação '+date(health.latest.last_run):'—';
 if(count)count.textContent=rows.length+' registros carregados';
 const more=$('cloudLoadMore');if(more)more.disabled=!api||rows.length===0;
 if(sum){const m=stats?.stats||{};sum.innerHTML=`<div><span>Sinais (últimos 90 dias)</span><strong>${num(m.total)??'—'}</strong></div><div><span>Hoje (Brasília)</span><strong>${num(m.day)??'—'}</strong></div><div><span>Medidos após 5 min</span><strong>${num(m.m5measured)??'—'}</strong></div><div><span>Subiram após 5 min*</span><strong>${num(m.m5measured)>0?percent(100*(m.m5positive||0)/m.m5measured):'—'}</strong></div>`;}
 if(list)list.innerHTML=rows.length?rows.map(card).join(''):`<p class="cloud-empty">${api?'Nenhum sinal na nuvem até agora. A coleta só começa depois que o Worker e o banco D1 forem implantados.':'Cole o endereço HTTPS do seu Worker da Cloudflare e clique em Conectar para visualizar o histórico centralizado.'}</p>`;
 const preview=$('cloudOpportunityPreview');
 if(preview){const recent=rows.filter(s=>num(s.triggered_at)>Date.now()-60*60000).slice(0,4);
  preview.hidden=!(api&&recent.length);if(recent.length)preview.innerHTML=`<h3>Capturados na nuvem durante a última hora</h3><p>Registros preservados mesmo quando o navegador estava fechado. A detecção usa verificações de aproximadamente um minuto.</p><div class="cloud-preview-grid">${recent.map(s=>`<a href="https://pump.fun/coin/${encodeURIComponent(s.mint)}" target="_blank" rel="noopener noreferrer"><strong>${safe(s.symbol||s.name||s.mint.slice(0,8))}</strong><span>${date(s.triggered_at)}</span><small>${s.m5_status==='measured'?'5 min: '+percent(s.m5_return):'5 min: '+(s.m5_status==='missing'?'sem amostra':'aguardando')}</small></a>`).join('')}</div>`;}
 }
async function get(path){const ctl=new AbortController(),tm=setTimeout(()=>ctl.abort(),9000);try{const r=await fetch(api+path,{cache:'no-store',signal:ctl.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(tm)}}
async function refresh(){
 if(!api||updating)return;updating=true;
 try{const result=await Promise.all([get('/api/status'),get('/api/signals?limit=60'),get('/api/stats')]);
  health=result[0];const fresh=(Array.isArray(result[1]?.signals)?result[1].signals:[]).filter(s=>validMint(s.mint));
  rows=[...new Map([...fresh,...rows].map(x=>[x.id,x])).values()].sort((a,b)=>b.triggered_at-a.triggered_at).slice(0,600);
  stats=result[2];connected=true;lastAt=Date.now();error='';
 }catch(e){error=String(e?.message||e).slice(0,90);connected=false;}
 finally{updating=false;redraw();}
}
async function loadMore(){if(!api||!rows.length)return;const before=Math.min(...rows.map(x=>Number(x.triggered_at)).filter(Number.isFinite));
 try{const r=await get('/api/signals?limit=100&before='+before);const older=(r.signals||[]).filter(x=>validMint(x.mint));rows=[...new Map([...rows,...older].map(x=>[x.id,x])).values()].sort((a,b)=>b.triggered_at-a.triggered_at).slice(0,600);error='';}
 catch(e){error=String(e?.message||e).slice(0,90);}redraw();}
function connect(v){const proposed=urls(v);if(!proposed){error='Informe um endereço HTTPS válido do Worker, sem caminhos adicionais';redraw();return false;}
 api=proposed;save();rows=[];health=null;stats=null;error='';connected=false;redraw();refresh();return true;
}
function init(){
 api=load();const url=$('cloudApiUrl'),btn=$('cloudConnect'),refreshButton=$('cloudRefresh');
 if(url)url.value=api;
 if(btn)btn.onclick=()=>connect(url?.value||'');
 if(refreshButton)refreshButton.onclick=refresh;const more=$('cloudLoadMore');if(more)more.onclick=loadMore;
 redraw();if(api)refresh();if(!timer)timer=setInterval(()=>{if(api)refresh()},INTERVAL);
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init()}
root.EdgeCloud={connect,refresh,loadMore,remoteStatus,card,urls,getURL,redraw};
})(typeof window!=='undefined'?window:globalThis);
