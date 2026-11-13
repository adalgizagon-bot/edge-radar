/* Edge Scalp V2: predeclared research hypothesis, NOT trained/optimized on closed trades.
 * Strictly paper-only. Compared forward from its own activation timestamp.
 */
export const V2=Object.freeze({
 target:0.07,stop:-0.03,maxHoldMs:8*60_000,maxPositions:2,
 minimumScore:80,minimumLiquidity:25000,minimumVolume5m:5000,
 minimumBuys:16,minimumRatio:1.65,minimumChange:2,maximumChange:12,
 minimumPoolAgeMs:8*60_000,flatExitMs:4*60_000,
 flatGain:0.01,weakExitMs:3*60_000,trailActivation:0.04,
 trailPullback:0.02,dailyLossLimitUsd:15
});
const n=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
export function scalpV2Candidate(c,at=Date.now()){
 if(c?.assessment?.eligible!==true)return {eligible:false,reason:'risco_ou_preco'};
 const p=c.pair||{},risk=c.risk||{};
 const liq=n(p.liquidity?.usd),volume=n(p.volume?.m5),change=n(p.priceChange?.m5);
 const buys=n(p.txns?.m5?.buys),sells=n(p.txns?.m5?.sells);
 const age=n(p.pairCreatedAt),score=n(c.score),organic=n(risk.organic),top=n(risk.top);
 if(!(score>=V2.minimumScore&&liq>=V2.minimumLiquidity&&volume>=V2.minimumVolume5m))
  return {eligible:false,reason:'score_liquidez_volume'};
 if(!(buys>=V2.minimumBuys&&sells>=1&&buys/sells>=V2.minimumRatio))
  return {eligible:false,reason:'pressao_compradora'};
 if(!(change>=V2.minimumChange&&change<=V2.maximumChange))
  return {eligible:false,reason:'movimento_excessivo_ou_fraco'};
 if(age===null||age>at||at-age<V2.minimumPoolAgeMs)
  return {eligible:false,reason:'idade_do_pool_indisponivel_ou_nova'};
 if((organic!==null&&organic<60)||(top!==null&&top>=25))
  return {eligible:false,reason:'alerta_de_auditoria'};
 if(n(risk.dropP)!==null&&risk.dropP<=-2)
  return {eligible:false,reason:'perda_de_forca'};
 return {eligible:true,reason:'v2_candidato_experimental',tier:c.tier||'exploratory'};
}
export function scalpV2Exit(p,price,at,track){
 const entry=n(p?.entry_price),start=n(p?.opened_at),current=n(price);
 if(!(entry>0&&start>0&&current>0))return null;
 const ret=current/entry-1,held=at-start;
 if(ret<=V2.stop)return 'v2: stop observado -3%';
 if(ret>=V2.target)return 'v2: alvo observado +7%';
 const peak=n(track?.peak_price)||entry;
 if(peak>=entry*(1+V2.trailActivation)&&current<=peak*(1-V2.trailPullback))
  return 'v2: protecao apos pico';
 if(held>=V2.maxHoldMs)return 'v2: limite de 8 minutos';
 if(held>=V2.weakExitMs&&Number(track?.weak_ticks||0)>=2&&ret<=0.01)
  return 'v2: perda de forca';
 if(held>=V2.flatExitMs&&ret<V2.flatGain)
  return 'v2: sem impulso';
 return null;
}
