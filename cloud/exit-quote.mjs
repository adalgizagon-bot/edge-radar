/* Consulta somente de rota de saida. Nao monta, assina ou envia ordens. */
export const SOL_MINT='So11111111111111111111111111111111111111112';
export const STAKE_USD=15;
const finite=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const mintOk=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export function quoteRequest(token,stake=STAKE_USD){
 const price=finite(token?.usdPrice),d=Number(token?.decimals),id=token?.id;
 if(!mintOk(id)||!Number.isInteger(d)||d<0||d>12||price===null||price<=0||!Number.isFinite(stake)||stake<1||stake>50)return null;
 const quantity=stake/price;
 if(!Number.isFinite(quantity)||quantity<=0||quantity>=1e14)return null;
 const decimal=quantity.toFixed(d);const [whole,fraction='']=decimal.split('.');
 if(!/^\d+$/.test(whole)||!/^\d*$/.test(fraction))return null;
 const raw=BigInt(whole+fraction.padEnd(d,'0'));
 if(raw<=0n||raw>18446744073709551615n)return null;
 const query=new URLSearchParams({inputMint:id,outputMint:SOL_MINT,amount:String(raw)});
 return {url:'https://api.jup.ag/swap/v2/order?'+query,stakeUsd:stake,tokenQty:quantity,atomicAmount:String(raw)};
}
export function parseExitQuote(data,solPriceUsd,stake=STAKE_USD){
 const sol=finite(solPriceUsd);if(sol===null||sol<=0)return {status:'unknown',error:'Preco SOL/USD indisponivel'};
 let out;
 try{out=BigInt(data?.outAmount||'0')}catch{return {status:'unavailable',error:'Cotacao sem valor valido'}}
 if(out<=0n)return {status:'unavailable',error:'Sem rota de saida ou valor recuperavel'};
 const solOut=Number(out)/1e9;const usdOut=solOut*sol;
 if(!Number.isFinite(usdOut)||usdOut<=0)return {status:'unavailable',error:'Valor de saida invalido'};
 const rec=100*usdOut/stake;
 return {status:rec<85?'large_impact':'quoted',estimatedSol:solOut,estimatedUsd:usdOut,recoveryPct:rec,router:String(data.router||'nao informado').slice(0,35),error:rec<85?'Cotacao recupera menos de 85% do valor teorico':''};
}
