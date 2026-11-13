import test from 'node:test';
import assert from 'node:assert/strict';
import {PAPER,paperEnabled,agentEnabled,isPaperCandidate,exitRule,askAgent} from '../cloud/paper-agent.mjs';
const mint='11111111111111111111111111111111';
const qualified=()=>({mint,stage:'priority',score:98,quote:'quoted',
 pair:{priceUsd:'0.01',liquidity:{usd:25000},volume:{m5:19000},priceChange:{m5:9}},
 risk:{level:'watch',verified:true,organic:85,top:12,ageMinutes:40,alerts:[]}
});
test('Live trades remain disabled unless PAPER_EXPERIMENT_ENABLED is explicitly true',()=>{
 assert.equal(paperEnabled({}),false);
 assert.equal(paperEnabled({PAPER_EXPERIMENT_ENABLED:'TRUE'}),false);
 assert.equal(paperEnabled({PAPER_EXPERIMENT_ENABLED:'true'}),true);
 assert.equal(agentEnabled({PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'true'}),false);
});
test('Candidate requires recent same-cycle sell quote and complete safety screen',()=>{
 assert.equal(isPaperCandidate(qualified()),true);
 for(const change of [
  {quote:'unavailable'}, {quote:null}, {risk:{...qualified().risk,level:'blocked'}},
  {risk:{...qualified().risk,organic:null}},
  {risk:{...qualified().risk,verified:false}},
  {risk:{...qualified().risk,top:50}},
  {risk:{...qualified().risk,ageMinutes:5}},
  {pair:{...qualified().pair,liquidity:{usd:9000}}}
 ])assert.equal(isPaperCandidate({...qualified(),...change}),false,JSON.stringify(change));
});
test('Emergency stop and max duration take precedence, no invented exits without quote',()=>{
 const p={entry_price:1,opened_at:1000};
 assert.equal(exitRule('baseline',p,null,1000+900000),null);
 assert.match(exitRule('baseline',p,0.92,1000+60000),/stop/);
 assert.match(exitRule('baseline',p,1.12,1000+60000),/alvo/);
 assert.equal(exitRule('baseline',p,1.1,1000+60000),null);
 assert.match(exitRule('ai',p,1.1,1000+20*60000),/limite/);
 assert.equal(PAPER.maxAiCallsPerDay,100);
});
test('AI request uses structured output, only sends market data, and stores usage',async()=>{
 let calls=0,updates=[];
 const db={prepare:sql=>({bind:(...args)=>({
  run:async()=>{updates.push({sql,args});return {meta:{changes:1}};}
 })})};
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'true',
  OPENAI_API_KEY:'test-not-a-real-api-key'};
 const mock=async(url,options)=>{
  calls++;
  assert.equal(url,'https://api.openai.com/v1/responses');
  assert.equal(options.method,'POST');
  const req=JSON.parse(options.body);
  assert.equal(req.store,false);
  assert.equal(req.text.format.type,'json_schema');
  assert.deepEqual(req.input[1].content.includes('test-not-a-real-api-key'),false);
  return {ok:true,json:async()=>({
   output:[{content:[{type:'output_text',text:JSON.stringify({decisions:[
    {mint,action:'buy',reason:'Sinais coerentes'},
    {mint:'22222222222222222222222222222222',action:'buy',reason:'Não veio nos dados'}
   ]})}]}],usage:{input_tokens:200,output_tokens:50}
  })};
 };
 const result=await askAgent(env,Date.now(),[qualified()],[],1000,mock);
 assert.equal(calls,1);
 assert.equal(result.status,'ok');
 assert.equal(result.choices.size,1);
 assert.equal(result.choices.get(mint).action,'buy');
 assert.ok(updates.some(x=>x.sql.includes('input_tokens=input_tokens+?')&&x.args[0]===200));
});
test('Agent fails closed on API failure',async()=>{
 const db={prepare:sql=>({bind:(...args)=>({run:async()=>({meta:{changes:1}})})})};
 const env={DB:db,PAPER_EXPERIMENT_ENABLED:'true',PAPER_AI_ENABLED:'true',
  OPENAI_API_KEY:'test-not-a-real-api-key'};
 const out=await askAgent(env,Date.now(),[qualified()],[],1000,async()=>({ok:false,status:429}));
 assert.equal(out.status,'error');assert.equal(out.choices.size,0);
});