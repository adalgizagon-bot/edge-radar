# Rechecagem após autorização informada dos domínios

Verificação iniciada em 13/11/2026 às 20:57:41 (Brasília), a partir de `9ff9d1f`, na branch `rebuild/memecoin-radar-v1`. O checkout estava limpo e foi preservado. Nenhuma funcionalidade foi refeita e nenhum arquivo ou dado anterior foi apagado.

Última confirmação após a atualização de contexto: **13/11/2026 às 21h00 de Brasília** (14/11 às 00h00 UTC). Mesma máquina, mesma revisão 1, lista personalizada vazia e nova chamada DEX com CONNECT 403.

## Resultado da conectividade real

O usuário informou que os domínios foram autorizados. A nova verificação mostra que essa atualização **ainda não está ativa na máquina desta conversa**:

- `environment_status`: observações atuais, rede restrita/enforced, revisão solicitada e observada **1**, `allowed_hosts=[]`;
- rascunho: revisão **4**, contendo os dez domínios, base de configuração igual à versão antiga em execução;
- snapshot do executor em `/etc/codex/network-policy.json`: regras do preset de gerenciadores de pacotes, sem os dez hosts;
- status vivo do proxy, consultado pela rota de diagnóstico documentada: nenhum dos dez hosts aparece na política retornada;
- novas conexões HTTPS: oito endpoints de dados e cinco documentações retornaram **CONNECT 403**;
- controle permitido `registry.npmjs.org`: **HTTP 200**, JSON válido.

Não é possível concluir em qual tela/versão a atualização foi feita pelo usuário. A evidência permite afirmar apenas que esta máquina continua com a política anterior. A ferramenta para alterar diretamente o runtime (`request_changes`) não está disponível nesta conversa. Salvar novamente o mesmo rascunho não aplicaria a política.

| Fonte | Consultas reais | Resultado observado |
|---|---|---|
| DEX Screener — `api.dexscreener.com` | perfis recentes e preços por contrato | CONNECT 403 nas duas |
| GeckoTerminal — `api.geckoterminal.com` | pools novos e pools em tendência | CONNECT 403 nas duas |
| Solana — `api.mainnet-beta.solana.com` | getAccountInfo e getTokenLargestAccounts | CONNECT 403 nas duas |
| Bluesky — `public.api.bsky.app` | searchPosts pelo contrato exato | CONNECT 403 |
| Jupiter — `api.jup.ag` | quote USDC→WSOL, sem transação | CONNECT 403; chave opcional ausente |

Documentações: `docs.dexscreener.com`, `apiguide.geckoterminal.com`, `solana.com`, `docs.bsky.app` e `dev.jup.ag` também receberam CONNECT 403. Não houve resposta HTTP das APIs; autenticação, cotas, WAF e contratos dos fornecedores permanecem desconhecidos.

Arquivo das provas: `.runtime/validation/network-probes-20261113T235741718430.json`. O diagnóstico usou proxy e TLS normais. A consulta interna ao status do proxy foi somente leitura, conforme a orientação de networking do ambiente; nenhuma restrição foi contornada e nenhuma chamada financeira foi executada.

## Resultados reais de cada radar

| Radar | Moedas reais recebidas nesta tentativa | Qualidade dos dados financeiros | Validação real |
|---|---:|---|---|
| A — moedas novas | 0 | Não avaliável: nenhum payload de mercado recebido | Bloqueada no acesso aos pools/perfis |
| B — aceleração | 0 | Não avaliável: sem sequência real comparável | Bloqueada; precisa de ≥3 amostras, separadas por ≥5 min |
| C — retomada | 0 | Não avaliável: sem baseline real | Bloqueada; precisa de histórico de 24–48 h |

Esses zeros representam **ausência de dados por bloqueio**, não ausência de oportunidades no mercado e não uma validação negativa dos detectores. Nenhum score, volume, liquidez, comprador ou risco foi confirmado com dados reais. Não foram alterados thresholds para produzir sinais artificiais.

## Persistência, risco, social e simulador

- Banco existente: `integrity_check=ok`, em leitura somente leitura. Zero tokens, snapshots, avaliações, auditorias on-chain, posts e operações. Nada foi apagado; o banco já estava vazio.
- Persistência de moedas reais fora do ranking: pendente, pois nenhum contrato foi recebido. Os testes com fixtures continuam separados da comprovação real.
- Risco: RPC não alcançado; autoridades, concentração e programa SPL não foram validados com respostas reais.
- Social: Bluesky não alcançado. Nenhuma menção ou narrativa comprovada. X, Reddit e Telegram continuam sem integração.
- Simulador: Jupiter não alcançado e `JUPITER_API_KEY` ausente (somente presença verificada). Sem cotação real, sem simulação de entrada/saída. Custos, slippage e execução estimada permanecem testados com fixtures, não validados no mercado.

## Todos os testes executados nesta continuação

| Checagem | Resultado |
|---|---|
| Build | Passou |
| TypeScript | Passou |
| ESLint / Ruff / formatação Python | Passou |
| Backend | **67 testes passaram** |
| Navegador desktop/mobile | **6 testes passaram** |
| Diagnóstico de conectividade externa | **Bloqueado**, exit code 2; controle HTTP 200 |
| Integridade do SQLite existente | `ok` |

Os testes internos incluem mocks e fixtures identificados; não são usados como prova de funcionamento com mercado real. Nenhum teste foi removido ou desabilitado.

## Ação que falta para retomar a validação

Aplicar a rede **no ambiente em execução desta conversa**, preservando as regras existentes. Se a alteração foi feita apenas na configuração publicada para futuras tarefas, ela não modifica automaticamente esta máquina. Não é preciso cadastrar os mesmos domínios de novo: eles já estão no rascunho.

Após a política efetiva conter os dez hosts, confirmar com novas conexões e executar a sequência de validação real documentada em [LIVE_VALIDATION.md](LIVE_VALIDATION.md). A descoberta só poderá ser comprovada com payloads reais; aceleração e retomada exigem observações futuras, sem backfill inventado. O simulador continua exclusivamente de leitura/paper trading. Nenhum deploy em produção foi realizado.
