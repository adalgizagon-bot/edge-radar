# Etapa 2 — monitoramento persistente e avaliação observacional

## O que foi implementado

O checkout continua em `rebuild/memecoin-radar-v1`. O checkout legado e a main não foram alterados. O banco da primeira coleta foi mantido e copiado com a API de backup SQLite para uma base de validação; nenhuma migração de produção foi executada.

`server/tracking.py` adiciona tabelas sem apagar snapshots ou contratos: fila persistente, lacunas, alertas e resultados por horizonte. A fila reserva metade das consultas para os contratos há mais tempo sem tentativa e usa o restante para prioridade dinâmica. Aceleração recebe prioridade 100; retomada 80; liquidez >= US$20 mil, volume de 5min >= US$2 mil, pressão compradora >=60%, dados recentes e ausência de flags recebem 60. Demais contratos continuam na rotação, incluindo os inativos. Intervalos planejados: 5 min para promissores, 15 min para pools antigos e 30 min para os demais. O tick local de 3 min pode atrasar a consulta até o próximo tick. Uma falha aplica espera progressiva de até 1 h. O limite de 60 contratos da fila por rodada significa que universos grandes têm espera adicional: `next_at` não é uma garantia de SLA.

A descoberta periódica de candidatos continua independente do ranking dos já acompanhados. O coletor prioriza posições simuladas existentes (sem abrir novas por padrão), fila persistente, perfis e novos pools. Reconsulta até 90 contratos em lotes de 30. A chave `(mint, observed_at, source)` evita duplicar snapshots; cache mantém a data original e não cria nova evidência temporal. Preço, volume, liquidez, transações e compradores únicos são mantidos quando fornecidos. Compras de DEX são transações, não compradores únicos. Idade do token e carteiras relacionadas continuam desconhecidas; idade do pool não as substitui.

Aceleração exige três amostras da mesma fonte/pool, separadas por 5–15 min, janela <=40 min, volume crescente e +50%, compras +25%, liquidez estável acima do mínimo, preço não decrescente e pressão >=60%. Retomada exige pool com pelo menos três dias, baseline real de 24–48 h (>=6 amostras distribuídas em >=4 h), volume atual >=3 vezes a mediana, pressão >=60% e liquidez estável. Dados atuais e histórico recente consistente também são obrigatórios. Ausência de baseline nunca é preenchida retroativamente.

`/api/tracking` expõe fila, lacunas, alertas e resultados recentes. O painel Radar mostra continuidade e resultados; o detalhe explica histórico insuficiente e verificações pendentes. Resultados de atividade não autorizam compra.

## Alertas e horizontes

O alerta grava horário de emissão, horário do preço usado, preço observado, fonte, pool, tipo e avaliação imutável. Um tipo de alerta por contrato tem cooldown de 1 h. Não são gerados alertas retrospectivos ao importar histórico.

A avaliação busca a primeira observação da mesma fonte/pool entre o horizonte de 5, 15, 30 ou 60 min e mais 180 segundos. Registra o horário efetivo da amostra; depois do prazo, ausência vira `missing`. Preserva máximo ganho e mínima variação amostrados até o horizonte, número de amostras, maior intervalo sem amostra, cobertura e mínima liquidez observada. O baseline está incluído nos extremos. Essas estatísticas não são OHLC nem máximas de mercado contínuas; liquidez observada não equivale a liquidez executável. Resultados concluídos não são recalculados com dados tardios. Até 200 sinais pendentes são processados por rodada.

Antecipação, vantagem estatística, custos e retorno executável são perguntas diferentes. Será necessário acumular sinais futuros, comparar com movimentos anteriores e um grupo de referência definido antes da análise, tratar dados ausentes e evitar viés de sobrevivência. Não há conclusão estatística nesta entrega.

## RPC, 429 e auditoria incompleta

O endpoint público responde por IP e não oferece capacidade dedicada. A documentação Solana descreve limites por IP/método e orienta respeitar Retry-After, mas avisa que limites podem mudar. Como o radar fez poucas chamadas, IP compartilhado ou política específica por método são hipóteses; a resposta 429 isolada não identifica a causa exata. Nesta validação, `getAccountInfo` respondeu e `getTokenLargestAccounts` recebeu 429. Não houve tentativa de rodar vários endpoints para driblar a restrição.

