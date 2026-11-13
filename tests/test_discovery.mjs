import test from 'node:test';
import assert from 'node:assert/strict';
import {GECKO_COOLDOWN_MS,geckoDelay,parseJupiterRecent,parseDexProfiles,combineCandidates} from '../cloud/discovery.mjs';
const TOKEN='9QtxNyxsS4aM6kNecXfNoRQd36hvnEk4vjzzGoAppump';
test('Gecko rate limiting backs off instead of retrying each minute',()=>{
 assert.equal(GECKO_COOLDOWN_MS,180000);
 assert.equal(geckoDelay(429,1),300000);
 assert.equal(geckoDelay(429,2),600000);
 assert.ok(geckoDelay(429,8)<=3600000);
 assert.equal(geckoDelay(500,1),180000);
 assert.equal(geckoDelay(429,1,900000),900000);
});
test('Fallback candidate parsing rejects non-Solana and system mints',()=>{
 const j=parseJupiterRecent([{id:TOKEN,name:'Jensen',symbol:'JEN',liquidity:3000},{id:'So11111111111111111111111111111111111111112',name:'SOL'}]);
 assert.equal(j.length,1);assert.equal(j[0].mint,TOKEN);
 const d=parseDexProfiles([{chainId:'solana',tokenAddress:TOKEN},{chainId:'ethereum',tokenAddress:TOKEN},{chainId:'solana',tokenAddress:'bad'}]);
 assert.equal(d.length,1);assert.equal(d[0].source,'dex_profile_promotional');
});
test('Fallback dedupe keeps independently monitored signals first',()=>{
 const r=combineCandidates([[{mint:TOKEN,source:'sinal_ativo'}],[{mint:TOKEN,source:'dex_profile_promotional'}]],35);
 assert.equal(r.length,1);assert.equal(r[0].source,'sinal_ativo');
});
