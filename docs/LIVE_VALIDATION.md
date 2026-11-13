# Diagnóstico de rede e validação real — continuação de f8b14cc

Verificação em 13/11/2026, aproximadamente 19h36–19h39 de Brasília (22h36–22h39 UTC). Branch mantida: `rebuild/memecoin-radar-v1`. O checkout estava limpo no início. Não houve reconstrução, remoção de arquivos, reset, alteração de dados, push ou deploy.

## Conclusão sustentada pela evidência

**Os 403 observados vêm da recusa do CONNECT pelo proxy gerenciado do ambiente, antes da conexão TLS com os destinos. Não são respostas HTTP das APIs.**

A ferramenta de status reportou observações atuais, rede `restricted`, política `enforced`, revisão de runtime 1 e **nenhum domínio personalizado aplicado**. Nenhum dos dez hosts necessários consta na lista efetiva. O preset vigente é `package_managers`.

O rascunho, revisão 4, **já contém os dez hosts**. Portanto, o problema é a diferença entre configuração salva e configuração aplicada à máquina. Não foi necessário salvar outra cópia do mesmo rascunho; isso não aplicaria a política e não resolveria o bloqueio.

Como controle, `https://registry.npmjs.org/typescript/latest`, permitido pelo preset, retornou **HTTP 200 e JSON válido**. Isso demonstra que há conectividade através da rota suportada para um destino autorizado. Não demonstra saúde ou autorização das APIs de mercado.

Nenhuma tentativa usou conexão direta sem proxy, IP alternativo, VPN, TLS desabilitado ou mudança de DNS. Não foram lidos logs retidos do provedor ou arquivos de credenciais.

## Inventário de chamadas e resultado real

Todas as chamadas abaixo passaram pelo proxy configurado, com validação TLS normal, sem valor de credencial nos registros. Os contratos de referência WSOL/USDC foram utilizados apenas para consultas de leitura; não foram inseridos como candidatos nem apresentados como descobertas.

| Fonte | Host exato | Chamadas verificadas | Resultado |
|---|---|---|---|
| DEX Screener | `api.dexscreener.com` | `GET /token-profiles/latest/v1`; `GET /tokens/v1/solana/{WSOL}` | CONNECT 403 nas duas |
| GeckoTerminal | `api.geckoterminal.com` | `GET /api/v2/networks/solana/new_pools?include=base_token&page=1`; `GET /api/v2/networks/solana/trending_pools?include=base_token&page=1` | CONNECT 403 nas duas |
| Solana RPC | `api.mainnet-beta.solana.com` | `POST /`, métodos `getAccountInfo` e `getTokenLargestAccounts` | CONNECT 403 nos dois |
| Bluesky | `public.api.bsky.app` | `GET /xrpc/app.bsky.feed.searchPosts`, busca pelo contrato exato WSOL, limit=1 | CONNECT 403 |
| Jupiter | `api.jup.ag` | `GET /swap/v1/quote`, USDC→WSOL, ExactIn, 1 USDC, slippage=100 bps, sem transação | CONNECT 403; sem chave configurada |
| Controle | `registry.npmjs.org` | `GET /typescript/latest` | HTTP 200, JSON válido |

As cinco documentações também falharam em CONNECT, cada uma no seu próprio host:

| Host | URL consultada |
|---|---|
| `docs.dexscreener.com` | `https://docs.dexscreener.com/api/reference` |
| `apiguide.geckoterminal.com` | `https://apiguide.geckoterminal.com/` |
| `solana.com` | `https://solana.com/docs/references/clusters` |
| `docs.bsky.app` | `https://docs.bsky.app/docs/api/app-bsky-feed-search-posts` |
| `dev.jup.ag` | `https://dev.jup.ag/docs/api-setup` |

**Total:** oito consultas de dados + cinco documentações bloqueadas pelo proxy; um controle HTTP 200. O código HTTP das APIs permanece **desconhecido**. Não se pode concluir que elas aceitariam a chamada após a liberação: autenticação, WAF, rate limits, termos e compatibilidade dos endpoints ainda precisam de verificação.

O link externo manual do detalhe de moeda aponta para `dexscreener.com`; ele não é usado pelo coletor e não é requisito para as chamadas de dados. X, Reddit e Telegram não são chamados. Não há IA ou API de negociação real.

## Ação necessária nas configurações do ambiente

Aplicar a rede salva no rascunho para os cinco hosts de runtime:

```text
api.dexscreener.com
api.geckoterminal.com
api.mainnet-beta.solana.com
public.api.bsky.app
api.jup.ag
```

E os cinco hosts de documentação para confirmar APIs, condições e limites:

```text
docs.dexscreener.com
apiguide.geckoterminal.com
solana.com
docs.bsky.app
dev.jup.ag
```

Preservar o preset de gerenciadores de pacotes e quaisquer outras regras existentes. Não é necessário liberar toda a Internet. Os dez hosts já estão no rascunho; falta aplicar/salvar a configuração na máquina através das configurações do ambiente. Se o produto exigir publicação da configuração, isso se refere ao **ambiente de desenvolvimento**, não ao deploy do Edge Radar em produção.

Após a atualização, verificar novamente o status aplicado e as chamadas. Se aparecer HTTP 401/403 **após** CONNECT/TLS, será um novo diagnóstico: investigar resposta do gateway/API e autenticação; não assumir que é o mesmo bloqueio atual nem cadastrar secrets duplicados.

