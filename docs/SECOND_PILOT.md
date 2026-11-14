# Segundo piloto de staging — preparação em 14/11/2026

Base: `7ff6f6e`, branch `rebuild/memecoin-radar-v1`. Somente `edge-radar-monitor-staging` e D1 `9f2f5da7-fa94-4a66-afc8-664e958cd80e`.

A migração 0006 acrescenta `pilot_authorizations`, preservando integralmente `pilot_control` e `pilot_authorization_log`. O Worker seleciona um ID explícito pelo ambiente; ID inexistente/pendente/parado nunca volta à autorização antiga e não há rotação automática para outro piloto. Identidade, prazo e prova de desligamento são imutáveis; consumo e parada não podem ser desfeitos. A ativação exige horário real dentro da janela e referência a uma prova concluída pelo Worker. Uma autorização de teste nunca pode ser ativada para coleta.

Autorização independente do segundo piloto: `d35d8e42-4d3d-4a4e-8240-de1f826aff2a`. Janela fixa: 12:14:50–12:44:50 UTC / 09:14:50–09:44:50 America/Sao_Paulo. Oportunidades planejadas de descoberta: 12:15 e 12:30 UTC. Não prolongar nem executar terceiro piloto automaticamente.

Prova independente de desligamento: `c0a72058-f9e4-4f91-bf8f-6334683938f6`, `kind=shutdown-test`. Versão da sonda: `35431d73-e8b8-4c45-86ba-77474cc4936d`. O próprio Worker registrou `pilot_expired`, zero chamadas externas, leitura/escrita e quick_check=ok. CPU principal dessa execução: 5,325 ms; startup separado: 6,836 ms. O modo de teste não ativa coleta.

34 testes do monitor e 98 testes Python passaram. Casos novos incluem prova obrigatória, ID sem fallback, ativação antecipada rejeitada, janela máxima, consumo único, prazo imutável, parada permanente, rollback durante resposta e expiração com tempo real decorrido. No D1 remoto foram também verificadas rejeições esperadas de extensão, ativação antecipada e exclusão, sem mudança no registro. ESLint e git diff --check passaram.

A versão operacional inicial usa a mesma otimização de CPU mais seleção de autorização independente e metadados de tentativas HTTP para o relatório. `discovery_attempted`, status HTTP Gecko/DEX, candidatos e `dex_attempted` são persistidos em cada rodada efetiva; erros de transporte também preservam a fase atingida. Esses campos não alteram a seleção ou qualidade das observações.

Antes da ativação: conta com aproximadamente 1.017 invocações, 794.132 linhas D1 lidas e 10.804 escritas hoje, abaixo das cotas Free previamente confirmadas pelo proprietário. Limites internos e nativos foram mantidos. Nenhuma chamada de Billing, compra, upgrade ou operação financeira foi realizada.

A flag de implantação pode ser preparada enquanto a sessão continua `consumed=0`. A coleta somente passa a ser autorizada ao consumir esse ID no D1, a partir de 12:14:50 UTC. O prazo fixo corta requests/commits mesmo sem esta tarefa em execução. A pausa operacional antiga de CPU só será liberada para essa nova autorização, sem zerar contadores, excluir histórico ou elevar limites.

Acompanhamento: GraphQL com Worker e versão exatos, CPU de execução separada de startup, status/erros/subrequisições; metadados e telemetria D1; contratos, observações, rodadas, respostas dos provedores e classificações. Pausa preventiva se CPU principal máxima >10.000 µs, erro crítico, proteção acionada, falta de métricas ou folga compartilhada insuficiente. GraphQL tem atraso; ausência momentânea de amostra não significa CPU zero.

## Resultado final — encerramento preventivo

A autorização foi consumida às **12:14:50 UTC / 09:14:50 de Brasília**, exatamente no início fixado. O observador registrou parada permanente às **12:15:52 UTC / 09:15:52 de Brasília**, após 62 segundos, devido a `pilot2_critical_round_failure`. A janela original até 12:44:50 não foi estendida. A oportunidade de descoberta de 12:30 estava na janela planejada, mas não foi executada porque a regra de interrupção prevaleceu.

| Item solicitado | Resultado efetivamente observado |
|---|---|
| Contratos reais descobertos/persistidos | **0**; nenhum contrato classificado |
| Observações persistidas | **0** |
| Rodadas | **1 tentativa de descoberta**, falha; **0 reconsultas**, nenhuma descoberta concluída |
| CPU principal máxima / p50 / p95 | **4,921 / 4,921 / 4,921 ms**, uma única invocação no intervalo efetivo |
| CPU de startup | **8,689 ms**, separada e não somada à CPU principal |
| D1 no intervalo efetivo consultado | **29 linhas lidas, 7 escritas**, 17 consultas de leitura e 7 de escrita reportadas pelo GraphQL, incluindo controle/observador |
| Armazenamento D1 | **102.400 bytes / 100 KiB** |
| Erros/limitações | **1 falha da aplicação**, nenhum status HTTP recebido, nenhuma tentativa DEX; GraphQL reportou zero erros nativos e zero subrequisições |
| Frequência entre observações | **Indeterminável**, pois não houve observações |
| Motivo da interrupção | Falha crítica antes de receber a resposta da primeira chamada GeckoTerminal; não foi excesso de CPU |

