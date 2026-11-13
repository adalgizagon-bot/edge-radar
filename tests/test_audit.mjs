import test from 'node:test';
import assert from 'node:assert/strict';
import {reasonGroup,stressPnL,normalizeAuditRows,summarizeClosed} from '../cloud/audit.mjs';
const at=Date.now();
const mockRow=(id,pnl,strategy='scalp')=>({
 id,created_at:at+Number(id)*60000,entry_at:at+Number(id)*60000-120000,
 strategy,mint:'11111111111111111111111111111111',symbol:'T',
 price_usd:1+pnl/20,entry_price:1,invested_usd:20,pnl_usd:pnl,
 reason:pnl>0?'scalp: alvo observado (+5%)':'scalp: stop observado (-3%)',
 tier:'exploratory',score:85,liquidity:31000,quote_status:'not_checked',
 volume5m:7000,change5m:6,buys5m:40,sells5m:12,organic:80,top_holders:12
});
test('Reason classifier groups all trading exits, including v2',()=>{
 assert.equal(reasonGroup('scalp: stop observado -3%'),'stop');
 assert.equal(reasonGroup('v2: alvo observado +7%'),'alvo');
 assert.equal(reasonGroup('scalp: tempo maximo de 6 min'),'tempo');
 assert.equal(reasonGroup('v2: sem impulso'),'sem_impulso');
 assert.equal(reasonGroup('v2: perda de forca'),'perda_forca');
 assert.equal(reasonGroup('v2: protecao apos pico'),'perda_forca');
});
test('Stress scenario is derived from original fill model without modifying actual history',()=>{
 const base=20/(1.01)*1.05*.99-20;
 const stressed=20/1.025*1.05*.975-20;
 assert.ok(Math.abs(stressPnL(base,20)-stressed)<1e-9);
 assert.equal(stressPnL(base,null),null);
});
test('Missing historical features are marked unknown rather than filled from new market data',()=>{
 const rows=normalizeAuditRows([{
  id:'a',strategy:'baseline',mint:'11111111111111111111111111111111',
  symbol:'Old',created_at:at,entry_at:at-60000,
  price_usd:.01,entry_price:.011,invested_usd:20,pnl_usd:-2,reason:'limite de 20 minutos'
 }],[]);
 assert.equal(rows[0].score,null);
 assert.equal(rows[0].volume5m,null);
 assert.equal(rows[0].tier,'sem_registro');
 assert.equal(rows[0].sampled_peak_return_pct,null);
 assert.equal(rows[0].duration_minutes,1);
});
test('Summaries calculate outcomes by reason, risk tier, score and liquidity independently',()=>{
 const raw=[mockRow(1,2,'baseline'),mockRow(2,-1,'baseline'),mockRow(3,-3,'scalp')];
 const rows=normalizeAuditRows(raw,[]);
 const summary=summarizeClosed(rows);
 const base=summary.find(x=>x.strategy==='baseline'),scalp=summary.find(x=>x.strategy==='scalp');
 assert.equal(base.closed,2);assert.equal(base.wins,1);
 assert.equal(base.realized_usd,1);
 assert.equal(base.win_rate_pct,50);
 assert.ok(base.by_reason.find(x=>x.category==='alvo').pnl_usd>0);
 assert.ok(base.by_score.find(x=>x.category==='80–89').count===2);
 assert.ok(scalp.by_tier.find(x=>x.category==='exploratory').count===1);
 assert.equal(scalp.max_drawdown_usd,3);
 assert.equal(base.confidence,'amostra_pequena');
});
test('Summary does not claim win-rate edge from a small number of trades',()=>{
 const rows=normalizeAuditRows([mockRow(1,3)],[]);
 assert.equal(summarizeClosed(rows)[0].confidence,'amostra_pequena');
 assert.equal(summarizeClosed([]).length,0);
});
test('Sampled extremes only use matching strategy, mint and historical opened_at',()=>{
 const raw=[mockRow(1,2,'scalp'),mockRow(2,-2,'scalp_v2')];
 const samples=[{strategy:'scalp',mint:raw[0].mint,opened_at:raw[0].entry_at,
  min_price:.90,max_price:1.08,sample_count:3}];
 const rows=normalizeAuditRows(raw,samples);
 assert.equal(rows[0].sample_count,3);
 assert.ok(rows[0].sampled_peak_return_pct>0);
 assert.equal(rows[1].sample_count,0);
 assert.equal(rows[1].sampled_trough_return_pct,null);
});
