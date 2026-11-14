# Terceiro piloto controlado — 14/11/2026

Base: `cd5f87b`, branch `rebuild/memecoin-radar-v1`. Exclusivamente Worker `edge-radar-monitor-staging` e D1 `9f2f5da7-fa94-4a66-afc8-664e958cd80e`.

## Resultado

**O GeckoTerminal retornou HTTP 429, não 200.** O coletor alcançou uma chamada externa real após a correção de redirect, mas não recebeu dados de contratos. Não houve consulta DEX nem observação de mercado. O monitor encerrou a sessão ao obter a CPU principal de **10,417 ms**, acima do orçamento conservador de 10 ms.

| Pergunta | Evidência do piloto |
|---|---|
| GeckoTerminal respondeu 200? | **Não: HTTP 429**, registrado no D1 |
| Quantos contratos reais foram recebidos? | **0 recebidos/admitidos neste ensaio**; a resposta não foi uma página válida de contratos |
| DEX Screener retornou dados válidos? | **Não foi consultado**, pois não havia candidatos |
| Contratos e observações gravados? | **0 contratos, 0 observações**; sem classificações fabricadas |
| CPU máxima de execução? | **10,417 ms**; p50/p95/p99 também 10,417 ms por haver uma única amostra no intervalo efetivo |
| CPU de startup? | **18,436 ms**, separada da CPU principal; não somada ao orçamento de execução |
| Consumo D1 reportado? | **36 linhas lidas e 10 escritas**, 22 consultas de leitura e 10 de escrita, incluindo controle/observador |
| Erros/limitações? | Uma resposta Gecko HTTP 429; uma subrequisição externa confirmada; zero erros nativos de execução Cloudflare; orçamento conservador de CPU excedido em 0,417 ms |
| Coleta desativada ao final? | **Sim**, `MONITOR_ENABLED=false`, sessão consumida e permanentemente parada |

O intervalo real foi **14:14:50–14:16:24 UTC / 11:14:50–11:16:24 America/Sao_Paulo**, 94 segundos. O prazo original imutável era 14:24:50 UTC / 11:24:50, exatamente 600 segundos após o início. Não houve prorrogação. A autorização foi consumida no segundo previsto, cerca de dez segundos antes da descoberta programada de 14:15.

A versão ativa foi `388fc444-358b-4f76-a320-98cc9dfad7d0`. A consulta GraphQL de CPU usa o nome e UUID exatos e termina em 14:16:24, excluindo sonda, ticks pendentes e versões desativadas. É uma amostra de processamento de uma **resposta de erro HTTP**, não de normalização/pesquisa com dados válidos. Não extrapolar percentis ou capacidade contínua a partir dela.

A sessão registrou primeiro `stop_reason=pilot3_cpu_budget` e `stopped_at=1794665784`. A intenção de encerrar também por HTTP 429 ocorreu quando esse stop automático já estava persistido; não substituiu o motivo imutável. A pausa operacional foi alinhada com esse motivo. O backoff Gecko foi mantido, sem forçar uma segunda tentativa. A próxima oportunidade de descoberta original seria 14:30, fora da janela autorizada de dez minutos.

## Verificações antes de abrir a sessão

- Versão corrigida existente `d05c6bf9-3b8d-4e15-9842-c56c6281e817` verificada no staging, com binding exclusivo e monitor desativado. O GraphQL já retornava CPU/status exatos dessa versão.
- **Quatro testes reais no Workerd local passaram:** HTTP 200, 302 sem seguir o destino, timeout de requisição e conexão de rede recusada. A fixture importa as mesmas funções de timeout/deadline/redirect usadas pelo coletor. Somente loopback local, sem APIs de mercado, D1 remoto ou autorização de coleta.
- **36 testes do monitor passaram**, incluindo validade/imutabilidade, rollback, expiração, orçamento de 600 segundos, redirects e classificação de erro sem mensagens/URLs/credenciais brutas. ESLint passou após excluir os artefatos temporários gerados pelo Wrangler. Os 98 testes de backend também passaram.
- Nova prova de desligamento `2c4a7d15-0e96-4d45-bd19-6ff209cdbace`, tipo `shutdown-test`, concluída pelo próprio Worker: `pilot_expired`, leitura/escrita, `quick_check=ok`, zero chamadas externas. A versão `b99dac91-6878-4d75-839e-00c6c9745482` teve CPU principal de 4,339 ms e zero subrequisições nessa prova. Ela é distinta das métricas do piloto ativo.
- Nova autorização independente **`f76a47ef-7d0d-45ae-89ef-3f736b112307`**, com prazo de 600 segundos e referência à prova imutável. O D1 rejeitou extensão de prazo e ativação antecipada. Não houve alteração de schema nem necessidade de remover guards.
- `PILOT_MAX_SECONDS=600` acrescenta um teto também na verificação do Worker; valor inválido ou autorização mais longa falham fechados. Timestamps e consumo no D1 continuam imutáveis; nenhuma seleção automática de outra sessão foi acrescentada.
- Cotas compartilhadas antes do piloto: 1.296 invocações, 946.656 linhas D1 lidas e 13.380 escritas no dia, abaixo dos limites Free informados pelo proprietário. Nenhum acesso Billing, upgrade, serviço pago ou limite aumentado.

