'use strict';
const $ = id => document.getElementById(id);
const STORE = 'atlas_esports_predictions_v2';
const DATA_STORE = 'atlas_esports_data_v2';
let latest = null, dataset = [], toastTimer = null;
const fmt = n => (100*n).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
const num = id => Number($(id).value);
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),4000)}
function seedHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function seeded(seed){let s=seed||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296}}
function poisson(lambda,random){const L=Math.exp(-lambda);let p=1,k=0;do{k++;p*=random()}while(p>L&&k<20);return Math.min(5,k-1)}
function playMap(p,kpr,side,random){let a=0,b=0,kills=0;
 const round=()=>{const aw=random()<p;a+=Number(aw);b+=Number(!aw);const playerWin=side==='A'?aw:!aw;kills+=poisson(kpr*(playerWin?1.12:.88),random)};
 while(a<13&&b<13&&a+b<24)round();
 if(a===12&&b===12){let blocks=0;do{const aa=a,bb=b;for(let i=0;i<6;i++){round();if(a-aa===4||b-bb===4)break}blocks++}while(a===b&&blocks<12);if(a===b)round()}
 return {a,b,rounds:a+b,kills,winner:a>b?'A':'B'};
}
function simulate(cfg){const random=seeded(seedHash(JSON.stringify(cfg)));const counts={mapA:0,seriesA:0,a20:0,b20:0,a21:0,b21:0,roundsOver:0,handicapA:0,killsOver:0,seriesKillsOver:0};let totalRounds=0,totalKills=0,totalMaps=0;
 for(let i=0;i<cfg.n;i++){const m1=playMap(cfg.p[0],cfg.kpr,cfg.side,random),m2=playMap(cfg.p[1],cfg.kpr,cfg.side,random);
 let aw=Number(m1.winner==='A')+Number(m2.winner==='A'),bw=2-aw,maps=2,kills=m1.kills+m2.kills;
 if(aw===1){const m3=playMap(cfg.p[2],cfg.kpr,cfg.side,random);maps++;kills+=m3.kills;if(m3.winner==='A')aw++;else bw++}
 counts.mapA+=Number(m1.winner==='A');counts.seriesA+=Number(aw===2);counts.a20+=Number(aw===2&&maps===2);counts.b20+=Number(bw===2&&maps===2);counts.a21+=Number(aw===2&&maps===3);counts.b21+=Number(bw===2&&maps===3);
 counts.roundsOver+=Number(m1.rounds>cfg.roundLine);counts.handicapA+=Number(m1.a-m1.b+cfg.handicap>0);counts.killsOver+=Number(m1.kills>cfg.killLine);counts.seriesKillsOver+=Number(kills>cfg.seriesKillLine);
 totalRounds+=m1.rounds;totalKills+=kills;totalMaps+=maps}
 return {counts,avgRounds:totalRounds/cfg.n,avgKills:totalKills/cfg.n,avgMaps:totalMaps/cfg.n,n:cfg.n};
}
function getConfig(){const cfg={a:$('team-a').value.trim(),b:$('team-b').value.trim(),player:$('player').value.trim(),maps:[1,2,3].map(n=>$('map-'+n).value),p:[1,2,3].map(n=>num('prob-'+n)/100),roundLine:num('round-line'),handicap:num('handicap-line'),killLine:num('kills-line'),seriesKillLine:num('kills-series-line'),kpr:num('kpr'),side:$('player-side').value,n:num('sim-count')};
 if(!cfg.a||!cfg.b||!cfg.player||cfg.a.toLowerCase()===cfg.b.toLowerCase())throw Error('Informe duas equipes distintas e um jogador.');
 if(cfg.p.some(p=>!Number.isFinite(p)||p<=0||p>=1)||!(cfg.kpr>0&&cfg.kpr<=1.8))throw Error('Verifique as probabilidades e kills por round.');
 return cfg}
