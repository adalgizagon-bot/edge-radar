/* CS2 Edge — destaque por partida, múltiplas de estudo e resultados manuais. Sem odds automáticas. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const n = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const dec = (v, d=2) => n(v) === null ? '—' : Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
  const percent = v => n(v) === null ? '—' : dec(v * 100,1) + '%';
  const money = v => n(v) === null ? '—' : Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const TZ = 'America/Sao_Paulo';
  const journalKey = 'cs2edge.selectionJournal.v1';
  const TODAY = () => {
    const fields = new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const v = Object.fromEntries(fields.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`;
  };
  const localDay = iso => {
    if (!iso || !Number.isFinite(Date.parse(iso))) return '';
    const fields = new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
    const v = Object.fromEntries(fields.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`;
  };
  const localTime = iso => iso ? new Date(iso).toLocaleString('pt-BR',{timeZone:TZ,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  const ai = () => window.EdgeIntelligence;
  let db = null, chosenDate = TODAY(), focusMatch = '', draft = [], lastPicks = [], derivedStats = {matches:0,priced:0,unpriced:0};
  let lastCode = '';
  function readList(key){try{const r = JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(r)?r:[];}catch{return []}}
  function storeList(key,list){try{localStorage.setItem(key,JSON.stringify(list));return true;}catch{alert('Armazenamento do navegador indisponível. Os resultados não poderão ser preservados.');return false;}}
  function odds(){try{return typeof window.oddsLoad==='function' ? window.oddsLoad() : readList('cs2edge.manualOdds');}catch{return readList('cs2edge.manualOdds')}}
  const same = (x,s) => x && x.matchId===s.matchId && x.target===s.target && x.market===s.market &&
    String(x.subject).toLowerCase()===String(s.subject).toLowerCase() && String(x.direction)===String(s.direction) &&
    n(x.line)===n(s.line) && (s.target==='series'||(x.mapName&&String(x.mapName).toLowerCase()===String(s.mapName).toLowerCase()));
  const currentPrice = x => !x.date || (Date.now()-Date.parse(x.date)) < 24*3600*1000; // sempre conferir a cotação antes de apostar
  function priceRows(s){return odds().filter(x=>same(x,s)&&n(x.odd)>1).sort((a,b)=>b.odd-a.odd)}
  function price(s){return priceRows(s)[0]||null}
  function label(s){
    const name=({kills:'Kills jogador',headshots:'Headshots',assists:'Assistências',firstKills:'Primeiras kills',team_kills:'Kills da equipe',rounds_total:'Rounds do mapa',maps_total:'Total de mapas MD3',series_winner:'Vencedor da série'})[s.market]||s.market;
    return `${name}${n(s.line)!==null?' · '+(s.direction==='over'?'Mais de ':s.direction==='under'?'Menos de ':'')+dec(s.line,1):''}`;
  }
  const targetName=s=>s.target==='series'?'Série inteira':`${s.target?.replace('map','Mapa ')||'Mapa'} · ${s.mapName||'não definido'}`;
  const id=s=>[s.matchId,s.target,s.mapName||'',s.market,s.subject,s.direction,s.line].join('|');
  function quality(s){
    if(!s.valid || n(s.p)===null || s.p<=0 || s.p>=1)return {priority:-1,status:'Dados insuficientes',className:'q-off'};
    const o=price(s);
    if (!o) return {priority:1,status:'Para buscar odd',className:'q-watch'};
    if (!currentPrice(o))return {priority:1,status:'Odd antiga · atualizar',className:'q-watch'};
    const ev=s.p*o.odd-1;
    if(ev<=0) return {priority:0,status:'Sem valor nesta odd',className:'q-off',ev};
    if(s.notCalibrated) return {priority:2,status:'Vantagem teórica · não calibrada',className:'q-caution',ev};
    if(n(s.low)!==null && s.n>=20 && s.low*o.odd>1.02) return {priority:4,status:'Possível valor · revisar',className:'q-positive',ev};
    return {priority:3,status:'Sinal positivo · incerto',className:'q-caution',ev};
  }
  function rating(s){const q=quality(s);return q.priority*1000 + Math.min(120,n(s.n)||0)*1.4 + Math.min(15,Math.max(-20,q.ev||0)*50) + (s.market==='kills'?22:s.market==='rounds_total'?17:s.market==='team_kills'?15:0) - (s.target==='map3'?40:0);}
  function picksFor(m,{perMatch=4,pricedOnly=false}={}){
    if(!ai() || !m)return [];
    let seq=ai().getSequence(m.id);
    const all=ai().allMarketCards(m,seq).filter(s=>s.valid&&n(s.p)!==null&&s.p>.24&&s.p<.85&&s.target!=='map3');
    if(pricedOnly) all.splice(0,all.length,...all.filter(s=>price(s)&&quality(s).priority>=2));
    else all.splice(0,all.length,...all.filter(s=>quality(s).priority>=1));
    all.sort((a,b)=>rating(b)-rating(a));
    const selected=[],seen=new Set(),marketLimit=new Map();
    for(const s of all){
      const family=[s.subject,s.market,s.target].join('|');
      if(seen.has(family))continue;
      if((marketLimit.get(s.market)||0)>=(s.market==='kills'?2:1))continue;
      selected.push(s);seen.add(family);marketLimit.set(s.market,(marketLimit.get(s.market)||0)+1);
      if(selected.length>=perMatch)break;
    }
    return selected;
  }
  function activeMatches(day=chosenDate){
    if(!db)return [];
    const tier=$('tierFilter')?.value||'all',query=($('search')?.value||'').toLowerCase().trim();
    return (db.upcoming||[]).filter(m=>localDay(m.startsAt)===day&&(tier==='all'||m.tier===tier)&&
      `${m.team1} ${m.team2} ${m.event}`.toLowerCase().includes(query)&&m.status==='upcoming'&&Date.parse(m.startsAt)>Date.now()-15*60000)
      .sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
  }
  function smallCard(s,m,{mini=false}={}){
    const q=quality(s),o=price(s),oddtxt=o?`Odd ${dec(o.odd)} · ${esc(o.book)}${!currentPrice(o)?' · conferir cotação antiga':''}`:'Odd não cadastrada';
    const value=o&&s.valid?`EV exploratório ${percent(s.p*o.odd-1)}`:'Sem avaliação de valor';
    const sample=s.method==='contextual'?`${s.mapN||0} neste mapa / ${s.totalN||0} gerais`:`${s.n||0} mapas/observações`;
    return `<article class="pick-highlight ${mini?'mini':''}"><div class="pick-hi-head"><span class="pick-chip ${q.className}">${esc(q.status)}</span><span class="fine">${esc(targetName(s))}</span></div>
      <div class="pick-hi-title">${esc(label(s))}</div><div class="fine">${esc(s.subject)} · ${esc(s.team||m.team1+' × '+m.team2)}</div>
      <div class="pick-stats"><span>Estimativa <b>${percent(s.p)}</b></span><span>Odd justa* <b>${dec(1/s.p)}</b></span><span>Amostra <b>${esc(sample)}</b></span></div>
      <p class="pick-price">${oddtxt} <span class="fine"> · ${esc(value)}</span></p>
      <div class="pick-card-actions"><button type="button" data-open-match="${esc(m.id)}">${o?'Ver análise':'Adicionar odd'}</button>${o&&q.priority>=2?`<button type="button" data-single="${esc(id(s))}">Registrar escolha</button>`:''}</div>
      <p class="fine">${s.notCalibrated?'Projeção combinada ainda não calibrada.':'Frequência histórica ainda não validada fora da amostra.'} *A odd justa depende da estimativa, não é cotação.</p></article>`;
  }
  function drawDaily(){
    const matches=activeMatches(), div=$('dailyPicks'),count=$('dailySummary');if(!div)return;
    const groups=[];lastPicks=[];
    for(const m of matches){const picks=picksFor(m,{perMatch:3});groups.push({m,picks});lastPicks.push(...picks.map(s=>({s,m})));}
    derivedStats={matches:matches.length,priced:lastPicks.filter(x=>price(x.s)).length,unpriced:lastPicks.filter(x=>!price(x.s)).length};
    if(count)count.innerHTML=`<strong>${matches.length}</strong> partida(s) · <strong>${derivedStats.priced}</strong> seleção(ões) com odd · <strong>${derivedStats.unpriced}</strong> candidata(s) sem cotação`;
    if(!matches.length){div.innerHTML=`<div class="empty">Não há partidas Tier 1/Tier 2 cadastradas para ${esc(chosenDate)} (horário de Brasília). Escolha outra data para explorar.</div>`;return;}
    div.innerHTML=groups.map(({m,picks})=>`<div class="daily-match"><div class="daily-match-head"><div><span class="pill">${esc(m.tier)}</span><span class="fine">${localTime(m.startsAt)} · ${esc(m.event)}</span><h3>${esc(m.team1)} × ${esc(m.team2)}</h3></div><button type="button" data-open-match="${esc(m.id)}">Definir mapas / odds</button></div>
      ${picks.length?`<div class="daily-cards">${picks.map(s=>smallCard(s,m,{mini:true})).join('')}</div>`:`<div class="empty">Nenhum mercado estimável nesta partida com os mapas informados. Defina Mapa 1 e Mapa 2 e confira a cobertura histórica.</div>`}</div>`).join('');
  }
  function openMatch(matchId){
    if($('tierFilter'))$('tierFilter').value='all';if($('search'))$('search').value='';
    ai()?.switchMatch(matchId);
    document.querySelector('[data-tab="opportunities"]')?.click();
    window.scrollTo?.({top:0,behavior:'smooth'});
  }
  function sameBook(legs){
    if(!legs.length)return null;
    const first=priceRows(legs[0].s).filter(currentPrice);let best=null;
    for(const row of first){const offers=[row];let ok=true;
      for(const leg of legs.slice(1)){
        const alternative=priceRows(leg.s).find(o=>o.book.trim().toLowerCase()===row.book.trim().toLowerCase()&&currentPrice(o));
        if(!alternative){ok=false;break;}offers.push(alternative);
      }
      if(ok){const combined=offers.reduce((p,o)=>p*o.odd,1);if(!best||combined>best.combined)best={book:row.book,offers,combined};}
    }return best;
  }
  function combosFor(day=chosenDate){
    const matches=activeMatches(day),groups=matches.map(m=>({m, options:picksFor(m,{perMatch:5})})).filter(g=>g.options.length);
    const combos=[];
    for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
      const [a,b]=[groups[i],groups[j]];
      let best=null;
      for(const sa of a.options.slice(0,4))for(const sb of b.options.slice(0,4)){
        if(sa.market===sb.market&&sa.subject===sb.subject)continue;
        const legs=[{s:sa,m:a.m},{s:sb,m:b.m}];const common=sameBook(legs);
        const priced=!!common;
        // Provisórias sem odd são sempre rascunhos; múltiplas com odd precisam de valor esperado individual positivo.
        const favorable=legs.every((x,k)=>quality(x.s).priority>=2 && (!common||x.s.p*common.offers[k].odd>1));
        const rank=(priced&&favorable?10000:priced?500:0) + rating(sa)+rating(sb);
        const cand={legs,common,rank,ready:priced&&favorable};
        if(!best||cand.rank>best.rank)best=cand;
      }
      if(best)combos.push(best);
    }
    combos.sort((a,b)=>b.rank-a.rank);
    const usedPairs=new Set();return combos.filter(c=>{const pair=c.legs.map(x=>x.m.id).sort().join('|');if(usedPairs.has(pair))return false;usedPairs.add(pair);return true;}).slice(0,5);
  }
  function renderCombo(c,i){
    const x=c.common;
    const legs=c.legs.map(({s,m},j)=>`<div class="combo-leg"><span class="pick-leg-no">${j+1}</span><div><strong>${esc(label(s))}</strong><div class="fine">${esc(m.team1)} × ${esc(m.team2)} · ${esc(s.subject)} · ${esc(targetName(s))}</div><span class="fine">${percent(s.p)} preliminar · ${s.notCalibrated?'não calibrada':'frequência do mapa'}</span></div><div class="combo-odd">${x?dec(x.offers[j].odd):'—'}</div></div>`).join('');
    const badge=c.ready?'Ideia cotada · verificar':x?'Cotação sem vantagem detectada':'Rascunho · aguarda odds na mesma casa';
    const combined=x?`<strong>${dec(x.combined)}</strong> · ${esc(x.book)} (odds informadas manualmente)`:'<strong>—</strong> · informe odds na mesma casa';
    return `<article class="combo-card"><div class="combo-head"><span class="pick-chip ${c.ready?'q-caution':'q-watch'}">${esc(badge)}</span><span class="fine">2 seleções · jogos diferentes</span></div>${legs}<div class="combo-footer"><div>Odd combinada ${combined}<p class="fine">Não somamos probabilidades como se fossem independentes; mercados, escalações e odds podem mudar.</p></div><button type="button" data-save-combo="${i}" ${!c.ready?'disabled':''}>Registrar múltipla</button></div></article>`;
  }
  function drawParlays(){
    const combos=combosFor(),container=$('parlayIdeas');if(!container)return;
    draft=combos;
    if(!activeMatches().length)container.innerHTML=`<div class="empty">Sem jogos para ${esc(chosenDate)} no filtro atual. Selecione outra data na aba Destaques do dia.</div>`;
    else if(!combos.length)container.innerHTML='<div class="empty">Não foi possível montar duas seleções em confrontos diferentes com histórico suficiente. Configure os mapas e cadastre as odds.</div>';
    else container.innerHTML=combos.map(renderCombo).join('');
    $('parlaySummary').textContent=`${combos.filter(x=>x.ready).length} múltipla(s) cotada(s) para revisar · ${combos.filter(x=>!x.ready).length} rascunho(s)`;
  }
  function journal(){return readList(journalKey)}
  function saveTicket(legs,stake,type){
    if(!legs.length||!Number.isFinite(stake)||stake<=0||stake>100000){alert('Informe uma unidade/valor positivo e válido para o registro.');return false;}
    if(legs.some(x=>Date.parse(x.m.startsAt)<=Date.now())){alert('Registro pré-jogo indisponível: uma partida já começou.');return false;}
    const offers=type==='parlay'?sameBook(legs):{book:price(legs[0].s)?.book,offers:[price(legs[0].s)],combined:price(legs[0].s)?.odd};
    if(!offers||!offers.offers.every(currentPrice)){alert('Cotações ausentes ou antigas. Atualize as odds da mesma casa antes de registrar.');return false;}
    if(type==='parlay' && (new Set(legs.map(x=>x.m.id))).size!==legs.length){alert('Não combine mercados da mesma partida neste gerador.');return false;}
    const record={id:'t'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),createdAt:new Date().toISOString(),type,stake,book:offers.book,
      legs:legs.map((x,i)=>({matchId:x.m.id,matchLabel:`${x.m.team1} × ${x.m.team2}`,startsAt:x.m.startsAt,market:x.s.market,target:x.s.target,mapName:x.s.mapName||'',subject:x.s.subject,playerId:x.s.playerId||null,team:x.s.team||null,direction:x.s.direction,line:x.s.line,odd:offers.offers[i].odd,prob:x.s.p,notCalibrated:x.s.notCalibrated,grade:'pending',gradedBy:null}))};
    if(storeList(journalKey,[record,...journal()].slice(0,400))){drawJournal();return true;}return false;
  }
  function result(ticket){
    if(ticket.legs.some(l=>l.grade==='lost'))return {status:'lost',payout:0,profit:-ticket.stake};
    if(ticket.legs.some(l=>l.grade==='pending'))return {status:'pending',payout:null,profit:null};
    const active=ticket.legs.filter(l=>l.grade==='won');const gross=active.reduce((x,l)=>x*l.odd,1)*ticket.stake;
    return {status:active.length?'won':'void',payout:gross,profit:gross-ticket.stake};
  }
  function setGrade(ticketId,index,grade){
    if(!['won','lost','void','pending'].includes(grade))return;
    const entries=journal(),ticket=entries.find(x=>x.id===ticketId);if(!ticket||!ticket.legs[index])return;
    ticket.legs[index].grade=grade;ticket.legs[index].gradedBy=grade==='pending'?null:'manual';if(storeList(journalKey,entries))drawJournal();
  }
  function normMap(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
  // Resultado histórico apenas quando a base confirma o jogo e, para mercados de mapa,
  // o mapa REAL naquele número coincide com a hipótese cadastrada antes do jogo.
  function actualValue(leg){
    if(!db)return null;
    const match=(db.past||[]).find(m=>m.id===leg.matchId&&m.status==='completed'&&!m.isForfeit);
    if(!match)return null;
    if(leg.market==='maps_total'&&leg.target==='series'){
      if(Number(match.bestOf)!==3||n(match.team1Score)===null||n(match.team2Score)===null)return null;
      return match.team1Score+match.team2Score;
    }
    const mapNumber=Number(String(leg.target||'').replace('map',''));
    if(!Number.isInteger(mapNumber)||mapNumber<1||mapNumber>3)return null;
    const map=(match.maps||[]).find(x=>Number(x.mapNumber)===mapNumber);
    if(!map||map.status!=='completed'||map.isForfeit||map.statsEligible===false||normMap(map.name||map.mapName)!==normMap(leg.mapName))return null;
    const rows=(db.player_maps||[]).filter(r=>r.matchId===match.id&&Number(r.mapNumber)===mapNumber&&normMap(r.mapName)===normMap(leg.mapName));
    if(leg.market==='rounds_total'){
      if(n(map.team1Score)===null||n(map.team2Score)===null)return null;
      return Number(map.team1Score)+Number(map.team2Score);
    }
    if(leg.market==='team_kills'){
      const tid=leg.subject===match.team1?match.team1Id:leg.subject===match.team2?match.team2Id:null;
      if(!tid)return null;
      const own=rows.filter(r=>r.teamId===tid&&n(r.kills)!==null);
      if(own.length!==5||new Set(own.map(r=>r.playerId)).size!==5)return null;
      return own.reduce((sum,r)=>sum+Number(r.kills),0);
    }
    if(['kills','headshots','assists','firstKills'].includes(leg.market)){
      const player=rows.find(r=>leg.playerId?r.playerId===leg.playerId:String(r.player).toLowerCase()===String(leg.subject).toLowerCase());
      return player?n(player[leg.market]):null;
    }
    return null;
  }
  function autoSettle(){
    const entries=journal();let changes=0;
    for(const ticket of entries){
      for(const leg of ticket.legs){
        if(leg.grade!=='pending'||leg.gradedBy==='manual'||Date.parse(ticket.createdAt)>=Date.parse(leg.startsAt))continue;
        const value=actualValue(leg),line=n(leg.line);
        if(value===null||line===null||!['over','under'].includes(leg.direction))continue;
        const won=leg.direction==='over'?value>line:value<line;
        if(value===line)continue; // linhas inteiras podem ter push: precisa conferir regras da casa
        leg.grade=won?'won':'lost';leg.gradedBy='cito';leg.actual=value;changes++;
      }
    }
    if(changes)storeList(journalKey,entries);
    return changes;
  }
  function drawJournal(){
    const entries=journal(),list=$('pickJournal'),summary=$('profitSummary');if(!list)return;
    const settled=entries.map(x=>({ticket:x,r:result(x)})).filter(x=>x.r.status!=='pending');
    const stake=settled.reduce((a,x)=>a+x.ticket.stake,0),profit=settled.reduce((a,x)=>a+x.r.profit,0);
    summary.innerHTML=`<div><span>Registros fechados</span><strong>${settled.length}</strong></div><div><span>Saldo simulado</span><strong class="${profit>=0?'pick-up':'pick-down'}">${money(profit)}</strong></div><div><span>ROI simulado</span><strong>${stake?percent(profit/stake):'—'}</strong></div><div><span>Em aberto</span><strong>${entries.length-settled.length}</strong></div>`;
    list.innerHTML=entries.length?entries.map(t=>{
      const r=result(t),status=({won:'Ganhou (manual)',lost:'Perdeu (manual)',void:'Anulada',pending:'Pendente'})[r.status];
      return `<article class="journal-item"><div class="journal-top"><div><strong>${t.type==='parlay'?'Múltipla':'Simples'} · ${esc(t.book)}</strong><span class="fine">${localTime(t.createdAt)} · registro manual</span></div><div class="journal-result"><span class="pick-chip ${r.status==='won'?'q-positive':r.status==='lost'?'q-off':'q-watch'}">${status}</span><strong>${r.profit===null?'—':money(r.profit)}</strong></div></div>
        ${t.legs.map((l,i)=>`<div class="journal-leg"><div><strong>${esc(l.matchLabel)}</strong><div class="fine">${esc(l.subject)} · ${esc(l.market)} · ${l.direction==='over'?'Mais de':l.direction==='under'?'Menos de':''} ${n(l.line)!==null?dec(l.line,1):''} · ${esc(l.target)} ${esc(l.mapName)} · odd ${dec(l.odd)}${l.gradedBy==='cito'?' · apurado pela Cito':l.gradedBy==='manual'?' · informado manualmente':''}</div></div><label>Resultado<select data-grade="${esc(t.id)}" data-index="${i}"><option value="pending" ${l.grade==='pending'?'selected':''}>Pendente</option><option value="won" ${l.grade==='won'?'selected':''}>Acertou</option><option value="lost" ${l.grade==='lost'?'selected':''}>Errou</option><option value="void" ${l.grade==='void'?'selected':''}>Anulada</option></select></label></div>`).join('')}
        <div class="journal-bottom"><span class="fine">Valor registrado: ${money(t.stake)} · Odd combinada: ${dec(t.legs.reduce((p,l)=>p*l.odd,1))}</span><button data-remove-ticket="${esc(t.id)}" type="button">Excluir</button></div></article>`;
    }).join(''):'<div class="empty">Ainda não há escolhas registradas. Use “Registrar escolha” ou “Registrar múltipla” após preencher as odds.</div>';
  }
  function matchHighlights(m){
    const target=$('edgeMatchHighlights');if(!target)return;
    focusMatch=m.id;const picks=picksFor(m,{perMatch:4});
    target.innerHTML=`<div class="pick-match-title"><div><h3>Seleções em destaque neste jogo</h3><p class="fine">Prioridade por amostra e odd manual; não significa resultado garantido. Seleções sem preço são apenas mercados para consultar.</p></div><span class="pill">${picks.length} candidatas</span></div>`+
      (picks.length?`<div class="daily-cards">${picks.map(s=>smallCard(s,m,{mini:true})).join('')}</div>`:'<div class="empty">Defina os dois primeiros mapas acima; ainda não há seleções com histórico mínimo nos mapas escolhidos.</div>');
  }
  function refresh(){if(!db||!ai())return;drawDaily();drawParlays();drawJournal();
    const m=(db.upcoming||[]).find(x=>x.id===$('edgeMatchSelect')?.value);if(m)matchHighlights(m);
  }
  function init(snapshot){db=snapshot;autoSettle();
    const date=$('pickDate');if(date){if(!date.value)date.value=chosenDate;chosenDate=date.value;date.onchange=()=>{chosenDate=date.value;refresh()}};
    refresh();
  }
  function handleClick(ev){const target=ev.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-open-match')){openMatch(target.dataset.openMatch);return;}
    if(target.hasAttribute('data-save-combo')){
      const combo=draft[Number(target.dataset.saveCombo)];if(!combo||!combo.ready)return;
      if(saveTicket(combo.legs,n($('pickStake')?.value)||10,'parlay')){alert('Múltipla registrada para acompanhamento manual. Confirme o resultado de cada seleção depois da partida.');}
      return;
    }
    if(target.hasAttribute('data-single')){
      const item=lastPicks.find(x=>id(x.s)===target.dataset.single && quality(x.s).priority>=2) || (db?.upcoming||[]).flatMap(m=>picksFor(m,{perMatch:4}).map(s=>({s,m}))).find(x=>id(x.s)===target.dataset.single&&quality(x.s).priority>=2);
      if(!item)return;
      if(saveTicket([item],n($('pickStake')?.value)||10,'single'))alert('Escolha registrada para acompanhamento manual.');
      return;
    }
    if(target.hasAttribute('data-remove-ticket')){
      if(confirm('Excluir este registro?')){storeList(journalKey,journal().filter(x=>x.id!==target.dataset.removeTicket));drawJournal();}return;
    }
  }
  function handleChange(ev){const e=ev.target.closest('select[data-grade]');if(e)setGrade(e.dataset.grade,Number(e.dataset.index),e.value);}
  document.addEventListener('click',handleClick);document.addEventListener('change',handleChange);
  window.EdgePicks={init,refresh,matchHighlights,picksFor,combosFor,sameBook,quality,localDay,TODAY,result,saveTicket,journal,actualValue,autoSettle};
})();