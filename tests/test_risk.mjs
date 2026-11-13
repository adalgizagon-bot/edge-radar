import test from 'node:test';import assert from 'node:assert/strict';
import {assessRisk,riskRow} from '../cloud/risk.mjs';
const mint='9QtxNyxsS4aM6kNecXfNoRQd36hvnEk4vjzzGoAppump';
const pair=(price=0.0001,liq=25000)=>({priceUsd:price,liquidity:{usd:liq}});
const t={id:mint,isVerified:true,organicScore:88,liquidity:30000,audit:{mintAuthorityDisabled:true,freezeAuthorityDisabled:true,topHoldersPercentage:12},stats5m:{buyVolume:10000,sellVolume:5000,numBuys:80,numSells:30}};
test('Low liquidity blocks even at activity 100',()=>{const r=assessRisk({mint,pair:pair(0.001,81),token:t});assert.equal(r.level,'blocked');assert.equal(r.entryAllowed,false)});
test('JensenHao-like activity: many small buys versus large sell value',()=>{const r=assessRisk({mint,pair:pair(),token:{...t,stats5m:{buyVolume:2500,sellVolume:6000,numBuys:150,numSells:30}}});assert.equal(r.level,'blocked');assert.ok(r.alerts.some(x=>x.includes('compras pequenas')))});
test('Fast price/liquidity collapse blocks',()=>{const r=assessRisk({mint,pair:pair(0.001,6500),previous:{pool_price:.01,pool_liquidity:20000},token:t});assert.equal(r.level,'blocked');assert.ok(r.alerts.length>=2)});
test('Missing audit fails closed',()=>{const r=assessRisk({mint,pair:pair(),token:null});assert.equal(r.level,'unverified');assert.equal(r.entryAllowed,false)});
test('Good market still requires external exit quote verification',()=>{const r=assessRisk({mint,pair:pair(),token:t});assert.equal(r.level,'watch');assert.equal(r.exitQuoteVerified,false);assert.equal(r.entryAllowed,false);assert.equal(riskRow(r).entry_allowed,0)});

test('Missing price or liquidity is unverified, not false proof of a small pool',()=>{
 const r=assessRisk({mint,pair:null,token:t});
 assert.equal(r.level,'unverified');assert.equal(r.entryAllowed,false);
 assert.ok(r.reasons.some(x=>x.includes('sem cotacao')));
});
