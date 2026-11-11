/* CS2 Edge v6 — contexto de mapa + histórico geral, sem confundir inferência e certeza. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const h = v => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v;
  const pct = x => num(x) === null ? '—' : (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  const fmt = (x, places = 1) => num(x) === null ? '—' : (+x).toLocaleString('pt-BR', {minimumFractionDigits:places, maximumFractionDigits:places});
  const currentPool = ['Ancient', 'Anubis', 'Cache', 'Dust2', 'Inferno', 'Mirage', 'Nuke'];
  const MARKET_NAMES = {kills:'Kills do jogador',headshots:'Headshots',assists:'Assistências',firstKills:'Primeiras kills',team_kills:'Kills totais da equipe',rounds_total:'Rounds totais do mapa',maps_total:'Total de mapas MD3',series_winner:'Vencedor MD3'};
  const PLAYER_LINES = {kills:[7.5,9.5,11.5,13.5,15.5,17.5,19.5,21.5,23.5,25.5,27.5,29.5],headshots:[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,11.5,13.5],assists:[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,9.5],firstKills:[0.5,1.5,2.5,3.5,4.5,5.5]};
  const ROUNDS_LINES = [17.5,19.5,20.5,21.5,22.5,23.5,24.5,25.5,26.5,28.5];
  let db = null, selected = '', marketFilter = 'all', currentCards = [];
  let indexed = {players:new Map(), teamMaps:new Map(), mapResults:new Map(), teamKills:new Map(), mapCount:0, seriesCount:0};
  const sequenceCache = new Map();

  function normMap(name){return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]/g,'');}
  function mapName(name){return currentPool.find(p=>normMap(p)===normMap(name)) || String(name||'').trim();}
  function mapSequenceKey(matchId){return 'cs2edge.mapSequence.v1.'+matchId;}
  function getSequence(matchId){
    if(sequenceCache.has(matchId)) return [...sequenceCache.get(matchId)];
    let arr = ['', '', ''];
    try {const v = JSON.parse(localStorage.getItem(mapSequenceKey(matchId)) || 'null');if(Array.isArray(v)&&v.length===3){arr=v.map(x=>currentPool.includes(x)?x:'');}} catch {}
    sequenceCache.set(matchId, arr);return [...arr];
  }
  function setSequence(matchId, i, map){
    const seq=getSequence(matchId);
    if (map && seq.some((v,j)=>j!==i&&v===map)) return false;
    seq[i]=currentPool.includes(map)?map:'';
    sequenceCache.set(matchId,seq);
    try{localStorage.setItem(mapSequenceKey(matchId),JSON.stringify(seq));}catch{}
    return true;
  }

  function indexData(data){
    indexed={players:new Map(),teamMaps:new Map(),mapResults:new Map(),teamKills:new Map(),mapCount:0,seriesCount:0};
    const uniquePlayerRows=new Map();
    for(const r of data.player_maps||[]){if(r.mapId&&r.playerId&&r.teamId) uniquePlayerRows.set(r.mapId+'|'+r.playerId,r);}
    const mapGrouping=new Map();
    for(const r of uniquePlayerRows.values()){
      const playerKey=r.teamId+'|'+r.playerId;
      if(!indexed.players.has(playerKey)) indexed.players.set(playerKey,[]);
      indexed.players.get(playerKey).push(r);
      if(!indexed.teamMaps.has(r.teamId)) indexed.teamMaps.set(r.teamId,new Map());
      if(!indexed.teamMaps.get(r.teamId).has(r.mapId)) indexed.teamMaps.get(r.teamId).set(r.mapId,r);
      const aggregateKey=r.mapId+'|'+r.teamId;
      if(!mapGrouping.has(aggregateKey))mapGrouping.set(aggregateKey,new Map());
      mapGrouping.get(aggregateKey).set(r.playerId,r);
      if(!indexed.mapResults.has(r.mapId))indexed.mapResults.set(r.mapId,{mapId:r.mapId,mapName:r.mapName,matchId:r.matchId,rounds:num(r.roundsPlayed),team1Id:null,team2Id:null,score1:null,score2:null,teamIds:new Set(),startsAt:r.startsAt});
      const mapRecord=indexed.mapResults.get(r.mapId);
      mapRecord.teamIds.add(r.teamId);
      if(mapRecord.rounds===null && num(r.roundsPlayed)!==null)mapRecord.rounds=num(r.roundsPlayed);
    }
    // Somente 5 IDs distintos com todas as kills/mortes observadas = total de equipe confiável.
    for(const [key,players] of mapGrouping){
      const lines=[...players.values()];
      if(lines.length!==5 || !lines.every(r=>num(r.kills)!==null&&num(r.deaths)!==null)) continue;
      const v=lines[0],total={mapId:v.mapId,matchId:v.matchId,mapName:v.mapName,teamId:v.teamId,team:v.team,startsAt:v.startsAt,
        kills:lines.reduce((sum,r)=>sum+num(r.kills),0),deaths:lines.reduce((sum,r)=>sum+num(r.deaths),0),rounds:num(v.roundsPlayed),players:5};
      if(!indexed.teamKills.has(v.teamId))indexed.teamKills.set(v.teamId,new Map());
      indexed.teamKills.get(v.teamId).set(v.mapId,total);
    }
    const finished = new Set();
    for(const m of data.past||[]){
      if(m.status!=='completed'||m.isForfeit)continue;
      finished.add(m.id);
      for(const mp of m.maps||[]){
        if(mp.status!=='completed'||mp.isForfeit||mp.statsEligible===false)continue;
        const a=num(mp.team1Score),b=num(mp.team2Score);
        if(a===null||b===null||!mp.mapId)continue;
        const prev=indexed.mapResults.get(mp.mapId)||{mapId:mp.mapId,teamIds:new Set()};
        indexed.mapResults.set(mp.mapId,{...prev,mapId:mp.mapId,mapName:mp.name||prev.mapName,matchId:m.id,startsAt:m.startsAt,
          rounds:a+b,team1Id:m.team1Id,team2Id:m.team2Id,score1:a,score2:b});
      }
    }
    indexed.mapCount=indexed.mapResults.size;indexed.seriesCount=finished.size;
  }
  function wilson(hits,count,z=1.645){
    if(!count)return [0,1];const p=hits/count,c=z*z,d=1+c/count,mid=(p+c/(2*count))/d,
      radius=z*Math.sqrt(p*(1-p)/count+c/(4*count*count))/d;
    return [Math.max(0,mid-radius),Math.min(1,mid+radius)];
  }
  function estimate(values,line,direction,minN=10){
    const vs=values.map(num).filter(v=>v!==null),len=vs.length;
    if(!len)return {n:0,hits:0,p:null,low:null,high:null,valid:false,mean:null};
    const hits=vs.filter(v=>direction==='over'?v>line:v<line).length;
    const [low,high]=wilson(hits,len);
    return {n:len,hits,p:(hits+1)/(len+2),low,high,valid:len>=minN,mean:vs.reduce((a,b)=>a+b,0)/len};
  }
  // A janela gratuita contém poucos jogos em cada arena. Recuar para a taxa
  // histórica geral evita tabelas vazias, mas é uma PROJEÇÃO exploratória.
  // O pseudo-histórico é limitado a oito observações; nunca é tratado como
  // partidas reais adicionais para habilitar um sinal forte de aposta.
  function contextualEstimate(mapValues,allValues,line,direction,{minTotal=12,minMap=2}={}){
    const specific=mapValues.map(num).filter(v=>v!==null);
    const general=allValues.map(num).filter(v=>v!==null);
    const mapN=specific.length,totalN=general.length;
    const hit=v=>direction==='over'?v>line:v<line;
    if(mapN>=10){
      const exact=estimate(specific,line,direction,10);
      return {...exact,mapN,totalN,method:'empirical',notCalibrated:false};
    }
    // allValues inclui os mapas específicos. Retirar essas observações antes
    // de construir a base geral evita contá-las duas vezes.
    const frequency=new Map();for(const v of specific)frequency.set(v,(frequency.get(v)||0)+1);
    const other=[];for(const v of general){const count=frequency.get(v)||0;if(count)frequency.set(v,count-1);else other.push(v);}
    if(mapN<minMap||totalN<minTotal||other.length<6){
      return {n:mapN,p:null,low:null,high:null,valid:false,hits:null,mean:null,mapN,totalN,method:'insufficient',notCalibrated:true};
    }
    const priorN=Math.min(8,other.length);
    const background=(other.filter(hit).length+1)/(other.length+2);
    const successes=specific.filter(hit).length;
    const effectiveN=mapN+priorN;
    const effectiveHits=successes+priorN*background;
    const [low,high]=wilson(effectiveHits,effectiveN,1.645);
    return {n:mapN,p:(effectiveHits+1)/(effectiveN+2),low,high,valid:true,hits:successes,
      mean:(specific.reduce((a,b)=>a+b,0)+priorN*other.reduce((a,b)=>a+b,0)/other.length)/effectiveN,
      mapN,totalN,method:'contextual',notCalibrated:true};
  }
  function selection(match,target,map,market,subject,playerId,direction,line,values,options={}){
    const st=options.allValues ? contextualEstimate(values,options.allValues,line,direction,{
      minTotal:options.minTotal||12,minMap:options.minMap||2}) : estimate(values,line,direction,options.minN||10);
    return {...st,matchId:match.id,target,mapName:map||'',market,marketLabel:MARKET_NAMES[market]||market,subject,playerId:playerId||null,direction,line,
      team:options.team||'',note:options.note||'',sampleA:options.sampleA??null,sampleB:options.sampleB??null,
      method:st.method||'empirical',notCalibrated:!!st.notCalibrated,kind:'market',valid:st.valid&&options.valid!==false};
  }
  function playerRoster(teamId){
    const rosters=(db.rosters||[]).find(x=>x.teamId===teamId)?.players;
    const byId=new Map();
    for(const [key,rows] of indexed.players){if(!key.startsWith(teamId+'|'))continue;
      const newest=[...rows].sort((a,b)=>String(b.startsAt).localeCompare(String(a.startsAt)))[0];
      byId.set(newest.playerId,{playerId:newest.playerId,name:newest.player,team:newest.team,rows});
    }
    if(Array.isArray(rosters)&&rosters.length){
      return rosters.filter(x=>x.playerId).slice(0,5).map(x=>byId.get(x.playerId)||{playerId:x.playerId,name:x.name||'Atleta',team:x.team||'',rows:[]});
    }
    return [...byId.values()].sort((a,b)=>b.rows.length-a.rows.length).slice(0,5);
  }
  function chooseLineCards(values,lines,maximum=2){
    if(!values.length)return [];
    const mid=values.reduce((a,b)=>a+b,0)/values.length;
    return lines.map(line=>({line,d:Math.abs(mid-line)})).sort((a,b)=>a.d-b.d).slice(0,maximum).map(x=>x.line);
  }
  function playerMarkets(match,sequence){
    const out=[];
    for(let i=0;i<3;i++){
      const map=sequence[i];if(!map)continue;
      const target='map'+(i+1);
      for(const id of [match.team1Id,match.team2Id])for(const p of playerRoster(id)){
        const history=p.rows.filter(x=>x.teamId===id&&normMap(x.mapName)===normMap(map));
        for(const metric of ['kills','headshots','assists','firstKills']){
          const values=history.map(r=>num(r[metric])).filter(v=>v!==null);
          const allValues=p.rows.filter(x=>x.teamId===id).map(r=>num(r[metric])).filter(v=>v!==null);
          if(values.length<2 || !allValues.length)continue;
          const metricMeans=values.length>=5?values:allValues;
          for(const line of chooseLineCards(metricMeans,PLAYER_LINES[metric],2))for(const dir of ['over','under']){
            const s=selection(match,target,map,metric,p.name,p.playerId,dir,line,values,{team:p.team,allValues,minTotal:12,minMap:2,
              note:`${values.length} mapa(s) ${map} e ${allValues.length} mapas totais recentes do jogador. ${values.length<10?'Estimativa combinada com a forma geral, não calibrada.':'Frequência observada somente neste mapa.'} Escalação e adversário ainda precisam ser confirmados.`});
            if(s.p===null || s.p>=.12&&s.p<=.93)out.push(s);
          }
        }
      }
    }
    return out;
  }
  function teamKillRecords(teamId,map){return [...(indexed.teamKills.get(teamId)?.values()||[])].filter(x=>!map||normMap(x.mapName)===normMap(map));}
  function teamKillMarkets(match,sequence){
    const out=[];
    for(let i=0;i<3;i++){
      const map=sequence[i];if(!map)continue;
      const target='map'+(i+1);
      for(const [tid,tname,opp] of [[match.team1Id,match.team1,match.team2Id],[match.team2Id,match.team2,match.team1Id]]){
        const own=teamKillRecords(tid,map),other=teamKillRecords(opp,map),allOwn=teamKillRecords(tid,null);
        const values=own.map(x=>x.kills),oppDeaths=other.map(x=>x.deaths),allValues=allOwn.map(x=>x.kills);
        if(values.length<2 || allValues.length<10){
          out.push({matchId:match.id,target,mapName:map,market:'team_kills',marketLabel:MARKET_NAMES.team_kills,
            subject:tname,team:tname,direction:'over',line:null,n:values.length,p:null,low:null,high:null,valid:false,
            kind:'placeholder',note:`${values.length} mapa(s) completos em ${map}, ${allValues.length} no total. O cálculo exige cinco jogadores em cada mapa e pelo menos 2 observações nessa arena, além de 10 no histórico geral.`});
          continue;
        }
        const mid=values.reduce((a,b)=>a+b,0)/values.length;
        const candidates=[-12,-6,0,6,12].map(v=>Math.max(20,Math.min(145,Math.round(mid+v)+.5)));
        const lines=[...new Set(candidates)].sort((a,b)=>Math.abs(mid-a)-Math.abs(mid-b)).slice(0,3);
        for(const line of lines)for(const dir of ['over','under']){
          const s=selection(match,target,map,'team_kills',tname,null,dir,line,values,{team:tname,allValues,minTotal:10,minMap:2,
            note:`${own.length} mapas ${map} e ${allOwn.length} totais com cinco jogadores completos. ${other.length} mapa(s) completos do adversário para comparação; totais incompletos excluídos. Projeção geral não calibrada quando há menos de 10 na arena.`});
          s.opponentDefensiveN=oppDeaths.length;s.opponentDefensiveMean=oppDeaths.length?oppDeaths.reduce((a,b)=>a+b,0)/oppDeaths.length:null;
          if(s.p>=.12&&s.p<=.93)out.push(s);
        }
      }
    }
    return out;
  }
  function teamMapResults(teamId,map){return [...indexed.mapResults.values()].filter(x=>(!map||normMap(x.mapName)===normMap(map))&&[x.team1Id,x.team2Id].includes(teamId)&&x.score1!==null&&x.score2!==null&&x.team1Id&&x.team2Id);}
  function teamRounds(teamId,map){
    const indexedMap = indexed.teamMaps.get(teamId) || new Map();
    const matching=x=>!map||normMap(x.mapName)===normMap(map);
    const mapIds=new Set([...indexedMap.values()].filter(matching).map(x=>x.mapId));
    for(const x of teamMapResults(teamId,map))mapIds.add(x.mapId);
    return [...mapIds].map(id=>indexed.mapResults.get(id)).filter(x=>x&&matching(x)&&num(x.rounds)!==null).map(x=>({id:x.mapId,rounds:x.rounds}));
  }
  function roundMarkets(match,sequence){
    const out=[];
    for(let i=0;i<3;i++){
      const map=sequence[i];if(!map)continue;
      const a=teamRounds(match.team1Id,map),b=teamRounds(match.team2Id,map);
      const union=new Map([...a,...b].map(x=>[x.id,x.rounds])),values=[...union.values()];
      const allA=teamRounds(match.team1Id,null),allB=teamRounds(match.team2Id,null);
      const allUnion=new Map([...allA,...allB].map(x=>[x.id,x.rounds]));
      const allValues=[...allUnion.values()];
      if(!values.length)continue;
      const basis=values.length>=8?values:allValues;
      const mid=basis.reduce((x,y)=>x+y,0)/basis.length;
      const lines=ROUNDS_LINES.map(line=>({line,d:Math.abs(mid-line)})).sort((x,y)=>x.d-y.d).slice(0,4).map(x=>x.line);
      for(const line of lines)for(const direction of ['over','under']){
        const s=selection(match,'map'+(i+1),map,'rounds_total',`${match.team1} × ${match.team2}`,null,direction,line,values,{allValues,minTotal:12,minMap:3,
          valid:allA.length>=8&&allB.length>=8 && a.length>=1&&b.length>=1,sampleA:a.length,sampleB:b.length,
          note:`${a.length}/${b.length} mapas ${map} das equipes; ${allA.length}/${allB.length} nos históricos gerais. Mapas duplicados entre equipes contam apenas uma vez. ${values.length<10?'Combinação geral/específica exploratória.':'Histórico específico do mapa.'} Inclui prorrogações.`});
        if(s.p>=.12&&s.p<=.93)out.push(s);
      }
    }
    return out;
  }
  function winEstimate(match,map){
    const a=teamMapResults(match.team1Id,map),b=teamMapResults(match.team2Id,map);
    const wins=(rows,tid)=>rows.filter(r=>r.team1Id===tid?r.score1>r.score2:r.score2>r.score1).length;
    const wa=wins(a,match.team1Id),wb=wins(b,match.team2Id),nA=a.length,nB=b.length;
    const allA=teamMapResults(match.team1Id,null),allB=teamMapResults(match.team2Id,null);
    if(allA.length<10||allB.length<10||nA<1||nB<1)return {valid:false,nA,nB,totalA:allA.length,totalB:allB.length};
    // Taxa no mapa, com suavização pela forma geral recente. Heurística exploratória;
    // não é probabilidade calibrada, mesmo quando existe bastante histórico.
    const prior=(allRows,mapRows,tid)=>{
      const excluded=new Set(mapRows.map(x=>x.mapId));const remaining=allRows.filter(x=>!excluded.has(x.mapId));
      const k=Math.min(8,remaining.length);
      const overall=remaining.length? (wins(remaining,tid)+1)/(remaining.length+2):.5;
      return {k,overall};
    };
    const priorA=prior(allA,a,match.team1Id),priorB=prior(allB,b,match.team2Id);
    const pa=(wa+priorA.k*priorA.overall+2)/(nA+priorA.k+4),pb=(wb+priorB.k*priorB.overall+2)/(nB+priorB.k+4);
    const odds=v=>v/(1-v);const convert=(a,b)=>{const ratio=odds(a)/odds(b);return ratio/(1+ratio)};
    const clamp=x=>Math.max(.025,Math.min(.975,x));
    const ciA=wilson(wa+priorA.k*priorA.overall,nA+priorA.k),ciB=wilson(wb+priorB.k*priorB.overall,nB+priorB.k);
    return {valid:true,nA,nB,totalA:allA.length,totalB:allB.length,wa,wb,p:convert(pa,pb),
      low:convert(clamp(ciA[0]),clamp(ciB[1])),high:convert(clamp(ciA[1]),clamp(ciB[0]))};
  }
  function mapTotalMarkets(match,sequence){
    if(Number(match.bestOf)!==3)return [];
    const [m1,m2,m3]=sequence;
    if(!m1||!m2)return [{matchId:match.id,target:'series',mapName:'',market:'maps_total',marketLabel:MARKET_NAMES.maps_total,
      subject:`${match.team1} × ${match.team2}`,direction:'over',line:2.5,n:0,p:null,valid:false,note:'Escolha Mapa 1 e Mapa 2 para estimar a necessidade de um terceiro mapa.',kind:'placeholder'}];
    const e1=winEstimate(match,m1),e2=winEstimate(match,m2);
    if(!e1.valid||!e2.valid){return ['over','under'].map(dir=>({matchId:match.id,target:'series',mapName:'',market:'maps_total',marketLabel:MARKET_NAMES.maps_total,
      subject:`${match.team1} × ${match.team2}`,direction:dir,line:2.5,n:Math.min(e1.nA||0,e1.nB||0,e2.nA||0,e2.nB||0),p:null,valid:false,kind:'placeholder',
      note:`Para uma projeção exploratória: cada equipe precisa de ≥10 mapas com placar no histórico geral e ≥1 no mapa escolhido. No ${m1}: ${e1.nA||0}/${e1.nB||0} (geral ${e1.totalA||0}/${e1.totalB||0}); no ${m2}: ${e2.nA||0}/${e2.nB||0} (geral ${e2.totalA||0}/${e2.totalB||0}).` }));}
    const split=(p1,p2)=>p1*(1-p2)+(1-p1)*p2;
    const combinations=[split(e1.low,e2.low),split(e1.low,e2.high),split(e1.high,e2.low),split(e1.high,e2.high)];
    const p=split(e1.p,e2.p),low=Math.max(0,Math.min(...combinations)),high=Math.min(1,Math.max(...combinations));
    const base={matchId:match.id,target:'series',mapName:'',market:'maps_total',marketLabel:MARKET_NAMES.maps_total,
      subject:`${match.team1} × ${match.team2}`,line:2.5,n:Math.min(e1.nA,e1.nB,e2.nA,e2.nB),hits:null,kind:'market',
      method:'heuristic',valid:true,notCalibrated:true,
      note:`Atualizado conforme ${m1} → ${m2}. Over 2,5 ocorre quando as equipes dividem as vitórias nos dois primeiros mapas. Independe do nome do terceiro mapa. Modelo de independência simplificada; não calibrado.`};
    return [{...base,direction:'over',p,low,high},{...base,direction:'under',p:1-p,low:1-high,high:1-low}];
  }
  function winnerCandidates(match,sequence){
    if(Number(match.bestOf)!==3)return [];
    const [m1,m2,m3]=sequence;
    const e=m1&&m2&&m3?[winEstimate(match,m1),winEstimate(match,m2),winEstimate(match,m3)]:[];
    if(e.length===3&&e.every(x=>x.valid)){
      const calc=([a,b,c])=>a*b+(a*(1-b)+(1-a)*b)*c;
      const p=calc(e.map(x=>x.p));
      return [{matchId:match.id,target:'series',mapName:'',market:'series_winner',marketLabel:MARKET_NAMES.series_winner,
        subject:match.team1,direction:'sim',line:null,n:Math.min(...e.flatMap(x=>[x.nA,x.nB])),p,low:null,high:null,
        valid:false,kind:'placeholder',note:`Estimativa exploratória da série com mapas ${sequence.join(' → ')}: ${pct(p)} para ${match.team1}; não calibrada e não habilitada para sinal de valor.`}];
    }
    return [{matchId:match.id,target:'series',mapName:'',market:'series_winner',marketLabel:MARKET_NAMES.series_winner,
      subject:`${match.team1} × ${match.team2}`,direction:'sim',line:null,n:0,p:null,valid:false,kind:'placeholder',
      note:'Informe os três mapas. Para a estimativa exploratória de vencedor, cada equipe precisa ter 10 mapas gerais com placar e ao menos um jogo em cada mapa escolhido.'}];
  }
  function allMarketCards(match){
    const sequence=getSequence(match.id);
    return [...mapTotalMarkets(match,sequence),...winnerCandidates(match,sequence),...roundMarkets(match,sequence),...teamKillMarkets(match,sequence),...playerMarkets(match,sequence)];
  }
  function oddsFor(s){
    if(typeof oddsLoad!=='function')return null;
    const all=oddsLoad().filter(x=>x.matchId===s.matchId&&x.target===s.target&&x.market===s.market&&
      String(x.subject).toLowerCase()===String(s.subject).toLowerCase()&&String(x.direction)===String(s.direction)&&
      Number(x.line)===Number(s.line) &&
      (s.target==='series'||(!!x.mapName&&normMap(x.mapName)===normMap(s.mapName))));
    return all.sort((a,b)=>b.odd-a.odd)[0]||null;
  }
  function status(s){
    if(!s.valid||s.p===null)return {cls:'disabled',label:s.market==='maps_total'&&!s.n?'Defina os mapas':'Dados insuficientes neste mercado'};
    const odd=oddsFor(s);
    if(!odd)return {cls:'await',label:s.notCalibrated?'Aguardando odd · projeção exploratória':'Aguardando odd'};
    if(s.notCalibrated||s.low===null)return {cls:'caution',label:s.p*odd.odd>1?'Vantagem teórica · não calibrada':'Sem valor na estimativa'};
    if(s.n>=20 && s.low*odd.odd>1.02)return {cls:'value',label:'Possível valor · revisar'};
    if(s.p*odd.odd<=1)return {cls:'novalue',label:'Sem valor nesta odd'};
    return {cls:'caution',label:'Sinal fraco / incerto'};
  }
  function valueScore(s){const o=oddsFor(s);return o&&s.valid&&s.low!==null?(s.low*o.odd-1): -2;}
  function cards(match){
    const all=allMarketCards(match).filter(x=>marketFilter==='all'||x.market===marketFilter);
    const rankStatus=s=>{const o=oddsFor(s);if(o&&s.valid&&!s.notCalibrated)return 3;if(o)return 2;return s.valid?1:0;};
    all.sort((a,b)=>rankStatus(b)-rankStatus(a)||valueScore(b)-valueScore(a)||b.n-a.n);
    // Cotas por mercado para focar a tela no que é comparável.
    if(marketFilter!=='all')return all.slice(0,48);
    const perKind={},chosen=[];
    for(const s of all){const max=s.market==='kills'?12:s.market==='team_kills'?8:s.market==='rounds_total'?8:s.market==='maps_total'?2:s.market==='series_winner'?1:4;
      const key=s.market+'|'+s.target;const perTarget=s.market==='kills'?5:s.market==='team_kills'?3:s.market==='rounds_total'?3:3;
      const cnt=perKind[s.market]||0;if(cnt>=max||(perKind[key]||0)>=perTarget)continue;
      chosen.push(s);perKind[s.market]=cnt+1;perKind[key]=(perKind[key]||0)+1;
    }
    return chosen.slice(0,40);
  }
  function optsForSequence(match){
    const current=getSequence(match.id);
    return `<div class="map-order"><div class="map-order-top"><div><h3>Defina a ordem provável dos mapas</h3><p>Escolha os mapas que você espera ver no veto. São hipóteses suas, <strong>não mapas oficiais confirmados</strong>. Mudar um mapa recalcula as linhas e não reaproveita odds de outro mapa.</p></div><button type="button" id="clearMapOrder">Limpar ordem</button></div><div class="map-order-grid">${current.map((value,i)=>`<label class="map-choice"><span>Mapa ${i+1}${i===2?' · desempate, se necessário':''}</span><select data-map-position="${i}" aria-label="Mapa ${i+1}"><option value="">Não informado</option>${currentPool.map(map=>`<option value="${h(map)}" ${map===value?'selected':''} ${current.some((a,j)=>a===map&&j!==i)?'disabled':''}>${h(map)}</option>`).join('')}</select><small>${value?'Mercados condicionados a '+h(value):'Selecione para ativar mercados deste mapa'}</small></label>`).join('')}</div><div class="map-order-footer">${current[0]&&current[1]?'✓ M1 e M2 escolhidos — análise de 2,5 mapas recalculada':'Escolha M1 e M2 para avaliar over/under 2,5 mapas.'} ${current[2]?'· M3 é condicional: só acontece se houver 1–1.':''}</div></div>`;
  }
  function displayCard(s,i){
    const odd=oddsFor(s),st=status(s),direction=s.direction==='over'?'Mais de':s.direction==='under'?'Menos de':'';
    const t=s.target==='series'?'Série MD3':s.target.replace('map','Mapa ')+' · '+s.mapName;
    const title=s.market==='series_winner'||s.line===null?s.marketLabel:`${s.marketLabel} · ${direction} ${fmt(s.line,1)}`;
    const probability=s.valid&&s.p!==null?pct(s.p):'—',fair=s.valid&&s.p>0?fmt(1/s.p,2):'—';
    const sample=s.method==='contextual'?`${s.mapN} neste mapa / ${s.totalN} gerais`:(s.n?`${s.n} ${s.method==='heuristic'?'mapas mín. por equipe':s.market==='rounds_total'?'mapas distintos':'observações'}`:'—');
    const band=s.low!==null&&s.low!==undefined?`Intervalo amostral/heurístico: ${pct(s.low)}–${pct(s.high)}.`:'';
    const value=odd&&s.valid?`EV ${s.notCalibrated?'exploratório':'estimado'} ${fmt((s.p*odd.odd-1)*100,1)}%${s.low!==null&&!s.notCalibrated?', limite conservador '+fmt((s.low*odd.odd-1)*100,1)+'%':''}.`:'';
    return `<article class="edge-pick"><div class="edge-pick-top"><div><div class="edge-pick-title">${h(title)}</div><div class="fine">${h(s.subject)}${s.team&&s.subject!==s.team?' · '+h(s.team):''} · ${h(t)}</div></div><span class="edge-status ${st.cls}">${st.label}</span></div>
      <div class="edge-pick-stats"><div><span>Prob. preliminar</span><strong>${probability}</strong></div><div><span>Odd justa</span><strong>${fair}</strong></div><div><span>Amostra</span><strong>${h(sample)}</strong></div></div>
      <div class="edge-explain">${h(s.note||'')}${band?' '+h(band):''} ${s.notCalibrated?'Probabilidade exploratória não calibrada; não é recomendação de aposta.':''}</div>
      <div class="edge-odds"><div class="edge-existing">${odd?`Melhor odd: <strong>${fmt(odd.odd,2)}</strong> (${h(odd.book)}) · ${value}`:'Sem odd cadastrada — não é possível afirmar valor'}</div>
      ${s.kind==='placeholder'?'<span class="fine">Aguardando histórico/mapas suficientes para uma avaliação.</span>':`<div class="edge-form"><input placeholder="Casa" aria-label="Casa de apostas" maxlength="50" data-book="${i}"/><input placeholder="Odd decimal" aria-label="Odd decimal" type="number" min="1.01" max="500" step="0.01" data-odd="${i}"/><button type="button" class="edge-save" data-edge-save="${i}">Avaliar odd</button></div>`}</div></article>`;
  }
  function mapHistory(match){
    const seq=getSequence(match.id);
    return `<div class="edge-history"><div class="edge-history-head"><h3>Cobertura da base por mapa escolhido</h3><span class="fine">${indexed.mapCount} mapas únicos de todos os jogos · ${indexed.seriesCount} séries concluídas na base</span></div><div class="map-coverage">${seq.map((map,i)=>{if(!map)return `<div><strong>Mapa ${i+1}</strong><span>A definir</span></div>`;
      const a=teamRounds(match.team1Id,map).length,b=teamRounds(match.team2Id,map).length,ak=teamKillRecords(match.team1Id,map).length,bk=teamKillRecords(match.team2Id,map).length;
      return `<div><strong>Mapa ${i+1} · ${h(map)}</strong><span>Rounds: ${a}/${b} mapas (${h(match.team1)} / ${h(match.team2)})</span><span>Kills completas: ${ak}/${bk} mapas</span></div>`;}).join('')}</div><p class="fine">Para kills totais, cada amostra exige estatísticas de 5 jogadores. Histórico por mapa é filtrado pela equipe atual registrada; troca de elenco ou veto deve ser considerada antes de decidir.</p></div>`;
  }
  function draw(){
    if(!db||!$('edgeMatchSelect'))return;
    const filter=$('tierFilter')?.value||'all',q=($('search')?.value||'').trim().toLowerCase();
    const all=(db.upcoming||[]).filter(m=>(filter==='all'||m.tier===filter)&&`${m.team1} ${m.team2} ${m.event}`.toLowerCase().includes(q))
      .sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
    const now=Date.now(),upcoming=all.filter(m=>Date.parse(m.startsAt)>now-4*3600000),eligible=upcoming.length?upcoming:all;
    if(!eligible.some(m=>m.id===selected))selected=eligible[0]?.id||'';
    $('edgeMatchSelect').innerHTML=eligible.map(m=>`<option value="${h(m.id)}">${h(m.team1)} × ${h(m.team2)} · ${new Date(m.startsAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})} (${h(m.tier)})</option>`).join('');
    $('edgeMatchSelect').value=selected;
    const m=eligible.find(x=>x.id===selected);
    if(!m){$('edgeMain').innerHTML='<div class="panel">Nenhum confronto disponível para o filtro escolhido.</div>';return;}
    currentCards=cards(m);
    const date=new Date(m.startsAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    const valid=currentCards.filter(x=>x.valid).length,priced=currentCards.filter(x=>oddsFor(x)).length;
    $('edgeMain').innerHTML=`<div class="edge-match-heading"><div><div class="edge-meta">${h(m.event)} · ${h(m.tier)} · ${h(date)}</div><h2>${h(m.team1)} <span>×</span> ${h(m.team2)}</h2><p class="fine">${valid} seleções exploratórias com amostra mínima · ${priced} odds para as seleções exibidas · BO${m.bestOf||'?'} · posições #${m.rank1||'—'} / #${m.rank2||'—'}</p></div><div class="edge-explanation">Os mapas são hipóteses informadas por você. Odds continuam manuais. A indicação de valor só é liberada para frequências históricas com margem conservadora; modelos derivados de vitória seguem sem calibração.</div></div>
    ${optsForSequence(m)}
    <div id="edgeMatchHighlights"></div>
    <div class="edge-pick-overview"><h3>Seleções por mercado</h3><span class="fine">Ordenadas por odds e evidência disponível — não por promessa de acerto.</span></div>
    <div class="edge-market-filters">${[['all','Todos'],['kills','Kills jogador'],['team_kills','Kills equipe'],['rounds_total','Rounds por mapa'],['maps_total','Mapas MD3'],['headshots','Headshots'],['assists','Assistências'],['firstKills','Primeiras kills'],['series_winner','Vencedor']].map(([v,l])=>`<button type="button" data-edge-market="${v}" class="${marketFilter===v?'active':''}">${l}</button>`).join('')}</div>
    <div class="edge-pick-grid">${currentCards.length?currentCards.map(displayCard).join(''):'<div class="edge-explanation">Escolha os mapas acima para ver as linhas específicas por confronto.</div>'}</div>${mapHistory(m)}`;
    $('edgeCount').textContent=`${indexed.mapCount} mapas · ${(db.player_maps||[]).length} registros jogador/mapa · ${indexed.seriesCount} séries`;
    window.EdgePicks?.refresh();
    for(const control of $('edgeMain').querySelectorAll('[data-map-position]'))control.addEventListener('change',()=>{
      if(!setSequence(m.id,Number(control.dataset.mapPosition),control.value))alert('Um mapa não pode ocupar duas posições.');
      marketFilter='all';draw();
    });
    $('clearMapOrder').onclick=()=>{sequenceCache.set(m.id,['','','']);try{localStorage.removeItem(mapSequenceKey(m.id));}catch{}marketFilter='all';draw();};
    for(const control of $('edgeMain').querySelectorAll('[data-edge-market]'))control.onclick=()=>{marketFilter=control.dataset.edgeMarket;draw();};
    for(const button of $('edgeMain').querySelectorAll('[data-edge-save]'))button.onclick=()=>{
      const i=Number(button.dataset.edgeSave),s=currentCards[i];if(!s)return;
      const book=($('edgeMain').querySelector(`[data-book="${i}"]`)?.value||'').trim();
      const odd=Number($('edgeMain').querySelector(`[data-odd="${i}"]`)?.value);
      if(!book||!Number.isFinite(odd)||odd<=1||odd>500){alert('Informe casa e odd decimal válida.');return;}
      const existing=typeof oddsLoad==='function'?oddsLoad():[];
      existing.unshift({matchId:s.matchId,target:s.target,mapName:s.mapName,market:s.market,subject:s.subject,direction:s.direction,line:s.line,book,odd,date:new Date().toISOString()});
      if(typeof oddsSave==='function')oddsSave(existing.slice(0,600));draw();
    };
  }
  function init(data){db=data;indexData(data);draw();}
  function switchMatch(v){selected=v;marketFilter='all';draw();}
  window.EdgeIntelligence={init,draw,switchMatch,estimate,wilson,allMarketCards,index:()=>indexData(db),
    getSequence,setSequence,teamKillRecords,teamRounds,winEstimate,mapTotalMarkets,roundMarkets,teamKillMarkets,playerMarkets,oddsFor,status,
    snapshotStats:()=>({maps:indexed.mapCount,series:indexed.seriesCount,completeTeamMaps:[...indexed.teamKills.values()].reduce((a,m)=>a+m.size,0)})};
  window.addEventListener('DOMContentLoaded',()=>{const el=$('edgeMatchSelect');if(el)el.onchange=()=>switchMatch(el.value);});
})();