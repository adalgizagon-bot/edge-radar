# Validação real da reconstrução — execução do coletor

Data: **13/11/2026, 21h39–21h41 de Brasília** (14/11, 00h39–00h41 UTC).

Branch utilizada: `rebuild/memecoin-radar-v1`. Antes de qualquer alteração, `git ls-remote origin refs/heads/rebuild/memecoin-radar-v1` confirmou exatamente o commit remoto e local solicitado: **`4e88ee05d40e6cd75da58f46b746c86633bf87e2`**. O checkout estava limpo. A `main` não foi utilizada.

## Conclusão

**A descoberta real continua bloqueada nesta máquina.** Executei o coletor existente, sem mocks, sem alterar critérios e sem usar dados externos como fixtures. O resultado real foi `partial`, com **zero contratos e zero observações**, por recusa de CONNECT pelo proxy antes de alcançar DEX Screener e GeckoTerminal.

O usuário informou respostas anteriores com dados reais no ambiente atualizado. Elas **não foram reproduzidas na máquina anexada a esta conversa**. O status atual identifica a mesma máquina das tentativas anteriores, revisão 1, política restrita/enforced e `allowed_hosts=[]`; as regras efetivas continuam sendo as do preset de gerenciadores de pacotes. Esta observação não invalida as respostas obtidas em outro momento ou ambiente; limita o que foi comprovado nesta execução.

Não foram recebidos payloads de mercado. Não é possível atribuir o bloqueio às próprias APIs nem confirmar formatos, cotas, indicadores ou disponibilidade atual delas.

## Conectividade real

O comando `python3 scripts/check_sources.py` abriu conexões novas pela rota normal do proxy, com verificação TLS e sem contornar restrições.

| Fonte | Consultas realizadas | Resultado nesta máquina |
|---|---|---|
| DEX Screener | perfis e preços por contrato | CONNECT 403 nas duas |
| GeckoTerminal | pools novos e tendências Solana | CONNECT 403 nas duas |
| Solana RPC | getAccountInfo e getTokenLargestAccounts | CONNECT 403 nas duas |
| Jupiter | cotação de leitura USDC→WSOL | CONNECT 403; chave ausente |
| Bluesky | busca de posts por contrato exato | CONNECT 403; indisponível |
| Controle permitido — npm | metadados públicos TypeScript | HTTP 200 / JSON válido |

As cinco páginas oficiais de documentação também falharam em CONNECT. Os contratos de referência WSOL/USDC nas sondagens são apenas parâmetros de leitura; não foram registrados como descobertas. Nenhuma carteira, assinatura ou transação foi gerada.

Evidência versionada: [network-20261114T003931Z.json](evidence/network-20261114T003931Z.json). Ela distingue `proxy_http_status=403` de `api_http_status=null` e não contém credenciais.

## Execução real do coletor

Executei `python3 -m server.collector --once`, com `EDGE_DB` apontando para um banco de validação novo e separado. Isso preserva o banco existente e permite verificar chamadas reais sem aproveitar um backoff anterior.

Resultado da primeira execução:

- `status=partial`;
- `observations=0`;
- `tokens=0`;
- `new_pools`: proxy CONNECT negado;
- `trending_pools`: pausa/backoff após falha do mesmo provedor;
- `profiles`: proxy CONNECT negado;
- duas tentativas externas consumidas do orçamento de 24;
- nenhum contrato chegou ao pipeline de avaliação.

Foi constatado um defeito real no CLI: ele encerrava com código **0**, apesar de a coleta ter falhado antes de receber qualquer observação. Após a correção, uma segunda execução real, com outro banco separado e sem mocks, confirmou **código 2** para a mesma condição.

Evidência versionada da nova execução: [collector-20261114T004131Z.json](evidence/collector-20261114T004131Z.json). O banco de validação está em `.runtime/validation/collector-exitfix-20261114T004131Z/market.sqlite3`; não foi enviado ao GitHub. Seu `integrity_check` retornou `ok`, com todas as tabelas de mercado vazias.

## Contagens concretas

| Métrica desta execução | Quantidade | Interpretação |
|---|---:|---|
| Contratos reais recebidos | 0 | Bloqueio antes de receber dados |
| Fontes vinculadas a contratos | 0 | Não houve contrato para atribuir origem |
| Contratos avaliados pelos filtros | 0 | Nenhum dado entrou no pipeline |
| Passaram nos filtros iniciais | 0 | Sem universo recebido; não é resultado negativo de mercado |
| Em observação | 0 | Nenhum token armazenado |
| Descartados por regras financeiras/risco | 0 | Nenhum contrato foi avaliado ou descartado |
| Snapshots gravados | 0 | Nenhum dado fictício ou retrospectivo |
| Avaliações / auditorias / posts / operações | 0 | Sem dados ou cotações reais |

