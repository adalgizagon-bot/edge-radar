'use strict';
let citoData=null,chosenMatch=null,currentFilter='all',currentMap=null;
const el=(tag,cls='',txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n};
const team=id=>citoData?.teams?.find(t=>t.id===id);
const stat=(t,map)=>t?.maps?.find(x=>x.name.toLowerCase()===map.toLowerCase());
const when=iso=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(iso));
const percent=n=>Number.isFinite(n)?Number(n).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—';
function filterEvents(value){currentFilter=value;document.querySelectorAll('[data-event-filter]').forEach(b=>{const selected=b.dataset.eventFilter===value;b.classList.toggle('secondary',selected);b.classList.toggle('ghost',!selected)});listMatches()}
function listMatches(){const root=document.getElementById('tournament-matches');root.textContent='';if(!citoData)return;
 for(const m of citoData.matches.filter(x=>currentFilter==='all'||x.eventId===currentFilter)){
 const btn=el('button','match-card'+(m.id===chosenMatch?' selected':''));btn.type='button';btn.setAttribute('aria-pressed',m.id===chosenMatch?'true':'false');
 const head=el('div','match-card-top');head.append(el('span','match-event',m.eventId==='cs2-event-9258'?'Stake Ranked':'RUSH Brno'),el('span','match-time',when(m.startTime)));
 const names=el('div','match-teams');names.append(el('strong','',m.teamA.name),el('span','versus','×'),el('strong','',m.teamB.name));
 const foot=el('div','match-card-bottom');foot.append(el('span','','Histórico Cito: '+(team(m.teamA.id)?.totalMaps??'—')+' / '+(team(m.teamB.id)?.totalMaps??'—')+' mapas'),el('span','small-arrow','Analisar ›'));
 btn.append(head,names,foot);btn.addEventListener('click',()=>showMatch(m.id));root.append(btn);
 }}
