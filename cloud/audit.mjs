/* Forensic analytics on CLOSED paper trades. Reads historical entries as recorded,
 * never substitutes current market data for unavailable historical features.
 */
const n=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
export const reasonGroup=x=>{
 const s=String(x||'').toLowerCase();
 return /stop/.test(s)?'stop':/alvo/.test(s)?'alvo':/tempo|limite de .*min/.test(s)?'tempo':
 /sem impulso|sem forca|movimento sem|sem movimento/.test(s)?'sem_impulso':
 /perda de forca|queda|devolucao|protecao apos pico/.test(s)?'perda_forca':
 /ia:/.test(s)?'ia':'outro';
};
const scoreBand=v=>v===null?'sem_registro':v<70?'<70':v<80?'70–79':v<90?'80–89':'90+';
const liquidityBand=v=>v===null?'sem_registro':v<10000?'<10 mil':v<20000?'10–20 mil':v<50000?'20–50 mil':'50 mil+';
const durationBand=v=>v===null?'sem_registro':v<2?'<2 min':v<4?'2–4 min':v<8?'4–8 min':v<20?'8–20 min':'20+ min';
const changeBand=v=>v===null?'sem_registro':v<3?'<3%':v<7?'3–7%':v<12?'7–12%':'12%+';
export function stressPnL(pnl,invested,baseFee=0.01,stressFee=0.025){
 if(n(pnl)===null||!(n(invested)>0))return null;
 const factor=(1+baseFee)*(1-stressFee)/((1+stressFee)*(1-baseFee));
 return (pnl+invested)*factor-invested;
}
function tally(list,label,row){
 const key=label||'sem_registro',item=list.get(key)||{category:key,count:0,wins:0,pnl_usd:0,stress_usd:0};
 item.count++;item.wins+=row.pnl_usd>0?1:0;item.pnl_usd+=row.pnl_usd;
 item.stress_usd+=row.stress_pnl_usd||0;list.set(key,item);
}
function sortedMap(map){return [...map.values()].sort((a,b)=>b.count-a.count||a.category.localeCompare(b.category));}
export function summarizeClosed(rows){
 const byStrategy=new Map();
 for(const row of [...rows].sort((a,b)=>a.closed_at-b.closed_at||String(a.sell_id).localeCompare(String(b.sell_id)))){
  const strategy=row.strategy,group=byStrategy.get(strategy)||{
   strategy,closed:0,wins:0,realized_usd:0,stress_usd:0,positive_usd:0,negative_usd:0,
   max_drawdown_usd:0,peak_cumulative:0,cumulative:0,
   max_gain_usd:null,max_loss_usd:null,avg_duration_min:null,avg_duration_total:0,
   observed_price_paths:0,entry_features_available:0,above_stop_observed:0,
   by_reason:new Map(),by_tier:new Map(),by_score:new Map(),by_liquidity:new Map(),
   by_duration:new Map(),by_change5m:new Map()};
  group.closed++;group.wins+=row.pnl_usd>0?1:0;group.realized_usd+=row.pnl_usd;
  group.stress_usd+=row.stress_pnl_usd||0;
  if(row.pnl_usd>0)group.positive_usd+=row.pnl_usd;else group.negative_usd+=Math.abs(row.pnl_usd);
  group.cumulative+=row.pnl_usd;group.peak_cumulative=Math.max(group.peak_cumulative,group.cumulative);
  group.max_drawdown_usd=Math.max(group.max_drawdown_usd,group.peak_cumulative-group.cumulative);
  group.max_gain_usd=Math.max(group.max_gain_usd??row.pnl_usd,row.pnl_usd);
  group.max_loss_usd=Math.min(group.max_loss_usd??row.pnl_usd,row.pnl_usd);
  if(row.duration_minutes!==null)group.avg_duration_total+=row.duration_minutes;
  group.observed_price_paths+=row.sample_count>0?1:0;
  group.entry_features_available+=row.volume5m!==null?1:0;
  group.above_stop_observed+=row.stop_overshoot_pct!==null&&row.stop_overshoot_pct>0?1:0;
  tally(group.by_reason,row.reason_group,row);tally(group.by_tier,row.tier,row);
  tally(group.by_score,scoreBand(row.score),row);tally(group.by_liquidity,liquidityBand(row.liquidity),row);
  tally(group.by_duration,durationBand(row.duration_minutes),row);
  tally(group.by_change5m,changeBand(row.change5m),row);
  byStrategy.set(strategy,group);
 }
 return [...byStrategy.values()].map(g=>{
  const ratio=g.positive_usd>0&&g.negative_usd>0?g.positive_usd/g.negative_usd:null;
  const avgWin=g.wins?g.positive_usd/g.wins:null,lossCount=g.closed-g.wins;
  const avgLoss=lossCount?g.negative_usd/lossCount:null;
  const breakeven=avgWin!==null&&avgLoss!==null&&avgWin+avgLoss>0?
   100*avgLoss/(avgWin+avgLoss):null;
  return {
   strategy:g.strategy,closed:g.closed,wins:g.wins,losses:lossCount,
   win_rate_pct:100*g.wins/g.closed,realized_usd:g.realized_usd,
   stress_usd:g.stress_usd,expectancy_usd:g.realized_usd/g.closed,
   avg_win_usd:avgWin,avg_loss_usd:avgLoss,
   break_even_pct:breakeven,profit_factor:ratio,
   max_drawdown_usd:g.max_drawdown_usd,max_gain_usd:g.max_gain_usd,max_loss_usd:g.max_loss_usd,
   avg_duration_min:g.avg_duration_total/g.closed,
   sampled_paths:g.observed_price_paths,with_entry_features:g.entry_features_available,
   stop_overshoots:g.above_stop_observed,
   confidence:g.closed>=100?'amostra_para_revisao':'amostra_pequena',
   by_reason:sortedMap(g.by_reason),by_tier:sortedMap(g.by_tier),
   by_score:sortedMap(g.by_score),by_liquidity:sortedMap(g.by_liquidity),
   by_duration:sortedMap(g.by_duration),by_change5m:sortedMap(g.by_change5m)
  };
 });
}
export function normalizeAuditRows(dbRows,samples=[]){
 const samplesByKey=new Map(samples.map(x=>[x.strategy+'|'+x.mint+'|'+x.opened_at,x]));
 return (dbRows||[]).map(x=>{
  const invested=n(x.invested_usd)||20,price=n(x.price_usd),entry=n(x.entry_price);
  const duration=n(x.entry_at)!==null?(x.created_at-x.entry_at)/60000:null;
  const sampled=samplesByKey.get(x.strategy+'|'+x.mint+'|'+x.entry_at);
  const stopOvershoot=n(x.stop_overshoot_pct);
  return {sell_id:x.id,strategy:x.strategy,mint:x.mint,symbol:String(x.symbol||'').slice(0,30),
   entry_at:n(x.entry_at),closed_at:Number(x.created_at),entry_price:entry,exit_price:price,
   pnl_usd:Number(x.pnl_usd)||0,stress_pnl_usd:stressPnL(Number(x.pnl_usd)||0,invested),
   duration_minutes:duration,price_return_pct:entry>0&&price>0?100*(price/entry-1):null,
   exit_reason:String(x.reason||'').slice(0,150),
   reason_group:reasonGroup(x.reason),
   tier:x.tier||'sem_registro',risk_level:x.risk_level||'sem_registro',
   quote_status:x.quote_status||'sem_registro',
   score:n(x.score),liquidity:n(x.liquidity),
   volume5m:n(x.volume5m),change5m:n(x.change5m),
   buys5m:n(x.buys5m),sells5m:n(x.sells5m),
   organic:n(x.organic),top_holders:n(x.top_holders),
   sample_count:Number(sampled?.sample_count)||0,
   sampled_peak_return_pct:entry>0&&n(sampled?.max_price)>0?100*(sampled.max_price/entry-1):null,
   sampled_trough_return_pct:entry>0&&n(sampled?.min_price)>0?100*(sampled.min_price/entry-1):null,
   previous_quote_lag_ms:n(x.previous_quote_lag_ms),
   stop_overshoot_pct:stopOvershoot
  };
 });
}
export async function auditSnapshot(env,at=Date.now(),limit=500){
 const db=env.DB,bounded=Math.min(1000,Math.max(1,Math.trunc(Number(limit)||500)));
 const cohort=await db.prepare('SELECT started_at FROM paper_comparison_start WHERE id=1').first();
 const v2=await db.prepare("SELECT started_at FROM paper_strategy_inception WHERE strategy='scalp_v2'").first();
 const since=n(cohort?.started_at)||0;
 const sql="SELECT s.id,s.strategy,s.mint,s.symbol,s.price_usd,s.pnl_usd,s.reason,s.created_at,"+
  "b.created_at AS entry_at,b.price_usd AS entry_price,ABS(b.cash_usd) AS invested_usd,"+
  "e.tier,e.risk_level,e.quote_status,COALESCE(f.score,e.score) AS score,COALESCE(f.liquidity,e.liquidity) AS liquidity,"+
  "f.volume5m,f.change5m,f.buys5m,f.sells5m,f.organic,f.top_holders,"+
  "o.previous_quote_lag_ms,o.stop_overshoot_pct "+
  "FROM paper_trades s LEFT JOIN paper_trades b ON b.id=("+
  "SELECT id FROM paper_trades b2 WHERE b2.strategy=s.strategy AND b2.mint=s.mint "+
  "AND b2.action='buy' AND b2.created_at<=s.created_at ORDER BY b2.created_at DESC LIMIT 1) "+
  "LEFT JOIN paper_entry_evidence e ON e.buy_id=b.id "+
  "LEFT JOIN paper_entry_features f ON f.buy_id=b.id "+
  "LEFT JOIN paper_exit_observations o ON o.sell_id=s.id "+
  "WHERE s.action='sell' AND s.created_at>=? ORDER BY s.created_at DESC,s.id DESC LIMIT ?";
 const [records,amount,samples]=await Promise.all([
  db.prepare(sql).bind(since,bounded).all(),
  db.prepare("SELECT COUNT(*) AS total FROM paper_trades WHERE action='sell' AND created_at>=?").bind(since).first(),
  db.prepare("SELECT strategy,mint,opened_at,MIN(price_usd) AS min_price,MAX(price_usd) AS max_price,COUNT(*) AS sample_count "+
    "FROM paper_quote_samples WHERE observed_at>=? GROUP BY strategy,mint,opened_at").bind(since).all()
 ]);
 const rows=normalizeAuditRows(records.results,samples.results).sort((a,b)=>b.closed_at-a.closed_at);
 const reverse=[...rows].reverse();
 const summaries=summarizeClosed(reverse);
 const windowStart=n(v2?.started_at);
 return {
  checkedAt:at,comparisonSince:since,v2Since:windowStart,limit:bounded,
  totalClosed:Number(amount?.total)||0,complete:Number(amount?.total)<=bounded,
  summary:summaries,forwardSummary:windowStart===null?[]:summarizeClosed(
   reverse.filter(x=>x.closed_at>=windowStart)),
  rows,note:'Somente operações simuladas ENCERRADAS. Dados de entrada antigos podem faltar. Picos e mínimos são amostrais, não intra-minuto. A comparação após V2 usa uma janela comum; retornos não provam execução real.'
 };
}