As falhas de fontes são registradas como falhas de coleta, **não** como descartes de moedas por falta de qualidade.

## Três radares

| Radar | Resultado real | Histórico necessário |
|---|---|---|
| A — moedas novas | Não validado: zero pools/perfis recebidos | Requer resposta real de descoberta e criação de pool verificável |
| B — aceleração | **Coleta insuficiente**: zero observações | Pelo menos três amostras reais da mesma fonte/pool, espaçadas por ≥5 min |
| C — retomada | **Baseline pendente**: zero observações | Dados de 24–48 h antes, pelo menos seis amostras cobrindo quatro horas |

Os critérios permaneceram exatamente os existentes. Não foram ajustados pesos, limiares, relógio, pool ou cadência para produzir sinais positivos. Os três detectores não foram apresentados como validados com mercado real.

## Qualidade dos dados e persistência

| Item solicitado | Situação real |
|---|---|
| Preço, volume e liquidez | Não avaliáveis: payloads não recebidos |
| Timestamp e idade de pool | Não avaliáveis: sem campos reais de origem |
| Compras/vendas | Não avaliáveis; o sistema distingue transações de compradores únicos |
| Concentração e autoridades | Não avaliáveis: RPC não alcançado |
| Scores e risco individual | Nenhuma avaliação real produzida |
| Deduplicação de contratos reais | Pendente: não houve contrato recebido |
| Histórico após saída do ranking | Pendente: não há contrato real persistido nesta máquina |
| Atualização de moedas anteriores | Pendente: nenhum token existente para reconsultar |
| Dados ausentes | Coleta e relatório indicam ausência; não substituem por zero financeiro ou nota |

Persistência/deduplicação e fórmulas têm cobertura de testes com fixtures; **isso não comprova persistência de dados reais**. Integridade de um banco vazio tampouco comprova retenção de tokens.

## Jupiter e simulador

Jupiter permaneceu inacessível na sondagem real. `JUPITER_API_KEY` está ausente; a checagem foi somente de presença. O adaptador existente requer essa configuração no backend. Não é possível confirmar nesta execução se as respostas anteriores vieram de uma rota pública diferente ou de outro contexto autenticado.

Não houve cotação real de compra ou saída recebida pelo sistema, nem posição simulada registrada. Slippage, impacto, `otherAmountThreshold`, taxas e possibilidade de saída permanecem **pendentes de validação com respostas reais**. A taxa de rede configurada continua sendo hipótese explícita, não uma taxa observada de transação. Não removi verificações ou gerei estimativas com preço de gráfico para aparentar sucesso.

## Bluesky

Integração indisponível nesta máquina: CONNECT 403. Não houve menções, autores, crescimento ou narrativas confirmados. X, Reddit e Telegram continuam sem integração. Uma resposta vazia, se futura consulta funcionar, só validará o acesso à busca; não demonstrará uma narrativa.

## Correção e testes

Alteração pontual em `server/collector.py`:

- execução única com `partial` e zero observações: saída **2**;
- erro interno na execução única: saída **1**, em vez de sucesso silencioso;
- rodada parcial com observações úteis: preserva saída 0 e o status JSON `partial`;
- `not_due` e `busy`: continuam sendo no-ops normais;
- conexão do banco é encerrada no `finally`;
- nenhuma mudança nos adaptadores, filtros ou estratégias.

**Checagens executadas e aprovadas:** build, TypeScript, lint, **73 testes de backend** e **seis testes de navegador desktop/mobile**. Os seis novos testes de regressão do CLI usam mocks identificados; não são usados para provar acesso ao mercado. A reprodução externa antes/depois da correção é a evidência real do código de saída.

## Pendências para validar descoberta

1. Disponibilizar nesta conversa o ambiente/rota em que as APIs responderam com dados reais, ou aplicar os hosts na política da máquina atual. A configuração salva/publicada para futuras tarefas não modifica automaticamente esta execução.
2. Repetir o coletor, arquivar payloads públicos e confrontar valores normalizados com as respostas de origem.
3. Reabrir o banco e verificar contratos, fontes, deduplicação e histórico; comparar coletas futuras sem apagar registros.
4. Aguardar amostras suficientes para aceleração e baseline para retomada. Ausência de sinal positivo não autoriza alterar os critérios.
5. Confirmar acesso gratuito e autenticação Jupiter, então testar somente cotações e saídas estimadas, sem transações.

**Nenhum deploy, negociação automática, merge, alteração da main ou dado de demonstração foi utilizado. A validação real de descoberta não está aprovada.**
