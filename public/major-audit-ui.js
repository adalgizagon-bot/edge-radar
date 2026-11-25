'use strict';
/* Prospectively frozen Major map predictions; no retroactive reconstruction. */
(function(root){
 const I=root.AtlasMajorIntel;
 const mk=(tag,cls='',str)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(str!==undefined)e.textContent=String(str);return e};
 const fmt=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('pt-BR',{maximumFractionDigits:3}):'—';
 const getSaved=()=>{try{const x=JSON.parse(localStorage.getItem('atlas_major_frozen_v1')||'[]');return Array.isArray(x)?x:[]}catch{return[]}};
 const getJson=async url=>{try{const r=await fetch(url,{cache:'no-store'});return r.ok?await r.json():null}catch{return null}};
 const download=(name,data)=>{
  const bytes=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(bytes),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),800);
 };
 const render=async parent=>{
  if(!parent||!I)return;
  const outer=mk('section','atlas-audit-summary');
  outer.append(mk('h3','','Validação prospectiva — Major BO1'));
  outer.append(mk('p','atlas-map-hint','As previsões devem ser registradas ANTES do início. Mapas e probabilidades ficam congelados; resultados são usados apenas depois, sem alterar os números originais.'));
  const status=mk('p','atlas-map-hint','Lendo previsões e resultados publicados…');outer.append(status);
  const exportBtn=mk('button','atlas-player-button','Exportar minhas previsões (JSON)');
  exportBtn.type='button';exportBtn.addEventListener('click',()=>download('atlas-previsoes-congeladas.json',{exportedAt:new Date().toISOString(),source:'este navegador',forecasts:getSaved()}));
  outer.append(exportBtn);
  parent.append(outer);
  const [live,automatic,observed,day1]=await Promise.all([
   getJson('data/major-live.json'),getJson('data/major-preflight-v1.json'),getJson('data/major-observed-results.json'),getJson('data/major-day1-audit.json')]);
  if(!outer.isConnected)return;
  const results=live?.results||[],saved=getSaved(),audited=I.audit(saved,results,observed?.matches||[]);
  status.textContent=saved.length+' registro(s) manuais neste navegador · '+audited.graded+' vencedor(es) avaliados · '+audited.pending+' aguardando · '+audited.mismatched+' com mapa divergente.';
  outer.append(mk('p','atlas-map-hint','Modelo dos registros manuais — Brier: '+fmt(audited.winnerBrier)+' · erro médio de kills: '+fmt(audited.killMae)+' (quando houver kills verificadas).'));
  if(day1?.summary?.games===8&&day1.records?.length===8){
   const d=day1.summary,section=mk('section','atlas-day1-audit');
   section.append(mk('h3','','24/11 — onde o modelo acertou e errou'));
   const metrics=mk('div','atlas-day1-metrics');
   const tiles=[
    ['Vencedor por mapa',d.winner.correct+'/'+d.winner.count],
    ['Brier Score',fmt(d.winner.brier)],
    ['Erro rounds',fmt(d.rounds.mae)+' rounds'],
    ['Kills provisórias',fmt(d.kills.mae)+' MAE']
   ];
   for(const [title,value] of tiles){const cell=mk('div','atlas-day1-metric');cell.append(mk('small','',title),mk('strong','',value));metrics.append(cell)}
   section.append(metrics);
   section.append(mk('p','atlas-map-alert','Qualidade da Cito: '+d.kills.sourceConflicts+'/'+d.kills.actualRosterSideSum+' divergências entre kills totais e CT+TR. A análise de kills usa CT+TR PROVISORIAMENTE; esta métrica não é uma validação independente. Preços e probabilidades de kills permanecem bloqueados.'));
   section.append(mk('p','atlas-map-hint','A amostra de oito jogos é muito pequena para recalibrar o modelo. O Brier mais baixo é melhor; não indica lucro. As previsões foram congeladas em '+new Date(day1.frozenAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+'.'));
   const wrapper=mk('div','hscroll atlas-day1-scroll'),table=mk('table','atlas-map-table atlas-day1-table'),head=mk('thead'),hrow=mk('tr');
   for(const label of ['Jogo / mapa','Vencedor','Modelo A','Acertou?','Rounds previstos / reais'])hrow.append(mk('th','',label));
   head.append(hrow);table.append(head);const tbody=mk('tbody');
   for(const row of day1.records){
    const tr=mk('tr');
    const winning=row.result?.[0]>row.result?.[1]?row.teams?.[0]:row.teams?.[1];
    const cells=[row.teams.join(' x ')+' · '+row.map,winning,
     typeof row.probabilityA==='number'?fmt(row.probabilityA*100)+'%':'—',
     row.winnerHit?'✓':'✕',
     fmt(row.expectedRounds)+' / '+fmt(row.actualRounds)];
    for(let i=0;i<cells.length;i++)tr.append(mk('td',i===3?(row.winnerHit?'atlas-day1-hit':'atlas-day1-miss'):'',cells[i]));
    tbody.append(tr);
   }
   table.append(tbody);wrapper.append(table);section.append(wrapper);
   const exportAudit=mk('button','atlas-player-button','Exportar auditoria 24/11 (JSON)');
   exportAudit.type='button';exportAudit.addEventListener('click',()=>download('atlas-auditoria-2026-11-24.json',day1));
   section.append(exportAudit);outer.append(section);
  }
  if(automatic?.forecasts?.length){
   const scenarios=automatic.forecasts,records=[];
   for(const match of scenarios){
    const actual=results.find(r=>r.id===match.matchId&&r.status==='completed');
    if(!actual){records.push({status:'pending'});continue}
    const mapName=actual.maps?.length===1?actual.maps[0]?.name:null;
    const row=match.maps?.find(s=>String(s.map).toLowerCase()===String(mapName||'').toLowerCase());
    if(!row){records.push({status:'map_mismatch'});continue}
    const frozen={version:'atlas-pre-veto-conditional-v1',createdAt:automatic.frozenAt,startsAt:match.startsAt,
     matchId:match.matchId,map:row.map,probabilityA:row.probabilityA,
     playerForecasts:row.playerForecasts||[]};
    records.push(I.grade(frozen,actual,(observed?.matches||[]).find(x=>x.matchId===match.matchId)));
   }
   const graded=records.filter(r=>r.status==='graded');
   const brier=graded.length?graded.reduce((s,r)=>s+r.brier,0)/graded.length:null;
   outer.append(mk('p','atlas-audit-highlight',
    'Pré-veto congelado no GitHub: '+scenarios.length+' jogos · '+graded.length+' avaliados · Brier '+fmt(brier)+
    ' · '+(scenarios.length-graded.length)+' aguardando resultado/mapa verificado.'));
   outer.append(mk('p','atlas-map-hint','Os cenários de todos os mapas foram registrados antes da estreia. Apenas o cenário do mapa efetivamente disputado será avaliado, sem recalcular a previsão.'));
  }else{
   outer.append(mk('p','atlas-map-hint','Arquivo de pré-registro coletivo ainda indisponível. Os registros manuais permanecem locais e exportáveis.'));
  }
  if(!results.length)outer.append(mk('p','atlas-map-alert','Nenhum resultado do Major verificado na base publicada. Não há acurácia demonstrada até os jogos terminarem e os dados serem sincronizados.'));
 };
 root.AtlasMajorAuditUI={render};
})(window);