function generateMarkets(cfg,s){const p=k=>s.counts[k]/s.n;const a=cfg.a,b=cfg.b,player=cfg.player;return [
 {key:'mapA',name:a+' vence '+cfg.maps[0],p:p('mapA'),detail:'Mapa 1'},
 {key:'roundsOver',name:'Mais de '+cfg.roundLine+' rounds',p:p('roundsOver'),detail:'Mapa 1 · média '+s.avgRounds.toFixed(1)},
 {key:'handicapA',name:a+' handicap '+(cfg.handicap>0?'+':'')+cfg.handicap,p:p('handicapA'),detail:'Mapa 1 · saldo de rounds'},
 {key:'killsOver',name:player+' mais de '+cfg.killLine+' kills',p:p('killsOver'),detail:'Mapa 1'},
 {key:'seriesA',name:a+' vence BO3',p:p('seriesA'),detail:'Série'},
 {key:'a20',name:a+' vence 2–0',p:p('a20'),detail:'Placar exato'},
 {key:'a21',name:a+' vence 2–1',p:p('a21'),detail:'Placar exato'},
 {key:'b20',name:b+' vence 2–0',p:p('b20'),detail:'Placar exato'},
 {key:'b21',name:b+' vence 2–1',p:p('b21'),detail:'Placar exato'},
 {key:'seriesKillsOver',name:player+' mais de '+cfg.seriesKillLine+' kills',p:p('seriesKillsOver'),detail:'Série · média '+s.avgKills.toFixed(1)}
 ]}
function run(e){if(e)e.preventDefault();try{const cfg=getConfig(),stats=simulate(cfg),markets=generateMarkets(cfg,stats);latest={cfg,stats,markets};$('sim-empty').hidden=true;$('sim-output').hidden=false;$('results-count').textContent=cfg.n.toLocaleString('pt-BR')+' cenários';
 const cards=$('market-cards');cards.textContent='';markets.forEach(m=>{const el=document.createElement('article');el.className='result-card';const err=1.96*Math.sqrt(Math.max(.000001,m.p*(1-m.p))/cfg.n);el.innerHTML='<div class="result-title"></div><strong></strong><div class="bar"><i></i></div><small></small>';el.querySelector('.result-title').textContent=m.name;el.querySelector('strong').textContent=fmt(m.p);el.querySelector('.bar i').style.width=(m.p*100)+'%';el.querySelector('small').textContent=m.detail+' · MC ±'+(100*err).toFixed(1)+' p.p.';cards.append(el)});
 const picker=$('market-picker');picker.textContent='';markets.forEach(m=>{const op=document.createElement('option');op.value=m.key;op.textContent=m.name;picker.append(op)});$('save-hint').textContent='Salvo somente neste dispositivo; sem auditoria externa.';toast('Simulação concluída.');}catch(err){toast(err.message||'Erro na simulação.')}}
function load(){try{const a=JSON.parse(localStorage.getItem(STORE)||'[]');return Array.isArray(a)?a:[]}catch{return[]}}
function store(rows){try{localStorage.setItem(STORE,JSON.stringify(rows));return true}catch{toast('Armazenamento indisponível.');return false}}
function save(){if(!latest)return toast('Execute uma simulação primeiro.');const m=latest.markets.find(x=>x.key===$('market-picker').value);if(!m)return;
 const rows=load();rows.unshift({id:crypto.randomUUID?.()||String(Date.now()),createdAt:new Date().toISOString(),match:$('match-note').value.trim()||latest.cfg.a+' x '+latest.cfg.b,market:m.name,prob:m.p,marketKey:m.key,params:latest.cfg,outcome:null});
 if(store(rows)){updateStats();toast('Previsão salva como pendente.');}}
function updateStats(){const all=load(),done=all.filter(r=>r.outcome===0||r.outcome===1),n=done.length;const brier=n?done.reduce((v,r)=>v+(r.prob-r.outcome)**2,0)/n:null;const hit=n?done.reduce((v,r)=>v+Number((r.prob>=.5)===Boolean(r.outcome)),0)/n:null;
 $('count-total').textContent=String(all.length);$('count-resolved').textContent=String(n);$('metric-brier').textContent=brier===null?'—':brier.toFixed(3);$('reg-total').textContent=String(all.length);$('reg-brier').textContent=brier===null?'—':brier.toFixed(3);$('reg-accuracy').textContent=hit===null?'—':fmt(hit);renderRegistry(all)}
