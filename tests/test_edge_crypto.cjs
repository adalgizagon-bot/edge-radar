'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/edge-crypto.js'),'utf8');
const context={Date,Math,JSON,Number,String,Intl,Map,Set,RegExp,Array,Object,console,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{}};
context.globalThis=context;vm.createContext(context);vm.runInContext(source,context);
const C=context.EdgeCrypto;
const M='A'.repeat(32), N='B'.repeat(32), T='C'.repeat(32);
function pair(mint=M,fields={}){return {chainId:'solana',dexId:'pumpswap',baseToken:{address:mint,name:'ABC',symbol:'ABC'},priceUsd:0.001,liquidity:{usd:25000},volume:{m5:12000},txns:{m5:{buys:55,sells:20}},priceChange:{m5:16},pairCreatedAt:Date.now()-60000,...fields}}
function token(mint=M,fields={}){return {mint,firstSeen:Date.now()-60000,lastEvent:Date.now(),source:'pumpportal',type:'launch',symbol:'ABC',name:'ABC',pair:pair(mint),pairFetchedAt:Date.now(),...fields}}
test('WS event only counts creation/migration, not ordinary trade',()=>{
 const d=C.normalizeEvent({mint:M,txType:'create',symbol:'ABC'});
 assert.equal(d.type,'launch');assert.equal(C.normalizeEvent({mint:M,txType:'buy'}),null);
 assert.equal(C.normalizeEvent({mint:M,txType:'migrate'}).type,'migration');
 assert.equal(C.normalizeEvent({mint:'invalid',txType:'create'}),null);
});
test('only Pump.fun/PumpSwap Gecko pools may enter',()=>{
 const json={included:[{id:'dex_pumpswap',attributes:{name:'PumpSwap'}},{id:'solana_'+M,attributes:{address:M,name:'ABC',symbol:'ABC'}}],data:[{attributes:{name:'ABC/SOL',pool_created_at:new Date(Date.now()-60000).toISOString(),base_token_price_usd:'0.001',reserve_in_usd:'25000',price_change_percentage:{m5:'16'},volume_usd:{m5:'12000'},transactions:{m5:{buys:55,sells:20}}},relationships:{dex:{data:{id:'dex_pumpswap'}},base_token:{data:{id:'solana_'+M}}}}]};
 const rows=C.parseGecko(json,'trending_pool');assert.equal(rows.length,1);assert.equal(rows[0].mint,M);assert.equal(rows[0].pair.liquidity.usd,25000);
 json.included[0].attributes.name='Raydium';assert.equal(C.parseGecko(json,'trending_pool').length,0);
});
test('qualifying momentum is a preliminary candidate, not just listing',()=>{
 const scored=C.evaluate(token());assert.equal(scored.stage,'priority');assert(scored.score>=67);
 const low=C.evaluate(token(M,{pair:pair(M,{liquidity:{usd:250},volume:{m5:80}})}));assert.notEqual(low.stage,'priority');
 const stale=C.evaluate(token(M,{pairFetchedAt:Date.now()-100000}));assert.equal(stale.stage,'waiting');
 const noPair=C.evaluate({mint:M});assert.equal(noPair.stage,'waiting');
 const hugeRise=C.evaluate(token(M,{pair:pair(M,{priceChange:{m5:155}})}));assert.notEqual(hugeRise.stage,'priority');
 const sellers=C.evaluate(token(M,{pair:pair(M,{txns:{m5:{buys:7,sells:40}}})}));assert.notEqual(sellers.stage,'priority');
});
test('DEX enrichment picks correct mint and prefer pump pools',()=>{
 const other=pair(M,{dexId:'raydium',liquidity:{usd:100000}});const pump=pair(M,{dexId:'pumpswap',liquidity:{usd:10000}});
 const r=C.bestPair([other,pump,pair(N)],M);assert.equal(r.dexId,'pumpswap');
 assert.equal(C.bestPair([pair(N)],M),null);
});
test('opportunity list excludes launch with no price and includes real qualified candidate',()=>{
 C.addToken({...token(M),pair:null,pairFetchedAt:0});
 C.addToken(token(N));
 const current=C.visible();assert.equal(current.length,1);assert.equal(current[0].t.mint,N);
 assert.equal(C.metadata().priority,1);
 C._setView('new');const discovery=C.visible();assert.equal(discovery.length,2);
});
test('paper ledger uses own virtual money; never performs real trades',()=>{
 const start=C.resetPaper(1000);assert.equal(start,true);
 const b=C.buyPaper(N,100);assert.equal(b.ok,true);assert.equal(C._debug().paper.cash,900);
 const position=C._debug().paper.positions[0];assert(position.quantity>0);assert(position.quantity<100/0.001);
 const s=C.sellPaper(N);assert(s.ok);assert(C._debug().paper.cash<1000,'costs reduce P&L if price unchanged');
 assert.equal(C._debug().paper.positions.length,0);
});
test('only crypto files are published in the new static page',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 assert.match(html,/PUMP.FUN/);assert.match(html,/edge-crypto.js/);
 assert.doesNotMatch(html,/CS2|CS:GO|CS GO|Cito API|baralho|parlays/i);
 assert.doesNotMatch(source,/signTransaction|sendTransaction|privateKey/i);
});