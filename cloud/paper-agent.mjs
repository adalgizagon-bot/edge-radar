/* Edge Radar — persistent A/B PAPER trading. No wallet, signing, or execution routes.
 * Prices are observed DEX quotes, not executable fills. Fail closed on missing data.
 */
import {SCALP,scalpCandidate,nextScalpTracking,scalpExit} from './scalp.mjs';
import {V2,scalpV2Candidate,scalpV2Exit} from './scalp-v2.mjs';
import {reasonGroup} from './audit.mjs';
export const PAPER={initial:1000,stake:20,fee:0.01,stressFee:0.025,maxPositions:3,stop:-0.07,
  baselineTake:0.12,aiTake:0.20,maxHoldMs:20*60_000,reentryMs:60*60_000,
  maxAiCallsPerDay:480};
const num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const mintOK=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export function paperEnabled(env){return env?.PAPER_EXPERIMENT_ENABLED==='true';}
export function agentEnabled(env){return paperEnabled(env)&&env?.PAPER_AI_ENABLED==='true'&&typeof env?.OPENAI_API_KEY==='string'&&env.OPENAI_API_KEY.length>15;}
const localDay=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const dayStart=ms=>{const d=localDay(ms);return Date.parse(d+'T00:00:00-03:00');};
const short=s=>String(s??'').slice(0,180);
export const aiDailyLimit=env=>{const x=Number(env?.PAPER_AI_DAILY_LIMIT);return Number.isInteger(x)&&x>=1?Math.min(PAPER.maxAiCallsPerDay,x):PAPER.maxAiCallsPerDay;};
/* Eligibility is NOT permission to trade real funds. Tier is a quality label for fictional observations.
 * A missing Jupiter quote is not proof of a viable exit; bad quotes DO block.
 */
