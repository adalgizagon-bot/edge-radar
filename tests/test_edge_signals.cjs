'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const signalSource=fs.readFileSync(path.join(__dirname,'../public/edge-signals.js'),'utf8');
const engineSource=fs.readFileSync(path.join(__dirname,'../public/edge-crypto.js'),'utf8');
const T=Date.parse('2026-11-12T21:20:00Z'),M='A'.repeat(32),N='B'.repeat(32),R='C'.repeat(32);
function env(storage=new Map()){
 let clock=T;
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock;}}
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const x={Date:FakeDate,Intl,JSON,Number,String,Math,RegExp,Array,Object,Map,Set,console,localStorage,
  setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{}};
 x.globalThis=x;vm.createContext(x);vm.runInContext(signalSource,x);return {x,H:x.EdgeSignalHistory,storage,setTime:t=>clock=t};
}
const sample=(mint=M,at=T,price=.001,stage='priority')=>({mint,at,price,stage,score:84,name:'Teste',symbol:'TEST',liquidity:19000,volume:6500,buys:30,sells:8,minLiquidity:5000,minVolume:1500});
const approx=(a,b,eps=1e-7)=>assert(Math.abs(a-b)<eps,`${a} vs ${b}`);
test('captura o primeiro preço qualificado e mantém sinal quando força cai',()=>{
 const {H,setTime}=env();setTime(T);let r=H.observe(sample());assert.equal(r.entryPrice,.001);assert.equal(H.all().length,1);
 setTime(T+30000);H.observe(sample(M,T+30000,.0012,'watch'));
 assert.equal(H.all().length,1);assert.equal(H.latest(M).stage,'watch');assert(H.recent(M,T+30000));
 assert.equal(H.latest(M).checkpoints.m1,undefined);
});
test('1, 5, 15, 30 min são retornos sobre o preço capturado',()=>{
 const {H,setTime}=env();H.observe(sample());
 const values=[[70000,.0012,'m1',20],[350000,.0009,'m5',-10],[960000,.0015,'m15',50],[1910000,.0011,'m30',10]];
 for(const [delay,price,key,ret] of values){setTime(T+delay);H.observe(sample(M,T+delay,price,'watch'));const c=H.latest(M).checkpoints[key];assert.equal(c.status,'measured');approx(c.returnPct,ret)}
 assert.equal(H.metrics().measured.m30,1);assert.equal(H.latest(M).samples,5);
});
test('não fabrica preço retroativo quando janela do checkpoint foi perdida',()=>{
 const {H,setTime}=env();H.observe(sample());setTime(T+200000);H.observe(sample(M,T+200000,.0015,'watch'));
 assert.equal(H.latest(M).checkpoints.m1.status,'missing');assert.equal(H.latest(M).checkpoints.m5,undefined);
 setTime(T+310000);H.observe(sample(M,T+310000,.0013,'watch'));
 assert.equal(H.latest(M).checkpoints.m1.status,'missing');
 approx(H.latest(M).checkpoints.m5.returnPct,30);
});
test('sem cotações após fechar a aba, checkpoints vencem como sem amostra',()=>{
 const {H,setTime}=env();H.observe(sample());setTime(T+2100000);assert(H.tick());
 const s=H.latest(M);for(const key of ['m1','m5','m15','m30'])assert.equal(s.checkpoints[key].status,'missing');
 assert.equal(H.metrics().measured.m5,0);assert.equal(H.metrics().positive.m5,null);
});
test('histórico permanece no localStorage após reinicialização, sem misturar listas',()=>{
 const a=env();a.H.observe(sample());a.setTime(T+65000);a.H.observe(sample(M,T+65000,.0011,'watch'));
 const b=env(a.storage);b.setTime(T+70000);assert.equal(b.H.all().length,1);
 approx(b.H.latest(M).checkpoints.m1.returnPct,10);assert.equal(b.H.latest(N),null);
});
test('o acompanhamento prioriza moedas com checkpoints pendentes, sem duplicar sinais',()=>{
 const {H,setTime}=env();H.observe(sample());assert.equal(H.pinnedMints(T).length,1);
 setTime(T+300000);H.observe(sample(M,T+300000,.0012,'priority'));assert.equal(H.all().length,1);
 setTime(T+3500000);H.tick();assert.equal(H.pinnedMints(T+3500000).length,0);
});
test('não registra token sem preço, contrato inválido ou amostra anterior ao sinal',()=>{
 const {H,setTime}=env();assert.equal(H.observe(sample('bad')),null);
 assert.equal(H.observe(sample(M,T,0)),null);assert.equal(H.observe(sample(M,T,.001,'watch')),null);
 H.observe(sample(M));setTime(T+60000);
 H.observe(sample(M,T-1000,.9,'watch'));assert.equal(H.latest(M).samples,1);
});
test('integração: token qualificado entra nas oportunidades e continua após perder força',()=>{
 const {x,H,setTime}=env();vm.runInContext(engineSource,x);const E=x.EdgeCrypto;
 const pair=(mint,price=.001,change=16)=>({chainId:'solana',dexId:'pumpswap',baseToken:{address:mint,name:'Teste',symbol:'TST'},priceUsd:price,liquidity:{usd:25000},volume:{m5:12000},txns:{m5:{buys:55,sells:20}},priceChange:{m5:change},pairCreatedAt:T-60000});
 const token=(mint,p,at)=>({mint,firstSeen:T-60000,lastEvent:at,source:'pumpportal',type:'launch',symbol:'TST',name:'Teste',pair:p,pairFetchedAt:at});
 E.addToken(token(N,pair(N),T));assert.equal(H.all().length,1);assert.equal(E.visible().length,1);
 setTime(T+70000);E.addToken(token(N,pair(N,.0008,-8),T+70000));
 assert.equal(H.latest(N).stage,'watch');
 assert.equal(E.visible().length,1,'memória da oportunidade permanece na lista por uma hora');
 E._setView('watch');assert.equal(E.visible().length,1);
});
test('a página possui aba de histórico e exportação, sem CS2',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 assert.match(html,/data-view="history"/);assert.match(html,/edge-signals.js/);
 assert.match(html,/historyTimeline/);assert.match(html,/exportSignalsCsv/);
 assert.doesNotMatch(html,/CS2|Cito API|parlays/i);
});