function renderRegistry(rows){const wrap=$('registry-table');wrap.textContent='';if(!rows.length){wrap.textContent='Nenhuma previsão registrada ainda.';return}
 const table=document.createElement('table');table.className='records';table.innerHTML='<thead><tr><th>Identificação</th><th>Mercado</th><th>Prob.</th><th>Estado</th><th>Ações</th></tr></thead><tbody></tbody>';const body=table.querySelector('tbody');
 rows.forEach(r=>{const tr=document.createElement('tr');for(const value of [r.match,r.market,fmt(r.prob),r.outcome===null?'Pendente':r.outcome===1?'Aconteceu':'Não aconteceu']){const td=document.createElement('td');td.textContent=value;tr.append(td)}const act=document.createElement('td');if(r.outcome===null){for(const [txt,v] of [['Sim',1],['Não',0]]){const btn=document.createElement('button');btn.textContent=txt;btn.addEventListener('click',()=>resolve(r.id,v));act.append(btn)}}else{act.textContent=new Date(r.resolvedAt).toLocaleDateString('pt-BR')}tr.append(act);body.append(tr)});const div=document.createElement('div');div.className='table-wrap';div.append(table);wrap.append(div)}
function resolve(id,v){const rows=load(),r=rows.find(x=>x.id===id);if(!r||r.outcome!==null)return;r.outcome=v;r.resolvedAt=new Date().toISOString();if(store(rows)){updateStats();toast('Resultado registrado.');}}
function downloadCsv(rows,name){const csv='\ufeff'+rows.map(r=>r.map(v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}).join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function exportCsv(){const a=load();if(!a.length)return toast('Nenhuma previsão para exportar.');const cols=['id','createdAt','match','market','prob','outcome','resolvedAt'];downloadCsv([cols,...a.map(r=>cols.map(k=>r[k]))],'atlas-previsoes.csv')}
function showTab(tab){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===tab));document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));window.scrollTo({top:0,behavior:'smooth'})}
// Base histórica — dados reais apenas se fornecidos pelo usuário, nunca exemplos fictícios.
function splitCsv(text){const first=text.replace(/^\ufeff/,'').split(/\r?\n/)[0]||'';const sep=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';const rows=[];let row=[],cell='',quoted=false;const src=text.replace(/^\ufeff/,'');
 for(let i=0;i<src.length;i++){const c=src[i];if(c==='"'){if(quoted&&src[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===sep&&!quoted){row.push(cell.trim());cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&src[i+1]==='\n')i++;row.push(cell.trim());if(row.some(v=>v!==''))rows.push(row);row=[];cell=''}else cell+=c}
 if(quoted)throw Error('Arquivo CSV contém aspas não fechadas.');row.push(cell.trim());if(row.some(v=>v!==''))rows.push(row);return rows}
function parseHistory(text){
 const parsed=splitCsv(text);if(parsed.length<2)throw Error('CSV sem registros.');
 const columns=parsed.shift().map(x=>x.toLowerCase().trim());
 const required=['date','match_id','team_a','team_b','map','rounds_a','rounds_b'];
 if(required.some(x=>!columns.includes(x)))throw Error('Colunas obrigatórias: '+required.join(', '));
 const out=[],seen=new Map();
 for(const values of parsed){
  const row=Object.fromEntries(columns.map((k,i)=>[k,values[i]||'']));
  const da=row.date.slice(0,10),ra=Number(row.rounds_a),rb=Number(row.rounds_b);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(da)||!Number.isFinite(Date.parse(da+'T12:00:00Z'))||!Number.isInteger(ra)||!Number.isInteger(rb)||ra<0||rb<0||ra===rb||ra+rb<13||ra+rb>96||!row.team_a||!row.team_b||row.team_a.toLowerCase()===row.team_b.toLowerCase()||!row.map||!row.match_id)continue;
  const id=row.match_id+'|'+row.map.toLowerCase(),hasKills=Boolean(row.player&&row.kills!==''&&Number.isInteger(Number(row.kills))&&Number(row.kills)>=0&&Number(row.kills)<=100);
  let entry=seen.get(id);
  if(entry){
   if(entry.date!==da||entry.a!==row.team_a||entry.b!==row.team_b||entry.ra!==ra||entry.rb!==rb)continue;
  }else{
   entry={date:da,matchId:row.match_id,a:row.team_a,b:row.team_b,map:row.map,ra,rb,players:[]};
   seen.set(id,entry);out.push(entry);
  }
  if(hasKills&&!entry.players.some(p=>p.name.toLowerCase()===row.player.toLowerCase())){
   entry.players.push({name:row.player,team:row.player_team||row.team_a,kills:Number(row.kills)});
  }
 }
 out.sort((a,b)=>a.date.localeCompare(b.date)||a.matchId.localeCompare(b.matchId));
 if(!out.length)throw Error('Nenhuma linha válida. Confira datas, placares e identificadores únicos.');
 if(out.length>10000)throw Error('Limite de 10.000 mapas por importação.');
 return out
}
function saveHistory(){try{localStorage.setItem(DATA_STORE,JSON.stringify(dataset));return true}catch{toast('CSV muito grande para o navegador. Use um arquivo menor.');return false}}
function importHistory(file){if(!file)return; if(file.size>4_000_000)return toast('Use CSV de até 4 MB.');const reader=new FileReader();reader.onload=()=>{try{const rows=parseHistory(String(reader.result));dataset=rows;if(saveHistory()){renderHistory();toast(rows.length+' mapas importados; origem informada pelo usuário.')}}catch(e){toast(e.message)}};reader.onerror=()=>toast('Falha na leitura do CSV.');reader.readAsText(file)}
function renderHistory(){const el=$('data-summary');if(!el)return;el.textContent=dataset.length?dataset.length+' mapas • '+dataset[0].date+' a '+dataset[dataset.length-1].date+' • fonte: arquivo local importado':'Sem histórico carregado. O simulador continua manual.';
 const uniq=x=>[...new Set(dataset.map(r=>r[x]))];$('data-teams').textContent=dataset.length?uniq('a').concat(uniq('b')).filter((x,i,a)=>a.indexOf(x)===i).length+' equipes · '+uniq('map').length+' mapas':'—';
 $('data-status').textContent=dataset.length<40?'Amostra insuficiente para avaliar modelos.':'Base carregada; qualidade e cobertura dependem da origem.';
 $('data-preview').textContent='';dataset.slice(-10).reverse().forEach(r=>{const tr=document.createElement('tr');[r.date,r.a+' x '+r.b,r.map,r.ra+'–'+r.rb,(r.players&&r.players.length?r.players.map(p=>p.name+' ('+p.kills+' kills)').join(', '):r.player?r.player+' ('+r.kills+' kills)':'—')].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});$('data-preview').append(tr)})}
