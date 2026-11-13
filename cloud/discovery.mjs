/* Fallback de descoberta de tokens sem prometer cobertura total do mercado.
 * Fontes promocionais servem apenas como candidatos para verificacao de pool.
 */
export const GECKO_COOLDOWN_MS=3*60_000;
export const GECKO_MAX_COOLDOWN_MS=60*60_000;
export function geckoDelay(status,failures=1,retryAfterMs=0){
 const rate=status===429;
 const exp=Math.min(GECKO_MAX_COOLDOWN_MS,(rate?5:3)*60_000*2**Math.min(4,Math.max(0,failures-1)));
 return Math.max(exp,Number.isFinite(retryAfterMs)?Math.min(GECKO_MAX_COOLDOWN_MS,retryAfterMs):0);
}
export function parseJupiterRecent(rows){
 return (Array.isArray(rows)?rows:[]).filter(x=>typeof x?.id==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x.id)&&x.id!=='So11111111111111111111111111111111111111112'&&x.id!=='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  .map(x=>({mint:x.id,name:String(x.name||'').slice(0,80),symbol:String(x.symbol||'').slice(0,25),
    source:'jupiter_recent',liquidity:Number(x.liquidity)||0,volume:Number(x.stats5m?.buyVolume||0)+Number(x.stats5m?.sellVolume||0)}));
}
export function parseDexProfiles(rows){
 return (Array.isArray(rows)?rows:[]).filter(x=>x?.chainId==='solana'&&typeof x.tokenAddress==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x.tokenAddress))
  .map(x=>({mint:x.tokenAddress,name:'',symbol:'',source:'dex_profile_promotional',liquidity:0,volume:0}));
}
export function combineCandidates(groups,max=35){
 const map=new Map();
 for(const group of groups)for(const c of group||[]){
  if(!c?.mint||map.has(c.mint))continue;
  map.set(c.mint,c);if(map.size>=max)return [...map.values()];
 }
 return [...map.values()];
}
