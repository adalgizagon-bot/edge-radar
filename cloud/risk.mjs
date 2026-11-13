/* Edge Radar · Camada de risco. Atividade nao equivale a seguranca.
 * Sem cotacao executavel de saida, entrada jamais e liberada.
 */
const n=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const txt=x=>String(x??'').slice(0,90);
export function assessRisk({mint,pair,token,previous,now=Date.now()}={}){
 const reasons=[],alerts=[];
 const liq=n(pair?.liquidity?.usd),price=n(pair?.priceUsd),prevP=n(previous?.pool_price),prevL=n(previous?.pool_liquidity);
 const dropP=price>0&&prevP>0?100*(price/prevP-1):null;
 const dropL=liq!==null&&prevL>0?100*(liq/prevL-1):null;
 const organic=n(token?.organicScore),audit=token?.audit||{};
 const jliq=n(token?.liquidity),top=n(audit.topHoldersPercentage);
 const buyUsd=n(token?.stats5m?.buyVolume),sellUsd=n(token?.stats5m?.sellVolume);
 const buyCount=n(token?.stats5m?.numBuys),sellCount=n(token?.stats5m?.numSells);
 const flow=buyUsd!==null&&sellUsd!==null&&sellUsd>0?buyUsd/sellUsd:null;
 const oldest=Date.parse(token?.firstPool?.createdAt||'');const ageMinutes=Number.isFinite(oldest)?Math.max(0,(now-oldest)/60000):null;
 const critical=m=>alerts.push(txt(m)),warning=m=>reasons.push(txt(m));
 if(liq===null)warning('Liquidez do pool sem cotacao atual; entrada nao verificada');
 else if(liq<5000)critical('Liquidez do pool abaixo de US$ 5 mil');
 else if(liq<20000)warning('Liquidez do pool abaixo de US$ 20 mil');
 if(jliq!==null&&jliq<5000)critical('Liquidez da Jupiter abaixo de US$ 5 mil');
 if(dropP!==null&&dropP<=-20)critical('Preco caiu '+Math.abs(dropP).toFixed(0)+'% entre verificacoes');
 if(dropL!==null&&dropL<=-30)critical('Liquidez caiu '+Math.abs(dropL).toFixed(0)+'% entre verificacoes');
 if(!token)warning('Auditoria e atividade organica indisponiveis');
 else {
  if(audit.isSus===true)critical('Token marcado como suspeito');
  if(audit.mintAuthorityDisabled===false)critical('Permissao de emissao ativa');
  if(audit.freezeAuthorityDisabled===false)critical('Permissao de congelamento ativa');
  if(top!==null&&top>=40)critical('Maiores detentores concentram '+top.toFixed(0)+'%');
  else if(top!==null&&top>=25)warning('Maiores detentores concentram '+top.toFixed(0)+'%');
  if(organic!==null&&organic<35)critical('Atividade organica baixa: '+organic.toFixed(0)+'/100');
  else if(organic!==null&&organic<60)warning('Atividade organica moderada: '+organic.toFixed(0)+'/100');
  if(flow!==null&&flow<0.75)warning('Volume vendido em US$ supera compras');
  if(flow!==null&&flow<0.65&&buyCount!==null&&sellCount!==null&&buyCount>sellCount)critical('Muitas compras pequenas e vendas maiores em US$');
  if(token.isVerified!==true)warning('Token nao verificado pela Jupiter');
  if(ageMinutes!==null&&ageMinutes<15)warning('Pool listado ha menos de 15 minutos');
  if(audit.mintAuthorityDisabled!==true||audit.freezeAuthorityDisabled!==true||top===null||organic===null)warning('Dados de seguranca incompletos');
 }
 const unverified=!token||organic===null||audit.mintAuthorityDisabled!==true||audit.freezeAuthorityDisabled!==true||top===null||liq===null||price===null;
 const level=alerts.length?'blocked':unverified?'unverified':'watch';
 return {mint,level,alerts,reasons,organic,verified:token?.isVerified===true,top,flow,buyUsd,sellUsd,liq,price,jliq,dropP,dropL,ageMinutes,assessedAt:now,exitQuoteVerified:false,entryAllowed:false};
}
export const riskRow=(r,{name='',symbol='',score=0}={})=>({
 mint:r.mint,name:txt(name),symbol:txt(symbol),assessed_at:r.assessedAt,level:r.level,
 market_score:n(score)||0,organic_score:r.organic,is_verified:r.verified?1:0,
 top_holders:r.top,buy_usd:r.buyUsd,sell_usd:r.sellUsd,flow_ratio:r.flow,
 pool_price:r.price,pool_liquidity:r.liq,jupiter_liquidity:r.jliq,
 change_price:r.dropP,change_liquidity:r.dropL,
 reasons:JSON.stringify([...r.alerts,...r.reasons]).slice(0,1150),exit_quote_verified:0,entry_allowed:0
});