function smoothed(team,map,rows){let w=0,t=0;for(const r of rows){if(r.map.toLowerCase()!==map.toLowerCase())continue;if(r.a.toLowerCase()===team.toLowerCase()){w+=r.ra;t+=r.ra+r.rb}else if(r.b.toLowerCase()===team.toLowerCase()){w+=r.rb;t+=r.ra+r.rb}}
 return {rate:(w+120)/(t+240),rounds:t}}
function roundProb(a,b,map,rows){const aa=smoothed(a,map,rows),bb=smoothed(b,map,rows);const logit=p=>Math.log(p/(1-p));return {p:1/(1+Math.exp(-(logit(aa.rate)-logit(bb.rate)))),a:aa.rounds,b:bb.rounds}}
function estimateKills(player,rows){let kills=0,rounds=0;for(const r of rows){const people=Array.isArray(r.players)?r.players:(r.player?[{name:r.player,kills:r.kills}]:[]);for(const p of people){if(p.name&&p.name.toLowerCase()===player.toLowerCase()&&Number.isFinite(p.kills)){kills+=p.kills;rounds+=r.ra+r.rb}}}return {rate:(kills+0.7*150)/(rounds+150),rounds}}
function applyHistory(){if(!dataset.length)return toast('Importe primeiro a base histórica.');const a=$('team-a').value.trim(),b=$('team-b').value.trim(),player=$('player').value.trim(),cutoff=$('data-cutoff').value;const train=dataset.filter(r=>!cutoff||r.date<cutoff);
 if(!train.length)return toast('Não há dados anteriores à data de corte.');const msg=[];
 for(let i=1;i<=3;i++){const map=$('map-'+i).value,res=roundProb(a,b,map,train);$('prob-'+i).value=(res.p*100).toFixed(1);msg.push(map+': '+res.a+'/'+res.b+' rounds por equipe')}
 const k=estimateKills(player,train);$('kpr').value=k.rate.toFixed(2);$('model-report').textContent='Estimativas com suavização bayesiana. Cobertura: '+msg.join(' | ')+'; jogador: '+k.rounds+' rounds. Com pouca cobertura, as previsões tendem a 50% por round e 0,70 kills/round. Não há correção por força dos adversários ou veto.';
 showTab('simulator');toast('Parâmetros preenchidos com o histórico; confira a cobertura antes de simular.')}