O limite máximo de 600 segundos e o prazo persistido no D1 independem da continuidade desta tarefa. A parada antecipada é ainda mais restritiva. A expiração natural não foi aguardada nem declarada como piloto completo; a expiração foi testada antes da ativação e a parada permanente foi observada depois.

## Histórico e diagnóstico

Foi acrescentada apenas uma rodada efetiva, `monitor_runs.id=3`, com status `partial` e os campos:

- `discovery_attempted=true`, `discovery_http_status=429`;
- `discovery_received_pools=0`, `discovery_received_contracts=0`, candidatos vazios;
- `dex_attempted=false`, `dex_http_status=null`, `dex_pairs_received=0`;
- `observations=0`, erro de provedor `geckoterminal:429`.

Não interpretei os zeros como ausência de oportunidades no mercado: a API não retornou uma resposta válida de descoberta. Os critérios de admissão, liquidez, prioridade, alertas e controles estatísticos não foram alterados para forçar resultado. A admissão continua limitada aos mesmos dois primeiros contratos elegíveis; a contagem de recebidos não muda a escolha.

A instrumentação agora preserva contagens de pools/contratos e pares recebidos, HTTP por provedor e, em falhas lançadas, `error_name`, `error_kind` e `failure_phase`. Apenas classificações fixas são persistidas; não mensagens brutas, URLs, headers ou credenciais. Timeout, aborto, rede, JSON inválido, schema inválido e armazenamento têm classes separadas. Nesta execução, 429 foi tratado como erro HTTP com backoff, e não como exceção genérica.

Os contadores internos cumulativos de rodadas passaram de 20/12 para 32/19 leituras/escritas, mas incluem margens conservadoras; não são o consumo de faturamento. A medição D1 de 36/10 usa o UUID do staging e o intervalo efetivo. Ela inclui ativação/observação/controle e usa a granularidade e atraso disponibilizados pela Cloudflare. Não inclui o consumo dos bancos antigos nem deve ser confundida com o custo total da preparação do dia.

## Encerramento verificado

Versão final publicada, **desativada**: `c603977c-17aa-40ae-8439-a548f45fd9cb`. `MONITOR_ENABLED=false`, `SHUTDOWN_PROBE_ENABLED=false`, ID da sessão encerrada explícito e `PILOT_MAX_SECONDS=600` confirmados remotamente. Dois ticks dessa versão já foram observados com zero subrequisições e zero erros.

Às 14:19:33 UTC, consultas repetidas confirmaram zero contratos, zero observações e **três rodadas históricas**, uma de cada piloto. Os registros anteriores de `monitor_runs`, `pilot_control`, `pilot_authorization_log` e das autorizações do segundo piloto foram comparados integralmente e continuam iguais. `quick_check=ok`, sem violações de chave estrangeira.

Os Workers antigos mantêm os mesmos metadados e os bancos antigos mantêm identidades/configurações. A variação de tamanho de edge-radar-crypto corresponde à atividade que já existia; esta tarefa não escreveu nem fez deploy/migração nesses recursos. Main e cobrança não foram alteradas. Nenhuma negociação real foi habilitada.

## Recomendação

**Não habilitar operação contínua.** A correção de compatibilidade permite chegar ao provedor real, mas o HTTP 429 impediu validar descoberta e DEX; não há evidência de qualidade/frequência com mercado. A CPU ultrapassou o orçamento mesmo no caminho de resposta 429, portanto falta margem demonstrada para processar dados válidos.

Antes de outro ensaio, verificar a origem e os limites do 429 e respeitar o backoff, sem contornar cotas; investigar o custo de execução com medição suficiente, sem atribuir um gargalo a uma única amostra. Não há evidência aqui que justifique contratar plano pago nem que comprove viabilidade contínua no Free. Qualquer novo piloto exige nova autorização explícita; nenhum outro foi iniciado ou agendado.
