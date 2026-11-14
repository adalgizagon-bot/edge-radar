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

Resultados serão acrescentados após encerramento e confirmação de estabilidade/integridade.