A versão ativa durante o piloto foi `0b9285ae-954a-44c3-9f1e-976f9ce72f98`. A consulta de CPU usa esse UUID, nome exato e intervalo 12:14:50–12:15:52 UTC. Não inclui a sonda, os ticks pendentes anteriores nem as versões desativadas posteriores. Uma amostra não permite estimar percentis representativos de uma coleta contínua; p50/p95 aqui refletem somente esse único evento.

O D1 preservou uma rodada nova (`id=2`, `status=failed`) com `discovery_attempted=true`, `discovery_http_status=null`, `discovery_candidates=[]`, `dex_attempted=false` e o marcador `transport_schema_or_storage_failure`. A rodada original (`id=1`) permanece. Os contadores internos cumulativos de rodadas passaram de 10/7 para 20/12 leituras/escritas, com margens conservadoras do código: não são uma medição de faturamento independente e não substituem a telemetria D1 acima.

A consulta de consumo usa a granularidade/latência disponibilizada pela Cloudflare e o UUID exato do novo banco. Exclui os outros bancos e não atribui seu consumo ao staging. Preparação, migração e diagnóstico posteriores estão fora desse intervalo; não são uma suposta coleta bem-sucedida.

## Diagnóstico de compatibilidade e correção sem nova coleta

O erro bruto de produção não foi persistido pelo catch original; o marcador é genérico. Não o interpretei como HTTP 403, 429 ou indisponibilidade comprovada do GeckoTerminal. Na investigação posterior, o mesmo padrão de chamada foi executado no Workerd local, com a mesma data de compatibilidade, sem acessar provedores: `redirect: "error"` foi rejeitado antes da requisição:

> TypeError: Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code).

Isso reproduz uma incompatibilidade concreta do caminho do coletor e é consistente com a falha antes de status HTTP e as zero subrequisições reportadas. Não é uma stack recuperada da execução de produção. `AbortSignal.any` e `AbortSignal.timeout` estavam disponíveis no runtime local; não atribuí o erro a eles.

Os testes anteriores em Node aceitavam `redirect: "error"` e não detectaram essa diferença do Workers. Corrigi ambos os provedores para `redirect: "manual"` com pausa explícita `provider_redirect` em qualquer resposta 3xx. Assim, redirects continuam bloqueados, não seguidos. O teste local no Workerd retornou 200 para fixture, 302 para redirect e confirmou que o destino não foi seguido; somente loopback local foi usado.

35 testes do monitor passaram após a correção, incluindo os dois caminhos de redirect. Os 98 testes Python anteriores e o lint passaram. A versão corrigida foi publicada **somente desativada**, UUID `d05c6bf9-3b8d-4e15-9842-c56c6281e817`. Nenhuma chamada real de mercado foi repetida e nenhuma terceira autorização foi criada/ativada.

## Confirmação de encerramento e preservação

A autorização independente permanece `consumed=1`, `stopped_at=1794658552`, `stop_reason=pilot2_critical_round_failure`; a parada não pode ser desfeita. `MONITOR_ENABLED=false`, `SHUTDOWN_PROBE_ENABLED=false` e o ID explícito da sessão encerrada foram verificados remotamente. Não existe seleção automática de outra autorização.

Consultas repetidas até 12:24:12 UTC confirmaram zero contratos, zero observações e exatamente duas rodadas históricas (uma de cada piloto). A versão desativada intermediária `c2f66fd5-dd31-4e58-a43b-4043fbaa309d` teve pelo menos três invocações observadas, com zero subrequisições e nenhum aumento das coletas. `quick_check=ok` e `foreign_key_check` vazio. A expiração natural de 12:44:50 não precisou ser aguardada: houve parada permanente antecipada; a expiração foi testada antes da ativação, não alegada como uma segunda execução real completa.

A primeira autorização e sua auditoria foram comparadas com o snapshot anterior e permaneceram integralmente iguais. Os Workers antigos mantêm todos os metadados. Os bancos antigos mantêm identidades/configurações; o crescimento de `file_size` de edge-radar-crypto durante a tarefa corresponde à atividade já existente, sem escrita, migração ou deploy desta tarefa nesses recursos. Main e cobrança não foram alteradas.

## Recomendação técnica

Manter o staging desativado. **Este piloto não validou a viabilidade de coleta contínua no Workers Free**, pois nenhuma resposta real chegou a ser processada. A CPU principal de 4,921 ms está abaixo do orçamento, mas mediu somente o caminho que falhou antes da chamada, não descoberta, normalização e pesquisa com mercado real. O erro reproduzido é de compatibilidade de API e não justifica contratar um plano pago.

A correção está preparada e testada localmente, sem comprovação de coleta real pós-correção. Um eventual terceiro piloto precisa de nova autorização explícita e independente, mantendo os mesmos limites e medição por versão; não será iniciado automaticamente. Nenhuma frequência de mercado, qualidade de classificação ou capacidade contínua deve ser inferida dos zeros deste ensaio.
