# Otimização de CPU do staging — 14/11/2026

Base: `507d7b7`, branch `rebuild/memecoin-radar-v1`. Worker otimizado: `edge-radar-monitor-staging`, versão `d6685060-dbfe-4d61-ace1-6772520191ed`. D1 exclusivo: `9f2f5da7-fa94-4a66-afc8-664e958cd80e`. Nenhuma nova coleta foi ativada.

## 1. Diagnóstico: evidências e limites

As duas invocações do primeiro piloto não permitem identificar um único gargalo de CPU. A revisão encontrou operações redundantes e o benchmark mediu sua remoção; não há perfil de CPU por função da Cloudflare para atribuir os 10,186 ms a um componente específico.

- **Rodada vazia:** o código antigo fazia oito chamadas ao adaptador D1: autorização, lease, releitura do estado, duas filas completas, pesquisa, batch de gravação e fechamento. Mesmo sem contratos, gravava `monitor_runs`, reservava amostras/escritas e atualizava o estado. O cenário SQLite confirma essas operações; não é apenas uma hipótese de leitura de código.
- **Tick desativado:** `scheduled()` chamava `probe()` a cada minuto, lendo o D1 mesmo sem solicitação pendente. Isso não inicia coleta, mas é trabalho dispensável. A versão nova precisa de `SHUTDOWN_PROBE_ENABLED=true` para executar essa sonda; o desligamento por expiração é independente dessa flag e continua obrigatório.
- **Catálogo:** as consultas carregavam `recent` e todos os campos de até 64 registros de rotação, além de 12 prioritários, antes de saber quais teriam observação. No cenário de prioritários, o adaptador retornou 452.243 bytes de arrays JSON; agora retorna 55.369. Não são bytes exatos de tráfego faturado D1, mas representam a mesma projeção SQL sob o mesmo adaptador.
- **Pesquisa:** havia consulta de coortes mesmo sem observações novas; coortes sem horizonte devido eram carregadas e seus resultados/observações podiam ser consultados inutilmente. A serialização de `recent` era imediatamente desfeita para detectar sinais. SQL de baseline e JSON do protocolo eram reconstruídos a cada candidato.
- **Respostas:** a versão anterior normalizava cada par DEX, inclusive perdedores e contratos fora do lote. Gecko materializava arrays completos para depois admitir somente dois contratos. A nova seleção reduz objetos intermediários sem mudar o par vencedor nem os campos preservados.
- **Política:** `choose()` já opera em filas limitadas e suas ordenações não foram demonstradas como gargalo. Os critérios de prioridade, pins, bursts e os cálculos de `transition()` foram preservados; o histórico em memória passou a ser reaproveitado.
- **Inicialização:** a consulta GraphQL da versão antiga identifica CPU principal de 10,186 / 3,735 ms e CPU de startup separada de 11,104 / 9,450 ms. O schema define `startupCpuTimeUs` separadamente de `cpuTimeUs`; não somei nem atribuí o pico principal ao startup. A importação de política e pesquisa foi adiada até existir trabalho. O bundle gerado confirma inicializadores tardios, mas seu tamanho cresceu de 32,18 para 38,35 KiB: não há demonstração de redução universal do startup.

## 2. Caminho leve e processamento

`MONITOR_ENABLED=false` retorna sem D1 e sem carregar os módulos de política/pesquisa. Com autorização válida, uma única consulta leve combina estado, prazo e verificações indexadas de trabalho devido. Ela não retorna prova JSON, histórias do catálogo ou payloads de coortes. `CASE` impede consultar filas quando a autorização não está válida, há pausa/limite atingido ou não há slot de despacho.

Se não há descoberta devida, contratos elegíveis, manutenção de prioritários ou resultado de pesquisa devido, retorna `idle`: sem lease, reserva, rodada de análise ou gravação. O tick continua fazendo a verificação indispensável de segurança. As leituras desses caminhos sem gravação continuam sendo faturadas/medidas pelo D1; contadores de rodadas não substituem as métricas compartilhadas da conta.

Descoberta continua nos múltiplos de 900 segundos; rotação continua a cada 180 segundos; bursts mantêm as mesmas condições e limites. Uma resposta vazia de descoberta ainda registra a tentativa real. Nenhuma evidência histórica é apagada. Cooldowns não criam novas rodadas repetindo o mesmo erro, mas o erro inicial e seu prazo persistido são preservados.

A lease usa `UPDATE ... RETURNING`, eliminando uma releitura. As filas retornam apenas metadados. Históricos completos são buscados pelos IDs que efetivamente produziram observação. A rotação filtra `next_at<=?` antes do limite de 64; isso corrige a situação em que 64 registros futuros ocultavam um contrato vencido, preservando a ordem de justiça entre os elegíveis.

