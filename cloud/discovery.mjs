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


/* Balanced source discovery: a new-pools flood cannot erase mature opportunities. */
export const DISCOVERY_TARGETS=Object.freeze([6,6,5,5,3]);
export function selectBalancedCandidates(groups,max=25,targets=DISCOVERY_TARGETS){
 const arrays=(groups||[]).map(g=>Array.isArray(g)?g:[]);
 const out=[],seen=new Set(),indexes=arrays.map(()=>0);
 const put=c=>{if(!c||typeof c.mint!=='string'||seen.has(c.mint))return false;seen.add(c.mint);out.push(c);return true;};
 // Reserve slots for each type of discovery before filling remaining slots.
 for(let i=0;i<arrays.length&&out.length<max;i++){
  let n=0,quota=Math.max(0,Math.trunc(Number(targets[i]??0)));
  while(indexes[i]<arrays[i].length&&out.length<max&&n<quota){
   const c=arrays[i][indexes[i]++];if(put(c))n++;
  }
 }
 let added=true;
 while(added&&out.length<max){
  added=false;
  for(let i=0;i<arrays.length&&out.length<max;i++){
   while(indexes[i]<arrays[i].length){
    const c=arrays[i][indexes[i]++];
    if(put(c)){added=true;break;}
   }
  }
 }
 return out;
}
