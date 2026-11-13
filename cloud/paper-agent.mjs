/* Edge Radar — persistent A/B PAPER trading. No wallet, signing, or execution routes.
 * Prices are observed DEX quotes, not executable fills. Fail closed on missing data.
 */
export const PAPER={initial:1000,stake:20,fee:0.01,maxPositions:3,stop:-0.07,
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
 await db.batch([
  db.prepare('INSERT INTO paper_positions(strategy,mint,symbol,quantity,invested_usd,entry_price,opened_at,updated_at,last_price,last_quote_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(strategy,c.mint,String(c.symbol||'').slice(0,25),qty,PAPER.stake,price,at,at,price,at),
  db.prepare('UPDATE paper_accounts SET cash_usd=cash_usd-?,updated_at=? WHERE strategy=? AND cash_usd>=?')
   .bind(PAPER.stake,at,strategy,PAPER.stake),
  db.prepare('INSERT INTO paper_trades(id,strategy,mint,symbol,action,quantity,price_usd,fee_usd,cash_usd,pnl_usd,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,strategy,c.mint,String(c.symbol||'').slice(0,25),'buy',qty,price,fee,-PAPER.stake,null,short(reason),at),
  db.prepare('INSERT INTO paper_entry_evidence(buy_id,strategy,mint,created_at,tier,risk_level,quote_status,score,liquidity) VALUES(?,?,?,?,?,?,?,?,?)')
   .bind(id,strategy,c.mint,at,c.tier,c.risk?.level||'unverified',c.quote||'not_checked',c.score||0,num(c.pair?.liquidity?.usd))
 ]);
 accountRow.cash_usd-=PAPER.stake;
 return true;
}
async function sell(db,accountRow,strategy,p,price,at,reason){
 if(!(price>0))return false;
 const gross=p.quantity*price,fee=gross*PAPER.fee,payout=gross-fee,pnl=payout-p.invested_usd;
 await db.batch([
  db.prepare('DELETE FROM paper_positions WHERE strategy=? AND mint=?').bind(strategy,p.mint),
  db.prepare('UPDATE paper_accounts SET cash_usd=cash_usd+?,updated_at=? WHERE strategy=?').bind(payout,at,strategy),
  db.prepare('INSERT INTO paper_trades(id,strategy,mint,symbol,action,quantity,price_usd,fee_usd,cash_usd,pnl_usd,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(strategy+':sell:'+p.mint+':'+at,strategy,p.mint,p.symbol,'sell',p.quantity,price,fee,payout,pnl,short(reason),at)
 ]);
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
 for(const name of ['baseline','ai']){accounts[name]=await account(db,name,at);open[name]=await positions(db,name);}
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
 await db.prepare('INSERT INTO paper_diagnostics(id,checked_at,candidates,eligible,exploratory,audited,without_price,critical,low_liquidity,weak_activity,too_new,bad_exit) VALUES(1,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,candidates=excluded.candidates,eligible=excluded.eligible,exploratory=excluded.exploratory,audited=excluded.audited,without_price=excluded.without_price,critical=excluded.critical,low_liquidity=excluded.low_liquidity,weak_activity=excluded.weak_activity,too_new=excluded.too_new,bad_exit=excluded.bad_exit')
  .bind(at,analyzed.length,eligibleAll.length,eligibleAll.filter(x=>x.tier==='exploratory').length,
   eligibleAll.filter(x=>x.tier==='audited').length,counters.sem_preco,counters.risco_critico,
   counters.liquidez_insuficiente,counters.atividade_insuficiente,counters.pool_recente,counters.saida_ruim_comprovada).run();
 const aiOpen=open.ai.map(p=>({...p,current_price:markPrice(prices,p.mint)}));
 const ai=await askAgent(env,at,eligible,aiOpen,accounts.ai.cash_usd,fetcher);
 const count={baseline:0,ai:0};let closed=0;
 for(const strategy of ['baseline','ai']){
  const a=accounts[strategy],positionsNow=open[strategy];
  for(const p of positionsNow){
   const price=markPrice(prices,p.mint);if(!price)continue;
   await db.prepare('UPDATE paper_positions SET last_price=?,last_quote_at=?,updated_at=? WHERE strategy=? AND mint=?')
    .bind(price,at,at,strategy,p.mint).run();
   const safety=exitRule(strategy,p,price,at);
   const model=ai.choices.get(p.mint),opt=strategy==='ai'&&model?.action==='sell'&&at-p.opened_at>=120000;
   if(safety||opt){
    if(await sell(db,a,strategy,p,price,at,safety||'IA: '+model.reason)){closed++;}
    await recordDecision(db,strategy,p.mint,'sell',safety||'IA: '+model.reason,at,safety?'safety':strategy);
   }else if(strategy==='ai'&&model){await recordDecision(db,strategy,p.mint,'hold',model.reason,at,'model');}
  }
  const alreadyOpen=positionsNow.filter(p=>!exitRule(strategy,p,markPrice(prices,p.mint),at)).length;
  if(alreadyOpen>=PAPER.maxPositions||a.cash_usd<PAPER.stake)continue;
  const daily=await db.prepare("SELECT COALESCE(SUM(pnl_usd),0) AS pnl FROM paper_trades WHERE strategy=? AND action='sell' AND created_at>=?")
   .bind(strategy,dayStart(at)).first();
  if((num(daily?.pnl)||0)<=-50)continue;
  for(const c of eligible){
   if(count[strategy]||open[strategy].some(p=>p.mint===c.mint)||await historyHasBuy(db,strategy,c.mint,at))continue;
   const model=ai.choices.get(c.mint),choice=strategy==='baseline'?'buy':model?.action||'hold';
   const category=c.tier==='exploratory'
    ?'EXPLORATORIO: entrada nao validada, execucao e saida nao comprovadas'
    :'AUDITADO PARA ESTUDO: sem garantia de execucao';
   const reason=strategy==='baseline'?category+'; filtro de atividade e risco':category+'; '+(model?.reason||('IA '+ai.status+'; sem autorizacao de entrada'));
   await recordDecision(db,strategy,c.mint,choice,reason,at,strategy==='baseline'?'rules':'model');
   if(choice==='buy'){if(await buy(db,a,strategy,c,at,reason))count[strategy]++;}
  }
 }
 return {enabled:true,eligible:eligible.length,buys:count,sells:closed,aiStatus:ai.status};
}
export async function paperSnapshot(env,at=Date.now()){
 if(!paperEnabled(env))return {enabled:false,aiConfigured:agentEnabled(env),aiCallLimit:aiDailyLimit(env),accounts:[],positions:[],trades:[],decisions:[],usage:null,note:'Teste ainda nao habilitado no servidor'};
 const db=env.DB;
 const [ac,po,tr,de,us,pf,ev,diag]=await Promise.all([
  db.prepare('SELECT * FROM paper_accounts ORDER BY strategy').all(),
  db.prepare('SELECT * FROM paper_positions ORDER BY opened_at DESC').all(),
  db.prepare('SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 80').all(),
  db.prepare('SELECT * FROM paper_decisions ORDER BY created_at DESC LIMIT 80').all(),
  db.prepare('SELECT * FROM paper_ai_usage WHERE day=?').bind(localDay(at)).first(),
  db.prepare("SELECT strategy,COUNT(*) AS sells,SUM(CASE WHEN pnl_usd>0 THEN 1 ELSE 0 END) AS wins,COALESCE(SUM(pnl_usd),0) AS realized_pnl FROM paper_trades WHERE action='sell' GROUP BY strategy").all(),
  db.prepare('SELECT * FROM paper_entry_evidence ORDER BY created_at DESC LIMIT 100').all(),
  db.prepare('SELECT * FROM paper_diagnostics WHERE id=1').first()
 ]);
 const rows=po.results||[],accounts=(ac.results||[]).map(a=>{
  const mine=rows.filter(p=>p.strategy===a.strategy);
  const fresh=mine.every(p=>num(p.last_price)>0&&num(p.last_quote_at)>0&&at-p.last_quote_at<180000&&at>=p.last_quote_at);
  const netOpen=fresh?mine.reduce((s,p)=>s+p.quantity*p.last_price*(1-PAPER.fee),0):null;
  const invested=mine.reduce((s,p)=>s+p.invested_usd,0);
  return {...a,open_value_usd:netOpen,equity_usd:fresh?a.cash_usd+netOpen:null,
   unrealized_pnl:fresh?netOpen-invested:null,prices_fresh:fresh};
 });
 return {enabled:true,aiConfigured:agentEnabled(env),aiCallLimit:aiDailyLimit(env),accounts,
  performance:pf.results||[],positions:rows,trades:tr.results||[],decisions:de.results||[],
  evidence:ev.results||[],diagnostics:diag||null,usage:us||null,
  checkedAt:at,note:'Compras/vendas ficticias com cotacoes observadas e custos supostos. Sem garantia de execucao real.'};
}