function mapProbability(p,n=900){const random=seeded(seedHash('backtest'+p));let hits=0;for(let i=0;i<n;i++){let a=0,b=0;while(a<13&&b<13&&a+b<24){if(random()<p)a++;else b++}if(a===12&&b===12){let guard=0;do{const aa=a,bb=b;for(let j=0;j<6;j++){if(random()<p)a++;else b++;if(a-aa===4||b-bb===4)break}guard++}while(a===b&&guard<12);if(a===b){if(random()<p)a++;else b++}}hits+=Number(a>b)}return hits/n}
function backtest(){if(dataset.length<40)return toast('Precisa de pelo menos 40 mapas para este teste inicial.');const cutoff=Math.floor(dataset.length*.75),train=dataset.slice(0,cutoff),test=dataset.slice(cutoff);let sum=0,base=0,acc=0,covered=0;
 const baseline=train.reduce((s,r)=>s+Number(r.ra>r.rb),0)/train.length;
 for(const r of test){const x=roundProb(r.a,r.b,r.map,train),p=mapProbability(x.p,350),out=Number(r.ra>r.rb);sum+=(p-out)**2;base+=(baseline-out)**2;acc+=Number((p>=.5)===Boolean(out));if(x.a>=100&&x.b>=100)covered++}
 const n=test.length,improved=(base-sum)/n;$('backtest-report').textContent='Teste temporal 75% treino / 25% teste: '+train.length+' mapas treinamento e '+n+' teste. Brier do modelo: '+(sum/n).toFixed(3)+'; Brier base simples: '+(base/n).toFixed(3)+'; acerto por classificação: '+fmt(acc/n)+'; mapas com ≥100 rounds históricos para cada equipe no mapa: '+covered+'/'+n+'. Diferença Brier (base − modelo): '+improved.toFixed(3)+'. Não é validação prospectiva e não mede rentabilidade.';toast('Teste histórico concluído.')}
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.go)));
document.querySelectorAll('[data-trigger=run]').forEach(b=>b.addEventListener('click',()=>{showTab('simulator');run()}));
$('sim-form').addEventListener('submit',run);$('save-prediction').addEventListener('click',save);$('export-csv').addEventListener('click',exportCsv);
$('reset-form').addEventListener('click',()=>{$('sim-form').reset();latest=null;$('sim-output').hidden=true;$('sim-empty').hidden=false;toast('Parâmetros restaurados.');});
$('history-file').addEventListener('change',e=>importHistory(e.target.files[0]));$('history-apply').addEventListener('click',applyHistory);$('history-test').addEventListener('click',backtest);$('history-clear').addEventListener('click',()=>{dataset=[];localStorage.removeItem(DATA_STORE);renderHistory();$('backtest-report').textContent='';toast('Base histórica removida deste navegador.')});
try{const saved=JSON.parse(localStorage.getItem(DATA_STORE)||'[]');if(Array.isArray(saved))dataset=saved}catch{}renderHistory();updateStats();
