/* Edge Radar Crypto: painel de descoberta em tempo real, SOMENTE LEITURA.
   WebSocket público para novos lançamentos/migrações; preços via DEX Screener REST.
   Não transmite ordens, não solicita segredos, não mede sentimento social sem dados.
*/
(function(global){
'use strict';
const CFG=Object.freeze({ws:'wss://pumpportal.fun/api/data',dex:'https://api.dexscreener.com/tokens/v1/solana/',MAX_TOKENS:250,MAX_WATCH:100,PRICE_INTERVAL:8000,BATCH:30,MAX_ATTEMPTS:100});
const validMint=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const now=()=>Date.now();
const fmt=(v,d=0)=>v===null||!Number.isFinite(+v)?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:d});
const money=v=>v===null||!Number.isFinite(+v)?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const age=ms=>ms<60000?`${Math.max(0,Math.floor(ms/1000))}s`:ms<3600000?`${Math.floor(ms/60000)}m`:`${Math.floor(ms/3600000)}h`;
const url=v=>typeof v==='string'&&/^https:\/\/[^\s<>"']+$/i.test(v)?v:null;
const tokenUrl=mint=>'https://pump.fun/coin/'+encodeURIComponent(mint);
const dexUrl=mint=>'https://dexscreener.com/solana/'+encodeURIComponent(mint);
const socialSearch=(token,site)=>{
  const q=`"${token.symbol||token.name||''}" "${token.mint}"`;
  return site==='x'?'https://x.com/search?q='+encodeURIComponent(q)+'&f=live':'https://www.google.com/search?tbm=nws&q='+encodeURIComponent(q);
};
const safeLink=(href,label)=>{const s=url(href);return s?`<a href="${e(s)}" target="_blank" rel="noopener noreferrer">${e(label)}</a>`:''};
function normalizeEvent(payload,receivedAt=now()){
  if(!payload||typeof payload!=='object'||!validMint(payload.mint))return null;
  const tx=String(payload.txType||payload.type||'').toLowerCase();
  let type=tx.includes('migrat')?'migration':tx==='create'||tx.includes('new')||tx==='creation'?'launch':null;
  if(!type)return null;
  return {mint:payload.mint,type,name:String(payload.name||'').slice(0,80),symbol:String(payload.symbol||'').slice(0,24),description:String(payload.description||'').slice(0,200),created:receivedAt,
    marketCapSol:num(payload.marketCapSol),creator:validMint(payload.traderPublicKey)?payload.traderPublicKey:null,
    website:url(payload.website),twitter:url(payload.twitter),telegram:url(payload.telegram)};
}
function pairForMint(rows,mint){if(!Array.isArray(rows))return null;
  return rows.filter(p=>p?.chainId==='solana'&&p?.baseToken?.address===mint).sort((a,b)=>(num(b.liquidity?.usd)||0)-(num(a.liquidity?.usd)||0))[0]||null;
}
function evaluate(t){const p=t.pair;if(!p)return {kind:'waiting',label:'Mercado ainda não indexado',notes:['Sem preço e liquidez confirmados']};
  const l=num(p.liquidity?.usd),v=num(p.volume?.m5),change=num(p.priceChange?.m5),buys=num(p.txns?.m5?.buys),sells=num(p.txns?.m5?.sells),cap=num(p.marketCap)||num(p.fdv);
  const notes=[],risks=[];
  if(l===null)risks.push('Liquidez não informada');else if(l<8000)risks.push('Liquidez muito baixa');
  if(cap!==null&&l!==null&&l>0&&cap/l>80)risks.push('Capitalização muito alta para a liquidez');
  if(buys!==null&&sells!==null&&buys+sells<12)risks.push('Poucas negociações nos últimos 5 minutos');
  if(change!==null&&change>120)risks.push('Alta muito rápida: risco de reversão');
  if(change!==null&&change<-35)risks.push('Queda acentuada');
  if(!t.pair?.priceUsd)risks.push('Preço em USD indisponível');
  if(v!==null&&v>=15000)notes.push('Volume elevado em 5 min');
  if(buys!==null&&sells!==null&&buys>=20&&buys>sells*1.3)notes.push('Mais compras que vendas em 5 min');
  if(change!==null&&change>5&&change<80)notes.push('Preço subindo em 5 min');
  if(risks.length)return {kind:'risk',label:'Risco elevado / revisar',notes:[...risks,...notes]};
  if(l!==null&&l>=15000&&v!==null&&v>=10000&&buys!==null&&sells!==null&&buys>=20&&buys>sells*1.3&&change!==null&&change>3&&change<80){return {kind:'screen',label:'Passou no pré-filtro',notes:[...notes,'Não verifica concentração de carteiras nem segurança do token']};}
  return {kind:'observe',label:'Monitorar / sem confirmação',notes:notes.length?notes:['Ainda sem sinais quantitativos suficientes']};
}
function buildTotals(history){let launches=0,migrations=0,review=0,risk=0;for(const t of history.values()){if(t.type==='migration')migrations++;else launches++;const a=evaluate(t);if(a.kind==='screen')review++;if(a.kind==='risk')risk++;}return {launches,migrations,review,risk};}
const readWatch=()=>{try{const x=JSON.parse(localStorage.getItem('edge.crypto.watch.v1')||'[]');return new Set(Array.isArray(x)?x.filter(validMint).slice(0,CFG.MAX_WATCH):[]);}catch{return new Set();}};
const saveWatch=watch=>{try{localStorage.setItem('edge.crypto.watch.v1',JSON.stringify([...watch].slice(0,CFG.MAX_WATCH)));return true;}catch{return false;}};
let app=null, running=false, socket=null, retry=null, poll=null, drawTimer=null, lastMessage=0, lastDex=0, retries=0, subscribed=false, busy=false, seenCount=0, failedCount=0, priceFailures=0;
let items=new Map(), watch=new Set(), options={minLiquidity:0,hideUnpriced:false,onlyWatch:false,sort:'newest',sound:false};
function elem(id){return document.getElementById(id)}
function state(text,status='idle') {const el=elem('cryptoStatus');if(el){el.textContent=text;el.dataset.state=status;}}
function header(){return `
  <div class="crypto-title"><div><h2>Radar Crypto <span class="crypto-strong">ao vivo</span></h2><p class="fine">Pump.fun · lançamentos e migrações recebidos por WebSocket. Somente leitura: nenhum trade será executado.</p></div><span id="cryptoStatus" class="crypto-status" data-state="idle">Desconectado</span></div>
  <div class="crypto-bar"><button id="cryptoStart" type="button" class="crypto-primary">Iniciar monitoramento</button><button id="cryptoStop" type="button" disabled>Pausar</button><button id="cryptoRefresh" type="button" disabled>Atualizar mercados agora</button><label><input type="checkbox" id="cryptoSound"/> Aviso sonoro para migração</label></div>
  <div class="crypto-kpis"><div><span>Eventos recebidos nesta sessão</span><strong id="cryptoSeen">0</strong></div><div><span>Lançamentos exibidos</span><strong id="cryptoLaunches">0</strong></div><div><span>Migrações exibidas</span><strong id="cryptoMigrated">0</strong></div><div><span>Último evento</span><strong id="cryptoLast">—</strong></div></div>
  <div class="crypto-info"><strong>Dois tempos:</strong> lançamentos/migrações aparecem imediatamente quando recebidos. Preço, liquidez e volume são enriquecidos pelo DEX Screener em lotes a cada ~8 segundos, quando a moeda já estiver listada. <b>Sem preço não há sinal de compra.</b> Dados sociais exibidos aqui são links públicos, não sentimento automatizado.</div>
  <div class="crypto-filter"><label>Liquidez mínima (USD)<select id="cryptoLiquidity"><option value="0">Todas</option><option value="5000">US$ 5.000</option><option value="15000">US$ 15.000</option><option value="50000">US$ 50.000</option></select></label><label>Ordenação<select id="cryptoSort"><option value="newest">Eventos recentes</option><option value="watch">Pré-filtro e migrações</option><option value="growth">Maior valorização em 5m</option><option value="liquidity">Maior liquidez</option></select></label><label><input type="checkbox" id="cryptoOnlyPriced"/> Com dados de mercado</label><label><input type="checkbox" id="cryptoOnlyWatch"/> Favoritos</label><span id="cryptoDexTime" class="crypto-foot">Mercado ainda não consultado</span></div>
  <div id="cryptoTable" class="crypto-grid"><div class="crypto-empty">Inicie o monitoramento para acompanhar lançamentos e migrações.</div></div>
  <div class="crypto-info crypto-disclaimer">Atenção: este radar não confirma a segurança de contratos, holders, criadores ou possibilidade de venda. O desempenho em tempo real depende da conexão e da disponibilidade das fontes. A aba aberta não substitui um serviço 24/7.</div>`;}
function lastAge(t){return age(Math.max(0,now()-t))}
function btnStatus(){const s=elem('cryptoStart'),p=elem('cryptoStop'),r=elem('cryptoRefresh');if(s)s.disabled=running;if(p)p.disabled=!running;if(r)r.disabled=!running;}
function eventsSummary(){const stats=buildTotals(items);elem('cryptoSeen').textContent=fmt(seenCount);elem('cryptoLaunches').textContent=fmt(stats.launches);elem('cryptoMigrated').textContent=fmt(stats.migrations);elem('cryptoLast').textContent=lastMessage?lastAge(lastMessage)+' atrás':'—';}
function renderCard(t){const p=t.pair,ass=evaluate(t),dex=p?.info||{};const sym=(t.symbol||p?.baseToken?.symbol||'SEM SÍMBOLO').slice(0,24);const name=(t.name||p?.baseToken?.name||'Novo token').slice(0,80);
  const soc=[...(Array.isArray(dex.socials)?dex.socials:[]),...(Array.isArray(dex.websites)?dex.websites:[])].filter(x=>url(x.url)).slice(0,4).map(x=>safeLink(x.url,x.platform||x.label||'Site')).join(' · ');
  const rating=ass.kind==='screen'?'screen':ass.kind==='risk'?'risk':ass.kind==='waiting'?'waiting':'observe';
  const signalNotes=ass.notes.slice(0,2).map(n=>e(n)).join(' · ');
  return `<article class="crypto-card ${rating}" data-mint="${e(t.mint)}"><div class="crypto-cardtop"><div class="crypto-token"><div class="crypto-icon">${t.type==='migration'?'⇄':'✦'}</div><div><strong>${e(sym)}</strong><span>${e(name)}</span></div></div><span class="crypto-age">${t.type==='migration'?'Migração':'Lançamento'} · ${lastAge(t.created)} atrás</span></div>
    <div class="crypto-rating">${e(ass.label)}</div>
    <div class="crypto-metrics"><div><span>Preço USD</span><strong>${p?.priceUsd?e(String(p.priceUsd)):'—'}</strong></div><div><span>Variação 5 min</span><strong class="${num(p?.priceChange?.m5)>0?'crypto-pos':'crypto-neg'}">${num(p?.priceChange?.m5)!==null?fmt(p.priceChange.m5,1)+'%':'—'}</strong></div><div><span>Liquidez</span><strong>${money(num(p?.liquidity?.usd))}</strong></div><div><span>Volume 5 min</span><strong>${money(num(p?.volume?.m5))}</strong></div><div><span>Compras / vendas 5m</span><strong>${fmt(num(p?.txns?.m5?.buys))} / ${fmt(num(p?.txns?.m5?.sells))}</strong></div><div><span>Market cap</span><strong>${money(num(p?.marketCap)||num(p?.fdv))}</strong></div></div>
    <p class="crypto-notes">${signalNotes}</p><div class="crypto-mint" title="Endereço do contrato">${e(t.mint)}</div>
    <div class="crypto-links">${safeLink(tokenUrl(t.mint),'Pump.fun')} ${safeLink(p?.url||dexUrl(t.mint),'DEX Screener')} ${safeLink(socialSearch(t,'x'),'Buscar no X')} ${safeLink(socialSearch(t,'news'),'Notícias')} ${soc?'<span class="crypto-soc">Links: '+soc+'</span>':''} <button type="button" data-crypto-watch="${e(t.mint)}">${watch.has(t.mint)?'★ Favorito':'☆ Favoritar'}</button></div>
    </article>`;
}
function scheduleDraw(){if(drawTimer)return;drawTimer=setTimeout(()=>{drawTimer=null;draw();},220);}
function draw(){if(!app)return;eventsSummary();const list=[...items.values()].filter(t=>{
   if(options.onlyWatch&&!watch.has(t.mint))return false;
   if(options.hideUnpriced&&!t.pair)return false;
   const liq=num(t.pair?.liquidity?.usd);return !options.minLiquidity||(liq!==null&&liq>=options.minLiquidity);
 });
 const ranking=t=>evaluate(t).kind==='screen'?3:t.type==='migration'?2:t.pair?1:0;
 list.sort((a,b)=>options.sort==='growth'?(num(b.pair?.priceChange?.m5)??-9999)-(num(a.pair?.priceChange?.m5)??-9999):options.sort==='liquidity'?(num(b.pair?.liquidity?.usd)||0)-(num(a.pair?.liquidity?.usd)||0):options.sort==='watch'?ranking(b)-ranking(a)||b.created-a.created:b.created-a.created);
 const view=list.slice(0,65),el=elem('cryptoTable');if(!el)return;
 el.innerHTML=view.map(renderCard).join('')||'<div class="crypto-empty">Nenhum token atende ao filtro selecionado. Muitos lançamentos ainda não possuem preço nem liquidez indexados.</div>';
 const updated=lastDex?`DEX Screener consultado há ${lastAge(lastDex)}`:'DEX Screener ainda não consultado';elem('cryptoDexTime').textContent=`${updated}${priceFailures?' · falhas: '+priceFailures:''} · ${items.size} tokens mantidos em memória`;
}
function remember(evt){if(!evt)return;seenCount++;lastMessage=now();const old=items.get(evt.mint);if(old){old.lastEvent=lastMessage;if(evt.type==='migration'){old.type='migration';old.created=lastMessage;} if(!old.symbol&&evt.symbol)old.symbol=evt.symbol;if(!old.name&&evt.name)old.name=evt.name;items.delete(evt.mint);items.set(evt.mint,old);}else{items.set(evt.mint,{...evt,lastEvent:lastMessage,pair:null,queried:0,attempts:0});}
 while(items.size>CFG.MAX_TOKENS)items.delete(items.keys().next().value);scheduleDraw();if(evt.type==='migration'&&options.sound)beep();}
let audio=null;function beep(){try{const A=global.AudioContext||global.webkitAudioContext;if(!A)return;if(!audio)audio=new A();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=680;g.gain.value=.035;o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+.12);}catch{}}
function ingest(raw){let d;try{d=typeof raw==='string'?JSON.parse(raw):raw;}catch{failedCount++;return;}if(d?.message&&!d.mint)return;const evt=normalizeEvent(d);if(evt)remember(evt);}
function connect(){if(!running||socket&&[0,1].includes(socket.readyState))return;state('Conectando ao WebSocket…','loading');try{const ws=new WebSocket(CFG.ws);socket=ws;ws.onopen=()=>{if(!running||socket!==ws){ws.close();return;}retries=0;subscribed=true;state('Ao vivo · WebSocket conectado','ok');ws.send(JSON.stringify({method:'subscribeNewToken'}));ws.send(JSON.stringify({method:'subscribeMigration'}));};ws.onmessage=evt=>{if(socket===ws&&running)ingest(evt.data);};ws.onerror=()=>{if(socket===ws)state('Falha na conexão · aguardando…','error');};ws.onclose=()=>{if(socket!==ws)return;socket=null;subscribed=false;if(!running)return;const delay=Math.min(30000,1500*Math.pow(2,Math.min(5,retries++)));state('Reconectando em '+Math.ceil(delay/1000)+'s…','loading');retry=setTimeout(connect,delay);};}catch(e){state('Conexão não suportada neste navegador','error');running=false;btnStatus();}}
async function refreshPrices(){if(!running||busy||!items.size)return;busy=true;
 const t=now();const candidates=[...items.values()].filter(x=>validMint(x.mint)&&x.attempts<CFG.MAX_ATTEMPTS&&(!x.queried||t-x.queried>=8000));
 // Mais recentes primeiro: o primeiro rastreio deve chegar antes do enriquecimento dos tokens antigos.
 candidates.sort((a,b)=>(a.queried?1:0)-(b.queried?1:0)||b.created-a.created);
 const subset=candidates.slice(0,CFG.BATCH);if(!subset.length){busy=false;return;}
 for(const x of subset){x.queried=t;x.attempts++;}
 try{const endpoint=CFG.dex+subset.map(x=>encodeURIComponent(x.mint)).join(',');const res=await fetch(endpoint,{cache:'no-store',headers:{Accept:'application/json'}});if(!res.ok)throw Error('HTTP '+res.status);const rows=await res.json();for(const x of subset){const y=pairForMint(rows,x.mint);if(y)x.pair=y;}lastDex=now();priceFailures=0;scheduleDraw();}
 catch(err){priceFailures++;state(socket?.readyState===1?'WebSocket ativo · mercado indisponível':'Fonte de preços indisponível','error');scheduleDraw();}finally{busy=false;}
}
function start(){if(running)return;running=true;retries=0;btnStatus();connect();poll=setInterval(()=>{refreshPrices();if(lastMessage&&now()-lastMessage>45000&&socket?.readyState===1)state('Conectado · sem novos eventos há '+lastAge(lastMessage),'idle');scheduleDraw();},CFG.PRICE_INTERVAL);refreshPrices();}
function stop(){running=false;subscribed=false;if(retry){clearTimeout(retry);retry=null;}if(poll){clearInterval(poll);poll=null;}if(socket){const s=socket;socket=null;try{s.close();}catch{}}state('Monitoramento pausado','idle');btnStatus();}
function init(){if(app)return;app=elem('cryptoApp');if(!app)return;watch=readWatch();app.innerHTML=header();elem('cryptoStart').onclick=start;elem('cryptoStop').onclick=stop;elem('cryptoRefresh').onclick=refreshPrices;
 elem('cryptoSound').onchange=x=>{options.sound=x.target.checked;if(options.sound)beep();};elem('cryptoLiquidity').onchange=x=>{options.minLiquidity=Number(x.target.value);draw();};elem('cryptoSort').onchange=x=>{options.sort=x.target.value;draw();};elem('cryptoOnlyPriced').onchange=x=>{options.hideUnpriced=x.target.checked;draw();};elem('cryptoOnlyWatch').onchange=x=>{options.onlyWatch=x.target.checked;draw();};
 app.addEventListener('click',ev=>{const btn=ev.target.closest('[data-crypto-watch]');if(!btn)return;const mint=btn.dataset.cryptoWatch;if(!validMint(mint))return;if(watch.has(mint))watch.delete(mint);else if(watch.size<CFG.MAX_WATCH)watch.add(mint);else{alert('Limite de 100 favoritos neste navegador.');return;}saveWatch(watch);draw();});draw();}
global.EdgeCrypto={init,start,stop,ingest,normalizeEvent,pairForMint,evaluate,socialSearch,buildTotals,getStatus:()=>({running,connected:socket?.readyState===1,events:seenCount,displayed:items.size,failed:failedCount,priceFailures}),_debug:()=>({items,watch,options})};
})(typeof window!=='undefined'?window:globalThis);