/* CS2 Edge | Minha Banca v1: registro financeiro local, separado do diário simulado. */
(function () {
  'use strict';
  const KEY = 'cs2edge.bankroll.v1';
  const JOURNAL = 'cs2edge.selectionJournal.v1';
  const $ = id => document.getElementById(id);
  const safe = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const pct = v => Number.isFinite(v)?(v*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
  const rounded = n => Math.round((Number(n)+Number.EPSILON)*100)/100;
  const dayInBrazil = date => {const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
  const today = () => dayInBrazil(new Date());
  const asDay = v => {if(typeof v==='string' && /^\d{4}-\d\d-\d\d$/.test(v))return v;
    if(!Number.isFinite(Date.parse(v||'')))return today();return dayInBrazil(new Date(v));};
  const uid = () => 'b'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
  const storage = () => {try {return JSON.parse(localStorage.getItem(KEY) || 'null');}catch{return null;}};
  const fresh = () => ({version:1,configured:false,initial:0,startedAt:today(),transactions:[],bets:[],linkedTickets:[]});
  function clean(raw){
    const d=raw&&typeof raw==='object'?raw:fresh();
    return {version:1,configured:!!d.configured,initial:rounded(d.initial||0),startedAt:asDay(d.startedAt||today()),
      transactions:Array.isArray(d.transactions)?d.transactions:[],bets:Array.isArray(d.bets)?d.bets:[],
      linkedTickets:Array.isArray(d.linkedTickets)?d.linkedTickets:[]};
  }
  const load=()=>clean(storage());
  function save(d){try{localStorage.setItem(KEY,JSON.stringify(d));return true;}catch{alert('Não foi possível salvar no navegador. Faça um backup e confira o armazenamento.');return false;}}
  function journal(){try{const v=JSON.parse(localStorage.getItem(JOURNAL)||'[]');return Array.isArray(v)?v:[]}catch{return []}}
  function validAmount(v){const n=Number(v);return Number.isFinite(n)&&n>0&&n<=1e9?n:null;}
  function validDate(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'));}
  function ticketStatus(ticket){
    const legs=Array.isArray(ticket.legs)?ticket.legs:[];
    if(!legs.length)return {status:'pending',profit:0,odd:1};
    if(legs.some(x=>x.grade==='lost'))return {status:'lost',profit:-Number(ticket.stake),odd:0};
    if(legs.some(x=>!['won','void'].includes(x.grade)))return {status:'pending',profit:0,odd:null};
    const odd=legs.filter(x=>x.grade==='won').reduce((p,x)=>p*Number(x.odd),1);
    return {status:legs.some(x=>x.grade==='won')?'won':'void',profit:rounded(Number(ticket.stake)*(odd-1)),odd};
  }
  function ticketSettlement(ticket){
    const legs=ticket.legs||[];const exact=legs.filter(l=>l.gradedAt&&Number.isFinite(Date.parse(l.gradedAt))).map(l=>asDay(l.gradedAt));
    if(exact.length===legs.length&&legs.length)return {day:exact.sort().at(-1),estimated:false};
    const starts=legs.filter(l=>l.startsAt&&Number.isFinite(Date.parse(l.startsAt))).map(l=>asDay(l.startsAt));
    return {day:starts.sort().at(-1)||asDay(ticket.createdAt),estimated:true};
  }
  function records(d=load(),entries=journal()){
    const linked=new Set(d.linkedTickets.map(x=>typeof x==='string'?x:x.id));
    const items=[];
    for(const b of d.bets){const stake=Number(b.stake),odd=Number(b.odd);
      if(!(stake>0&&odd>1))continue;
      const status=['won','lost','void'].includes(b.status)?b.status:'pending';
      items.push({id:b.id,source:'manual',label:b.label||'Aposta manual',book:b.book||'',strategy:b.strategy||'other',stake,odd,status,
        placedAt:asDay(b.placedAt),settledAt:status==='pending'?null:asDay(b.settledAt||b.placedAt),
        profit:status==='won'?rounded(stake*(odd-1)):status==='lost'?-stake:0,estimatedDate:false});
    }
    for(const t of entries){if(!linked.has(t.id))continue;
      const stake=Number(t.stake);if(!(stake>0))continue;
      const r=ticketStatus(t),settle=ticketSettlement(t);
      items.push({id:t.id,source:'journal',label:(t.type==='parlay'?'Múltipla':'Simples')+' · '+(t.legs||[]).map(l=>l.matchLabel||l.subject||'Partida').join(' / '),
        book:t.book||'',strategy:t.type==='parlay'?'dupla':'simples',stake,odd:r.odd,status:r.status,
        placedAt:asDay(t.createdAt),settledAt:r.status==='pending'?null:settle.day,profit:r.profit,estimatedDate:settle.estimated});
    }
    return items.sort((a,b)=>b.placedAt.localeCompare(a.placedAt)||String(b.id).localeCompare(String(a.id)));
  }
  function calculate(d=load(),entries=journal()){
    const bets=records(d,entries),deposits=d.transactions.filter(x=>x.type==='deposit').reduce((a,x)=>a+Number(x.amount||0),0),
      withdrawals=d.transactions.filter(x=>x.type==='withdrawal').reduce((a,x)=>a+Number(x.amount||0),0);
    const settled=bets.filter(x=>x.status!=='pending'),open=bets.filter(x=>x.status==='pending');
    const profit=rounded(settled.reduce((a,x)=>a+x.profit,0)),risk=rounded(open.reduce((a,x)=>a+x.stake,0)),
      closedStakes=settled.reduce((a,x)=>a+x.stake,0),equity=rounded(d.initial+deposits-withdrawals+profit),
      available=rounded(equity-risk);
    const events=[...d.transactions.filter(x=>validDate(x.date)).map(x=>({day:x.date,kind:x.type,value:x.type==='deposit'?Number(x.amount):-Number(x.amount),id:x.id})),
      ...settled.map(x=>({day:x.settledAt||x.placedAt,kind:'result',value:x.profit,id:x.id}))];
    const sequence=[{day:d.startedAt,capital:d.initial,profit:0,description:'Capital inicial'}];
    events.sort((a,b)=>a.day.localeCompare(b.day)||((a.kind==='result')-(b.kind==='result'))||String(a.id).localeCompare(String(b.id)));
    let capital=d.initial,cumProfit=0,peak=0,drawdown=0;
    for(const e of events){capital=rounded(capital+e.value);if(e.kind==='result'){cumProfit=rounded(cumProfit+e.value);peak=Math.max(peak,cumProfit);drawdown=Math.max(drawdown,rounded(peak-cumProfit));}
      sequence.push({day:e.day,capital,profit:cumProfit,description:e.kind});}
    const won=settled.filter(x=>x.status==='won').length,lost=settled.filter(x=>x.status==='lost').length;
    return {bets,settled,open,capital:equity,available,risk,profit,deposits,withdrawals,closedStakes,
      roi:closedStakes>0?profit/closedStakes:null,won,lost,drawdown,sequence};
  }
  function pointsSvg(values,width,height,min,max,color){const x=(i)=>40+(values.length<2?0:i*(width-60)/(values.length-1));const y=v=>height-30-(v-min)/(max-min)*(height-50);
    return `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${values.map((v,i)=>x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ')}"/>`;
  }
  function chartHtml(m){
    const seq=m.sequence,initial=seq[0]?.capital||0;const data=seq.length===1?[seq[0],{...seq[0],day:today()}]:seq;
    const capitals=data.map(x=>x.capital),profits=data.map(x=>initial+x.profit),all=[...capitals,...profits];
    let min=Math.min(...all),max=Math.max(...all);if(max===min){max+=1;min-=1;}const pad=Math.max((max-min)*.12,1);max+=pad;min-=pad;
    const y=v=>(195-30-(v-min)/(max-min)*(195-50)).toFixed(1);
    return `<div class="bank-chart-wrap"><svg viewBox="0 0 700 195" preserveAspectRatio="none" role="img" aria-label="Evolução do capital e desempenho acumulado em reais">
      ${[0,.25,.5,.75,1].map(f=>`<line x1="40" x2="680" y1="${25+f*140}" y2="${25+f*140}" stroke="#304454" stroke-dasharray="3 5" opacity=".7"/>`).join('')}
      ${pointsSvg(capitals,700,195,min,max,'#57d6c6')}${pointsSvg(profits,700,195,min,max,'#e1b669')}
      <text x="5" y="${y(max)}" fill="#a9bcca" font-size="12">${safe(Math.round(max).toLocaleString('pt-BR'))}</text>
      <text x="5" y="${y(min)}" fill="#a9bcca" font-size="12">${safe(Math.round(min).toLocaleString('pt-BR'))}</text>
      <text x="42" y="187" fill="#a9bcca" font-size="12">${safe(data[0].day.slice(5))}</text>
      <text x="680" y="187" text-anchor="end" fill="#a9bcca" font-size="12">${safe(data.at(-1).day.slice(5))}</text></svg></div>
      <div class="bank-legend"><span><i style="background:#57d6c6"></i>Capital (inclui depósitos/retiradas)</span><span><i style="background:#e1b669"></i>Resultado acumulado, sem aportes</span></div>`;
  }
  function render(){const host=$('bankContent');if(!host)return;const d=load(),entries=journal(),m=calculate(d,entries);
    const init=$('bankInitial');if(init&&!init.matches?.(':focus'))init.value=d.configured?d.initial:'';const st=$('bankStartDate');if(st&&!st.matches?.(':focus'))st.value=d.startedAt;
    const configured=d.configured;
    $('bankBanner').innerHTML=configured?`Banca iniciada em ${safe(d.startedAt.split('-').reverse().join('/'))}. Dados armazenados <strong>somente neste navegador</strong>. Bilhetes do diário são simulações até você confirmar a inclusão individual.`:
      'Informe seu capital inicial para começar. Nenhuma aposta do histórico simulado será somada automaticamente.';
    $('bankSummary').innerHTML=`<article><span>Capital atual*</span><strong>${configured?money(m.capital):'—'}</strong></article>
      <article><span>Disponível (menos apostas abertas)</span><strong>${configured?money(m.available):'—'}</strong></article>
      <article><span>Comprometido em aberto</span><strong>${configured?money(m.risk):'—'}</strong></article>
      <article><span>Lucro/prejuízo realizado</span><strong class="${m.profit<0?'bank-negative':'bank-positive'}">${configured?money(m.profit):'—'}</strong></article>
      <article><span>ROI sobre apostas encerradas</span><strong>${configured&&m.roi!==null?pct(m.roi):'—'}</strong></article>
      <article><span>Maior queda em resultados</span><strong>${configured?money(m.drawdown):'—'}</strong></article>`;
    $('bankChart').innerHTML=configured?chartHtml(m):'<p class="fine">O gráfico aparecerá depois que você configurar o capital inicial.</p>';
    $('bankStats').innerHTML=configured?`<span>Depósitos: <strong>${money(m.deposits)}</strong></span><span>Retiradas: <strong>${money(m.withdrawals)}</strong></span><span>Bilhetes encerrados: <strong>${m.settled.length}</strong></span><span>Acertos/perdas: <strong>${m.won} / ${m.lost}</strong></span>`:'';
    const trans=[...d.transactions].sort((a,b)=>b.date.localeCompare(a.date));
    $('bankTransactions').innerHTML=trans.length?trans.map(t=>`<tr><td>${safe(t.date.split('-').reverse().join('/'))}</td><td>${t.type==='deposit'?'Depósito':'Retirada'}</td><td>${money(t.amount)}</td><td>${safe(t.note||'—')}</td><td><button class="bank-link" type="button" data-bank-delete-trans="${safe(t.id)}">Excluir</button></td></tr>`).join(''):'<tr><td colspan="5" class="fine">Nenhuma movimentação registrada.</td></tr>';
    $('bankBets').innerHTML=m.bets.length?m.bets.map(b=>`<tr><td><strong>${safe(b.label)}</strong><div class="fine">${safe(b.book)} · ${safe(b.placedAt)}${b.source==='journal'?' · Diário vinculado':''}${b.estimatedDate?' · data do resultado aproximada':''}</div></td>
      <td>${money(b.stake)}</td><td>${Number.isFinite(b.odd)?b.odd.toFixed(2):'—'}</td><td>${b.source==='manual'?`<select aria-label="Resultado" data-bank-grade="${safe(b.id)}"><option value="pending"${b.status==='pending'?' selected':''}>Pendente</option><option value="won"${b.status==='won'?' selected':''}>Ganhou</option><option value="lost"${b.status==='lost'?' selected':''}>Perdeu</option><option value="void"${b.status==='void'?' selected':''}>Anulada</option></select>`:safe(({won:'Ganhou',lost:'Perdeu',void:'Anulada',pending:'Pendente'})[b.status])}</td>
      <td class="${b.profit<0?'bank-negative':b.profit>0?'bank-positive':''}">${b.status==='pending'?'—':money(b.profit)}</td><td>${b.source==='manual'?`<button type="button" class="bank-link" data-bank-delete-bet="${safe(b.id)}">Excluir</button>`:'<button type="button" class="bank-link" data-bank-unlink="'+safe(b.id)+'">Desvincular</button>'}</td></tr>`).join(''):'<tr><td colspan="6" class="fine">Nenhuma aposta vinculada à banca. Cadastre uma abaixo ou vincule um bilhete do diário.</td></tr>';
    const linked=new Set(d.linkedTickets.map(x=>typeof x==='string'?x:x.id));
    $('bankJournal').innerHTML=entries.length?entries.slice(0,100).map(t=>{const status=ticketStatus(t);return `<label class="bank-journal-item"><input type="checkbox" data-bank-link="${safe(t.id)}" ${linked.has(t.id)?'checked':''} ${!configured?'disabled':''}/><span><strong>${safe(t.type==='parlay'?'Múltipla':'Simples')} · ${money(t.stake)}</strong><small>${safe(asDay(t.createdAt))} · ${safe(t.book||'')} · ${status.status==='pending'?'Em aberto':status.status==='won'?'Ganhou':status.status==='lost'?'Perdeu':'Anulada'}</small></span></label>`}).join(''):'<p class="fine">Ainda não há bilhetes no histórico de Múltiplas + resultados.</p>';
    for(const id of ['bankCashForm','bankBetForm']){const form=$(id);for(const el of form?.querySelectorAll('input,select,button')||[]){el.disabled=!configured;}}
    $('bankInitialSave').textContent=configured?'Atualizar capital inicial':'Definir capital inicial';
    const note=$('bankRisk');if(note)note.innerHTML=configured&&m.risk>0?`Exposição atual: <strong>${pct(m.capital>0?m.risk/m.capital:1)}</strong> do capital. Saldo disponível considera os valores comprometidos, e resultados pendentes não entram no lucro.`:'Apostas pendentes não contam como lucro. O retorno das liquidadas é calculado a partir das odds e resultados que você registrou.';
  }
  function setInitial(){const input=$('bankInitial')?.value, v=Number(input),start=$('bankStartDate')?.value||today();
    if(input===''||!Number.isFinite(v)||v<0||v>1e9||!validDate(start)||start>today()){alert('Informe capital inicial válido e uma data de início até hoje.');return;}
    const d=load();if(d.configured&&(d.initial!==rounded(v)||d.startedAt!==start)&&!confirm('Alterar capital inicial ou data de início recalculará o histórico. Continuar?'))return;
    d.configured=true;d.initial=rounded(v);d.startedAt=start;if(save(d))render();}
  function addCash(){const d=load(),type=$('bankCashType').value,amount=validAmount($('bankCashAmount').value),date=$('bankCashDate').value,
    note=$('bankCashNote').value.trim();if(!d.configured||!['deposit','withdrawal'].includes(type)||!amount||!validDate(date)||date<d.startedAt||date>today()){alert('Informe tipo, valor e data entre o início da banca e hoje.');return;}
    if(type==='withdrawal'&&amount>calculate(d).available+1e-8){alert('A retirada não pode superar o saldo disponível.');return;}
    d.transactions.push({id:uid(),type,amount:rounded(amount),date,note:note.slice(0,130)});
    if(save(d)){$('bankCashForm').reset();$('bankCashDate').value=today();render();}}
  function addBet(){const d=load(),title=$('bankBetTitle').value.trim(),stake=validAmount($('bankBetStake').value),odd=Number($('bankBetOdd').value),
    placedAt=$('bankBetDate').value,status=$('bankBetStatus').value,book=$('bankBetBook').value.trim(),strategy=$('bankBetStrategy').value;
    if(!d.configured||!title||!stake||!Number.isFinite(odd)||odd<=1||odd>500||!validDate(placedAt)||placedAt<d.startedAt||placedAt>today()||!['pending','won','lost','void'].includes(status)){alert('Informe descrição, stake, odd e data válida entre o início da banca e hoje.');return;}
    if(status==='pending'&&stake>calculate(d).available+1e-8){alert('O valor da aposta em aberto supera o saldo disponível da banca.');return;}
    const settledAt=status==='pending'?null:($('bankBetSettled').value||today());if(settledAt&&(!validDate(settledAt)||settledAt<placedAt||settledAt>today())){alert('A data do resultado precisa estar entre a data da aposta e hoje.');return;}
    d.bets.push({id:uid(),label:title.slice(0,150),stake:rounded(stake),odd,book:book.slice(0,90),strategy,placedAt,status,settledAt});
    if(save(d)){$('bankBetForm').reset();$('bankBetDate').value=today();$('bankBetSettled').value=today();render();}}
  function changeGrade(id,status){const d=load(),b=d.bets.find(x=>x.id===id);if(!b||!['pending','won','lost','void'].includes(status))return;
    if(status==='pending'&&b.status!=='pending'&&b.stake>calculate(d).available+1e-8){alert('Saldo disponível insuficiente para reabrir este bilhete.');render();return;}
    const prior=b.status;b.status=status;b.settledAt=status==='pending'?null:prior==='pending'?today():b.settledAt||today();if(save(d))render();}
  function toggleLinked(id,checked){const d=load(),entry=journal().find(t=>t.id===id);if(!d.configured||!entry)return;
    d.linkedTickets=d.linkedTickets.filter(t=>(typeof t==='string'?t:t.id)!==id);
    if(checked){if(!confirm('Confirmar que este bilhete foi uma aposta REAL? Vinculá-lo à banca alterará seu saldo. Não duplique um bilhete já lançado manualmente.')){render();return;}
      if(ticketStatus(entry).status==='pending'&&Number(entry.stake)>calculate(d).available+1e-8){alert('Não há saldo disponível suficiente para incluir esse bilhete aberto.');render();return;}
      d.linkedTickets.push({id,linkedAt:new Date().toISOString()});}
    if(save(d))render();}
  function remove(collection,id){const d=load(),row=d[collection]?.find(x=>x.id===id);if(!row||!confirm('Excluir este lançamento do histórico da banca?'))return;
    d[collection]=d[collection].filter(x=>x.id!==id);if(save(d))render();}
  function download(filename,text,mime){const blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();URL.revokeObjectURL(url);}
  function exportData(){download('edge-radar-minha-banca-'+today()+'.json',JSON.stringify({exportedAt:new Date().toISOString(),bank:load()},null,2),'application/json');}
  function exportCsv(){const d=load(),m=calculate(d),rows=[['Tipo','Data','Descrição','Valor (BRL)','Odd','Status','Lucro (BRL)','Fonte'],
    ...d.transactions.map(t=>['Movimentação',t.date,t.type==='deposit'?'Depósito':'Retirada',t.type==='deposit'?t.amount:-t.amount,'','',0,'manual']),
    ...m.bets.map(b=>['Aposta',b.placedAt,b.label,-b.stake,b.odd||'',b.status,b.status==='pending'?'':b.profit,b.source])];
    const csv='\ufeff'+rows.map(row=>row.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');download('edge-radar-banca-'+today()+'.csv',csv,'text/csv;charset=utf-8');}
  function importData(file){if(!file)return;file.text().then(s=>{let d;try{const raw=JSON.parse(s),obj=raw.bank||raw;
      if(obj.version!==1||!Array.isArray(obj.bets)||!Array.isArray(obj.transactions)||!Array.isArray(obj.linkedTickets)||typeof obj.configured!=='boolean')throw Error('formato');
      d=clean(obj);if(!Number.isFinite(d.initial)||d.initial<0||d.initial>1e9||d.bets.some(b=>!validAmount(b.stake)||!(Number(b.odd)>1))||d.transactions.some(x=>!validAmount(x.amount)||!['deposit','withdrawal'].includes(x.type)))throw Error('dados inválidos');
    }catch{alert('Arquivo de backup inválido. Nenhum dado foi alterado.');return;}
    if(!confirm('Importar este backup substituirá TODO o histórico atual da aba Minha banca neste navegador. Continuar?'))return;if(save(d))render();
  }).catch(()=>alert('Não foi possível ler o arquivo.'));}
  function click(e){const btn=e.target.closest?.('button');if(!btn)return;
    if(btn.id==='bankInitialSave')setInitial();
    if(btn.id==='bankExport')exportData();
    if(btn.id==='bankCsv')exportCsv();
    if(btn.id==='bankImportBtn')$('bankImportFile')?.click();
    if(btn.dataset.bankDeleteTrans)remove('transactions',btn.dataset.bankDeleteTrans);
    if(btn.dataset.bankDeleteBet)remove('bets',btn.dataset.bankDeleteBet);
    if(btn.dataset.bankUnlink)toggleLinked(btn.dataset.bankUnlink,false);
  }
  function change(e){const t=e.target;if(t.dataset.bankGrade)changeGrade(t.dataset.bankGrade,t.value);
    if(t.dataset.bankLink)toggleLinked(t.dataset.bankLink,t.checked);
    if(t.id==='bankImportFile'){importData(t.files?.[0]);t.value='';}
  }
  let initialized=false;
  function init(){if(!$('bankContent'))return;for(const id of ['bankCashDate','bankBetDate','bankBetSettled','bankStartDate']){const el=$(id);if(el&&!el.value)el.value=today();}
    if(!initialized){for(const [id,fn] of [['bankCashForm',addCash],['bankBetForm',addBet]])$(id)?.addEventListener('submit',e=>{e.preventDefault();fn();});initialized=true;}
    render();}
  document.addEventListener('click',click);document.addEventListener('change',change);
  window.addEventListener?.('storage',event=>{if(event.key===KEY||event.key===JOURNAL)render()});
  window.EdgeBankroll={init,render,load,save,records,calculate,ticketStatus,ticketSettlement,validAmount,asDay};
})();