O cliente mantém orçamento global de 6.000 tentativas/dia por banco, limite por rodada, reserva atômica de slots, uma requisição em andamento por provedor, intervalo RPC mínimo de 10 segundos, cache de 10 min por método/contrato e backoff exponencial com jitter. Aceita Retry-After em segundos ou data HTTP, inclusive >1 h, sem encurtá-lo. Cache conserva seu timestamp. Reservas podem consumir orçamento mesmo se a chamada for adiada; isso é conservador. Todas as instâncias precisam compartilhar o mesmo banco para compartilhar estes controles; não se trata de limite global dos outros usuários do IP do provedor.

Audita no máximo um contrato por rodada, com validade de 30 min. Se autoridades/supply forem obtidos e concentração falhar, a primeira parte fica salva. Cada verificação registra `observed` ou `missing`, com a razão. Tentativas de auditoria, inclusive evidências anteriores ao erro, ficam em `security_attempts`; o detalhe da API expõe `security_history`. Erros e métodos ficam em `request_events`, sem URL completa, chave ou cabeçalhos sensíveis. Concentração mede contas, que podem ser pools/custódias; criador, relações de carteiras, Token-2022 e bloqueio de liquidez não estão integralmente auditados. `complete` refere-se apenas ao conjunto básico implementado, não a uma certificação de segurança.

Alternativas: Helius Free documenta 10 req/s e 100 mil créditos/mês (conferir vigência ao configurar). Exige conta/chave e hostname próprio. O ambiente atual permite apenas `api.mainnet-beta.solana.com` como RPC; Helius e outros hosts não estão na allowlist. Nenhuma alternativa privada foi acessada, credencial criada ou política alterada. O hostname `api.mainnet.solana.com` citado na documentação atual também não está autorizado. Trocar de host só será útil após configurar acesso permitido e limites, não como resposta automática a 429.

## Execução contínua sem custo de hospedagem adicional

### Opção local completa

Uma máquina já disponível, ligada, com disco persistente, pode executar o núcleo completo. Há custo de energia e disponibilidade da máquina. Configure `EDGE_DB` absoluto em volume persistente, restaure a evidência somente para um arquivo inexistente e mantenha backups externos. `python3 -m scripts.run_persistent --once` recusa banco ausente ou configuração `paper_auto=true`, evitando reiniciar silenciosamente com histórico vazio após falha de montagem. Exemplos de service/timer em `ops/` não foram instalados. O próprio coletor também pode permanecer em loop com `python3 -m scripts.run_persistent`; reinícios exigem supervisor externo.

Uma tarefa Codex efêmera não é um serviço 24/7. Não ficou processo de coleta prometido para depois desta tarefa. O snapshot compactado versionado permite retomar o histórico mesmo se `/workspace/work` desaparecer. Restaurar exige um destino novo; não substitua o banco produtivo.

### Cloudflare Workers + D1: sampler separado de staging

`cloud-monitor/` implementa um sampler agendado e persistente, **desabilitado**. O D1 tem nome próprio, ID placeholder e não referencia nenhum banco legado. Não há endpoint público de coleta, escrita, carteira ou negociação. São até 12 contratos por tick de 5 min: quatro lugares por justiça da rotação, cinco por prioridade e até três descobertas. Prioridade é triagem instantânea; não é a detecção temporal completa do Python. Mantém os contratos fora do ranking. Catálogo não apaga contratos, observações são idempotentes, falhas/contratos tentados são registrados por rodada, lease impede sobreposição e cooldown por provedor persiste entre invocações. Requisições têm timeout e não seguem redirecionamentos.

Este componente é **infraestrutura de amostragem**, não uma migração integral do backend Python: auditoria on-chain, detectores completos, alertas e avaliação de horizontes ainda rodam no núcleo Python. Exportar o staging D1 para SQLite e executar `python3 -m scripts.import_monitor EXPORT.sqlite3 NOVO_ANALYSIS.sqlite3` preserva timestamps sem criar alertas antigos. O teste usa SQLite real para executar as mesmas instruções SQL do Worker; não é uma medição no D1 remoto. CPU, integração com Cron e consumo remoto ainda precisam de staging autorizado e medição. Não há deploy nesta entrega.

Limites oficiais consultados em 13/11/2026:

| Recurso gratuito | Limite | Planejamento deste sampler |
|---|---:|---|
| Workers | 100.000 invocações/dia, 10 ms CPU/invocação | 288 ticks/dia; CPU remota ainda não medida |
| D1 leituras | 5 milhões de linhas/dia | consultas indexadas e lotes de <=12; medir `meta.rows_read` com catálogo real |
| D1 escritas | 100 mil linhas/dia, incluindo manutenção de índices | reserva conservadora de 160 por tick = 46.080/dia; pausa se reserva exceder 50.000/dia |
| D1 armazenamento | 500 MB por banco Free, 5 GB por conta | reserva máxima 140.000 amostras; pausa sem apagar evidências |
| D1 consultas por invocação | 50 Free | consultas fixas e um batch; abaixo do limite |

