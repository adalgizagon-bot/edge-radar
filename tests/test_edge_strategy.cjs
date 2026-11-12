'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../public/edge-strategy.js'),'utf8');
const store=new Map();const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
const nextHour=new Date(Date.now()+3600*1000).toISOString();
const match=i=>({id:'M'+i,team1:'A'+i,team2:'B'+i,tier:'Tier 1',status:'upcoming',event:'Test',startsAt:nextHour});
const samples=Array.from({length:3},(_,i)=>match(i+1));
const make=(i,p=.75,uncal=false)=>({matchId:'M'+i,target:'map1',mapName:'Mirage',market:'kills',subject:'Player '+i,
    playerId:'P'+i,team:'A'+i,direction:'over',line:15.5,p,n:30,low:.62,valid:true,notCalibrated:uncal,kind:'market',method:'empirical'});
const sels=[make(1),make(2),make(3,.75,true)];
const elements={tierFilter:{value:'all'},search:{value:''},
  pickDate:{value:'',addEventListener(){}},strategyDate:{value:'',addEventListener(){}},
  strategyMode:{value:'all',addEventListener(){}},strategyEdge:{value:'3',addEventListener(){}}};
for(const name of ['strategyKpis','strategyFeatured','strategyCandidates','strategyWatch','strategyPairs','strategyBacktest','strategyPerformance'])elements[name]={innerHTML:''};
elements.pickJournal={querySelectorAll:()=>[]};
const document={getElementById:n=>elements[n]||null,addEventListener:()=>{},querySelector:()=>null};
const window={EdgeIntelligence:{getSequence:()=>['Mirage','Nuke','Inferno'],allMarketCards:m=>[sels[Number(m.id[1])-1]]},
  EdgePicks:{refresh:()=>{},journal:()=>[]},oddsLoad:()=>JSON.parse(store.get('cs2edge.manualOdds')||'[]')};
const ctx={document,window,localStorage,Date,Intl,Math,Number,String,JSON,console,alert:()=>{}};
vm.createContext(ctx);vm.runInContext(code,ctx);
const m=window.EdgeStrategy;assert(m);
const day=m.localDay(nextHour);
const rows=sels.map((s,i)=>({matchId:s.matchId,target:s.target,mapName:s.mapName,market:s.market,
  subject:s.subject,direction:s.direction,line:s.line,book:i===2?'Other House':'House A',odd:[1.5,1.55,1.5][i],date:new Date().toISOString()}));
store.set('cs2edge.manualOdds',JSON.stringify(rows));
assert.equal(m.validPrice(rows[0]),true);
assert.equal(m.validPrice({...rows[0],date:new Date(Date.now()-25*3600*1000).toISOString()}),false,'stale odds invalid');
const sampled={upcoming:samples,player_maps:[],meta:{collectedAt:'2026-11-11T00:00:00Z'}};
assert.equal(m.collect(sampled,day).priced.length,3);
assert.equal(m.lowOdds(m.collect(sampled,day)).length,3,'1.40–1.60 range');
assert.equal(m.pairs(m.collect(sampled,day)).length,1,'only 1 same-book double of distinct matches');
assert(Math.abs(m.pairs(m.collect(sampled,day))[0].odd-1.5*1.55)<1e-10);
assert.equal(m.assessment(sels[0],1.5).level,'caution','no strong label when lower bound not above breakeven');
assert.equal(m.assessment({...sels[0],low:.70},1.5).level,'review','conservative amostral, not calibrated official');
assert.equal(m.assessment({...sels[0],notCalibrated:true},1.5).level,'explore');
assert.equal(m.assessment(sels[0],1.2).level,'no');
assert.equal(m.offers({...sels[0],mapName:'Nuke'},rows).length,0,'odds must be tied to exact map');
assert.equal(m.collect(sampled,day,0.03).matches.length,3);
const old=rows.map(x=>({...x,date:new Date(Date.now()-48*3600*1000).toISOString()}));
store.set('cs2edge.manualOdds',JSON.stringify(old));
assert.equal(m.collect(sampled,day).priced.length,0,'do not use old odds');
store.set('cs2edge.manualOdds',JSON.stringify(rows));
const grades=[
 {type:'single',stake:10,createdAt:'2026-10-01',legs:[{grade:'won',odd:1.5,closingOdd:1.4}]},
 {type:'single',stake:10,createdAt:'2026-10-02',legs:[{grade:'lost',odd:1.6}]},
 {type:'parlay',stake:10,createdAt:'2026-10-03',legs:[{grade:'won',odd:1.6},{grade:'won',odd:1.5}]}];
const perf=m.metrics(grades);assert.equal(perf.count,3);assert(Math.abs(perf.profit-9)<1e-8);assert(Math.abs(perf.roi-.3)<1e-10);assert.equal(perf.maxDrawdown,10);
assert.equal(perf.groups.find(x=>x.name==='Faixa 1,40–1,60').rows.length,2);
assert(perf.clv>0);assert.equal(perf.clvN,1);
assert.equal(m.ticketResult({stake:10,legs:[{grade:'lost',odd:1.5},{grade:'pending',odd:2}]}).profit,-10);
// Audit: preceding ten maps only; does not assign retrospective sportsbook odds or ROI.
const past=Array.from({length:16},(_,i)=>({matchId:'S'+i,mapId:'MAP'+i,playerId:'P1',teamId:'T1',startsAt:new Date(Date.UTC(2026,9,1+i)).toISOString(),
 kills:i===15?3:17,headshots:7,assists:5}));
const audit=m.auditWalkForward({player_maps:past});
assert.equal(audit.kills.count,6);assert.equal(audit.assists.count,6);
assert(audit.kills.brier!==null&&audit.kills.brier>=0);
assert.equal(m.auditWalkForward({player_maps:past.slice(0,15)}).kills.count,5,'no future peeking');
// Real render path, no click actions requested.
m.init(sampled);assert(elements.strategyCandidates.innerHTML.includes('A1'),'renders ranked match');
assert(elements.strategyKpis.innerHTML.includes('3'),'summary visible');
assert(elements.strategyBacktest.innerHTML.includes('histórico suficiente'),'empty audit honest');
console.log('PASS strategy: odds freshness, match/map matching, 1.5, same-book doubles, ROI, CLV, chronological audit, rendering');