Gecko mantém a primeira admissão válida de até dois contratos distintos. DEX examina todos os pares retornados para escolher a maior liquidez por contrato; só então normaliza os vencedores, até o limite de contratos já existente. Campos de origem, horário, cache, desconhecidos e histórico permanecem iguais. O parse do JSON inteiro do provedor ainda é necessário; não trunquei respostas para fabricar uma economia de CPU.

Pesquisa usa horizontes do protocolo congelado da própria coorte e índices existentes. Controles sem par continuam finalizados sem esperar o horizonte do alerta. Histórias recentes são reutilizadas em memória; aceleração já confirmada não consulta um baseline de revival; amostras de resultado são filtradas/ordenadas uma vez por braço. O protocolo estatístico e as hipóteses de custos não mudaram.

`EXPLAIN QUERY PLAN` confirmou `catalog_due`, `catalog_tier`, `research_pending` e os índices únicos de observações/resultados. A rotação ainda usa uma árvore temporária para ordenar os registros devidos por justiça; o índice filtra o intervalo, não cobre toda a ordenação. Não criei índices ou tabelas novos nesta otimização.

Não separei descoberta, cotação e pesquisa em Workers ou execuções adicionais: isso exigiria mais leases/checkpoints D1 e poderia separar temporalmente alerta e controle. Só faz sentido considerar essa divisão após medir coleta real suficiente, preservando o protocolo de pareamento e o orçamento compartilhado.

## 3. Testes aprovados

- 29 testes Node do monitor, com SQL real em SQLite: vazio, descoberta pontual, contratos existentes/prioritários, coortes e controles, cooldown 429, pausa por 403, dados malformados, falhas, armazenamento, leitura/escrita, lease concorrente, expiração durante resposta, evento atrasado e autorização imutável.
- 98 testes de backend Python. O teste de preflight que assumia um UUID ainda não configurado foi isolado com configurações temporárias: agora testa tanto placeholder como UUID configurado, sem confundir configuração com autorização de deploy.
- ESLint completo das áreas configuradas, Ruff das alterações Python, formato e `git diff --check`.
- Integração D1 de staging: nova consulta de cabeçalho executada com sucesso, duas linhas lidas e zero escritas no estado pausado; sintaxe de `RETURNING` validada com `WHERE 0`, zero alterações.
- Benchmark de 13 cenários × 5 repetições × duas versões. `assert.deepEqual` confirmou paridade de catálogo, observações, coortes e resultados completos; as chamadas de provedores também foram iguais. A retirada de logs de rodadas vazias é intencional. O caso adicional de contrato vencido após 64 futuros é coberto por teste de regressão.

## 4. Benchmark local

Reprodução: `node scripts/benchmark_monitor.mjs 507d7b7 5`.

São fixtures sintéticas, SQLite e respostas JSON pré-serializadas; nenhuma API real é chamada. CPU abaixo é a mediana do processo Node menos a CPU medida dentro do adaptador de teste. É uma aproximação com ruído de runtime/GC/processos filhos. Tempo de parede inclui subprocessos Python/SQLite. Nenhum desses números comprova CPU na Cloudflare. Batch conta como uma chamada D1, embora contenha várias instruções SQL.

| Cenário | Chamadas D1, antes → depois | Bytes JSON retornados, antes → depois | CPU JS local, µs, antes → depois |
|---|---:|---:|---:|
| `disabled_tick` | 1 → 0 | 158 → 0 | 107 → 58 |
| `expired` | 1 → 1 | 158 → 423 | 65 → 94 |
| `empty_rotation` | 8 → 1 | 581 → 423 | 425 → 95 |
| `future_catalog` | 8 → 1 | 413,508 → 423 | 1207 → 148 |
| `empty_discovery` | 8 → 4 | 582 → 839 | 1001 → 1210 |
| `discovery_many_pairs` | 9 → 7 | 596 → 857 | 3926 → 3325 |
| `requery` | 16 → 16 | 413,556 → 54,164 | 2765 → 2082 |
| `priority` | 16 → 16 | 452,243 → 55,369 | 2983 → 2051 |
| `alerts_controls` | 10 → 9 | 5,317 → 4,062 | 958 → 1393 |
| `pending_outcomes` | 11 → 8 | 5,840 → 6,099 | 570 → 851 |
| `future_outcomes` | 9 → 1 | 2,092 → 423 | 330 → 54 |
| `api_failure` | 8 → 6 | 413,508 → 2,497 | 2139 → 725 |
| `expiry_during_response` | 7 → 4 | 576 → 835 | 1273 → 1171 |

