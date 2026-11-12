'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const store=new Map(),listeners={};
const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>{store.set(k,v)}};
const document={getElementById:()=>null,addEventListener:(name,fn)=>{listeners[name]=fn}};
const window={addEventListener:()=>{}};
const context={window,document,localStorage,Date,Intl,Math,Number,String,JSON,console,alert:()=>{},confirm:()=>true};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/edge-bankroll.js'),'utf8'),context);
const bank=window.EdgeBankroll;assert(bank,'module exported');
const state={version:1,configured:true,initial:1000,startedAt:'2026-11-01',transactions:[
  {id:'d1',type:'deposit',amount:200,date:'2026-11-03'},
  {id:'d2',type:'withdrawal',amount:100,date:'2026-11-04'}],bets:[
  {id:'b1',label:'Win',stake:100,odd:1.5,placedAt:'2026-11-05',settledAt:'2026-11-06',status:'won',strategy:'odd150'},
  {id:'b2',label:'Loss',stake:50,odd:2,placedAt:'2026-11-05',settledAt:'2026-11-07',status:'lost'},
  {id:'b3',label:'Open',stake:80,odd:2,placedAt:'2026-11-08',status:'pending'},
  {id:'b4',label:'Void',stake:35,odd:1.8,placedAt:'2026-11-08',settledAt:'2026-11-09',status:'void'}
],linkedTickets:[]};
assert(bank.save(state));
let r=bank.calculate();
assert.equal(r.capital,1100,'original capital with cashflows and net profit');
assert.equal(r.available,1020,'pending stake deducted only from available');
assert.equal(r.risk,80);assert.equal(r.profit,0);
assert.equal(r.won,1);assert.equal(r.lost,1);
assert.equal(r.roi,0,'0 profit on 185 settled stakes');
assert.equal(r.drawdown,50,'peak cumulative realized profit fell from 50 to 0');
assert.equal(r.sequence.length,1+2+3);
assert.equal(bank.ticketStatus({stake:50,legs:[{grade:'won',odd:1.5},{grade:'void',odd:1.8}]}).profit,25,'void legs do not multiply odds');
assert.equal(bank.ticketStatus({stake:50,legs:[{grade:'lost',odd:1.5},{grade:'pending',odd:1.8}]}).profit,-50,'one lost leg settles parlay');
assert.equal(bank.ticketStatus({stake:50,legs:[{grade:'pending',odd:1.5}]}).status,'pending');
const past={id:'t1',createdAt:'2026-11-07T13:00:00Z',type:'parlay',stake:40,book:'House',legs:[
  {grade:'won',odd:1.5,gradedAt:'2026-11-08T13:00:00Z',startsAt:'2026-11-08T10:00:00Z'},
  {grade:'won',odd:1.6,gradedAt:'2026-11-09T13:00:00Z',startsAt:'2026-11-09T10:00:00Z'}]};
store.set('cs2edge.selectionJournal.v1',JSON.stringify([past]));
assert.equal(bank.calculate().capital,1100,'simulated history NOT included by default');
state.linkedTickets=[{id:'t1',linkedAt:'2026-11-10T20:00:00Z'}];bank.save(state);r=bank.calculate();
assert.equal(r.profit,56,'40 * (1.5*1.6 - 1)');assert.equal(r.capital,1156);assert.equal(r.available,1076);
assert.equal(r.settled.length,4);assert.equal(r.roi,56/(100+50+35+40));
assert.equal(bank.ticketSettlement(past).day,'2026-11-09');assert.equal(bank.ticketSettlement(past).estimated,false);
assert.equal(bank.ticketSettlement({...past,legs:[{grade:'won',odd:2,startsAt:'2026-11-08T14:00:00Z'}]}).estimated,true);
const prices=bank.calculate({...state,bets:[{id:'a',stake:100,odd:1.4,placedAt:'2026-11-02',settledAt:'2026-11-02',status:'won'}],linkedTickets:[]},[]);
assert.equal(prices.profit,40);assert.equal(prices.capital,1140);
assert.equal(bank.validAmount(''),null);assert.equal(bank.validAmount(-10),null);assert.equal(bank.validAmount('20.5'),20.5);
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
for(const id of ['bankroll','bankContent','bankSummary','bankChart','bankJournal','bankInitialSave','bankBets','bankTransactions'])assert(html.includes('id="'+id+'"'),'missing HTML id '+id);
assert(html.includes('data-tab="bankroll"'));assert(html.includes('edge-bankroll.js'));assert(html.includes('EdgeBankroll.init()'));
console.log('EDGE BANKROLL: 30+ checks passed');