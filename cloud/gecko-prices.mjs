/* Pure GeckoTerminal price-pair adaptation for PAPER simulation.
 * Only freshly fetched pool payloads may be used; no stale DB quote as a fill.
 * Gecko quotes are observed/polling prices, NOT executable swap quotations.
 */
const n=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const mint=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const pump=s=>/(pump.?swap|pump.?fun|pumpfun)/i.test(String(s||''));
export function poolAgeMillis(value){
 if(typeof value!=='string'||!value)return null;
 const ms=Date.parse(value);
 return Number.isFinite(ms)&&ms>0?ms:null;
}
export function geckoPoolToPair(pool,now=Date.now()){
 const price=n(pool?.price),liq=n(pool?.liquidity),volume=n(pool?.volume);
 const buy=n(pool?.buys),sell=n(pool?.sells),change=n(pool?.change);
 const created=n(pool?.createdAt);
 if(!mint(pool?.mint)||!pump(pool?.dex)||!(price>0)||!(liq>0)||volume===null||
  buy===null||sell===null||change===null)return null;
 if(created!==null&&created>now)return null;
 return {chainId:'solana',dexId:'pumpswap',priceUsd:String(price),
  baseToken:{address:pool.mint,name:pool.name||'',symbol:pool.symbol||''},
  pairAddress:pool.pool||null,liquidity:{usd:liq},volume:{m5:volume,h24:n(pool.volume24h)},
  txns:{m5:{buys:buy,sells:sell}},priceChange:{m5:change,h1:n(pool.change1h),h24:n(pool.change24h)},
  marketCap:n(pool.marketCap),pairCreatedAt:created,priceSource:'gecko',observedAt:now};
}
export function selectGeckoPairs(pools,at=Date.now()){
 const out=new Map();
 for(const x of pools||[]){
  const p=geckoPoolToPair(x,at);if(!p)continue;
  const old=out.get(x.mint);
  if(!old||Number(p.liquidity.usd)>Number(old.liquidity.usd))out.set(x.mint,p);
 }
 return out;
}
export function mergeFreshPairs(dex,gecko){
 const out=new Map(gecko||[]);
 for(const [mint,p] of dex||[])out.set(mint,{...p,priceSource:'dex',observedAt:p.observedAt??Date.now()});
 return out;
}