O ganho é claro no caminho ocioso e no volume de históricos transferidos. Não é universal: algumas medianas de descoberta vazia, alertas e resultados pendentes ficaram maiores, apesar da redução de chamadas. Essas amostras pequenas e de baixo tempo absoluto não identificam o gargalo nem autorizam concluir que toda coleta ficará abaixo de 10 ms. A evidência completa, com wall time, mutações e fingerprint do código, está em `evidence/cpu-optimization-local.json`.

## 5. Proteções e validação Cloudflare desativada

`MONITOR_ENABLED=false` e `SHUTDOWN_PROBE_ENABLED=false` foram verificados remotamente. Binding `MONITOR_DB` aponta exclusivamente para o UUID de staging. Sem rotas públicas ou URLs de preview. A autorização consumida e seu registro de auditoria permanecem byte a byte iguais aos resultados anteriores; nenhuma janela nova foi criada, nenhum prazo foi alterado e nenhuma pausa foi removida.

Continuam: prazo máximo de 1.800 segundos; relógio atual em vez de horário do evento para a autorização; verificação antes de cada chamada de provedor; timeout limitado ao prazo restante; guarda transacional antes das observações; bloqueio de dono de lease obsoleto; proibição de estender/reutilizar a autorização consumida; tetos de leituras, escritas, reserva, amostras e armazenamento. A lease agora também exige autorização ainda válida no relógio do D1. As proteções nativas do Workers Free e as configurações de cobrança não foram alteradas.

Validação de dados remota: `quick_check=ok`, nenhuma violação de chave estrangeira, zero observações e a mesma única rodada do piloto anterior. Workers antigos mantêm os metadados; identidades/configurações D1 antigas também foram preservadas. A variação de tamanho do banco antigo ocorre durante sua atividade existente, sem consultas de escrita, migrações ou deploys direcionados a ele nesta tarefa.

As métricas GraphQL usam o nome e o UUID exatos da versão nova. O relatório separa CPU de execução e startup, e não incorpora `__unknown__` ou outras versões. Valores finais da amostra desativada estão no bloco abaixo e em `evidence/cpu-optimized-disabled.json`.


Amostra até `2026-11-14T11:53:58.275402+00:00`: **5 invocações**, **0 erros**, **0 subrequisições**. CPU principal p50/p95/p99: **1.290 / 2.002 / 2.002 ms**; máximo **2.002 ms**. Startup máximo: **16.297 ms**, separado da CPU principal. Wrangler reportou startup de 3 ms na publicação. Esta amostra é pequena e **apenas do monitor desativado**; não comprova a CPU da descoberta/reconsulta otimizada em produção.

## 6. Plano do segundo piloto — não ativado

1. Revisar estas alterações e preparar uma **nova autorização com ID independente e auditoria**, preservando a primeira autorização consumida e sua imutabilidade. O esquema atual não permite simplesmente atualizar sua janela; não remover essa proteção. Qualquer migração para múltiplas autorizações deve manter cada prazo individual imutável e o limite de 30 minutos.
2. Repetir os testes de expiração/timeout/rollback com a nova autorização ainda fechada, além da sonda de binding sem coleta. Validar Worker/versão e margem nas cotas compartilhadas; manter tudo desativado até os testes e a autorização para esse segundo piloto estarem concluídos.
3. Escolher um quarto de hora `T` após a preparação. Abrir a janela em `T−10s` e expirar em `T+29m50s`, sem ampliar o limite de 1.800s. Assim cobre descoberta em `T` e `T+15m` e deixa a terceira descoberta fora da janela. Se a preparação atrasar, escolher outro `T` **antes de armar**; nunca estender uma janela consumida. Exemplo candidato após esta entrega: 09h00 de Brasília, somente se houver nova autorização e preparação concluída a tempo; caso contrário, o próximo quarto de hora.
4. Observar métricas exatas da versão a cada 30–60s, separando ticks ociosos, descoberta, reconsulta e pesquisa; guardar CPU principal e startup, máximo/p50/p95/p99, status/erros, subrequisições e métricas D1. Manter o orçamento conservador de 10 ms e pausa preventiva, levando em conta que o GraphQL tem atraso. Não confundir ausência momentânea de amostra com consumo zero.
5. Preservar os limites atuais e folga compartilhada. Não aumentar lotes, eliminar campos, reduzir evidências ou habilitar cobrança para forçar êxito. Se CPU real continuar alta, interromper e perfilar o caminho identificado antes de nova tentativa.
6. Após expirar, observar pelo menos dois ticks, confirmar nenhum aumento de observações/rodadas de coleta, verificar integridade e restaurar explicitamente a flag falsa. Não declarar operação contínua validada com somente um piloto de 30 minutos.

Nenhum horário acima é agendamento ou ativação. A validação de CPU com mercado real e a capacidade de operação contínua no Free continuam pendentes.
