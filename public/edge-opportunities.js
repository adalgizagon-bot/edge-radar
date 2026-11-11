/* CS2 Edge — radar por confronto, sem odds externas. Cito API snapshot apenas. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const safe=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=x=>x===null||x===undefined||x===''?null:Number.isFinite(+x)?+x:null;
const fmt=(x,d=1)=>x===null||!Number.isFinite(x)?'—':x.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
const date=x=>{try{return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(x));}catch{return '—'}};
const MEAS={kills:'Kills',headshots:'Headshots',assists:'Assistências',firstKills:'Primeiras kills'};
const LINES={kills:[7.5,9.5,11.5,13.5,15.5,17.5,19.5,21.5,23.5,25.5],headshots:[2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,11.5],assists:[1.5,2.5,3.5,4.5,5.5,6.5,7.5],firstKills:[0.5,1.5,2.5,3.5,4.5,5.5]};
let selected='',market='all',data=null,view=[];
const byMatch=new Map(), teamMaps=new Map(), playerSeries=new Map();
function key(row){return `${row.mapId}|${row.playerId}`}
function index(){
 byMatch.clear();teamMaps.clear();playerSeries.clear();
 const rows=new Map((data.player_maps||[]).filter(x=>x.mapId&&x.playerId).map(x=>[key(x),x]));
 for(const r of rows.values()){
  if(!byMatch.has(r.matchId))byMatch.set(r.matchId,new Map());
  const maps=byMatch.get(r.matchId);if(!maps.has(r.mapId)) maps.set(r.mapId,{...r,teams:new Set()});
  maps.get(r.mapId).teams.add(r.teamId);
  if(!teamMaps.has(r.teamId))teamMaps.set(r.teamId,new Map());
  teamMaps.get(r.teamId).set(r.mapId,r);
  const k=r.teamId+'|'+r.playerId;
  if(!playerSeries.has(k))playerSeries.set(k,new Map());
  playerSeries.get(k).set(r.mapId,r);
 }
}
function countUniqueMaps(){return new Set((data.player_maps||[]).map(x=>x.mapId).filter(Boolean)).size}
function parsedResults(){return (data.past||[]).filter(m=>m.status==='completed'&&!m.isForfeit&&n(m.team1Score)!==null&&n(m.team2Score)!==null)}
function samplePlayer(teamId){
 const roster=(data.rosters||[]).find(x=>x.teamId===teamId)?.players;
 const stored=(data.player_maps||[]).filter(x=>x.teamId===teamId);
 const byId=new Map();for(const r of stored){if(!r.playerId)continue;const bucket=byId.get(r.playerId)||{playerId:r.playerId,player:r.player,team:r.team,latest:r.startsAt,rows:[]};bucket.rows.push(r);if(r.startsAt>bucket.latest){bucket.latest=r.startsAt;bucket.player=r.player}byId.set(r.playerId,bucket)}
 const active=roster?.filter(p=>p.playerId).map(p=>p.playerId);
 const players=[...byId.values()].filter(p=>!active || active.includes(p.playerId));
 return players.sort((a,b)=>b.rows.length-a.rows.length).slice(0,5);
}
function wilson(k,n,z=1.645){if(!n)return [0,1];let p=k/n,c=z*z,den=1+c/n,mid=(p+c/(2*n))/den,rad=z*Math.sqrt((p*(1-p)+c/(4*n))/n)/den;return [Math.max(0,mid-rad),Math.min(1,mid+rad)]}
function estimate(values,line,direction,minN=12){
 const vs=values.filter(x=>n(x)!==null).map(Number),length=vs.length;
 if(!length)return {n:0,p:null,low:null,high:null,hits:0};
 const hits=vs.filter(x=>direction==='over'?x>line:x<line).length;
 const [low,high]=wilson(hits,length,1.645);
 return {n:length,p:(hits+1)/(length+2),low,high,hits,mean:vs.reduce((a,b)=>a+b,0)/length,valid:length>=minN};
}
function selection(match,marketKey,subject,playerId,direction,line,values,{team=null,target='map1',label='',note='',minN=12}={}){
 const st=estimate(values,line,direction,minN);
 const id=[match.id,target,marketKey,subject,playerId||'',direction,line].join('|');
 return {id,matchId:match.id,market:marketKey,marketLabel:label||MEAS[marketKey]||marketKey,subject,playerId,target,team,direction,line, ...st,note};
}
function playerCandidates(match){
 const picks=[];
 for(const teamId of [match.team1Id,match.team2Id]){
  for(const p of samplePlayer(teamId)){
   const own=p.rows.filter(x=>x.teamId===teamId).sort((a,b)=>String(b.startsAt).localeCompare(String(a.startsAt)));
   for(const metric of Object.keys(LINES)){
    const values=own.map(x=>n(x[metric])).filter(x=>x!==null);
    if(values.length<7)continue;
    const m=values.reduce((a,b)=>a+b,0)/values.length;
    const suggested=LINES[metric].filter(line=>Math.abs(line-m)<(metric==='kills'?5:metric==='headshots'?3.5:2.5));
    let options=[];
    for(const line of suggested){for(const dir of ['over','under']){
      const sel=selection(match,metric,p.player,p.playerId,dir,line,values,{team:p.team,note:'Mapas da equipe atual; mapa/veto futuro ainda não confirmado.'});
      if(sel.p!==null && sel.p>0.37&&sel.p<0.84){sel.preference= (sel.n>=20?50:sel.n>=12?28:0)+ Math.min(sel.n,40) + (metric==='kills'?20:metric==='headshots'?12:5) - Math.abs(sel.p-.62)*25;options.push(sel)}
    }}
    options.sort((a,b)=>b.preference-a.preference);
    if(options[0])picks.push(options[0]);
   }
  }
 }
 return picks;
}
function seriesMapCandidates(match){
 if(match.bestOf!==3)return [];
 const complete=parsedResults().filter(x=>x.bestOf===3);
 const own=id=>complete.filter(x=>x.team1Id===id||x.team2Id===id);
 const a=own(match.team1Id),b=own(match.team2Id);
 // Dedupe across both teams; rates are descriptive only.
 const combined=new Map([...a,...b].map(x=>[x.id,x]));
 const values=[...combined.values()].map(x=>n(x.team1Score)+n(x.team2Score)).filter(x=>x===2||x===3);
 const s=selection(match,'maps_total',`${match.team1} × ${match.team2}`,null,'over',2.5,values,{target:'series',label:'Total de mapas (MD3)',note:`Séries concluídas: ${a.length} envolvendo ${match.team1}, ${b.length} envolvendo ${match.team2}. Estimativa somente quando ambos têm ≥8 séries.`,minN:16});
 s.valid=s.valid&&a.length>=8&&b.length>=8;
 s.minNNotice='8 séries para cada equipe';
 const under=selection(match,'maps_total',`${match.team1} × ${match.team2}`,null,'under',2.5,values,{target:'series',label:'Total de mapas (MD3)',note:s.note,minN:16});under.valid= s.valid;under.minNNotice=s.minNNotice;
 return [s,under];
}
function totalRoundsCandidates(match){
 const a=[...(teamMaps.get(match.team1Id)?.values()||[])],b=[...(teamMaps.get(match.team2Id)?.values()||[])];
 const union=new Map([...a,...b].filter(x=>n(x.roundsPlayed)>0).map(x=>[x.mapId,x]));
 const values=[...union.values()].map(x=>n(x.roundsPlayed)).filter(x=>x!==null);
 const uniqueA=new Set(a.filter(x=>n(x.roundsPlayed)>0).map(x=>x.mapId)).size;
 const uniqueB=new Set(b.filter(x=>n(x.roundsPlayed)>0).map(x=>x.mapId)).size;
 const result=[];
 for(const line of [20.5,22.5,24.5])for(const dir of ['over','under']){
  const sel=selection(match,'rounds_total',`${match.team1} × ${match.team2}`,null,dir,line,values,{target:'map1',label:'Rounds totais / mapa 1',note:`Amostra sem veto: ${uniqueA} mapas de ${match.team1}; ${uniqueB} de ${match.team2}. Contagem por mapa deduplicada.`,minN:20});
  sel.valid=sel.valid&&uniqueA>=10&&uniqueB>=10;
  sel.minNNotice='10 mapas por equipe';
  result.push(sel);
 }
 return result;
}
function winnerCandidates(match){
 const past=parsedResults();
 const recent=id=>past.filter(x=>x.team1Id===id||x.team2Id===id);
 const a=recent(match.team1Id),b=recent(match.team2Id);
 const wins=(list,id)=>list.filter(x=>x.winnerTeamId===id || (x.winnerTeamId==null && (x.team1Id===id ? x.team1Score>x.team2Score:x.team2Score>x.team1Score))).length;
 // No h2h/strength model calibrated: do not assign a fake probability; just an evidence card.
 const record={id:match.id+'|series_winner',matchId:match.id,market:'series_winner',marketLabel:'Vencedor da série',target:'series',subject:match.team1+' / '+match.team2,team:null,dir:'',line:null,n:a.length+b.length,p:null,low:null,high:null,valid:false,hits:0,note:`${match.team1}: ${wins(a,match.team1Id)}–${a.length-wins(a,match.team1Id)} em ${a.length} séries; ${match.team2}: ${wins(b,match.team2Id)}–${b.length-wins(b,match.team2Id)} em ${b.length}. Sem probabilidade calibrada para o confronto.`,kind:'placeholder'};
 return record;
}
function allMarketCards(match){
 const player=playerCandidates(match);
 const round=totalRoundsCandidates(match).filter(x=>x.p===null || x.p>.43&&x.p<.79).sort((a,b)=>Math.abs(a.p-.61)-Math.abs(b.p-.61));
 const maps=seriesMapCandidates(match);
 const goodPlayers=player.sort((a,b)=>b.preference-a.preference);
 // A good preliminary shortlist covers multiple players rather than dozens of lines from one player.
 const chosen=[],seen=new Set();for(const m of ['kills','headshots','assists','firstKills']){
 for(const p of goodPlayers.filter(x=>x.market===m)){
  if(seen.has(p.playerId+'|'+m))continue;
  if(chosen.filter(x=>x.market===m).length>=(m==='kills'?8:4))break;
  chosen.push(p);seen.add(p.playerId+'|'+m);
 }}
 return [...maps,...round.slice(0,2),winnerCandidates(match),...chosen].filter(x=>x);
}
function oddsFor(s){
 const list=(typeof oddsLoad==='function'?oddsLoad():[]).filter(x=>x.matchId===s.matchId&&x.market===s.market&&x.target===s.target&&String(x.subject).toLowerCase()===String(s.subject).toLowerCase()&&String(x.direction)===String(s.direction)&&Number(x.line)===Number(s.line));
 list.sort((a,b)=>b.odd-a.odd);return list[0]||null;
}
function score(s){const odd=oddsFor(s);if(!odd||!s.valid||s.p===null)return 0;return (s.low*odd.odd-1) +.1*(s.p*odd.odd-1);}
function status(s){
 if(!s.valid||s.p===null)return {cls:'disabled',label:'Dados insuficientes'};
 const odd=oddsFor(s);
 if(!odd)return {cls:'await',label:'Aguardando odd'};
 if(s.n>=20 && s.low*odd.odd > 1.02)return {cls:'value',label:'Possível valor · revisar'};
 if(s.p*odd.odd<=1)return {cls:'novalue',label:'Sem valor nesta odd'};
 return {cls:'caution',label:'Sinal fraco / incerto'};
}
function cards(match){
 let all=allMarketCards(match);
 if(market!=='all')all=all.filter(x=>x.market===market);
 all.sort((a,b)=>{const aOdd=oddsFor(a),bOdd=oddsFor(b);if(aOdd&&bOdd)return score(b)-score(a);if(aOdd)return -1;if(bOdd)return 1;return (Number(b.valid)-Number(a.valid))*1000 + ((b.preference||0)-(a.preference||0)) + (b.n-a.n)*.1;});
 return all;
}
function displayCard(s,i){
 const st=status(s),o=oddsFor(s),dir=s.direction==='over'?'Mais de':s.direction==='under'?'Menos de':'';
 const label=s.kind==='placeholder'?`${s.marketLabel}`:`${s.marketLabel} · ${dir} ${fmt(s.line,1)}`;
 const btarget=s.target==='series'?'Série':'Mapa 1 (provisório)';
 const hits=s.p===null?'Amostra indisponível':`${s.hits}/${s.n} ocorrências`;
 const p=s.valid?`${fmt(s.p*100,0)}%`:'—';
 const fair=s.valid?fmt(1/s.p,2):'—';
 const tail=s.valid?`Faixa amostral 90%: ${fmt(s.low*100,0)}–${fmt(s.high*100,0)}%`:`${s.n||0} observações · mínimo necessário não atingido`;
 const ev=o&&s.valid?`<strong>${fmt((s.p*o.odd-1)*100,1)}% EV estimado</strong> · limite conservador ${fmt((s.low*o.odd-1)*100,1)}%`:'';
 const top=`<span class="edge-status ${st.cls}">${st.label}</span>`;
 return `<article class="edge-pick"><div class="edge-pick-top"><div><div class="edge-pick-title">${safe(label)}</div><div class="fine">${safe(s.subject)}${s.team?' · '+safe(s.team):''} · ${btarget}</div></div>${top}</div>
 <div class="edge-pick-stats"><div><span>Prob. preliminar</span><strong>${p}</strong></div><div><span>Odd justa teórica</span><strong>${fair}</strong></div><div><span>Histórico</span><strong>${hits}</strong></div></div>
 <div class="edge-explain">${tail}. ${safe(s.note||'')} Não incorpora todas as variáveis do adversário nem garante resultado.</div>
 <div class="edge-odds"><div class="edge-existing">${o?`Melhor odd: <strong>${fmt(+o.odd,2)}</strong> (${safe(o.book)}) ${ev}`:'Sem odd registrada — comparação de valor indisponível'}</div>
 ${s.kind==='placeholder'?'<div class="fine">Calibração de vitória ainda indisponível. Utilize a aba Mercados + odds para registrar sua cotação sem sinal automático.</div>':`<div class="edge-form"><input aria-label="Casa de aposta" placeholder="Casa de aposta" data-book="${i}" maxlength="50"/><input aria-label="Odd decimal" placeholder="Odd (ex.: 1.95)" type="number" min="1.01" max="500" step="0.01" data-odd="${i}"/><button class="edge-save" data-edge-save="${i}">Avaliar odd</button></div>`}
 </div></article>`;
}
function mapHistory(match){
 const teamA=teamMaps.get(match.team1Id)||new Map(),teamB=teamMaps.get(match.team2Id)||new Map();
 const unique=new Map([...teamA.values(),...teamB.values()].map(r=>[r.mapId,r]));
 const list=[...unique.values()].sort((a,b)=>String(b.startsAt).localeCompare(String(a.startsAt)));
 const mapCount=byMatch.size;
 return `<div class="edge-history"><div class="edge-history-head"><h3>Histórico real que sustenta a análise</h3><span class="fine">${unique.size} mapas deduplicados destas equipes · ${mapCount} partidas identificadas na base de jogadores</span></div><p class="fine">As tabelas antigas mostravam apenas séries consultadas diretamente; aqui contabilizamos também mapas obtidos dos históricos individuais. Quando o placar do mapa não foi fornecido, mostramos somente os rounds conhecidos.</p><div class="edge-history-table"><table><thead><tr><th>Data</th><th>Equipe observada</th><th>Mapa</th><th>Total de rounds</th><th>ID da partida</th></tr></thead><tbody>${list.slice(0,35).map(r=>`<tr><td>${date(r.startsAt)}</td><td>${safe(r.team)}</td><td>${safe(r.mapName)}</td><td>${n(r.roundsPlayed)??'—'}</td><td><code>${safe(r.matchId)}</code></td></tr>`).join('')||'<tr><td colspan="5">Nenhum mapa encontrado para essas equipes</td></tr>'}</tbody></table></div></div>`;
}
function cardMatch(match){
 const all=cards(match); const players=all.filter(x=>MEAS[x.market]),valid=all.filter(x=>x.valid).length,number=all.filter(x=>oddsFor(x)).length;
 const dateText=date(match.startsAt);
 const rankText=`#${match.rank1||'—'} / #${match.rank2||'—'}`;
 const roster1=(data.rosters||[]).some(r=>r.teamId===match.team1Id),roster2=(data.rosters||[]).some(r=>r.teamId===match.team2Id);
 return `<section class="edge-match-detail"><div class="edge-match-heading"><div><div class="edge-meta">${safe(match.event)} · ${safe(match.tier)} · ${dateText} · ${rankText}</div><h2>${safe(match.team1)} <span>×</span> ${safe(match.team2)}</h2><p class="fine">${valid} linhas com histórico mínimo · ${number} odds cadastradas · ${roster1&&roster2?'Elencos consultados':'Elencos a confirmar'} · BO${match.bestOf||'?'}</p></div><div class="edge-explanation">As seleções abaixo são <strong>candidatas para conferir na casa</strong>, não recomendações automáticas. O selo “possível valor” exige odd inserida e margem conservadora.</div></div>
 <div class="edge-market-filters">${[['all','Todos'],['kills','Kills'],['headshots','Headshots'],['assists','Assistências'],['firstKills','First kills'],['rounds_total','Rounds'],['maps_total','Mapas MD3'],['series_winner','Vencedor']].map(([v,l])=>`<button data-edge-market="${v}" class="${v===market?'active':''}">${l}</button>`).join('')}</div>
 <div class="edge-pick-grid">${all.map((s,i)=>displayCard(s,i)).join('')||'<p class="fine">Ainda não há históricos para esse mercado na partida selecionada.</p>'}</div>${mapHistory(match)}</section>`;
}
function draw(){
 if(!data||!$('edgeMatchSelect'))return;
 const tier=$('tierFilter')?.value||'all',q=($('search')?.value||'').trim().toLowerCase();
 let all=(data.upcoming||[]).filter(x=>tier==='all'||x.tier===tier).filter(x=>`${x.team1} ${x.team2} ${x.event}`.toLowerCase().includes(q)).sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
 const select=$('edgeMatchSelect'),now=Date.now();
 const recent=all.filter(x=>Date.parse(x.startsAt)>=now-4*3600*1000);
 const eligible=recent.length?recent:all;
 if(!selected||!eligible.some(x=>x.id===selected))selected=eligible[0]?.id||'';
 select.innerHTML=eligible.map(x=>`<option value="${safe(x.id)}">${date(x.startsAt)} · ${safe(x.team1)} × ${safe(x.team2)} (${safe(x.tier)})</option>`).join('');select.value=selected;
 const m=eligible.find(x=>x.id===selected);
 $('edgeMain').innerHTML=m?cardMatch(m):'<div class="panel">Sem confrontos disponíveis para os filtros atuais.</div>';
 $('edgeCount').textContent=`${countUniqueMaps()} mapas reais · ${(data.player_maps||[]).length} linhas de jogadores · ${byMatch.size} séries identificadas`;
 view=m?cards(m):[];
 $('edgeMain').querySelectorAll('[data-edge-market]').forEach(btn=>btn.onclick=()=>{market=btn.dataset.edgeMarket;draw()});
 $('edgeMain').querySelectorAll('[data-edge-save]').forEach(btn=>btn.onclick=()=>{
 const idx=Number(btn.dataset.edgeSave),x=view[idx];
 // Query within active container to avoid CSS selector id restriction.
 const inputs=$('edgeMain');const b=inputs.querySelector(`[data-book="${idx}"]`),v=inputs.querySelector(`[data-odd="${idx}"]`);
 const bookmaker=(b?.value||'').trim(),price=Number(v?.value);if(!bookmaker||!Number.isFinite(price)||price<=1||price>500){alert('Informe a casa e uma odd decimal válida (maior que 1).');return}
 const odds=oddsLoad();odds.unshift({matchId:x.matchId,target:x.target,market:x.market,subject:x.subject,line:x.line,direction:x.direction,book:bookmaker,odd:price,date:new Date().toISOString()});oddsSave(odds.slice(0,600));draw();
 });
}
function init(d){data=d;index();draw()}
function switchMatch(next){selected=next;market='all';draw()}
window.EdgeIntelligence={init,draw,switchMatch,estimate,wilson,allMarketCards,index,samplePlayer,totalRoundsCandidates,seriesMapCandidates};
window.addEventListener('DOMContentLoaded',()=>{const s=$('edgeMatchSelect');if(s)s.onchange=()=>switchMatch(s.value)});
})();