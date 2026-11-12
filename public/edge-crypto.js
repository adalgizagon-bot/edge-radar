/* EDGE RADAR CRYPTO · Pump.fun + PumpSwap · somente observação e paper trading.
 * Sem chaves privadas, sem ordens, sem probabilidade fabricada.
 */
(function (root) {
'use strict';
const CFG=Object.freeze({ws:'wss://pumpportal.fun/api/data',gecko:'https://api.geckoterminal.com/api/v2/networks/solana/',dex:'https://api.dexscreener.com/tokens/v1/solana/',maxTokens:280,priceMs:8000,poolsMs:45000,debounceMs:280,priceMaxAgeMs:90000,seenMaxHours:8,feeEstimate:0.01});
const $=id=>typeof document==='undefined'?null:document.getElementById(id);
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const mintOk=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const fmt=(v,d=0)=>v===null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:d});
const usd=(v,d=0)=>v===null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:d}).format(v);
const pct=v=>v===null||!Number.isFinite(Number(v))?'—':(v>0?'+':'')+fmt(v,1)+'%';
const stamp=()=>Date.now();
const age=ms=>!Number.isFinite(ms)?'—':ms<60000?`${Math.max(0,Math.floor(ms/1000))}s`:ms<3600000?`${Math.max(0,Math.floor(ms/60000))}min`:`${Math.floor(ms/3600000)}h`;
const getJson=(key,fallback)=>{try{const raw=JSON.parse(localStorage.getItem(key));return raw??fallback}catch{return fallback}};
const putJson=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}};
const pairGood=p=>p&&p.chainId==='solana'&&mintOk(p.baseToken?.address);
const pumpDex=s=>/(pump.?swap|pump.?fun|pumpfun)/i.test(String(s||''));
function normalizeEvent(payload,time=stamp()){
 if(!payload||typeof payload!=='object'||!mintOk(payload.mint))return null;
 const tx=String(payload.txType||payload.type||payload.event||'').toLowerCase();
 const type=tx.includes('migrat')?'migration':(tx==='create'||tx.includes('creation')||tx.includes('new'))?'launch':null;
 if(!type)return null;
 return {mint:payload.mint,type,symbol:String(payload.symbol||'').slice(0,25),name:String(payload.name||'').slice(0,90),firstSeen:time,source:'pumpportal',lastEvent:time,creator:mintOk(payload.traderPublicKey)?payload.traderPublicKey:null};
}
function parseGecko(json,kind,at=stamp()){
 const inc=new Map((json?.included||[]).filter(x=>x?.id).map(x=>[x.id,x]));
 const out=[];
 for(const row of json?.data||[]){
  const a=row?.attributes||{};const dexRelation=row?.relationships?.dex?.data?.id;
  const dexObj=inc.get(dexRelation);const dexName=dexObj?.attributes?.name||dexRelation||'';
  if(!pumpDex(dexName))continue; // apenas pools Pump.fun / PumpSwap confirmados pela fonte
  const tokenRelation=row?.relationships?.base_token?.data?.id||'';
  const tokenObj=inc.get(tokenRelation);
  const mint=tokenObj?.attributes?.address||tokenRelation.replace(/^solana_/, '');
  if(!mintOk(mint))continue;
  const volume5=num(a.volume_usd?.m5),buys5=num(a.transactions?.m5?.buys),sells5=num(a.transactions?.m5?.sells);
  const poolAge=Date.parse(a.pool_created_at||'');const price=num(a.base_token_price_usd);
  const pair={chainId:'solana',dexId:String(dexName),baseToken:{address:mint,name:tokenObj?.attributes?.name||'',symbol:tokenObj?.attributes?.symbol||''},
   priceUsd:price,liquidity:{usd:num(a.reserve_in_usd)},volume:{m5:volume5},txns:{m5:{buys:buys5,sells:sells5}},
   priceChange:{m5:num(a.price_change_percentage?.m5)},marketCap:num(a.market_cap_usd),fdv:num(a.fdv_usd),
   pairCreatedAt:Number.isFinite(poolAge)?poolAge:null,pairAddress:a.address||null,url:null,info:null};
  out.push({mint,name:String(tokenObj?.attributes?.name||a.name?.split('/')?.[0]||'').trim().slice(0,90),symbol:String(tokenObj?.attributes?.symbol||'').slice(0,25),source:'geckoterminal',type:kind,
   firstSeen:Number.isFinite(poolAge)?poolAge:at,lastEvent:at,pair,pairFetchedAt:at});
 }
 return out;
}
function bestPair(rows,mint){
 if(!Array.isArray(rows))return null;
 const matches=rows.filter(p=>pairGood(p)&&p.baseToken.address===mint);
 if(!matches.length)return null;
 return matches.sort((a,b)=>{
  const x=num(a.liquidity?.usd)||0,y=num(b.liquidity?.usd)||0;
  const px=pumpDex(a.dexId)?1:0,py=pumpDex(b.dexId)?1:0;
  return (py-px)||y-x;
 })[0];
}
function evaluate(token,filters={liquidity:5000,volume:1500},nowMs=stamp()){
 const p=token?.pair;
 const fresh=Number.isFinite(token?.pairFetchedAt)&&nowMs-token.pairFetchedAt<=CFG.priceMaxAgeMs;
 if(!p||!fresh)return {stage:'waiting',score:0,valid:false,notes:[p?'Preço desatualizado; atualizar':'Aguardando preço e liquidez indexados'],ageMinutes:null};
 const l=num(p.liquidity?.usd),v=num(p.volume?.m5),c=num(p.priceChange?.m5),b=num(p.txns?.m5?.buys),s=num(p.txns?.m5?.sells);
 const n=(b===null||s===null)?null:b+s;
 const ratio=b===null||s===null?null:b/(s||1);
 const poolAge=num(p.pairCreatedAt)??num(token.firstSeen);const ageMinutes=poolAge?Math.max(0,(nowMs-poolAge)/60000):null;
 const signals=[],risk=[];let score=0;
 if(l!==null){score+=l>=20000?21:l>=10000?18:l>=5000?14:l>=3000?8:0;if(l<3000)risk.push('Liquidez muito baixa');}else risk.push('Liquidez não verificada');
 if(v!==null){score+=v>=10000?20:v>=5000?17:v>=1500?13:v>=500?6:0;if(v<500)risk.push('Volume fraco em 5 min');}else risk.push('Volume de 5 min indisponível');
 if(n!==null){score+=n>=50?18:n>=25?14:n>=15?10:n>=8?4:0;if(n<10)risk.push('Poucas negociações');}else risk.push('Compras e vendas indisponíveis');
 if(ratio!==null){score+=b>=8&&ratio>=1.5?21:b>=8&&ratio>=1.2?16:b>=5&&ratio>=1?7:0;if(ratio<0.85&&s>=5)risk.push('Vendas predominantes');}else risk.push('Pressão compradora desconhecida');
 if(c!==null){score+=c>=3&&c<=35?16:c>0&&c<60?9:0;if(c>80)risk.push('Alta explosiva: possível entrada tardia');if(c<-15)risk.push('Queda acelerada em 5 min');}else risk.push('Variação recente indisponível');
 if(ageMinutes!==null&&ageMinutes<240)score+=4;
 if(l!==null&&l>=filters.liquidity)signals.push('Liquidez passou no filtro');
 if(v!==null&&v>=filters.volume)signals.push('Volume recente confirmado');
 if(ratio!==null&&ratio>=1.25)signals.push('Mais compras que vendas');
 const meets=l!==null&&l>=filters.liquidity&&v!==null&&v>=filters.volume&&n!==null&&n>=18&&b>=8&&s!==null&&b/(s||1)>=1.25&&c!==null&&c>=2&&c<=45;
 const extreme=(l!==null&&l<3000)||(c!==null&&(c>100||c<-25));
 const stage=meets&&score>=67&&!extreme?'priority':extreme?'risk':'watch';
 return {stage,score,valid:true,notes:risk.length?risk:signals.length?signals:['Atividade recente em análise'],liquidity:l,volume:v,change:c,buys:b,sells:s,ratio,ageMinutes};
}
const data=new Map();const favorites=new Set();
let view='opportunities',running=false,socket=null,wsConnected=false,retryTimer=null,pricesTimer=null,poolsTimer=null,paintTimer=null,persistTimer=null,lastMarketAt=0,lastGeckoAt=0,wsSeen=0,marketError='',geckoError='',initialized=false,sound=false,wsRetry=0,activeRequest=false,fetchingPools=false;
let settings={liquidity:5000,volume:1500,sort:'score',search:''};
const journalKey='edgeradar.crypto.watch.v2',favorKey='edgeradar.crypto.favorites.v2',paperKey='edgeradar.crypto.paper.v1';
function signalHistory(){return root.EdgeSignalHistory||null;}
function trackSignal(t){
 const h=signalHistory();if(!h||!t?.pair||!Number.isFinite(t.pairFetchedAt)||num(t.pair.priceUsd)===null)return;
 const a=evaluate(t,settings,t.pairFetchedAt);h.observe({mint:t.mint,name:t.name,symbol:t.symbol,at:t.pairFetchedAt,price:num(t.pair.priceUsd),stage:a.stage,score:a.score,
  liquidity:a.liquidity,volume:a.volume,change:a.change,buys:a.buys,sells:a.sells,minLiquidity:settings.liquidity,minVolume:settings.volume});
}

