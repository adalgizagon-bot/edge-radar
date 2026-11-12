import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteRequest,parseExitQuote,SOL_MINT} from '../cloud/exit-quote.mjs';
const mint='9QtxNyxsS4aM6kNecXfNoRQd36hvnEk4vjzzGoAppump';
test('Quote raw amount uses decimals and never creates a trade',()=>{
 const q=quoteRequest({id:mint,usdPrice:0.01,decimals:6},15);
 assert.equal(q.atomicAmount,'1500000000');
 assert.equal(q.stakeUsd,15);
 assert.ok(q.url.startsWith('https://api.jup.ag/swap/v2/order?'));
 assert.ok(q.url.includes('inputMint='+mint));
 assert.ok(q.url.includes('outputMint='+SOL_MINT));
 assert.ok(!q.url.includes('taker='));
});
test('invalid or dangerous quote inputs do not call API',()=>{
 assert.equal(quoteRequest({id:'bad',usdPrice:1,decimals:6},15),null);
 assert.equal(quoteRequest({id:mint,usdPrice:0,decimals:6},15),null);
 assert.equal(quoteRequest({id:mint,usdPrice:1,decimals:6},1000),null);
 assert.equal(quoteRequest({id:mint,usdPrice:1,decimals:-1},15),null);
});
test('Expected quote results are theoretical values, not guaranteed exits',()=>{
 const q=parseExitQuote({outAmount:'150000000',router:'metis'},100,15);
 assert.equal(q.status,'quoted');assert.equal(q.estimatedSol,0.15);assert.equal(q.estimatedUsd,15);
});
test('Low recovery and no route remain blocked for safety',()=>{
 const low=parseExitQuote({outAmount:'10000000',router:'metis'},100,15);
 assert.equal(low.status,'large_impact');assert.ok(low.recoveryPct<85);
 assert.equal(parseExitQuote({},100,15).status,'unavailable');
 assert.equal(parseExitQuote({outAmount:'12345'},null,15).status,'unknown');
});
