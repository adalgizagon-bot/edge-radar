/* Edge Scalp — fixed-rule paper-only strategy; never sends or signs transactions.
 * Data cadence: Cloudflare cron ~60s; stops/targets are evaluated on observations,
 * not continuous market orders. Non-executable DEX spot prices only.
 */
export const SCALP=Object.freeze({
 target:0.05,stop:-0.03,maxHoldMs:6*60_000,maxPositions:2,
 stakeUsd:20,minimumScore:70,minimumLiquidity:12000,minimumVolume5m:2500,
 minimumBuys5m:10,minimumBuySellRatio:1.35,
 minimumChange5m:1.5,maximumChange5m:16,
 minimumPoolAgeMs:5*60_000,weakExitAfterMs:2*60_000,
 flatExitAfterMs:3*60_000,flatGain:0.008,
 trailingActiveGain:0.03,trailingPullback:0.018,
 dailyLossLimitUsd:25
});
const n=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);

export function scalpCandidate(c,at=Date.now()){
 const base=c?.assessment;
 if(!base?.eligible)return {eligible:false,tier:'rejected',reason:base?.reason||'triagem_pendente'};
 const p=c?.pair||{},tx=p.txns?.m5||{},volume=n(p.volume?.m5),liq=n(p.liquidity?.usd);
 const change=n(p.priceChange?.m5),buys=n(tx.buys),sells=n(tx.sells),score=n(c.score);
 const age=n(p.pairCreatedAt),drop=n(c?.risk?.dropP);
 if(!(liq>=SCALP.minimumLiquidity)||!(volume>=SCALP.minimumVolume5m)||!(score>=SCALP.minimumScore))
  return {eligible:false,tier:'rejected',reason:'scalp_volume_ou_score'};
 if(!(buys>=SCALP.minimumBuys5m)||!(sells>=1)||buys/sells<SCALP.minimumBuySellRatio)
  return {eligible:false,tier:'rejected',reason:'scalp_pressao_compradora'};
 if(change===null||change<SCALP.minimumChange5m||change>SCALP.maximumChange5m)
  return {eligible:false,tier:'rejected',reason:'scalp_preco_esticado_ou_fraco'};
 if(age!==null&&(age>at||at-age<SCALP.minimumPoolAgeMs))
  return {eligible:false,tier:'rejected',reason:'scalp_pool_novo'};
 if(drop!==null&&drop<=-2)return {eligible:false,tier:'rejected',reason:'scalp_perda_de_forca'};
 return {eligible:true,tier:base.tier,reason:'scalp_aprovado_apenas_para_simulacao'};
}
export function nextScalpTracking(old,price,at){
 if(!(n(price)>0))return old||null;
 if(old&&!(at>Number(old.sample_at)))return old;
 const previous=n(old?.last_price);
 const peak=Math.max(n(old?.peak_price)||0,price);
 const weak=previous!==null&&price<previous*0.999?Number(old.weak_ticks||0)+1:0;
 return {peak_price:peak,last_price:price,weak_ticks:weak,sample_at:at};
}
export function scalpExit(position,price,at,tracking){
 if(!position||!(n(price)>0)||!(n(position.entry_price)>0)||!(n(position.opened_at)>0))return null;
 const change=price/position.entry_price-1,held=Math.max(0,at-position.opened_at);
 if(change<=SCALP.stop)return 'scalp: stop observado (-3%)';
 if(change>=SCALP.target)return 'scalp: alvo observado (+5%)';
 const peak=n(tracking?.peak_price)||n(position.entry_price);
 if(peak>=position.entry_price*(1+SCALP.trailingActiveGain)&&
    price<=peak*(1-SCALP.trailingPullback))return 'scalp: devolucao apos ganho';
 if(held>=SCALP.maxHoldMs)return 'scalp: tempo maximo de 6 min';
 if(held>=SCALP.weakExitAfterMs&&Number(tracking?.weak_ticks||0)>=2&&change<=0.01)
  return 'scalp: queda em duas observacoes';
 if(held>=SCALP.flatExitAfterMs&&change<SCALP.flatGain)
  return 'scalp: movimento sem forca';
 return null;
}