let paper={initial:1000,cash:1000,positions:[],history:[]};
function initializeCache(){
 const saved=getJson(journalKey,[]);for(const t of Array.isArray(saved)?saved.slice(0,CFG.maxTokens):[]){if(!mintOk(t.mint)||!Number.isFinite(t.firstSeen))continue;if(stamp()-t.firstSeen>CFG.seenMaxHours*3600000)continue;data.set(t.mint,{...t,pair:null,pairFetchedAt:0});}
 for(const m of getJson(favorKey,[])){if(mintOk(m))favorites.add(m);}
 const x=getJson(paperKey,null);if(x&&num(x.initial)>0&&Array.isArray(x.positions)&&Array.isArray(x.history))paper={initial:x.initial,cash:Math.max(0,num(x.cash)||0),positions:x.positions.filter(p=>mintOk(p.mint)&&num(p.quantity)>0),history:x.history};
}
function saveCache(){putJson(journalKey,[...data.values()].sort((a,b)=>b.lastEvent-a.lastEvent).slice(0,CFG.maxTokens).map(t=>({mint:t.mint,firstSeen:t.firstSeen,lastEvent:t.lastEvent,source:t.source,type:t.type,name:t.name,symbol:t.symbol})));}
function storePaper(){putJson(paperKey,paper);}
function schedule(){if(paintTimer)return;paintTimer=setTimeout(()=>{paintTimer=null;draw();},CFG.debounceMs);}
function persist(){if(persistTimer)return;persistTimer=setTimeout(()=>{persistTimer=null;saveCache()},3500);}
function addToken(token){if(!token||!mintOk(token.mint))return false;
 const old=data.get(token.mint);
 if(old){const combined={...old,...token,firstSeen:Math.min(old.firstSeen||token.firstSeen,token.firstSeen),name:token.name||old.name,symbol:token.symbol||old.symbol,source:old.source==='pumpportal'?'pumpportal':token.source||old.source};
 if(old.pair&&(!token.pair||Number(token.pairFetchedAt)<Number(old.pairFetchedAt))) {combined.pair=old.pair;combined.pairFetchedAt=old.pairFetchedAt;}
 data.set(token.mint,combined);
 }else data.set(token.mint,token);
 if(token.pair)trackSignal(data.get(token.mint));
 if(data.size>CFG.maxTokens){const removable=[...data.values()].filter(x=>!favorites.has(x.mint)&&!paper.positions.some(p=>p.mint===x.mint)&&!signalHistory()?.pinnedMints().includes(x.mint));removable.sort((a,b)=>(a.lastEvent||0)-(b.lastEvent||0));for(const t of removable.slice(0,Math.max(0,data.size-CFG.maxTokens)))data.delete(t.mint);}
 schedule();persist();return true;
}
function ingestMessage(raw){let payload;try{payload=typeof raw==='string'?JSON.parse(raw):raw}catch{return false}
 const event=normalizeEvent(payload);if(!event)return false;
 wsSeen++;const ok=addToken(event);if(event.type==='migration')refreshMarketSoon();return ok;
}
function updatePairs(rows){let changed=0;const group=new Map();for(const p of rows||[]){if(!pairGood(p))continue;const mint=p.baseToken.address;if(!group.has(mint))group.set(mint,[]);group.get(mint).push(p)}
 for(const [mint,arr]of group){const old=data.get(mint);if(!old)continue;const best=bestPair(arr,mint);if(!best)continue;
 addToken({mint,firstSeen:old.firstSeen,lastEvent:old.lastEvent||stamp(),source:old.source,type:old.type,name:old.name||best.baseToken.name||'',symbol:old.symbol||best.baseToken.symbol||'',pair:best,pairFetchedAt:stamp()});changed++;
 }if(changed)lastMarketAt=stamp();return changed;
}
function marketCandidates(){
 const pinned=new Set(signalHistory()?.pinnedMints()||[]);
 const items=[...data.values()].filter(t=>mintOk(t.mint)).sort((a,b)=>
  Number(pinned.has(b.mint))-Number(pinned.has(a.mint))||Number(favorites.has(b.mint))-Number(favorites.has(a.mint))||(b.lastEvent||0)-(a.lastEvent||0));
 return items.slice(0,90).map(t=>t.mint);
}
async function refreshPrices(){if(!running||activeRequest)return;const mints=marketCandidates();if(!mints.length)return;activeRequest=true;
 try{const lists=[];for(let i=0;i<mints.length;i+=30)lists.push(mints.slice(i,i+30));
 const responses=await Promise.all(lists.map(async list=>{const resp=await fetch(CFG.dex+list.join(','),{headers:{accept:'application/json'},cache:'no-store'});if(!resp.ok)throw Error('HTTP '+resp.status);return resp.json()}));
 updatePairs(responses.flatMap(v=>Array.isArray(v)?v:[]));marketError='';
 }catch(err){marketError='DEX Screener: '+String(err?.message||err).slice(0,90)}finally{activeRequest=false;schedule()}
}
function refreshMarketSoon(){if(!running)return;setTimeout(()=>refreshPrices(),2000)}
async function refreshPools(){if(!running||fetchingPools)return;fetchingPools=true;
 try{
  const urls=['new_pools?include=base_token,dex','trending_pools?include=base_token,dex&duration=5m'];
  const results=await Promise.allSettled(urls.map(async path=>{const r=await fetch(CFG.gecko+path,{headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}));
  let loaded=0;for(let i=0;i<results.length;i++){if(results[i].status!=='fulfilled')continue;for(const t of parseGecko(results[i].value,i===0?'new_pool':'trending_pool')){if(addToken(t))loaded++;}}
  if(results.some(r=>r.status==='fulfilled')){geckoError='';lastGeckoAt=stamp();if(loaded)refreshPrices();}
  else geckoError='GeckoTerminal: '+String(results[0]?.reason?.message||'indisponível').slice(0,90);
 }catch(e){geckoError='GeckoTerminal: '+String(e?.message||e).slice(0,90)}finally{fetchingPools=false;schedule()}
}
function connect(){if(!running||socket&&socket.readyState<=1)return;
 try{const ws=new WebSocket(CFG.ws);socket=ws;ws.onopen=()=>{if(!running||socket!==ws){ws.close();return}wsConnected=true;wsRetry=0;ws.send(JSON.stringify({method:'subscribeNewToken'}));ws.send(JSON.stringify({method:'subscribeMigration'}));schedule()};
 ws.onmessage=msg=>{if(running&&socket===ws)ingestMessage(msg.data)};
 ws.onerror=()=>{wsConnected=false;schedule()};
 ws.onclose=()=>{if(socket!==ws)return;socket=null;wsConnected=false;if(!running)return;const delay=Math.min(30000,1200*Math.pow(2,Math.min(5,wsRetry++)));retryTimer=setTimeout(connect,delay);schedule()};
 }catch(e){wsConnected=false;schedule()}
}
function start(){if(running)return;running=true;wsRetry=0;connect();refreshPools();refreshPrices();pricesTimer=setInterval(refreshPrices,CFG.priceMs);poolsTimer=setInterval(refreshPools,CFG.poolsMs);schedule()}
function stop(){running=false;wsConnected=false;if(retryTimer)clearTimeout(retryTimer);if(pricesTimer)clearInterval(pricesTimer);if(poolsTimer)clearInterval(poolsTimer);retryTimer=null;pricesTimer=null;poolsTimer=null;if(socket){const ws=socket;socket=null;try{ws.close()}catch{}}schedule()}
function visible(nowMs=stamp()){
 const arr=[...data.values()].map(t=>({t,a:evaluate(t,settings,nowMs)}));
 let list=arr.filter(({t,a})=>{
  if(view==='opportunities'&&a.stage!=='priority'&&!signalHistory()?.recent(t.mint,nowMs))return false;
  if(view==='watch'&&!(a.stage==='watch'||a.stage==='risk'))return false;
  if(view==='new'&&t.source!=='pumpportal'&&t.type!=='new_pool')return false;
  if(view==='favorites'&&!favorites.has(t.mint))return false;
  if(settings.search){const search=settings.search.toLowerCase();if(!`${t.name} ${t.symbol} ${t.mint}`.toLowerCase().includes(search))return false;}
  return true;
 });
 list.sort((x,y)=>{
  if(view==='new')return(y.t.firstSeen||0)-(x.t.firstSeen||0);
  if(view==='opportunities'){const h=signalHistory();const rx=h?.recent(x.t.mint,nowMs),ry=h?.recent(y.t.mint,nowMs);
    return Number(y.a.stage==='priority')-Number(x.a.stage==='priority')||(ry?.triggeredAt||0)-(rx?.triggeredAt||0)||y.a.score-x.a.score;}

  if(settings.sort==='volume')return(y.a.volume||0)-(x.a.volume||0);
  if(settings.sort==='change')return(y.a.change||0)-(x.a.change||0);
  if(settings.sort==='recent')return(y.t.lastEvent||0)-(x.t.lastEvent||0);
  return y.a.score-x.a.score||(y.t.lastEvent||0)-(x.t.lastEvent||0);
 });return list;
}
function metadata(){const a=[...data.values()].map(t=>evaluate(t,settings));return {priority:a.filter(x=>x.stage==='priority').length,watch:a.filter(x=>['watch','risk'].includes(x.stage)).length,newItems:[...data.values()].filter(x=>x.source==='pumpportal'||x.type==='new_pool').length,total:data.size,favorites:favorites.size,signals:signalHistory()?.all().length||0}}
function socialUrl(t,site){const q=`"${t.mint}"`;return site==='x'?`https://x.com/search?q=${encodeURIComponent(q)}&f=live`:site==='news'?`https://www.google.com/search?tbm=nws&q=${encodeURIComponent(q)}`:`https://www.reddit.com/search/?q=${encodeURIComponent(q)}`}
const pumpUrl=t=>`https://pump.fun/coin/${encodeURIComponent(t.mint)}`;
const dexUrl=t=>`https://dexscreener.com/solana/${encodeURIComponent(t.mint)}`;
function renderCard(t,a){const p=t.pair||{},pairFresh=a.valid;const reason=a.notes.slice(0,2).join(' · ');
 const labels={priority:'Análise prioritária',watch:'Em observação',risk:'Risco elevado',waiting:'Sem cotação recente'};
 const on=favorites.has(t.mint);
 const price=num(p.priceUsd);const change=a.change;
 return `<article class="token-card ${a.stage}"><div class="token-head"><div style="min-width:0"><div class="token-name">${safe(t.name||p.baseToken?.name||t.symbol||'Token sem nome')}</div><div class="token-symbol">${safe(t.symbol||p.baseToken?.symbol||'—')} · ${safe(t.mint.slice(0,6)+'…'+t.mint.slice(-5))}</div></div><button class="favorite ${on?'on':''}" data-favorite="${safe(t.mint)}" title="${on?'Remover dos favoritos':'Adicionar aos favoritos'}" aria-label="Favorito">${on?'★':'☆'}</button></div>
 <div class="token-meta"><span class="signal ${a.stage}">${labels[a.stage]}</span> · ${t.source==='pumpportal'?'Evento Pump.fun':'Pool PumpSwap'} · ${age(stamp()-t.firstSeen)} </div>
 <div class="token-metrics"><div><span>Variação 5 min</span><b class="${change!==null?(change>=0?'up':'down'):'neutral'}">${pairFresh?pct(change):'—'}</b></div><div><span>Volume 5 min</span><b>${pairFresh?usd(a.volume):'—'}</b></div><div><span>Liquidez</span><b>${pairFresh?usd(a.liquidity):'—'}</b></div><div><span>Compras / vendas</span><b>${pairFresh&&a.buys!==null?fmt(a.buys)+' / '+fmt(a.sells):'—'}</b></div><div><span>Valor de mercado</span><b>${pairFresh?usd(num(p.marketCap)??num(p.fdv)):'—'}</b></div><div><span>Preço (US$)</span><b>${pairFresh&&price!==null?price<0.001?price.toPrecision(4):fmt(price,5):'—'}</b></div></div>
 ${(()=>{const h=signalHistory()?.recent(t.mint);if(!h)return '';return `<div class="historical-capture"><strong>${a.stage==='priority'?'● Sinal registrado':'◷ Sinal que perdeu força / aguardando dados'}</strong><span>Detectado ${new Date(h.triggeredAt).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})} · acompanhar em Histórico</span></div>`;})()}
 <div class="scorebar" title="Pontuação heurística ${a.score}/100"><i style="width:${Math.min(100,Math.max(0,a.score))}%"></i></div><div class="notes">Pontuação: <strong>${a.score}/100</strong> · ${safe(reason)}${pairFresh?'':' · não ranqueado sem dados atuais'}</div>
 <div class="social-presence">Redes: pesquisa manual; popularidade não verificada.</div>
 <div class="cardlinks"><a href="${pumpUrl(t)}" target="_blank" rel="noopener noreferrer">Pump.fun</a><a href="${dexUrl(t)}" target="_blank" rel="noopener noreferrer">Gráfico</a><a href="${socialUrl(t,'x')}" target="_blank" rel="noopener noreferrer">Pesquisar no X</a><a href="${socialUrl(t,'news')}" target="_blank" rel="noopener noreferrer">Notícias</a><button data-paper-buy="${safe(t.mint)}" ${!pairFresh||price===null||price<=0?'disabled':''}>Simular compra</button></div></article>`;
}
function draw(){if(typeof document==='undefined')return;
 const meta=metadata(),visibleItems=(view==='cloud'?[]:visible()),isPaper=view==='paper',isHistory=view==='history',isCloud=view==='cloud';
 signalHistory()?.tick();
 const elem=$('tokenGrid');if(!elem)return;
 for(const [id,v] of Object.entries({kPriority:meta.priority,kWatch:meta.watch,kNew:meta.newItems,kTotal:meta.total,nOpportunities:meta.priority,nWatch:meta.watch,nNew:meta.newItems,nFav:meta.favorites}))if($(id))$(id).textContent=String(v);
 const status=$('connectionStatus'),dot=$('connectionDot');
 status.textContent=!running?'Radar pausado':wsConnected?'Eventos ao vivo conectados':'Tentando conectar aos eventos…';
 dot.className='dot '+(!running?'muted':wsConnected?'on':'fail');
 $('lastUpdated').textContent=lastMarketAt?'Preços '+age(stamp()-lastMarketAt)+' atrás':lastGeckoAt?'Pools '+age(stamp()-lastGeckoAt)+' atrás':'Sem atualização ainda';
 const errors=[marketError,geckoError].filter(Boolean).join(' · ');
 $('sourceSummary').textContent=(wsSeen+' eventos WebSocket · '+(lastGeckoAt?'pools consultados':'pools aguardando')+(errors?' · '+errors:''));
 $('btnStart').disabled=running;$('btnStop').disabled=!running;
 $('marketSection').hidden=isPaper||isHistory||isCloud;$('paperSection').hidden=!isPaper;
 if($('cloudSection'))$('cloudSection').hidden=!isCloud;
 $('historySection').hidden=!isHistory;
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));
 if(isHistory){signalHistory()?.render();return;}
 if(isCloud){root.EdgeCloud?.redraw();return;}
 if(isPaper){renderPaper();return;}
 const desc={opportunities:['Oportunidades capturadas','Sinais ao vivo e moedas que passaram nos filtros na última hora. Não desaparecem quando o preço oscila: confira também o Histórico.'],watch:['Em observação','Mercados com atividade parcial, preço corrigindo ou avisos de risco.'],new:['Novos lançamentos','Eventos Pump.fun e pools novos da PumpSwap, mesmo antes de existir cotação.'],all:['Todos os tokens','Tokens de fontes Pump.fun/PumpSwap, independentemente da classificação.'],favorites:['Favoritos','Moedas que você marcou para continuar acompanhando.']}[view];
 $('sectionTitle').textContent=desc[0];$('sectionDescription').textContent=desc[1];
 $('resultCount').textContent=visibleItems.length+' moeda(s) nesta lista · '+meta.signals+' sinal(is) registrado(s) · '+meta.total+' token(s) acompanhados · '+(wsConnected?'fluxo em tempo real':'sem conexão ao vivo');
 $('tokenGrid').innerHTML=visibleItems.slice(0,100).map(({t,a})=>renderCard(t,a)).join('');$('emptyState').hidden=visibleItems.length!==0;
}
function paperValue(){let invested=0,market=0,havePrice=0;for(const p of paper.positions){invested+=p.invested;const t=data.get(p.mint),pr=num(t?.pair?.priceUsd);if(pr!==null&&stamp()-(t?.pairFetchedAt||0)<=CFG.priceMaxAgeMs){market+=p.quantity*pr*(1-CFG.feeEstimate);havePrice++;}}
 return {invested,market,havePrice,unpriced:paper.positions.length-havePrice};}
