'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../public/edge-picks.js'),'utf8');
const memory=new Map();
const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
const now=new Date();const inHour=new Date(Date.now()+3600000).toISOString();
const els={tierFilter:{value:'all'},search:{value:''}};
const document={getElementById:id=>els[id]||null,addEventListener:()=>{}};
const qs=(id,subject='Player '+id)=>({matchId:id,target:'map1',mapName:'Mirage',market:'kills',subject,team:'A',direction:'over',line:15.5,p:.63,n:27,low:.53,valid:true,notCalibrated:false,method:'empirical'});
let data={upcoming:[
{id:'M1',team1:'A',team2:'B',startsAt:inHour,status:'upcoming',event:'Event',tier:'Tier 1'},
{id:'M2',team1:'C',team2:'D',startsAt:inHour,status:'upcoming',event:'Event',tier:'Tier 1'},
{id:'M3',team1:'E',team2:'F',startsAt:inHour,status:'upcoming',event:'Event',tier:'Tier 2'}]};
const win={EdgeIntelligence:{getSequence:()=>['Mirage','Nuke','Inferno'],allMarketCards:m=>[qs(m.id)]}};
const context={window:win,document,localStorage:storage,console,Intl,Date,Number,String,Math,alert:()=>{},confirm:()=>true};
vm.createContext(context);vm.runInContext(code,context);
const mod=win.EdgePicks;assert(mod);
const today=mod.localDay(inHour);assert.match(today,/^\d{4}-\d{2}-\d{2}$/,'future match local day');
assert.equal(mod.quality(qs('M1')).status,'Para buscar odd','no odds no edge');
const oddFor=(s,book,odd)=>({matchId:s.matchId,target:s.target,mapName:s.mapName,market:s.market,subject:s.subject,direction:s.direction,line:s.line,book,odd,date:new Date().toISOString()});
const s1=qs('M1'),s2=qs('M2');
memory.set('cs2edge.manualOdds',JSON.stringify([oddFor(s1,'HouseA',2.10),oddFor(s1,'HouseB',2.20),oddFor(s2,'HouseA',1.90)]));
assert.equal(mod.quality(s1).priority,4,'full sample positive conservative edge');
assert.equal(mod.sameBook([{m:data.upcoming[0],s:s1},{m:data.upcoming[1],s:s2}]).book,'HouseA','parlay uses common house even if another has better price');
assert.equal(mod.sameBook([{m:data.upcoming[0],s:s1},{m:data.upcoming[1],s:s2}]).combined,2.10*1.90);
const sDifferentMap={...s1,mapName:'Nuke'};
assert.equal(mod.quality(sDifferentMap).status,'Para buscar odd','cannot leak odds between maps');
const nonCalibrated={...s1,notCalibrated:true};assert.equal(mod.quality(nonCalibrated).priority,2,'uncalibrated not strong value');
assert.equal(mod.quality({...s1,valid:false}).priority,-1,'no misleading signal without data');
// Using init does not require DOM for candidate computation; refresh is invoked only with elements.
mod.init(data);
const combos=mod.combosFor(today);assert(combos.length>0,'can generate paired candidates');
assert(combos.every(c=>new Set(c.legs.map(x=>x.m.id)).size===2),'distinct match IDs');
const first=combos.find(x=>x.legs.some(l=>l.m.id==='M1')&&x.legs.some(l=>l.m.id==='M2'));
assert(first && first.ready,'only common house and positive priced legs gets ready');
const ticket={stake:10,legs:[{odd:2,grade:'won'},{odd:3,grade:'won'}]};
assert.equal(mod.result(ticket).profit,50,'parlay payout');
assert.equal(mod.result({stake:10,legs:[{odd:2,grade:'won'},{odd:3,grade:'void'}]}).profit,10,'void leg adjusted');
assert.equal(mod.result({stake:10,legs:[{odd:2,grade:'lost'},{odd:3,grade:'pending'}]}).profit,-10,'one lost leg loses parlay');
assert.equal(mod.result({stake:10,legs:[{odd:2,grade:'won'},{odd:3,grade:'pending'}]}).status,'pending','missing result not settled');
const badOdd={...s1};memory.set('cs2edge.manualOdds',JSON.stringify([oddFor(s1,'HouseA',1.01),oddFor(s2,'HouseB',1.01)]));
assert.equal(mod.sameBook([{m:data.upcoming[0],s:s1},{m:data.upcoming[1],s:s2}]),null,'no fake parlay across different houses');
const noVal=mod.combosFor(today);assert(noVal.every(c=>!c.ready),'do not invent price or positive opportunity');
// Settles only a completed match with an identical actual map name/position.
const resolvedMatch={id:'M1',status:'completed',isForfeit:false,bestOf:3,team1:'A',team2:'B',team1Id:'T1',team2Id:'T2',maps:[{mapNumber:1,name:'Mirage',status:'completed',isForfeit:false,team1Score:13,team2Score:11}]};
mod.init({...data,past:[resolvedMatch],player_maps:[{matchId:'M1',mapNumber:1,mapName:'Mirage',playerId:'P1',player:'Player',kills:20}]});
assert.equal(mod.actualValue({matchId:'M1',market:'rounds_total',target:'map1',mapName:'Mirage'}),24,'map rounds from real completed map');
assert.equal(mod.actualValue({matchId:'M1',market:'rounds_total',target:'map1',mapName:'Nuke'}),null,'refuse scoring if map is different');
assert.equal(mod.actualValue({matchId:'M1',market:'team_kills',target:'map1',mapName:'Mirage',subject:'A'}),null,'team kills needs five lines');
assert.equal(mod.actualValue({matchId:'M1',market:'kills',target:'map1',mapName:'Mirage',playerId:'P1',subject:'Player'}),20,'player kills from known map');
assert.equal(mod.actualValue({matchId:'M1',market:'maps_total',target:'series',mapName:''}),null,'series not scored unless final scores known');
console.log('PASS highlights + parlays: real odds matching, team match isolation, uncalibrated status, journal math, distinct matches');