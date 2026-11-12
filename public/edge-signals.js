/* Edge Radar Crypto — registro local de sinais e checkpoints observados.
   Apenas leituras de preços; sem negociação e sem extrapolar observações ausentes. */
(function (root) {
'use strict';
const KEY='edgeradar.crypto.signals.v1';
const VERSION=1, MAX=600, RETAIN_MS=30*86400000, REENTRY_MS=60*60000;
const HORIZONS=[{key:'m1',label:'1 min',after:60000,grace:30000},{key:'m5',label:'5 min',after:300000,grace:90000},{key:'m15',label:'15 min',after:900000,grace:150000},{key:'m30',label:'30 min',after:1800000,grace:240000}];
const validMint=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const number=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const text=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const BRL=x=>x===null||!Number.isFinite(x)?'—':x.toLocaleString('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:1})+'%';
const clock=at=>new Date(at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
let signals=[],loaded=false,dirty=false,lastSavedAt=0;
const activeSignal=s=>s.checkpoints && HORIZONS.some(h=>!s.checkpoints[h.key]);
function load(){
 if(loaded)return;loaded=true;
 try{const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(raw?.version!==VERSION||!Array.isArray(raw.signals))return;
 signals=raw.signals.filter(s=>validMint(s.mint)&&Number.isFinite(s.triggeredAt)&&number(s.entryPrice)>0&&s.triggeredAt>=Date.now()-RETAIN_MS)
   .slice(0,MAX).map(s=>({...s,checkpoints:s.checkpoints&&typeof s.checkpoints==='object'?s.checkpoints:{},samples:Math.max(1,Number(s.samples)||1)}));}
 catch{signals=[];}
}
function persist(force=false){
 if(!dirty)return;
 const now=Date.now();if(!force&&now-lastSavedAt<12000)return;
 try{localStorage.setItem(KEY,JSON.stringify({version:VERSION,savedAt:now,signals}));dirty=false;lastSavedAt=now;}
 catch{ /* armazenamento local sem espaço/permissão; não inventar persistência */ }
}
function prune(now=Date.now()){
 load();const n=signals.length;
 signals=signals.filter(s=>s.triggeredAt>=now-RETAIN_MS).slice(0,MAX);
 if(signals.length!==n)dirty=true;
}
function latest(mint){load();return signals.find(s=>s.mint===mint)||null;}
function percent(entry,after){return(entry>0&&after>0)?((after/entry)-1)*100:null;}
function checkpoint(s,h,now,price){
 if(s.checkpoints[h.key])return false;
 const target=s.triggeredAt+h.after,deadline=target+h.grace;
 if(now<target)return false;
 if(now<=deadline&&price!==null&&price>0){
  s.checkpoints[h.key]={status:'measured',price,measuredAt:now,delayMs:now-target,returnPct:percent(s.entryPrice,price)};
 }else if(now>deadline){
  s.checkpoints[h.key]={status:'missing',reason:'Sem cotação observada dentro da janela',targetAt:target};
 }else return false;
 return true;
}
function observe(sample){
 load();const mint=sample?.mint,at=number(sample?.at),price=number(sample?.price);
 if(!validMint(mint)||at===null||at<1000000000000||at>Date.now()+3600000||price===null||price<=0)return null;
 prune(at);
 let recent=latest(mint);
 // Cada sinal nasce do primeiro preço realmente observado que passou nos filtros.
 if(sample.stage==='priority'&&(!recent||at-recent.triggeredAt>=REENTRY_MS)){
  recent={id:mint+':'+at,mint,name:String(sample.name||'').slice(0,90),symbol:String(sample.symbol||'').slice(0,25),triggeredAt:at,entryPrice:price,
    stage:'priority',score:number(sample.score)||0,liquidity:number(sample.liquidity),volume:number(sample.volume),change5:number(sample.change),
    buys:number(sample.buys),sells:number(sample.sells),lastQualifiedAt:at,lastQuoteAt:at,lastPrice:price,
    samples:1,minObservedPct:0,maxObservedPct:0,checkpoints:{},source:'DEX Screener / GeckoTerminal',
    filters:{liquidity:number(sample.minLiquidity),volume:number(sample.minVolume)}};
  signals.unshift(recent);prune(at);dirty=true;persist(true);return recent;
 }
 if(!recent||at<recent.triggeredAt||at>recent.triggeredAt+REENTRY_MS)return recent;
 if(at<Number(recent.lastQuoteAt)||at===Number(recent.lastQuoteAt))return recent; // nenhuma cotação duplicada ou retroativa
 const ret=percent(recent.entryPrice,price);
 recent.lastQuoteAt=at;recent.lastPrice=price;recent.samples++;
 recent.stage=sample.stage==='priority'?'priority':sample.stage||'waiting';
 if(recent.stage==='priority')recent.lastQualifiedAt=at;
 recent.minObservedPct=Math.min(number(recent.minObservedPct)??0,ret);
 recent.maxObservedPct=Math.max(number(recent.maxObservedPct)??0,ret);
 for(const h of HORIZONS)checkpoint(recent,h,at,price);
 dirty=true;persist(false);return recent;
}
function tick(at=Date.now()){
 load();let changed=false;
 for(const s of signals){for(const h of HORIZONS){if(checkpoint(s,h,at,null))changed=true;}}
 if(changed){dirty=true;persist(true);}else persist(false);
 return changed;
}
function recent(mint,at=Date.now(),maxAgeMs=60*60000){
 const s=latest(mint);return s&&at-s.triggeredAt>=0&&at-s.triggeredAt<=maxAgeMs?s:null;
}
function pinnedMints(at=Date.now()){
 load();return [...new Set(signals.filter(s=>at-s.triggeredAt<35*60000&&at>=s.triggeredAt && activeSignal(s)).map(s=>s.mint))].slice(0,65);
}
function all(){load();return signals.slice();}
function metrics(){
 load();const now=Date.now();const recentCount=signals.filter(s=>now-s.triggeredAt<=3600000).length;
 const result={total:signals.length,lastHour:recentCount,measured:{},positive:{},average:{}};
 for(const h of HORIZONS){const values=signals.map(s=>s.checkpoints?.[h.key]).filter(x=>x?.status==='measured'&&Number.isFinite(x.returnPct)).map(x=>x.returnPct);
  result.measured[h.key]=values.length;result.positive[h.key]=values.length?100*values.filter(x=>x>0).length/values.length:null;
  result.average[h.key]=values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
 return result;
}
function render(){
 if(typeof document==='undefined')return;
 tick();const count=document.getElementById('nHistory'),stats=document.getElementById('historyStats'),list=document.getElementById('historyTimeline');
 if(count)count.textContent=String(signals.length);
 if(!stats||!list)return;
 const m=metrics();
 stats.innerHTML=`<div><span>Sinais capturados</span><strong>${m.total}</strong></div><div><span>Última hora</span><strong>${m.lastHour}</strong></div><div><span>Observados após 5 min</span><strong>${m.measured.m5}</strong></div><div><span>Observados após 30 min</span><strong>${m.measured.m30}</strong></div><div><span>Subiram em 5 min*</span><strong>${m.positive.m5===null?'—':BRL(m.positive.m5)}</strong></div><div><span>Variação média em 5 min*</span><strong>${m.average.m5===null?'—':BRL(m.average.m5)}</strong></div>`;
 const filter=document.getElementById('historyFilter')?.value||'all';
 const filtered=signals.filter(s=>filter==='all'||filter==='recent'&&Date.now()-s.triggeredAt<=3600000||filter==='complete'&&!!s.checkpoints.m30);
 list.innerHTML=filtered.length?filtered.slice(0,150).map(s=>{
  const ageMs=Date.now()-s.triggeredAt;
  const last=s.lastQuoteAt&&Date.now()-s.lastQuoteAt<90000;
  const state=ageMs<3600000&&s.stage==='priority'&&last?'Ativo':'Registrado · acompanhamento';
  const boxes=HORIZONS.map(h=>{const c=s.checkpoints?.[h.key];const txt=c?.status==='measured'?BRL(c.returnPct):c?.status==='missing'?'Sem amostra':'Aguardando';
   return `<div class="hist-horizon"><span>${h.label}</span><b class="${c?.status==='measured'?(c.returnPct>0?'up':'down'):''}">${txt}</b></div>`;}).join('');
  return `<article class="hist-card"><div class="hist-head"><div><strong>${text(s.symbol||s.name||s.mint.slice(0,9))}</strong><span class="hist-mint">${text(s.mint.slice(0,5)+'…'+s.mint.slice(-5))}</span><small>Capturado ${clock(s.triggeredAt)} · força ${Number(s.score)||0}/100</small></div><span class="hist-status">${state}</span></div>
   <div class="hist-horizons">${boxes}</div><div class="hist-footer"><small>Preço de entrada observado: US$ ${Number(s.entryPrice).toPrecision(5)} · máxima observada ${BRL(s.maxObservedPct||0)} · mínima observada ${BRL(s.minObservedPct||0)} · ${Number(s.samples)||1} amostra(s)</small><div><a href="https://pump.fun/coin/${encodeURIComponent(s.mint)}" target="_blank" rel="noopener noreferrer">Pump.fun</a><a href="https://dexscreener.com/solana/${encodeURIComponent(s.mint)}" target="_blank" rel="noopener noreferrer">Gráfico</a></div></div></article>`;
 }).join(''):'<p class="empty-hist">Nenhum sinal registrado neste filtro. O histórico começa quando uma moeda satisfaz os critérios e tem preço válido.</p>';
}
function exportData(kind='json'){
 load();if(typeof document==='undefined'||typeof URL==='undefined'||typeof Blob==='undefined')return false;
 let body='',mime='application/json',filename='edge-radar-sinais.json';
 if(kind==='csv'){
  const cols=['mint','symbol','triggeredAt','entryPrice','score','liquidity','volume','change5',...HORIZONS.map(h=>'return_'+h.key),...HORIZONS.map(h=>'status_'+h.key)];
  const esc=x=>'"'+String(x??'').replace(/"/g,'""')+'"';
  body=cols.join(',')+'\n'+signals.map(s=>cols.map(k=>{let v;if(k.startsWith('return_'))v=s.checkpoints?.[k.slice(7)]?.returnPct;else if(k.startsWith('status_'))v=s.checkpoints?.[k.slice(7)]?.status;else v=s[k];return esc(v)}).join(',')).join('\n');
  filename='edge-radar-sinais.csv';mime='text/csv;charset=utf-8';
 }else body=JSON.stringify({version:VERSION,exportedAt:new Date().toISOString(),signals},null,2);
 const href=URL.createObjectURL(new Blob([body],{type:mime})),a=document.createElement('a');a.href=href;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);return true;
}
function reset(){load();signals=[];dirty=true;persist(true);render();}
root.EdgeSignalHistory={observe,tick,latest,recent,pinnedMints,all,metrics,render,exportData,reset,HORIZONS,load,_debug:()=>({dirty,signals})};
})(typeof window!=='undefined'?window:globalThis);