function showMatch(id){chosenMatch=id;const m=citoData?.matches?.find(x=>x.id===id);if(!m)return;
 const a=team(m.teamA.id),b=team(m.teamB.id),root=document.getElementById('team-comparison');
 document.getElementById('selected-match-heading').textContent=m.teamA.name+' × '+m.teamB.name;
 document.getElementById('selected-match-time').textContent=when(m.startTime)+' · Brasília';
 root.textContent='';listMatches();
 if(!a||!b){root.append(el('p','muted','Dados insuficientes para comparação.'));document.getElementById('send-match-to-sim').disabled=true;return}
 const all=el('div','match-comparison-grid');
 for(const t of [a,b]){const item=el('div','team-summary');item.append(el('div','team-name',t.name),el('strong','summary-main',percent(t.mapWinPercent)),el('small','',t.mapWins+' vitórias em '+t.totalMaps+' mapas (90 dias)'),el('div','small-stats','CT '+percent(t.sideEconomy?.ctWinPercent)+' · TR '+percent(t.sideEconomy?.tWinPercent)+' · Pistols '+percent(t.sideEconomy?.pistolWinPercent)));all.append(item)}
 root.append(all);
 const maps=a.maps.map(x=>x.name).filter(x=>stat(b,x)).map(x=>({name:x,total:stat(a,x).played+stat(b,x).played})).sort((x,y)=>y.total-x.total||x.name.localeCompare(y.name));
 if(!maps.length){root.append(el('p','muted','Nenhum mapa em comum no histórico.'));document.getElementById('send-match-to-sim').disabled=true;return}
 if(!maps.some(x=>x.name===currentMap))currentMap=maps[0].name;
 const section=el('div','map-selector-row'),label=el('label','','Comparar mapa específico'),select=el('select','map-selector');select.id='tourney-map-select';
 for(const x of maps){const op=el('option','',x.name);op.value=x.name;select.append(op)}
 select.value=currentMap;select.addEventListener('change',()=>{currentMap=select.value;showMap(a,b,currentMap)});
 label.append(select);section.append(label,el('span','map-caveat','Histórico não indica veto confirmado'));root.append(section);
 const detail=el('div','map-comparison');detail.id='map-comparison';root.append(detail);showMap(a,b,currentMap);
 document.getElementById('team-comparison-note').textContent='As taxas históricas não são probabilidades de vencer este confronto. Não há ajuste por nível dos adversários, roster ou veto.';
 document.getElementById('send-match-to-sim').disabled=maps.length<3;
}
function showMap(a,b,map){const root=document.getElementById('map-comparison');root.textContent='';
 for(const t of [a,b]){const m=stat(t,map),line=el('div','map-stat-line'),head=el('div','map-stat-head'),bar=el('div','map-stat-bar'),fill=el('i'),foot=el('div','map-stat-small');
 head.append(el('strong','',t.name),el('span','',(m?.played??0)+' mapas / '+(m?.wins??0)+' vitórias'));fill.style.width=Math.max(0,Math.min(100,m?.winPercent??0))+'%';bar.append(fill);
 foot.append(el('span','','Vitórias: '+percent(m?.winPercent)+' · Rounds: '+(m?.roundsFor??'—')+' pró / '+(m?.roundsAgainst??'—')+' contra'),el('span','','CT '+percent(m?.ctWinPercent)+' · TR '+percent(m?.tWinPercent)));line.append(head,bar,foot);root.append(line)}
 const n=Math.min(stat(a,map)?.played??0,stat(b,map)?.played??0);root.append(el('p','sample-note',n>=8?'Amostra de pelo menos 8 mapas para cada equipe.':n>=4?'Amostra limitada.':'Amostra muito pequena.'));
}
function estimatedRound(a,b){const k=140,pa=(a.roundsFor+k*.5)/(a.roundsFor+a.roundsAgainst+k),pb=(b.roundsFor+k*.5)/(b.roundsFor+b.roundsAgainst+k),logit=p=>Math.log(p/(1-p));return 1/(1+Math.exp(-(logit(pa)-logit(pb))))}
function sendTournamentToSimulator(){const m=citoData?.matches?.find(x=>x.id===chosenMatch);if(!m)return toast('Escolha uma partida.');
 const a=team(m.teamA.id),b=team(m.teamB.id);if(!a||!b)return toast('Faltam estatísticas das equipes.');
 const maps=a.maps.map(x=>x.name).filter(x=>stat(b,x)).sort((x,y)=>stat(a,y).played+stat(b,y).played-stat(a,x).played-stat(b,x).played);
 if(maps.length<3)return toast('Histórico insuficiente em três mapas.');
 document.getElementById('team-a').value=m.teamA.name;document.getElementById('team-b').value=m.teamB.name;
 let limited=false;
 for(let i=0;i<3;i++){const name=maps[i],aa=stat(a,name),bb=stat(b,name),select=document.getElementById('map-'+(i+1));
 if(![...select.options].some(op=>op.value===name)){const option=el('option','',name);option.value=name;select.append(option)}
 select.value=name;document.getElementById('prob-'+(i+1)).value=(estimatedRound(aa,bb)*100).toFixed(1);if(Math.min(aa.played,bb.played)<5)limited=true}
 document.getElementById('player').value='Selecionar jogador';
 if(document.getElementById('match-note'))document.getElementById('match-note').value=m.event+' · '+when(m.startTime)+' · '+m.id;
 document.getElementById('model-report').textContent='Probabilidades por round estimadas com médias regularizadas do histórico Cito de 90 dias: NÃO calibradas. Mapas selecionados pela frequência em comum, NÃO pelo veto. Kills por round continuam manuais.'+(limited?' CUIDADO: mapas com menos de 5 jogos em cada equipe.':'');
 document.getElementById('sim-output').hidden=true;document.getElementById('sim-empty').hidden=false;showTab('simulator');toast('Parâmetros históricos preenchidos. Confira as ressalvas.');
}
async function loadTournaments(){try{const resp=await fetch('data/tournaments.json',{cache:'no-store'});if(!resp.ok)throw Error('HTTP '+resp.status);const d=await resp.json();if(!Array.isArray(d.matches)||!Array.isArray(d.teams)||!d.fetchedAt)throw Error('JSON incompleto');citoData=d;
 document.getElementById('tournament-match-count').textContent=String(d.matches.length);document.getElementById('tournament-team-count').textContent=String(d.teams.length);
 document.getElementById('tournament-snapshot-age').textContent=when(d.fetchedAt);
 document.getElementById('tournament-source').textContent='Fonte: Cito API · consulta '+when(d.fetchedAt)+' (Brasília). Histórico de 90 dias. Fotografia fixa, sem atualização ao vivo.';
 if(d.matches.length)showMatch(d.matches[0].id);
 }catch(e){document.getElementById('tournament-source').textContent='Falha ao carregar dados Cito: '+e.message;document.getElementById('tournament-matches').textContent='Recarregue a página ou verifique a conexão.';document.getElementById('send-match-to-sim').disabled=true}}
document.querySelectorAll('[data-event-filter]').forEach(b=>b.addEventListener('click',()=>filterEvents(b.dataset.eventFilter)));
document.getElementById('send-match-to-sim').addEventListener('click',sendTournamentToSimulator);
loadTournaments();