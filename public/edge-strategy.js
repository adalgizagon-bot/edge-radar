/* CS2 Edge v7 — triagem de valor, faixa 1.50, duplas e auditoria walk-forward.
   SEM odds externas, SEM backtest fictício de lucro, SEM alegar calibração. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '—').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num = v => (v===null || v===undefined || v==='' || !Number.isFinite(Number(v))) ? null : Number(v);
  const pct = (p, d=1) => Number.isFinite(p) ? (p*100).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})+'%' : '—';
  const fmt = (x,d=2) => Number.isFinite(x) ? x.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const brl = x => Number.isFinite(x) ? x.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : '—';
  const TZ='America/Sao_Paulo';
  const marketLabels={kills:'Kills jogador',headshots:'Headshots',assists:'Assistências',firstKills:'Primeiras kills',rounds_total:'Rounds/mapa',team_kills:'Kills da equipe',maps_total:'Total mapas MD3'};
  const validPrice = x => Number.isFinite(+x?.odd) && +x.odd>1 && +x.odd<=500 && !!String(x?.book||'').trim() &&
     !!x.date && Number.isFinite(Date.parse(x.date)) && Date.now()>=Date.parse(x.date)-60000 && Date.now()-Date.parse(x.date)<24*3600*1000;
  const localDay = iso => {if (!Number.isFinite(Date.parse(iso||''))) return '';
    const chunks=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
    const v=Object.fromEntries(chunks.map(k=>[k.type,k.value]));return `${v.year}-${v.month}-${v.day}`;};
  const today = () => localDay(new Date().toISOString());
  const selectionId=s=>[s.matchId,s.target,s.mapName||'',s.market,s.subject,s.direction,s.line].join('|');
  const norm = v=>String(v||'').toLowerCase().trim();
  const positive = s => !!(s?.valid && num(s.p)!==null && s.p>.005 && s.p<.995 && s.market!=='series_winner' && s.kind!=='placeholder');
  const matchOdds=(s,x)=>x?.matchId===s.matchId && x.target===s.target && x.market===s.market && norm(x.subject)===norm(s.subject) &&
    String(x.direction)===String(s.direction) && num(x.line)===num(s.line) && (s.target==='series'||(!!x.mapName&&norm(x.mapName)===norm(s.mapName)));
  function odds(){try{const r=window.oddsLoad?.()??JSON.parse(localStorage.getItem('cs2edge.manualOdds')||'[]');return Array.isArray(r)?r:[]}catch{return []}}
  function offers(s,rows=odds()){return rows.filter(x=>matchOdds(s,x)&&validPrice(x)).sort((a,b)=>+b.odd-(+a.odd));}
  function assessment(s,odd,minEdge=.03){
    const p=num(s?.p),o=num(odd),n=num(s?.n)||0;
    if(!positive(s))return {level:'blocked',label:'Sem base para estimar',score:-Infinity};
    if(o===null||o<=1)return {level:'watch',label:'Aguardando odd',score:n};
    const implied=1/o,ev=p*o-1,conservative=(num(s.low)!==null && !s.notCalibrated)?s.low*o-1:null;
    const provisional=!!s.notCalibrated;
    const score=(provisional?-23:5)+Math.min(n,50)*.6+Math.max(-.25,Math.min(.25,ev))*75 +
        (conservative===null?-8:Math.max(-.30,Math.min(.20,conservative))*85);
    if(ev<minEdge)return {level:'no',label:'Sem margem mínima',p,implied,ev,conservative,score};
    // Todas as probabilidades atuais são preliminares. O selo não é "validado".
    if(provisional)return {level:'explore',label:'Projeção exploratória',p,implied,ev,conservative,score};
    if(conservative!==null && conservative>0 && n>=20)return {level:'review',label:'Margem amostral · revisar',p,implied,ev,conservative,score};
    return {level:'caution',label:'Vantagem preliminar',p,implied,ev,conservative,score};
  }
  function allMatches(snapshot,day){const tier=$('tierFilter')?.value||'all',query=norm($('search')?.value||'');
    return (snapshot?.upcoming||[]).filter(m=>m.status==='upcoming' && Number.isFinite(Date.parse(m.startsAt)) &&
      Date.parse(m.startsAt)>Date.now() && localDay(m.startsAt)===day && (tier==='all'||m.tier===tier) &&
      norm(`${m.team1} ${m.team2} ${m.event}`).includes(query))
      .sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
  }
  function collect(snapshot,day,minEdge=.03){
    const engine=window.EdgeIntelligence;
    if(!engine)return {priced:[],watch:[],matches:[]};
    const matches=allMatches(snapshot,day),allOdds=odds(),priced=[],watch=[];
    for(const m of matches){
      const seq=engine.getSequence(m.id),list=engine.allMarketCards(m,seq)||[];
      const used=new Set(),matchWatch=[];
      for(const s of list){
        if(!positive(s) || s.target==='map3')continue; // M3 não é garantido
        const key=selectionId(s);if(used.has(key))continue;used.add(key);
        const choices=offers(s,allOdds),off=choices[0]||null;
        const ev=assessment(s,off?.odd,minEdge),entry={s,m,offer:off,choices,ev};
        if(off) priced.push(entry); else matchWatch.push(entry);
      }
      matchWatch.sort((a,b)=>(b.s.notCalibrated?0:1)-(a.s.notCalibrated?0:1)||Math.min(50,b.s.n||0)-Math.min(50,a.s.n||0));
      const seen=new Set();for(const x of matchWatch){const key=x.s.market+'|'+x.s.subject+'|'+x.s.target;if(seen.has(key))continue;
        watch.push(x);seen.add(key);if(seen.size>=3)break;}
    }
    priced.sort((a,b)=>b.ev.score-a.ev.score);
    return {priced,watch,matches};
  }
  function candidates(c,minEdge=.03){return c.priced.filter(x=>x.ev.ev>=minEdge && x.ev.level!=='no' && x.ev.level!=='blocked');}
  function lowOdds(c,minEdge=.03){return candidates(c,minEdge).filter(x=>+x.offer.odd>=1.4&&+x.offer.odd<=1.6).slice(0,4);}
  function commonBook(a,b,minEdge=.03){
    let best=null;
    for(const x of a.choices)for(const y of b.choices){
      if(norm(x.book)!==norm(y.book))continue;
      const evA=assessment(a.s,+x.odd,minEdge),evB=assessment(b.s,+y.odd,minEdge);
      if(evA.ev<minEdge||evB.ev<minEdge)continue;
      const odd=(+x.odd)*(+y.odd),p=a.s.p*b.s.p,raw=p*odd-1;
      const entry={book:x.book,odd,offers:[x,y],ev:raw,p,score:evA.score+evB.score+Math.max(-20,Math.min(20,raw*20))};
      if(!best||entry.score>best.score)best=entry;
    }return best;
  }
  function pairs(c,minEdge=.03){
    const options=candidates(c,minEdge).slice(0,45),result=[];
    for(let i=0;i<options.length;i++)for(let j=i+1;j<options.length;j++){
      const a=options[i],b=options[j];if(a.m.id===b.m.id)continue;
      const join=commonBook(a,b,minEdge);if(!join||join.ev<minEdge)continue;
      result.push({legs:[a,b],...join});
    }
    result.sort((a,b)=>b.score-a.score);
    const used=new Set(),out=[];
    for(const p of result){const matchKey=p.legs.map(x=>x.m.id).sort().join('|');if(used.has(matchKey))continue;used.add(matchKey);out.push(p);if(out.length===5)break;}
    return out;
  }
  function ticketResult(t){const legs=t?.legs||[],stake=num(t?.stake)||0;
    if(legs.some(x=>x.grade==='lost'))return {state:'lost',profit:-stake};
    if(legs.some(x=>x.grade==='pending'))return {state:'pending',profit:null};
    const wins=legs.filter(x=>x.grade==='won');return {state:wins.length?'won':'void',profit:stake*(wins.reduce((a,x)=>a*Number(x.odd),1)-1)};
  }
  function metrics(tickets){
    const ordered=[...(tickets||[])].filter(t=>t?.createdAt).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    const done=ordered.map(t=>({t,r:ticketResult(t)})).filter(x=>x.r.profit!==null);
    const stake=done.reduce((s,x)=>s+(num(x.t.stake)||0),0),profit=done.reduce((s,x)=>s+x.r.profit,0);
    let running=0,peak=0,maxDrawdown=0,wins=0;
    for(const x of done){running+=x.r.profit;peak=Math.max(peak,running);maxDrawdown=Math.max(maxDrawdown,peak-running);if(x.r.state==='won')wins++;}
    const singles=done.filter(x=>x.t.type==='single'),doubles=done.filter(x=>x.t.type==='parlay');
    const range=singles.filter(x=>{const o=num(x.t.legs?.[0]?.odd);return o!==null&&o>=1.4&&o<=1.6;});
    const roi=rows=>{const st=rows.reduce((a,x)=>a+(num(x.t.stake)||0),0);return st?rows.reduce((a,x)=>a+x.r.profit,0)/st:null;};
    let clvSum=0,clvN=0;
    for(const x of done)for(const leg of x.t.legs||[]){const taken=num(leg.odd),closed=num(leg.closingOdd);if(taken>1&&closed>1){clvSum+=taken/closed-1;clvN++;}}
    return {count:done.length,open:(tickets||[]).length-done.length,stake,profit,roi:stake?profit/stake:null,wins,winRate:done.length?wins/done.length:null,
      maxDrawdown,groups:[{name:'Simples',rows:singles,roi:roi(singles)},{name:'Faixa 1,40–1,60',rows:range,roi:roi(range)},{name:'Múltiplas',rows:doubles,roi:roi(doubles)}],clv:clvN?clvSum/clvN:null,clvN};
  }
  const LINES={kills:[7.5,9.5,11.5,13.5,15.5,17.5,19.5,21.5,23.5,25.5],headshots:[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,11.5],assists:[.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,9.5]};
  // Walk-forward: cada previsão considera somente os mapas ANTERIORES do mesmo atleta,
  // compara com o resultado do mapa seguinte e NUNCA utiliza odds retrospectivas fictícias.
  function auditWalkForward(snapshot){
    const grouped=new Map();const seen=new Set();
    for(const row of snapshot?.player_maps||[]){
      if(!row.playerId||!row.teamId||!row.mapId||!row.startsAt||!Number.isFinite(Date.parse(row.startsAt)))continue;
      if(Date.parse(row.startsAt)>Date.now())continue;
      const key=row.mapId+'|'+row.playerId;if(seen.has(key))continue;seen.add(key);
      const player=row.teamId+'|'+row.playerId;if(!grouped.has(player))grouped.set(player,[]);grouped.get(player).push(row);
    }
    const metrics=['kills','headshots','assists'],samples={kills:[],headshots:[],assists:[]};
    for(const rows of grouped.values()){
      rows.sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt))||String(a.mapId).localeCompare(String(b.mapId)));
      for(const metric of metrics){
        const observed=rows.filter(x=>num(x[metric])!==null);
        for(let i=10;i<observed.length;i++){
          const prior=observed.slice(Math.max(0,i-30),i),value=num(observed[i][metric]);
          // Não estimar o próximo mapa quando há timestamps idênticos (risco de leakage).
          if(prior.some(x=>x.mapId===observed[i].mapId)||String(prior.at(-1)?.startsAt)>=String(observed[i].startsAt))continue;
          const mean=prior.reduce((a,x)=>a+Number(x[metric]),0)/prior.length;
          const line=LINES[metric].reduce((best,line)=>Math.abs(line-mean)<Math.abs(best-mean)?line:best);
          const hits=prior.filter(x=>Number(x[metric])>line).length,p=(hits+1)/(prior.length+2),actual=value>line?1:0;
          samples[metric].push({p,actual,line,n:prior.length,at:observed[i].startsAt});
        }
      }
    }
    const reports={};
    for(const metric of metrics){const obs=samples[metric],count=obs.length;
      const avgPred=count?obs.reduce((a,x)=>a+x.p,0)/count:null,hitRate=count?obs.reduce((a,x)=>a+x.actual,0)/count:null;
      const brier=count?obs.reduce((a,x)=>a+(x.p-x.actual)**2,0)/count:null;
      const bins=[];let weighted=0;
      for(let a=0;a<10;a++){const members=obs.filter(x=>Math.min(9,Math.floor(x.p*10))===a);if(!members.length)continue;
        const predicted=members.reduce((sum,x)=>sum+x.p,0)/members.length,real=members.reduce((sum,x)=>sum+x.actual,0)/members.length;
        bins.push({label:`${a*10}–${(a+1)*10}%`,n:members.length,predicted,real});weighted+=members.length*Math.abs(predicted-real);}
      reports[metric]={count,avgPred,hitRate,brier,ece:count?weighted/count:null,bins};
    }
    return reports;
  }
  const badgeFor=e=>e.level==='review'?'q-positive':e.level==='explore'||e.level==='caution'?'q-caution':e.level==='no'?'q-off':'q-watch';
  const nameFor=s=>marketLabels[s.market]||s.market;
  const description=s=>`${nameFor(s)} · ${s.direction==='over'?'Mais de':'Menos de'} ${fmt(num(s.line),1)} · ${s.target==='series'?'Série':s.target?.replace('map','Mapa ')}${s.mapName?' ('+s.mapName+')':''}`;
  const scope=s=>s.notCalibrated?`Projeção combinada · ${s.mapN||0} neste mapa / ${s.totalN||0} gerais`:`${s.n||0} registros históricos específicos`;
  function card(x,{compact=false}={}){
    const {s,m,offer,ev}=x,market=description(s);
    return `<article class="strategy-pick ${compact?'compact':''}"><div class="strategy-pick-head"><span class="pick-chip ${badgeFor(ev)}">${esc(ev.label)}</span><span class="fine">${esc(m.tier)} · ${esc(s.target)}</span></div>
      <h3>${esc(m.team1)} × ${esc(m.team2)}</h3><div class="strat-market">${esc(market)} · <strong>${esc(s.subject)}</strong></div>
      <div class="strategy-stats"><div><span>Odd informada</span><strong>${offer?fmt(+offer.odd):'—'}</strong></div><div><span>Prob. preliminar</span><strong>${pct(s.p)}</strong></div><div><span>EV teórico</span><strong>${ev.ev!==undefined?pct(ev.ev):'—'}</strong></div><div><span>Ponto de equilíbrio</span><strong>${ev.implied?pct(ev.implied):'—'}</strong></div></div>
      <p class="fine">${esc(scope(s))}${offer?' · '+esc(offer.book)+' · odd cadastrada manualmente':''}. Sem validação fora da amostra para este confronto.</p>
      <button type="button" data-strat-match="${esc(m.id)}">Abrir confronto e conferir odds</button></article>`;
  }
  function renderPairs(rows){if(!rows.length)return '<p class="strategy-empty">Nenhuma dupla com duas odds recentes, da mesma casa e vantagem teórica individual. Não vamos fabricar múltiplas.</p>';
    return rows.slice(0,3).map(p=>`<article class="strategy-double"><div class="strategy-double-head"><span class="pick-chip q-caution">Dupla exploratória</span><strong>${fmt(p.odd)} · ${esc(p.book)}</strong></div>
      ${p.legs.map((x,i)=>`<p><strong>${i+1}. ${esc(x.m.team1)} × ${esc(x.m.team2)}</strong> — ${esc(description(x.s))} (${esc(x.s.subject)}) · odd ${fmt(p.offers[i].odd)}</p>`).join('')}
      <p class="fine">Probabilidade combinada ${pct(p.p)} apenas se as estimativas forem corretas e os eventos independentes; EV condicional ${pct(p.ev)}. Independência, calibração e liquidação devem ser verificadas.</p></article>`).join('');}
  function renderAudit(audit){const entries=Object.entries(audit),total=entries.reduce((a,[,v])=>a+v.count,0);
    if(!total)return '<p class="strategy-empty">Ainda não há histórico suficiente para o teste temporal. A coleta continuará acumulando mapas.</p>';
    return `<p class="fine">Teste cronológico sem usar resultados futuros: a cada jogo, calcula a frequência dos até 30 mapas anteriores do atleta e compara com o resultado seguinte. Não corresponde às odds de casas nem valida o modelo contextual atual.</p>
      <div class="strategy-audit-grid">${entries.map(([key,s])=>`<div class="strategy-audit-item"><h4>${esc(nameFor({market:key}))}</h4><strong>${s.count} previsões</strong><p>Probabilidade média ${pct(s.avgPred)} · ocorrência ${pct(s.hitRate)}</p><p>Brier ${fmt(s.brier,3)} · desvio médio de calibração ${pct(s.ece)}</p><div class="strategy-bins">${s.bins.filter(b=>b.n>=3).map(b=>`<div><span>${esc(b.label)} (${b.n})</span><span>Prev. ${pct(b.predicted)} / real ${pct(b.real)}</span></div>`).join('')||'<span class="fine">Poucas amostras por faixa.</span>'}</div></div>`).join('')}</div>`;
  }
  function renderPerformance(m){
    return `<div class="strategy-performance-grid"><div><span>Registros encerrados</span><strong>${m.count}</strong></div><div><span>ROI simulado*</span><strong>${pct(m.roi)}</strong></div><div><span>Saldo simulado*</span><strong>${brl(m.profit)}</strong></div><div><span>Maior queda registrada</span><strong>${brl(m.maxDrawdown)}</strong></div><div><span>CLV médio informado</span><strong>${pct(m.clv)}</strong></div></div>
      <div class="strategy-split">${m.groups.map(g=>`<div><strong>${esc(g.name)}</strong><span>${g.rows.length} registros</span><span>ROI ${pct(g.roi)}</span></div>`).join('')}</div>
      <p class="fine">*Somente apostas registradas e liquidadas neste navegador. Histórico manual, sujeito a seleção e edição; não comprova apostas reais nem garante resultados futuros. CLV utiliza odd de fechamento informada por você (${m.clvN} cotações).</p>`;
  }
  function enrichJournal(){const journal=$('pickJournal');if(!journal||!window.EdgePicks)return;
    const index=new Map(window.EdgePicks.journal().map(t=>[t.id,t]));
    for(const select of journal.querySelectorAll('select[data-grade]')){
      const id=select.dataset.grade,idx=Number(select.dataset.index),leg=index.get(id)?.legs?.[idx];if(!leg)continue;
      if(select.parentElement?.parentElement?.querySelector('input[data-strat-closing]'))continue;
      const label=document.createElement('label');label.className='strat-closing-label';label.textContent='Odd fechamento (manual)';
      const input=document.createElement('input');input.type='number';input.min='1.01';input.max='500';input.step='0.01';input.placeholder='Opcional';
      input.dataset.stratClosing=id;input.dataset.index=String(idx);if(num(leg.closingOdd)>1)input.value=String(leg.closingOdd);
      label.appendChild(input);select.parentElement.parentElement.appendChild(label);
    }
  }
  let db=null,chosenDay='',lastAudit=null,cacheKey='',defaultEdge=.03,initialized=false;
  function draw(){if(!db||!$('strategyCandidates'))return;
    const date=$('strategyDate'),mode=$('strategyMode')?.value||'all',input=$('strategyEdge');
    if(date?.value)chosenDay=date.value;else if(date)date.value=chosenDay;
    const edge=Math.max(0,Math.min(.25,(num(input?.value)??3)/100));defaultEdge=edge;
    const c=collect(db,chosenDay,edge),ranked=candidates(c,edge),small=lowOdds(c,edge),combos=pairs(c,edge);
    const normal=mode==='small'?small:mode==='rounds'?ranked.filter(x=>x.s.market==='rounds_total'):
      mode==='kills'?ranked.filter(x=>['kills','team_kills'].includes(x.s.market)):
      mode==='maps'?ranked.filter(x=>x.s.market==='maps_total'):ranked;
    $('strategyKpis').innerHTML=`<div><strong>${c.matches.length}</strong><span>Confrontos na data</span></div><div><strong>${c.priced.length}</strong><span>Seleções cotadas</span></div><div><strong>${ranked.length}</strong><span>Com EV preliminar ≥ ${fmt(edge*100,0)}%</span></div><div><strong>${combos.length}</strong><span>Duplas exploratórias</span></div>`;
    $('strategyFeatured').innerHTML=small.length?`<div class="strategy-featured-head"><strong>Faixa de odds 1,40–1,60</strong><span class="fine">Filtro de preço, não garantia de acerto</span></div>${card(small[0],{compact:true})}`:
      `<p class="strategy-empty">Nenhuma cotação de 1,40–1,60 com margem teórica suficiente nesta data. Não é necessário encontrar uma aposta todos os dias.</p>`;
    $('strategyCandidates').innerHTML=normal.length?normal.slice(0,18).map(x=>card(x)).join(''):
      `<p class="strategy-empty">Sem oportunidades cotadas que passem nos filtros. ${c.priced.length?'As odds registradas não apresentam a margem mínima exigida.':'Cadastre odds nas análises por partida para avaliar valor.'}</p>`;
    $('strategyWatch').innerHTML=c.watch.length?c.watch.slice(0,10).map(x=>card(x,{compact:true})).join(''):
      '<p class="strategy-empty">Escolha Mapa 1 e Mapa 2 nas partidas para gerar mercados e consultar odds.</p>';
    $('strategyPairs').innerHTML=renderPairs(combos);
    const key=[db.meta?.collectedAt,(db.player_maps||[]).length,(db.past||[]).length].join('|');
    if(!lastAudit||cacheKey!==key){lastAudit=auditWalkForward(db);cacheKey=key;}
    $('strategyBacktest').innerHTML=renderAudit(lastAudit);
    $('strategyPerformance').innerHTML=renderPerformance(metrics(window.EdgePicks?.journal?.()||[]));
    enrichJournal();
  }
  function refresh(){draw();}
  function init(snapshot){db=snapshot;
    chosenDay=initialized?($('strategyDate')?.value||chosenDay):($('pickDate')?.value||today());
    if(!initialized && !allMatches(db,chosenDay).length){const next=(db?.upcoming||[]).filter(x=>x.status==='upcoming'&&Date.parse(x.startsAt)>Date.now())
      .sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)))[0];if(next)chosenDay=localDay(next.startsAt);}
    const date=$('strategyDate');if(date){date.value=chosenDay;if(!initialized)date.addEventListener('change',refresh);}
    if(!initialized){for(const x of ['strategyMode','strategyEdge'])$(x)?.addEventListener('change',refresh);
      $('pickDate')?.addEventListener('change',()=>{chosenDay=$('pickDate').value;if(date)date.value=chosenDay;refresh();});}
    // Recebe mudanças nos odds e vetos sem alterar as rotinas originais.
    if(window.EdgePicks && !window.EdgePicks.__strategyWrapped){const original=window.EdgePicks.refresh;
      window.EdgePicks.refresh=function (...args){const r=original.apply(this,args);refresh();return r;};window.EdgePicks.__strategyWrapped=true;}
    initialized=true;draw();
  }
  function openMatch(id){const select=$('tierFilter'),search=$('search');if(select)select.value='all';if(search)search.value='';
    window.EdgeIntelligence?.switchMatch(id);document.querySelector('[data-tab="opportunities"]')?.click();window.scrollTo?.({top:0,behavior:'smooth'});}
  document.addEventListener('click',e=>{const el=e.target.closest?.('[data-strat-match]');if(el)openMatch(el.dataset.stratMatch);});
  document.addEventListener('change',e=>{
    if(e.target?.matches?.('select[data-grade]')){refresh();return;}
    if(e.target?.matches?.('input[data-strat-closing]')){
      const id=e.target.dataset.stratClosing,idx=Number(e.target.dataset.index),value=num(e.target.value);
      if(value!==null&&(value<=1||value>500)){alert('A odd de fechamento deve ser maior que 1.');return;}
      try{const list=window.EdgePicks?.journal?.()||[],entry=list.find(x=>x.id===id);
        if(!entry||!entry.legs[idx])return;entry.legs[idx].closingOdd=value;
        localStorage.setItem('cs2edge.selectionJournal.v1',JSON.stringify(list));refresh();}
      catch{alert('Não foi possível salvar a odd de fechamento neste navegador.');}
    }
  });
  document.addEventListener('click',e=>{const btn=e.target.closest?.('button[data-save-combo],button[data-single],button[data-remove-ticket]');if(btn)refresh();});
  window.EdgeStrategy={init,refresh,assessment,collect,candidates,lowOdds,pairs,commonBook,offers,auditWalkForward,metrics,ticketResult,validPrice,localDay};
})();