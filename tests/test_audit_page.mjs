import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {auditHtml} from '../cloud/audit-page.mjs';

test('Public audit dashboard includes grounded loss and data quality alerts',()=>{
 assert.match(auditHtml,/Principais alertas do desempenho/);
 assert.match(auditHtml,/Sem cotação|sem cotação de saída confirmada/i);
 assert.match(auditHtml,/Cobertura histórica limitada/);
 assert.match(auditHtml,/sem fechamentos nesta janela/);
 assert.match(auditHtml,/não há evidência para ajustar seus parâmetros/i);
});
test('Inline analysis script parses safely, no API key or live trading call',()=>{
 const script=auditHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script);
 assert.doesNotThrow(()=>new vm.Script(script,{filename:'audit-page-inline.js'}));
 assert.ok(script.includes("fetch('/api/audit?limit=1000'"));
 assert.ok(!script.includes('OPENAI_API_KEY'));
 assert.ok(!script.includes('sendTransaction'));
 assert.ok(!script.includes('window.ethereum'));
});