function renderPaper(){const val=paperValue(),canValue=val.unpriced===0;
 const equity=canValue?paper.cash+val.market:null;
 $('paperCapital').value=String(paper.initial);
 $('paperKpis').innerHTML=`<div><span>Saldo simulado disponível</span><strong>${usd(paper.cash,2)}</strong></div><div><span>Investido em posições abertas</span><strong>${usd(val.invested,2)}</strong></div><div><span>Patrimônio marcado a mercado</span><strong>${equity===null?'—':usd(equity,2)}</strong></div><div><span>Resultado vs. capital inicial</span><strong>${equity===null?'—':usd(equity-paper.initial,2)}</strong></div>`;
 const pos=paper.positions.map(p=>{const t=data.get(p.mint),pr=num(t?.pair?.priceUsd),fresh=pr!==null&&stamp()-(t?.pairFetchedAt||0)<=CFG.priceMaxAgeMs;return `<tr><td>${safe(p.symbol||p.mint.slice(0,8))}</td><td>${usd(p.invested,2)}</td><td>${fresh?usd(p.quantity*pr*(1-CFG.feeEstimate),2):'Sem preço recente'}</td><td>${fresh?usd(p.quantity*pr*(1-CFG.feeEstimate)-p.invested,2):'—'}</td><td><button class="btn ghost" data-paper-sell="${safe(p.mint)}" ${fresh?'':'disabled'}>Simular venda</button></td></tr>`}).join('');
 $('paperPositions').innerHTML=`<h3>Posições abertas</h3>${pos?`<table class="paper-table"><thead><tr><th>Token</th><th>Aplicado</th><th>Valor estimado</th><th>Resultado</th><th>Ação</th></tr></thead><tbody>${pos}</tbody></table>`:'<p class="paper-empty">Nenhuma posição. Acesse uma moeda com cotação recente e escolha “Simular compra”.</p>'}`;
 $('paperHistory').innerHTML=`<h3>Movimentações simuladas</h3>${paper.history.length?`<table class="paper-table"><thead><tr><th>Horário</th><th>Token</th><th>Ação</th><th>Valor (US$)</th></tr></thead><tbody>${paper.history.slice(0,30).map(x=>`<tr><td>${safe(new Date(x.at).toLocaleString('pt-BR'))}</td><td>${safe(x.symbol)}</td><td>${x.action==='buy'?'Compra':'Venda'}</td><td>${usd(x.amount,2)}</td></tr>`).join('')}</tbody></table>`:'<p class="paper-empty">Ainda não há movimentações.</p>'}`;
}
function buyPaper(mint,amount){const t=data.get(mint),price=num(t?.pair?.priceUsd);if(!t||price===null||price<=0||stamp()-(t.pairFetchedAt||0)>CFG.priceMaxAgeMs)return {ok:false,message:'Cotação indisponível ou desatualizada'};
 if(!Number.isFinite(amount)||amount<=0||amount>paper.cash)return {ok:false,message:'Valor inválido ou acima do saldo'};
 const quantity=amount/(price*(1+CFG.feeEstimate));paper.cash=+(paper.cash-amount).toFixed(8);
 const pos=paper.positions.find(p=>p.mint===mint);if(pos){pos.quantity+=quantity;pos.invested+=amount;}else paper.positions.push({mint,symbol:t.symbol||mint.slice(0,8),quantity,invested:amount,openedAt:stamp()});
 paper.history.unshift({mint,symbol:t.symbol||mint.slice(0,8),action:'buy',amount,at:stamp()});storePaper();schedule();return {ok:true};
}
function sellPaper(mint){const p=paper.positions.find(x=>x.mint===mint),t=data.get(mint),price=num(t?.pair?.priceUsd);
 if(!p||price===null||price<=0||stamp()-(t.pairFetchedAt||0)>CFG.priceMaxAgeMs)return {ok:false,message:'Posição ou preço indisponível'};
 const payout=p.quantity*price*(1-CFG.feeEstimate);paper.cash+=payout;paper.positions=paper.positions.filter(x=>x.mint!==mint);paper.history.unshift({mint,symbol:p.symbol,action:'sell',amount:payout,at:stamp()});storePaper();schedule();return {ok:true,payout};
}
function resetPaper(capital){if(!Number.isFinite(capital)||capital<1||capital>1e8)return false;paper={initial:capital,cash:capital,positions:[],history:[]};storePaper();schedule();return true;}
function bind(){if(initialized||typeof document==='undefined')return;initialized=true;signalHistory()?.load();initializeCache();
 $('btnStart').onclick=start;$('btnStop').onclick=stop;$('btnRefresh').onclick=()=>{refreshPools();refreshPrices()};
 $('soundAlert').onchange=e=>sound=e.target.checked;
 $('liquidityFilter').onchange=e=>{settings.liquidity=Number(e.target.value);schedule()};$('volumeFilter').onchange=e=>{settings.volume=Number(e.target.value);schedule()};$('sortFilter').onchange=e=>{settings.sort=e.target.value;schedule()};$('searchFilter').oninput=e=>{settings.search=e.target.value.trim();schedule()};
 $('historyFilter').onchange=()=>signalHistory()?.render();
 $('exportSignalsJson').onclick=()=>signalHistory()?.exportData('json');
 $('exportSignalsCsv').onclick=()=>signalHistory()?.exportData('csv');
 $('clearSignals').onclick=()=>{if(confirm('Apagar todo o histórico de sinais deste navegador? Faça um backup antes se quiser preservar os dados.')){signalHistory()?.reset();draw();}};

 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{view=b.dataset.view;draw()}));
 document.addEventListener('click',e=>{const fav=e.target.closest('[data-favorite]');if(fav){const m=fav.dataset.favorite;if(!mintOk(m))return;if(favorites.has(m))favorites.delete(m);else favorites.add(m);putJson(favorKey,[...favorites]);schedule();return;}
 const buy=e.target.closest('[data-paper-buy]');if(buy){const m=buy.dataset.paperBuy;const raw=prompt('Simular compra: quanto investir em US$? (sem dinheiro real)','20');if(raw===null)return;const amt=Number(String(raw).replace(',','.'));const out=buyPaper(m,amt);if(!out.ok)alert(out.message);else{view='paper';draw()}return;}
 const sell=e.target.closest('[data-paper-sell]');if(sell){const m=sell.dataset.paperSell;if(!confirm('Simular a venda de toda esta posição?'))return;const out=sellPaper(m);if(!out.ok)alert(out.message);else draw();}
 });
 $('paperReset').onclick=()=>{const value=Number($('paperCapital').value);if(!confirm('Reiniciar toda a simulação e apagar seu histórico simulado neste navegador?'))return;if(!resetPaper(value))alert('Capital inicial inválido.');else draw();};
 draw();start();setInterval(()=>{if(initialized){signalHistory()?.tick();draw()}},30000);
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind()}
root.EdgeCrypto={start,stop,normalizeEvent,parseGecko,bestPair,evaluate,ingestMessage,addToken,updatePairs,visible,metadata,buyPaper,sellPaper,resetPaper,getState:()=>({running,wsConnected,marketError,geckoError,tokens:data.size,wsSeen,recordedSignals:signalHistory()?.all().length||0}),_debug:()=>({data,paper,favorites,settings}),_setView:v=>{view=v;draw()}};
})(typeof window!=='undefined'?window:globalThis);