## Correção pontual realizada

`server/sources.py` agora conserva a distinção no status visível:

- `Proxy CONNECT negado (HTTP 403); API não alcançada` para o erro observado;
- `Resposta HTTP N após CONNECT; origem a confirmar` quando há resposta HTTP;
- erros gerais de transporte sem copiar mensagens arbitrárias que possam conter dados privados.

O orçamento, o cache, o backoff, os adaptadores e as fórmulas existentes foram mantidos. Nenhuma alteração foi feita no dashboard ou nas estratégias.

Foi adicionado `scripts/check_sources.py`, diagnóstico reproduzível somente leitura. Ele retorna código **2** quando algum destino falha, separa status do proxy e HTTP após conexão, registra presença de chave sem seu valor e preserva relatórios anteriores.

```bash
python3 scripts/check_sources.py
```

Evidência local deste diagnóstico, ignorada pelo Git para não misturar execução e código:

- `.runtime/validation/network-probes-complete.json`: resultados por chamada;
- `.runtime/validation/network-policy-evidence.json`: diferença entre política efetiva e rascunho, sem credenciais.

## Funcionalidades validadas com dados reais

- Diagnóstico de rede do ambiente: CONNECT negado nos provedores, controle npm HTTP 200 e diferença entre rascunho e política aplicada.
- Integridade do banco existente: `PRAGMA integrity_check` retornou `ok`, em conexão somente leitura.

**Nenhuma descoberta, análise financeira, risco, narrativa social ou simulação foi validada com dados reais de mercado nesta continuação.** O banco preservado contém zero tokens, snapshots, avaliações, posts e operações. Um banco vazio íntegro não valida persistência de moedas reais.

## Funcionalidades testadas apenas com mocks/fixtures

- Três detectores: novidade, aceleração e retomada com baseline.
- Normalização de campos, comparação por fonte/pool, dados ausentes e fórmulas heurísticas.
- Persistência após desaparecimento da fonte e falha parcial; snapshots e avaliações preservados.
- Riscos básicos por autoridades/concentração; associação social por contrato.
- Ledger de simulação, custos/slippage estimados, gaps, stops, rotas indisponíveis e ausência de look-ahead.
- Seis novas regressões de diagnóstico: CONNECT 403 versus HTTP 403; HTTP 401; erro JSON-RPC com HTTP 200; sanitização; mensagem persistida do runtime.

Checagens desta continuação: **67 testes Python passaram**, incluindo as seis novas regressões; **lint passou** (ESLint/Ruff e formatação Python). Frontend não foi alterado; seus seis testes de navegador e build/TypeScript aprovados na entrega anterior não foram apresentados como uma nova execução.

## Funcionalidades pendentes e sequência após liberação

1. **Documentação e acesso:** confirmar termos, cotas atuais, formatos e endpoints com respostas reais. Liberação de rede não fornece credenciais automaticamente. `JUPITER_API_KEY` foi verificada apenas quanto à presença: **ausente**. Confirmar acesso gratuito antes de configurar uma chave no backend; nunca enviar valor em chat.
2. **Radar A:** iniciar coleta real, conferir contrato, pool, criação, fonte e horário nos payloads de origem; ausência de candidatos elegíveis não é falha se a descoberta estiver corretamente demonstrada.
3. **Persistência:** coletar contratos reais, reiniciar serviço/conexão e retirar um contrato apenas do conjunto de entrada de uma validação isolada, sem apagar observações. Confirmar que ele permanece no banco e na busca histórica. Essa retirada controlada deve ser descrita como teste de persistência com dados reais capturados, não como observação natural do mercado.
4. **Radar B:** obter ao menos três amostras genuínas da mesma fonte/pool, separadas por ≥5 min, e recalcular volume, transações de compra/venda, liquidez e scores a partir dos payloads. Transações não equivalem a compradores únicos. Não alterar relógio, interpolar amostras ou forçar um sinal positivo.
5. **Radar C:** construir baseline real de 24–48 h, com pelo menos seis amostras cobrindo quatro horas. Confirmar casos negativos e, se ocorrer, uma retomada positiva. A idade do pool não substitui histórico de volume.
6. **Risco:** conferir autoridades de mint/freeze, supply e maiores contas em respostas RPC reais. Maior conta pode ser pool ou custódia; não anunciar auditoria completa, token seguro ou holders únicos.
7. **Social:** confirmar acesso Bluesky e conteúdo com contrato exato. Resposta vazia só valida a consulta, não menções/narrativas. Crescimento exige duas horas de cobertura contínua; a descoberta global de narrativas permanece não implementada. X/Reddit/Telegram seguem ausentes.
8. **Simulador:** com acesso gratuito Jupiter confirmado, obter e arquivar duas rotas somente leitura, verificar unidades de `priceImpactPct`, `otherAmountThreshold`, taxas embutidas e slippage, e só então registrar uma simulação que passe pelas condições existentes. Custos de rede continuam hipótese explícita. Avaliar saídas em amostras futuras reais, incluindo a possibilidade de nenhuma rota. Não executar swaps nem alterar regras para forçar entrada.

**Bloqueador externo atual:** aplicação da política de rede. Não houve deploy, modificação de infraestrutura externa, dados fabricados ou trabalho no robô de negociação. A aprovação dos testes reais continua sendo requisito para publicação em produção.