A reserva é uma estimativa conservadora da carga deste schema, não medição de cobrança nem limite de conta compartilhada. Outras aplicações consomem a mesma franquia. A trava de 140 mil amostras dura cerca de 40 dias à taxa máxima de 3.456/dia; falhas também consomem reserva para segurança. Armazenamento efetivo e CPU precisam ser medidos antes de ativar. Não há alegação de retenção ilimitada gratuita: é preciso exportar, verificar e arquivar externamente antes de qualquer futura política de compactação/expurgo. Nenhum expurgo foi implementado ou executado. O sistema pausa quando chega ao teto.

Para staging futuro: criar **novo** D1 no plano Free, substituir somente o placeholder de staging, aplicar seu schema, medir execução e `meta` remotamente, verificar limite de conta, e só então considerar habilitar `MONITOR_ENABLED`. Produção, migração do banco existente e ativação não fazem parte desta entrega. Workers não executa diretamente este serviço Python/SQLite; anunciar uma migração automática seria incorreto.

## Fontes oficiais

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/platform/limits/
- https://solana.com/docs/references/clusters
- https://www.helius.dev/pricing
- https://www.helius.dev/solana-rpc-nodes

## Resultado da validação real desta etapa

Três rodadas no histórico consolidado (a primeira já existia). As duas rodadas adicionais reconsultaram respectivamente 53 e 19 contratos conhecidos; estes totais por rodada se sobrepõem. Os 53 contratos originais foram reconsultados. Há 56 contratos com observações em instantes diferentes da mesma fonte; contar fontes diferentes dentro da mesma rodada como reconsulta inflaria o resultado.

- Contratos totais: **129**; novos nesta etapa: **76**.
- Contratos mantidos no histórico/fila: **129**.
- Snapshots: **315**; avaliações: **201**.
- Observações originais preservadas e comparadas integralmente: **91**.
- Contratos com histórico recente suficiente na última avaliação registrada: **16**.
- Acelerações comprovadas: **0**; retomadas comprovadas: **0**.
- Auditorias básicas completas: **0**; duas auditorias parciais preservadas.
- Alertas reais emitidos e horizontes reais avaliados: **0**; não foram fabricados sinais para testar resultados.
- Trades: **0**; nenhuma negociação automática habilitada.

`docs/evidence/stage2-summary.json` registra rodadas, contagens, política de rede, erros por método e hashes. `stage2-history.sqlite3.gz` contém backup consistente do histórico real consolidado, inclusive os dados iniciais. A restauração foi testada em outro banco e produziu SHA-256 idêntico ao snapshot; integridade e referências passaram. O arquivo compacto tem cerca de 219 KiB e permite retomar o histórico em outra tarefa, sem depender do disco efêmero.

Restauração **somente em destino novo**, consultando o SHA atual no JSON:

```bash
python3 -m scripts.restore_history docs/evidence/stage2-history.sqlite3.gz /SEU_VOLUME_PERSISTENTE/edge.sqlite3 --sha256 562e9cd44c7a00c1add903a8bbe3b635cfacac53df799e5c396d75bf98ce43f2
export EDGE_DB=/SEU_VOLUME_PERSISTENTE/edge.sqlite3
python3 -m scripts.run_persistent --once
```

Não substitua o banco de produção. Não use o arquivo de evidência como banco de trabalho gravável. O restore recusa destino existente, confere SHA e integridade e remove apenas sua própria restauração nova se a validação falhar. Backups futuros precisam de nomes novos e armazenamento persistente; versionar uma evidência pequena desta etapa não é uma estratégia de banco operacional em Git.

Verificações: **85 testes Python**, **6 testes do sampler com SQLite real**, **6 testes de interface desktop/mobile**, build, TypeScript, ESLint, Ruff e restauração real do arquivo compactado passaram. Fixtures sintéticas dos testes não estão no banco de mercado. Os testes SQL não comprovam limites de CPU do Worker remoto; a carga de produção não foi exercitada.

Pendências reais: observar sinais que cumpram os critérios, baseline de retomada de 24–48 h, horizontes futuros de 5–60 min após alertas reais, concentração on-chain, cobertura social, avaliação estatística com amostra adequada, benchmark de CPU/leitura/escrita e integração remota de staging. O sampler não foi ativado nem o motor temporal completo portado para Workers. A infraestrutura de produção não foi modificada.