export function assessPaperCandidate(c,at=Date.now()){
 const p=c?.pair,r=c?.risk,price=num(p?.priceUsd),liquidity=num(p?.liquidity?.usd);
 const volume=num(p?.volume?.m5),change=num(p?.priceChange?.m5);
 const buys=num(p?.txns?.m5?.buys),sells=num(p?.txns?.m5?.sells);
 const score=num(c?.score),quote=c?.quote||'not_checked';
 const rejected=reason=>({eligible:false,tier:'rejected',reason});
 if(!mintOK(c?.mint)||!(price>0))return rejected('sem_preco');
 if(!r||r.level==='blocked'||(Array.isArray(r.alerts)&&r.alerts.length>0)||
    (num(r.organic)!==null&&num(r.organic)<35)||(num(r.top)!==null&&num(r.top)>=40)||
    (num(r.dropP)!==null&&num(r.dropP)<=-20)||(num(r.dropL)!==null&&num(r.dropL)<=-30))return rejected('risco_critico');
 if(!(liquidity>=8000))return rejected('liquidez_insuficiente');
 if(!['priority','watch'].includes(c?.stage)||!(score>=60)||
    !(volume>=1500)||!(buys>=8)||!(sells>=1)||!(buys/sells>=1.2)||
    change===null||change<1||change>45)return rejected('atividade_insuficiente');
 const created=num(p?.pairCreatedAt);
 if(created!==null&&(created>at||at-created<3*60_000))return rejected('pool_recente');
 if(quote==='large_impact'||quote==='unavailable')return rejected('saida_ruim_comprovada');
 const audited=r.level==='watch'&&r.verified===true&&r.organic>=60&&
  r.top!==null&&r.top<25&&(r.ageMinutes===null||r.ageMinutes>=15)&&
  quote==='quoted';
 return {eligible:true,tier:audited?'audited':'exploratory',
  reason:audited?'auditado_para_estudo':'entrada_nao_validada'};
}
export function isPaperCandidate(c,at){return assessPaperCandidate(c,at).eligible;}
export function exitRule(strategy,position,price,at){
 if(!position||!(price>0))return null;
 const entry=num(position.entry_price),opened=num(position.opened_at);
 if(!(entry>0)||!(opened>0))return null;
 const ret=price/entry-1;
 if(ret<=PAPER.stop)return 'stop de protecao (-7%)';
 if(ret>=(strategy==='baseline'?PAPER.baselineTake:PAPER.aiTake))return 'alvo automatico';
 if(at-opened>=PAPER.maxHoldMs)return 'limite de 20 minutos';
 return null;
}
function markPrice(prices,mint){const p=prices?.get(mint);return num(p?.priceUsd)>0?num(p.priceUsd):null;}
async function account(db,strategy,at){
 await db.prepare('INSERT OR IGNORE INTO paper_accounts(strategy,initial_usd,cash_usd,updated_at) VALUES(?,?,?,?)')
  .bind(strategy,PAPER.initial,PAPER.initial,at).run();
 return db.prepare('SELECT * FROM paper_accounts WHERE strategy=?').bind(strategy).first();
}
async function positions(db,strategy){const x=await db.prepare('SELECT * FROM paper_positions WHERE strategy=? ORDER BY opened_at ASC').bind(strategy).all();return x.results||[];}
async function historyHasBuy(db,strategy,mint,at){
 const x=await db.prepare("SELECT id FROM paper_trades WHERE strategy=? AND mint=? AND action='buy' AND created_at>? LIMIT 1")
 .bind(strategy,mint,at-PAPER.reentryMs).first();return !!x;
}
async function recordDecision(db,strategy,mint,decision,reason,at,source){
 await db.prepare('INSERT OR IGNORE INTO paper_decisions(id,strategy,mint,decision,reason,source,created_at) VALUES(?,?,?,?,?,?,?)')
 .bind(strategy+':'+mint+':'+at+':'+decision,strategy,mint,decision,short(reason),source,at).run();
}
async function buy(db,accountRow,strategy,c,at,reason){
 if(!(accountRow?.cash_usd>=PAPER.stake))return false;
 const price=markPrice(new Map([[c.mint,c.pair]]),c.mint);
 if(!price)return false;
 const qty=PAPER.stake/(price*(1+PAPER.fee)),fee=PAPER.stake-qty*price;
 const id=strategy+':buy:'+c.mint+':'+at;
 const requests=[
  db.prepare('INSERT INTO paper_positions(strategy,mint,symbol,quantity,invested_usd,entry_price,opened_at,updated_at,last_price,last_quote_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(strategy,c.mint,String(c.symbol||'').slice(0,25),qty,PAPER.stake,price,at,at,price,at),
  db.prepare('UPDATE paper_accounts SET cash_usd=cash_usd-?,updated_at=? WHERE strategy=? AND cash_usd>=?')
   .bind(PAPER.stake,at,strategy,PAPER.stake),
  db.prepare('INSERT INTO paper_trades(id,strategy,mint,symbol,action,quantity,price_usd,fee_usd,cash_usd,pnl_usd,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,strategy,c.mint,String(c.symbol||'').slice(0,25),'buy',qty,price,fee,-PAPER.stake,null,short(reason),at),
  db.prepare('INSERT INTO paper_entry_evidence(buy_id,strategy,mint,created_at,tier,risk_level,quote_status,score,liquidity) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind(id,strategy,c.mint,at,c.tier,c.risk?.level||'unverified',c.quote||'not_checked',c.score||0,num(c.pair?.liquidity?.usd)),
  db.prepare('INSERT INTO paper_entry_features(buy_id,strategy,mint,opened_at,score,liquidity,volume5m,change5m,buys5m,sells5m,age_minutes,organic,top_holders,quote_status,tier) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,strategy,c.mint,at,num(c.score),num(c.pair?.liquidity?.usd),
    num(c.pair?.volume?.m5),num(c.pair?.priceChange?.m5),num(c.pair?.txns?.m5?.buys),
    num(c.pair?.txns?.m5?.sells),num(c.pair?.pairCreatedAt)!==null?Math.max(0,(at-c.pair.pairCreatedAt)/60000):null,
    num(c.risk?.organic),num(c.risk?.top),c.quote||'not_checked',c.tier||'exploratory'),
  db.prepare('INSERT OR IGNORE INTO paper_quote_samples(strategy,mint,opened_at,observed_at,price_usd) VALUES(?,?,?,?,?)')
   .bind(strategy,c.mint,at,at,price)
 ];
 if(strategy==='scalp'||strategy==='scalp_v2')requests.push(db.prepare('INSERT INTO paper_scalp_tracking(strategy,mint,peak_price,last_price,weak_ticks,sample_at) VALUES(?,?,?,?,0,?)')
  .bind(strategy,c.mint,price,price,at));
 await db.batch(requests);
 accountRow.cash_usd-=PAPER.stake;
 return true;
}
async function sell(db,accountRow,strategy,p,price,at,reason){
 if(!(price>0))return false;
 const gross=p.quantity*price,fee=gross*PAPER.fee,payout=gross-fee,pnl=payout-p.invested_usd;
 const requests=[
  db.prepare('DELETE FROM paper_positions WHERE strategy=? AND mint=?').bind(strategy,p.mint),
  db.prepare('UPDATE paper_accounts SET cash_usd=cash_usd+?,updated_at=? WHERE strategy=?').bind(payout,at,strategy),
  db.prepare('INSERT INTO paper_trades(id,strategy,mint,symbol,action,quantity,price_usd,fee_usd,cash_usd,pnl_usd,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(strategy+':sell:'+p.mint+':'+at,strategy,p.mint,p.symbol,'sell',p.quantity,price,fee,payout,pnl,short(reason),at),
  db.prepare('INSERT INTO paper_exit_observations(sell_id,strategy,mint,entry_at,closed_at,elapsed_ms,previous_quote_lag_ms,price_return_pct,stop_overshoot_pct,reason_group) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(strategy+':sell:'+p.mint+':'+at,strategy,p.mint,p.opened_at,at,at-p.opened_at,
     num(p.last_quote_at)!==null&&at>=p.last_quote_at?at-p.last_quote_at:null,
     100*(price/p.entry_price-1),
     reasonGroup(reason)==='stop'?Math.max(0,100*((strategy==='scalp'?SCALP.stop:strategy==='scalp_v2'?V2.stop:PAPER.stop)-(price/p.entry_price-1))):null,
     reasonGroup(reason))
 ];
 if(strategy==='scalp'||strategy==='scalp_v2')requests.push(db.prepare('DELETE FROM paper_scalp_tracking WHERE strategy=? AND mint=?').bind(strategy,p.mint));
 await db.batch(requests);
 accountRow.cash_usd+=payout;return true;
}
function safeModelChoices(answer,candidates,open){
 const allowed=new Set([...candidates.map(x=>x.mint),...open.map(x=>x.mint)]);
 const parsed=Array.isArray(answer?.decisions)?answer.decisions:[];
 const result=new Map();
 for(const x of parsed.slice(0,10)){
  if(!mintOK(x?.mint)||!allowed.has(x.mint)||!['buy','hold','sell'].includes(x.action)||result.has(x.mint))continue;
  result.set(x.mint,{action:x.action,reason:short(x.reason)});
 }
 return result;
}
export async function askAgent(env,at,candidates,open,cash,fetcher=fetch){
 if(!agentEnabled(env)||!(candidates.length||open.length))return {choices:new Map(),status:'disabled'};
 const db=env.DB,day=localDay(at);
 await db.prepare('INSERT OR IGNORE INTO paper_ai_usage(day,calls,input_tokens,output_tokens,last_status,updated_at) VALUES(?,0,0,0,?,?)')
  .bind(day,'ready',at).run();
 const quota=await db.prepare('UPDATE paper_ai_usage SET calls=calls+1,updated_at=? WHERE day=? AND calls<?')
  .bind(at,day,aiDailyLimit(env)).run();
 if(quota?.meta?.changes===0)return {choices:new Map(),status:'daily_limit'};
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),11000);
 try{
  const schema={type:'object',additionalProperties:false,properties:{decisions:{type:'array',items:{
    type:'object',additionalProperties:false,properties:{
      mint:{type:'string'},action:{type:'string',enum:['buy','hold','sell']},reason:{type:'string'}
    },required:['mint','action','reason']}}},required:['decisions']};
  const payload={capital_usd:cash,fee_each_side_pct:1,stop_loss_pct:-7,max_hold_minutes:20,
   candidates:candidates.map(c=>({mint:c.mint,symbol:c.symbol,score:c.score,price_usd:num(c.pair.priceUsd),
    liquidity_usd:num(c.pair.liquidity?.usd),volume5m_usd:num(c.pair.volume?.m5),change5m_pct:num(c.pair.priceChange?.m5),
    risk_level:c.risk.level,organic:c.risk.organic,top_holders_pct:c.risk.top,
    quote_status:c.quote})),
   open_positions:open.map(p=>({mint:p.mint,symbol:p.symbol,entry_price:p.entry_price,
    current_price:p.current_price,return_pct:p.current_price?100*(p.current_price/p.entry_price-1):null,
    held_minutes:(at-p.opened_at)/60000}))};
  const response=await fetcher('https://api.openai.com/v1/responses',{
   method:'POST',signal:controller.signal,headers:{'content-type':'application/json',authorization:'Bearer '+env.OPENAI_API_KEY},
   body:JSON.stringify({model:String(env.PAPER_AI_MODEL||'gpt-5-mini'),store:false,
     max_output_tokens:420,
     input:[{role:'system',content:'You are a conservative paper-trading research assistant for highly risky Solana meme tokens. You never execute transactions. Return one decision per presented token, buy/hold/sell, with short Portuguese reasons. A candidate may be bought, but buying is optional; never buy from missing information. Positions may be sold or held. Decisions are simulated; optimize risk-adjusted net returns, not raw win rate. Do not claim certainty.'},
      {role:'user',content:JSON.stringify(payload)}],
     text:{format:{type:'json_schema',name:'paper_decisions',strict:true,schema}}})
  });
  if(!response.ok)throw Error('API HTTP '+response.status);
  const data=await response.json();
  const message=data.output_text||(data.output||[]).flatMap(x=>(x.content||[]).filter(y=>y.type==='output_text').map(y=>y.text)).join('');
  const choices=safeModelChoices(JSON.parse(message||'{}'),candidates,open);
  await db.prepare('UPDATE paper_ai_usage SET input_tokens=input_tokens+?,output_tokens=output_tokens+?,last_status=?,updated_at=? WHERE day=?')
   .bind(Math.max(0,Number(data.usage?.input_tokens)||0),Math.max(0,Number(data.usage?.output_tokens)||0),'ok',at,day).run();
  return {choices,status:'ok'};
 }catch(e){
  await db.prepare('UPDATE paper_ai_usage SET last_status=?,updated_at=? WHERE day=?')
   .bind(short('error: '+String(e?.message||e)),at,day).run();
  return {choices:new Map(),status:'error'};
 }finally{clearTimeout(timeout);}
}
export async function runPaperCycle(env,at,{prices,candidates,riskAtSignal,quoteThisCycle,fetcher=fetch}){
 if(!paperEnabled(env))return {enabled:false};
 const db=env.DB,bucket=Math.floor(at/60000);
 const gate=await db.prepare('INSERT OR IGNORE INTO paper_cycle_runs(minute_at) VALUES(?)').bind(bucket).run();
 if(gate?.meta?.changes===0)return {enabled:true,skipped:'already_processed'};
 const accounts={},open={};
 for(const name of ['baseline','scalp','scalp_v2','ai']){accounts[name]=await account(db,name,at);open[name]=await positions(db,name);}
 await db.prepare("INSERT OR IGNORE INTO paper_strategy_inception(strategy,started_at) VALUES('scalp_v2',?)").bind(at).run();
 await db.prepare('INSERT OR IGNORE INTO paper_comparison_start(id,started_at) VALUES(1,?)').bind(at).run();
 const analyzed=(candidates||[]).map(c=>{const pair=prices.get(c.mint);
  const token={mint:c.mint,name:c.name,symbol:c.symbol,pair,risk:riskAtSignal.get(c.mint),
    stage:pair?c.stage:null,score:c.score||0,quote:quoteThisCycle.get(c.mint)||'not_checked'};
  return {...token,assessment:assessPaperCandidate(token,at)};
 });
 const counters={sem_preco:0,risco_critico:0,liquidez_insuficiente:0,atividade_insuficiente:0,pool_recente:0,saida_ruim_comprovada:0};
 for(const c of analyzed)if(!c.assessment.eligible)counters[c.assessment.reason]++;
 const eligibleAll=analyzed.filter(c=>c.assessment.eligible)
  .map(c=>({...c,tier:c.assessment.tier}))
  .sort((a,b)=>b.score-a.score);
 const eligible=eligibleAll.slice(0,3);
 const scalpExam=eligibleAll.map(c=>({...c,scalpAssessment:scalpCandidate(c,at)}));
 const scalpAll=scalpExam.filter(c=>c.scalpAssessment.eligible);
 const scalpEligible=scalpAll.slice(0,3);
 const v2Exam=eligibleAll.map(c=>({...c,v2Assessment:scalpV2Candidate(c,at)}));
 const v2All=v2Exam.filter(c=>c.v2Assessment.eligible);
 const v2Eligible=v2All.slice(0,3);
 const v2Reject={score_liquidez_volume:0,pressao_compradora:0,
  movimento_excessivo_ou_fraco:0,idade_do_pool_indisponivel_ou_nova:0,
  alerta_de_auditoria:0,perda_de_forca:0};
 for(const c of v2Exam)if(!c.v2Assessment.eligible&&Object.hasOwn(v2Reject,c.v2Assessment.reason))
  v2Reject[c.v2Assessment.reason]++;
 await db.prepare('INSERT INTO paper_v2_diagnostics(id,checked_at,base_candidates,eligible,score_liquidez_volume,pressao_compradora,movimento_excessivo_ou_fraco,idade_do_pool_indisponivel_ou_nova,alerta_de_auditoria,perda_de_forca) VALUES(1,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,base_candidates=excluded.base_candidates,eligible=excluded.eligible,score_liquidez_volume=excluded.score_liquidez_volume,pressao_compradora=excluded.pressao_compradora,movimento_excessivo_ou_fraco=excluded.movimento_excessivo_ou_fraco,idade_do_pool_indisponivel_ou_nova=excluded.idade_do_pool_indisponivel_ou_nova,alerta_de_auditoria=excluded.alerta_de_auditoria,perda_de_forca=excluded.perda_de_forca')
  .bind(at,eligibleAll.length,v2All.length,v2Reject.score_liquidez_volume,v2Reject.pressao_compradora,
   v2Reject.movimento_excessivo_ou_fraco,v2Reject.idade_do_pool_indisponivel_ou_nova,
   v2Reject.alerta_de_auditoria,v2Reject.perda_de_forca).run();
 const scalpReject={scalp_volume_ou_score:0,scalp_pressao_compradora:0,scalp_preco_esticado_ou_fraco:0,
   scalp_pool_novo:0,scalp_perda_de_forca:0};
 for(const c of scalpExam)if(!c.scalpAssessment.eligible)scalpReject[c.scalpAssessment.reason]=(scalpReject[c.scalpAssessment.reason]||0)+1;
 await db.prepare('INSERT INTO paper_scalp_diagnostics(id,checked_at,candidates,eligible,volume_score,pressure,stretched,too_new,weakening) VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,candidates=excluded.candidates,eligible=excluded.eligible,volume_score=excluded.volume_score,pressure=excluded.pressure,stretched=excluded.stretched,too_new=excluded.too_new,weakening=excluded.weakening')
  .bind(at,eligibleAll.length,scalpAll.length,scalpReject.scalp_volume_ou_score,
   scalpReject.scalp_pressao_compradora,scalpReject.scalp_preco_esticado_ou_fraco,
   scalpReject.scalp_pool_novo,scalpReject.scalp_perda_de_forca).run();
 await db.prepare('INSERT INTO paper_diagnostics(id,checked_at,candidates,eligible,exploratory,audited,without_price,critical,low_liquidity,weak_activity,too_new,bad_exit) VALUES(1,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,candidates=excluded.candidates,eligible=excluded.eligible,exploratory=excluded.exploratory,audited=excluded.audited,without_price=excluded.without_price,critical=excluded.critical,low_liquidity=excluded.low_liquidity,weak_activity=excluded.weak_activity,too_new=excluded.too_new,bad_exit=excluded.bad_exit')
  .bind(at,analyzed.length,eligibleAll.length,eligibleAll.filter(x=>x.tier==='exploratory').length,
   eligibleAll.filter(x=>x.tier==='audited').length,counters.sem_preco,counters.risco_critico,
   counters.liquidez_insuficiente,counters.atividade_insuficiente,counters.pool_recente,counters.saida_ruim_comprovada).run();
 const aiOpen=open.ai.map(p=>({...p,current_price:markPrice(prices,p.mint)}));
 const ai=await askAgent(env,at,eligible,aiOpen,accounts.ai.cash_usd,fetcher);
 const count={baseline:0,scalp:0,scalp_v2:0,ai:0};let closed=0;
 for(const strategy of ['baseline','scalp','scalp_v2','ai']){
  const a=accounts[strategy],positionsNow=open[strategy];
  const closedMints=new Set();
  for(const p of positionsNow){
   const price=markPrice(prices,p.mint);if(!price)continue;
   await db.prepare('UPDATE paper_positions SET last_price=?,last_quote_at=?,updated_at=? WHERE strategy=? AND mint=?')
    .bind(price,at,at,strategy,p.mint).run();
   await db.prepare('INSERT OR IGNORE INTO paper_quote_samples(strategy,mint,opened_at,observed_at,price_usd) VALUES(?,?,?,?,?)')
    .bind(strategy,p.mint,p.opened_at,at,price).run();
   let tracking=null;
   if(strategy==='scalp'||strategy==='scalp_v2'){
    const old=await db.prepare('SELECT * FROM paper_scalp_tracking WHERE strategy=? AND mint=?')
      .bind(strategy,p.mint).first();
    tracking=nextScalpTracking(old||{peak_price:p.entry_price,last_price:p.entry_price,
     weak_ticks:0,sample_at:p.opened_at},price,at);
    await db.prepare('INSERT INTO paper_scalp_tracking(strategy,mint,peak_price,last_price,weak_ticks,sample_at) VALUES(?,?,?,?,?,?) ON CONFLICT(strategy,mint) DO UPDATE SET peak_price=excluded.peak_price,last_price=excluded.last_price,weak_ticks=excluded.weak_ticks,sample_at=excluded.sample_at')
     .bind(strategy,p.mint,tracking.peak_price,tracking.last_price,tracking.weak_ticks,tracking.sample_at).run();
   }
   const safety=strategy==='scalp'?scalpExit(p,price,at,tracking):
    strategy==='scalp_v2'?scalpV2Exit(p,price,at,tracking):exitRule(strategy,p,price,at);
   const model=ai.choices.get(p.mint),opt=strategy==='ai'&&model?.action==='sell'&&at-p.opened_at>=120000;
   if(safety||opt){
    if(await sell(db,a,strategy,p,price,at,safety||'IA: '+model.reason)){closed++;closedMints.add(p.mint);}
    await recordDecision(db,strategy,p.mint,'sell',safety||'IA: '+model.reason,at,safety?'safety':strategy);
   }else if(strategy==='ai'&&model){await recordDecision(db,strategy,p.mint,'hold',model.reason,at,'model');}
  }
  const maxPositions=strategy==='scalp'?SCALP.maxPositions:
   strategy==='scalp_v2'?V2.maxPositions:PAPER.maxPositions;
  if(positionsNow.length-closedMints.size>=maxPositions||a.cash_usd<PAPER.stake)continue;
  const daily=await db.prepare("SELECT COALESCE(SUM(pnl_usd),0) AS pnl FROM paper_trades WHERE strategy=? AND action='sell' AND created_at>=?")
   .bind(strategy,dayStart(at)).first();
  if((num(daily?.pnl)||0)<=(strategy==='scalp'?-SCALP.dailyLossLimitUsd:
   strategy==='scalp_v2'?-V2.dailyLossLimitUsd:-50))continue;
  for(const c of strategy==='scalp'?scalpEligible:strategy==='scalp_v2'?v2Eligible:eligible){
   if(count[strategy]||positionsNow.some(p=>p.mint===c.mint)||await historyHasBuy(db,strategy,c.mint,at))continue;
   const model=ai.choices.get(c.mint),choice=strategy==='ai'?model?.action||'hold':'buy';
   const category=c.tier==='exploratory'
    ?'EXPLORATORIO: entrada nao validada, execucao e saida nao comprovadas'
    :'AUDITADO PARA ESTUDO: sem garantia de execucao';
   const reason=strategy==='scalp'?category+'; Edge Scalp: alvo 5%, stop 3%, max 6 min':
    strategy==='scalp_v2'?category+'; V2 experimental: alvo 7%, stop 3%, max 8 min':
    strategy==='baseline'?category+'; filtro de atividade e risco':category+'; '+(model?.reason||('IA '+ai.status+'; sem autorizacao de entrada'));
   await recordDecision(db,strategy,c.mint,choice,reason,at,strategy==='ai'?'model':'rules');
   if(choice==='buy'){if(await buy(db,a,strategy,c,at,reason))count[strategy]++;}
  }
 }
 return {enabled:true,eligible:eligibleAll.length,scalpEligible:scalpAll.length,v2Eligible:v2All.length,buys:count,sells:closed,aiStatus:ai.status};
}
export async function paperSnapshot(env,at=Date.now()){
 if(!paperEnabled(env))return {enabled:false,aiConfigured:agentEnabled(env),aiCallLimit:aiDailyLimit(env),
  accounts:[],positions:[],trades:[],decisions:[],usage:null,note:'Teste ainda nao habilitado no servidor'};
 const db=env.DB;
 const cohort=await db.prepare('SELECT started_at FROM paper_comparison_start WHERE id=1').first();
 const since=num(cohort?.started_at)||at;
 // A second cost scenario lets the user see if small-target scalp gains survive heavier fees.
 const stressMultiplier=(1+PAPER.fee)*(1-PAPER.stressFee)/((1+PAPER.stressFee)*(1-PAPER.fee));
 const comparisonSql="SELECT strategy,COUNT(*) AS sells,"+
  "SUM(CASE WHEN pnl_usd>0 THEN 1 ELSE 0 END) AS wins,"+
  "COALESCE(SUM(pnl_usd),0) AS realized_pnl,"+
  "COALESCE(SUM((pnl_usd+?)*?-?),0) AS stress_pnl,"+
  "COALESCE(SUM(CASE WHEN pnl_usd>0 THEN pnl_usd ELSE 0 END),0) AS total_gains,"+
  "COALESCE(SUM(CASE WHEN pnl_usd<0 THEN ABS(pnl_usd) ELSE 0 END),0) AS total_losses,"+
  "MIN(pnl_usd) AS worst_trade,AVG(pnl_usd) AS avg_trade "+
  "FROM paper_trades WHERE action='sell' AND created_at>=? GROUP BY strategy";
 const drawdownSql="WITH balances AS ("+
  "SELECT strategy,created_at,id,1000.0+SUM(pnl_usd) OVER(PARTITION BY strategy ORDER BY created_at,id ROWS UNBOUNDED PRECEDING) AS balance "+
  "FROM paper_trades WHERE action='sell' AND created_at>=?), "+
  "peaks AS (SELECT strategy,balance,MAX(balance) OVER(PARTITION BY strategy ORDER BY created_at,id ROWS UNBOUNDED PRECEDING) AS peak FROM balances) "+
  "SELECT strategy,MAX((CASE WHEN peak>1000 THEN peak ELSE 1000 END)-balance) AS max_drawdown_usd FROM peaks GROUP BY strategy";
 const [ac,po,tr,de,us,pf,ev,diag,scalpDiag,drawdowns]=await Promise.all([
  db.prepare('SELECT * FROM paper_accounts ORDER BY strategy').all(),
  db.prepare('SELECT * FROM paper_positions ORDER BY opened_at DESC').all(),
  db.prepare('SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 100').all(),
  db.prepare('SELECT * FROM paper_decisions ORDER BY created_at DESC LIMIT 80').all(),
  db.prepare('SELECT * FROM paper_ai_usage WHERE day=?').bind(localDay(at)).first(),
  db.prepare(comparisonSql).bind(PAPER.stake,stressMultiplier,PAPER.stake,since).all(),
  db.prepare('SELECT * FROM paper_entry_evidence ORDER BY created_at DESC LIMIT 120').all(),
  db.prepare('SELECT * FROM paper_diagnostics WHERE id=1').first(),
  db.prepare('SELECT * FROM paper_scalp_diagnostics WHERE id=1').first(),
  db.prepare(drawdownSql).bind(since).all()
 ]);
 const rows=po.results||[],accounts=(ac.results||[]).map(a=>{
  const mine=rows.filter(p=>p.strategy===a.strategy);
  const freshLimit=a.strategy==='scalp'?100000:180000;
  const fresh=mine.every(p=>num(p.last_price)>0&&num(p.last_quote_at)>0&&at-p.last_quote_at<=freshLimit&&at>=p.last_quote_at);
  const openValue=fresh?mine.reduce((sum,p)=>sum+p.quantity*p.last_price*(1-PAPER.fee),0):null;
  const invested=mine.reduce((sum,p)=>sum+p.invested_usd,0);
  return {...a,open_value_usd:openValue,equity_usd:fresh?a.cash_usd+openValue:null,
   unrealized_pnl:fresh?openValue-invested:null,prices_fresh:fresh};
 });
 const byDrawdown=new Map((drawdowns.results||[]).map(x=>[x.strategy,x.max_drawdown_usd]));
 const performance=(pf.results||[]).map(x=>({...x,max_drawdown_usd:byDrawdown.get(x.strategy)??null}));
 return {enabled:true,aiConfigured:agentEnabled(env),aiCallLimit:aiDailyLimit(env),
  accounts,performance,positions:rows,trades:tr.results||[],decisions:de.results||[],
  evidence:ev.results||[],diagnostics:diag||null,scalpDiagnostics:scalpDiag||null,
  comparisonSince:since,fees:{baseEachSidePct:PAPER.fee*100,stressEachSidePct:PAPER.stressFee*100},
  profiles:{baseline:{targetPct:PAPER.baselineTake*100,stopPct:PAPER.stop*100,holdMinutes:PAPER.maxHoldMs/60000,
                      maxPositions:PAPER.maxPositions},
    scalp:{targetPct:SCALP.target*100,stopPct:SCALP.stop*100,holdMinutes:SCALP.maxHoldMs/60000,
           maxPositions:SCALP.maxPositions}},usage:us||null,
  checkedAt:at,note:'Retornos teoricos com preco observado ~1/min, sem garantia de compra ou venda. Dados de preco ausentes nao sao substituidos.'};
}
