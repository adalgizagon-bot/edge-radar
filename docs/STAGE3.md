# Etapa 3 — preparação do monitoramento e estudo prospectivo

Base: `c61e3fddd1da74c995bdcd8e983f871d11902943`, branch `rebuild/memecoin-radar-v1`. **Sem deploy, criação de recursos remotos, migração de produção ou ativação.** O banco e o arquivo compactado da etapa 2 permanecem preservados. Nesta etapa não foi executada nova coleta de mercado: a base real segue com 129 contratos, 315 snapshots, 201 avaliações e duas auditorias parciais.

## Arquitetura de execução

A arquitetura existente foi estendida:

1. **Workers Cron + D1 de staging:** agenda nominal de um minuto; despacho interno decide quando trabalhar. Coleta DEX em lote, descoberta limitada no Gecko, classificação de força, fila em duas velocidades, detectores temporais, alerta prospectivo, controle comparável e resultados futuros são persistidos no D1. Nenhum navegador precisa permanecer aberto para esse caminho funcionar após uma futura implantação autorizada. O Worker nunca valida uma entrada: risco e execução permanecem não verificados.
2. **Python + SQLite:** núcleo completo já existente, alternativa em uma máquina com disco persistente; também importa um export D1 para produzir estatísticas mais pesadas sem gastar CPU/gravações do Worker. O import preserva as coortes e resultados que o Worker criou ao vivo, sem fabricar alertas retrospectivos. A interface local mostra pares, liquidez, retornos e cenários de custo.
3. **Backup/export:** snapshot real da etapa 2 continua versionado. A preparação de seed e os relatórios são locais. Não existe replicação automática com banco produtivo. Estatísticas e intervalos por blocos são calculados fora do Worker.

Não há serviço 24/7 ativo nesta entrega. O componente Cloudflare contém agora coleta **e estudo prospectivo limitado**; deixou de ser somente sampler. Auditoria completa, social e cotações de execução não foram portados/ativados no Worker. O caminho Python preserva suas auditorias e bloqueios de entrada.

## Frequência: mais rápida onde a informação pode valer mais

O limite documentado de requisições da DEX Screener não é o gargalo desta configuração: `/tokens/v1` permite até 300 requisições/minuto, em lotes de até 30 contratos. O projeto usa no máximo uma chamada DEX por minuto ativo. A chamada Gecko de descoberta ocorre no máximo uma vez por 15 minutos. Não são feitos loops subsegundo nem rotação de hosts para contornar limites.

| Categoria no staging preparado | Capacidade nominal | Comportamento |
|---|---:|---|
| Radar rápido, janela intensiva | Até 2 contratos a cada 60 s | Janela de 15 min, no máximo uma nova janela por hora e 360 min reservados/dia; apenas com força/prioridade e folga de orçamento |
| Radar rápido, acompanhamento normal | Até 6 contratos no total a cada 3 min | Os dois intensivos fazem parte destes seis, não são seis adicionais |
| Referências de pesquisa | Consomem vagas rápidas | Até três pares alerta/referência simultâneos; o par é mantido junto quando escolhido para a janela intensiva |
| Radar de acompanhamento | Pelo menos 2 vagas por tick de 3 min, quando há fila vencida | Ordenação por tentativa mais antiga; vagas rápidas ociosas são emprestadas, chegando a 8 contratos por tick |
| Descoberta | Até 2 admissões por 15 min | Novos candidatos não substituem o histórico dos admitidos |

**São metas de despacho, não SLA da fonte.** API 429, cache, ausência de pool, indisponibilidade D1 e atraso do Cron aumentam o intervalo. Ticks entregues com atraso superior a 30 segundos são pulados e registrados nos logs. O intervalo efetivo é calculado pelas observações, nunca preenchido com timestamps fictícios.

O modo intensivo não significa dois contratos atualizados a cada minuto durante 24 horas. Uma proposta assim teria aproximadamente 6 mil amostras/dia neste universo, mais invocações e menor folga de escrita; não é o perfil escolhido. Atualizar todos os 129 contratos a cada minuto produziria 185.760 snapshots/dia antes de catálogo, índices e resultados: inviável neste orçamento.

### Alcance do acompanhamento

Com seis contratos rápidos e duas vagas de acompanhamento a cada três minutos:

| Contratos em acompanhamento | Rotação conservadora sem falhas e sem novos ingressos |
|---:|---:|
| 123, além dos 6 rápidos | Até 186 min |
| 500 | Até 750 min (12,5 h) |
| 1.000 | Até 1.500 min (25 h) |

Com os 129 no acompanhamento e nenhuma vaga rápida ocupada, o orçamento de oito por tick permite aproximadamente **51 minutos** por rotação, respeitado o intervalo mínimo de 30 minutos. A fila cresce com admissões; os números não prometem cobertura de movimentos rápidos nos contratos antigos. Ser descoberto não garante vaga rápida. Toda moeda admitida é retida, mesmo fora dos rankings; nenhuma exclusão automática foi implementada.

No Python, a carteira rápida é de até 12 contratos, incluindo referências, com o tick padrão de três minutos. Intervalo maior configurado pelo usuário prevalece; nenhum parâmetro de coleta existente foi reduzido silenciosamente. O modo de um minuto é do novo despacho preparado do Worker.

### Força e perda de força

A promoção usa dados atuais, liquidez >= US$20 mil, volume móvel 5m >= US$2 mil e pressão compradora >=60%, ou evento temporal relevante. Duas novas amostras consecutivas com perda de critérios, queda de volume móvel >30%, queda de liquidez >10% ou perda de pressão rebaixam o acompanhamento. Observação do cache local repetida não conta duas vezes no núcleo Python. A falta de dados recentes também remove a prioridade comum; pares já em avaliação conservam cobertura programada até o horizonte final. Há limite da carteira e rebalanceamento explícito, sem apagar evidências.

São registrados os deltas entre observações: preço, volume móvel, liquidez, transações de compra e compradores únicos quando a fonte os oferece. DEX fornece transações, não pessoas únicas. As janelas de volume de cinco minutos se sobrepõem: variação de volume móvel não é volume independente ocorrido no último minuto.

**Limite de antecipação:** o detector confirmado da etapa 2 permanece com três amostras separadas por pelo menos cinco minutos. A confirmação demanda pelo menos dez minutos de histórico comparável; no passo normal de três minutos, tipicamente doze. O monitor de um minuto ajuda a observar força, perda e preços posteriores; ele não transforma esse critério em detecção garantida do início de um pump. Movimentos curtos podem começar e terminar antes de qualquer confirmação.

## Consumo e travas de custo

Limites oficiais Free consultados: 100 mil invocações Workers/dia, 10 ms de CPU/invocação; D1 com 5 milhões de linhas lidas/dia, 100 mil escritas/dia, 500 MB por banco e 5 GB por conta. Índices também podem acrescentar escritas. Latência de rede não é CPU, mas parse de JSON, classificação e serialização são CPU.

| Recurso | Planejamento superior deste perfil |
|---|---:|
| Cron invocado | 1.440 vezes/dia |
| Rodadas com trabalho | Até 720/dia: 480 normais + até 240 extras intensivas |
| Observações | Até 4.512/dia: 2.880 rápidas normais + 480 extras intensivas + 960 de acompanhamento + 192 novas admissões |
| Chamadas DEX | Até 720/dia, uma por minuto ativo |
| Chamadas Gecko | Até 96/dia |
| Reserva conservadora de escrita | Até 64.896 linhas/dia (`40 + 8 × vagas` por rodada) |
| Trava de reserva | 70.000/dia; reserva consumida mesmo em falhas |
| Trava de escrita observada | 45.000/dia, medida por `meta.rows_written` |
| Trava de leitura observada | 2.000.000/dia, medida por `meta.rows_read` |
| Novas janelas intensivas | Suspensas antes: reserva >=50.000 ou escrita medida >=35.000 |
| Armazenamento | Pausa em 350 MB medidos ou 140 mil amostras reservadas |

A estimativa do caminho comum é da ordem de **30–40 mil escritas/dia**, dependendo de índices, coortes, falhas e quantidade efetivamente amostrada. Não é cobrança medida. O limite de 45 mil pode interromper o dia em uma carga desfavorável; por isso a capacidade deve ser validada no piloto, não anunciada como garantida. Outras aplicações dividem a franquia da conta. A reserva não mede consumo de outros Workers e não garante que o D1 produtivo antigo deixou de consumir cota.

O seed inicial da base validada adiciona 129 linhas de catálogo e 315 observações uma vez, mais índices; deve entrar no orçamento da inicialização. O seed é idempotente e atualiza a reserva mínima de amostras já existentes, sem zerar contadores.

Com 4.512 amostras/dia, o teto de 140 mil amostras dá cerca de **31 dias** na carga superior, descontado o seed. Bytes podem atingir o teto antes. A estimativa de disco precisa incluir JSON das observações, estado recente do catálogo, índices, coortes e resultados — não apenas contar snapshots. `meta.size_after` aciona a pausa de armazenamento. Não há retenção ilimitada grátis nem expurgo automático: exportar/arquivar é obrigatório antes de qualquer futura decisão de compactação. A coleta pausa para preservar o histórico.

### Consultas e CPU

A fila lê no máximo 12 candidatos rápidos e os 64 registros mais antigos da rotação, por índices. Não percorre o universo inteiro para encontrar um próximo contrato. Coortes pendentes têm índice próprio; resultados finalizados não são varridos de novo a cada Cron. Retomadas usam seis consultas pontuais indexadas de faixas de quatro horas em uma única instrução SQL, evitando varrer 24 horas de snapshots de um token intensivo. Isso define uma baseline estratificada no Worker, identificada separadamente do detector Python no relatório.

São até quatro coortes pendentes lidas e oito resultados finalizados por rodada, com limite defensivo de 45 chamadas D1; permanece folga para recuperação diante do limite Free de 50. O trabalho comum usa menos chamadas; a contagem entra na telemetria. SQL e limites de parâmetros são exercitados contra SQLite real nos testes. Metadata de cobrança não é simulada como prova de D1 remoto.

O bundle foi compilado por **Wrangler 4.162.0 com `--dry-run`**, sem autenticação, upload ou publicação. O benchmark local usa somente fixtures sintéticas e lógica pura; seus tempos estão em `docs/evidence/stage3-local-benchmark.json`. **Não mede CPU Cloudflare, D1, rede ou custo da invocação completa.** O requisito remoto de 10 ms continua pendente. O piloto deverá medir CPU e falhas de limite e reduzir a carga se necessário; não há autorização para migrar ao plano pago automaticamente.

### Falhas, isolamento e recuperação

- `MONITOR_ENABLED=false` no arquivo versionado; Worker `workers_dev=false`, sem rotas e com HTTP 404. Sem endpoint administrativo público, carteira, chave privada ou ordens.
- Nome e binding exclusivos de staging, UUID placeholder e marcador `purpose='edge-radar-staging'` no banco. O schema não roda automaticamente dentro do Worker.
- Lease com proprietário e verificação atômica antes do batch: uma invocação expirada não grava nem limpa o lease da próxima. O batch preserva atomicidade.
- Timeout HTTPS, sem seguir redirects, backoff por provedor e Retry-After em segundos/data. HTTP 403 pausa o monitor; não muda de host. Três falhas técnicas recorrentes pausam para inspeção. Falhas e contratos tentados ficam em `monitor_runs`.
- Crash: lease expira; próxima rodada tenta recuperar. Reservas previnem consumo invisível ilimitado após crash. Lacunas continuam desconhecidas.
- Pausas de quota/armazenamento/falha exigem inspeção e liberação deliberada. Não zere contadores do dia nem desative as travas para forçar coleta.
- `Date` e `Age` da resposta são preservados quando disponíveis. Horário de observação é recebimento da resposta, não timestamp on-chain do preço. Data de atualização da fonte continua desconhecida se não fornecida. Consultar a cada minuto não prova receber dados novos a cada minuto.

## Estudo prospectivo de alertas

`prospective-v1` fica registrado integralmente na coorte e não é recalibrado para melhorar os resultados anteriores. Horizonte principal: **excesso de valorização observada em 30 min**, alerta menos referência. Horizontes de 5, 15 e 60 min são secundários exploratórios.

A referência é selecionada no alerta, entre dados disponíveis naquele momento: mesma fonte, classe de idade do pool (até 24 h, 1–3 dias, >=3 dias), categoria de cobertura de risco e liquidez/volume entre metade e dobro do alerta. Usa distância logarítmica e desempate determinístico pelo contrato. Baseline pode ter no máximo 300 segundos. Contratos com alertas já conhecidos ou detectados na rodada não são controles. Sem equivalente, a coorte permanece `unmatched`; não se escolhe um perdedor posteriormente para melhorar o resultado.

O Worker admite no máximo uma nova coorte por rodada e seis contratos de estudo simultâneos, incluindo controles. Candidatos sem admissão por capacidade não viram entradas financeiras. A amostra é do radar dentro dessas regras de capacidade, não de todos os tokens do mercado. O Python registra também cobertura limitada quando sua carteira está cheia. A configuração do detector fica congelada; motores/configurações diferentes são apresentados separadamente, sem misturar retornos automaticamente.

O par recebe cobertura até 60 min + 180 s. Se a referência alertar depois, ela continua no grupo original e é marcada como contaminada; removê-la usaria futuro para mudar a amostra. O preço do alerta, o horário real do preço e a emissão são preservados, junto à identificação da fonte e pool.

Resultados usam primeira observação da mesma fonte/pool entre o alvo e mais 180 segundos. Com jitter/cache/falhas, até um horizonte de cinco minutos pode ficar indisponível. Registra-se o horário real da observação; preço anterior não é interpolado, outro pool não é substituído e ausências ficam nos denominadores.

Cada braço tem campos separados para:

- Valorização/queda e extremos **das amostras**, quantidade de observações e intervalos sem amostra.
- Liquidez observada no início, no endpoint e mínima amostrada; não é liquidez executável nem profundidade por tamanho de ordem.
- Cenário de custo congelado: US$20, fee de 1% e slippage de 1% por lado, US$0,05 de rede por lado. O líquido em cenário é calculado do preço observado, sem inventar cotação.
- `execution_status='unverified'`, cotações de entrada/saída ausentes e `executable_net_usd=null` quando não existem rotas. Não há trades automáticos ou chamadas pagas de IA.
- `between_samples='unknown'`, intervalos explícitos, `continuous_extrema_known=false` e `stop_execution_assumed=false`. Nada presume execução no pico, fundo ou preço de stop entre duas consultas.

A API `/api/research` e a tela Radar apresentam pares, retornos observados, cenários, liquidez e indisponibilidade. Após no mínimo 100 pares observados e 20 dias distintos, o relatório pode calcular intervalo descritivo por bootstrap de blocos diários UTC; não trata vários alertas do mesmo dia como observações independentes. Dependência entre dias/tokens, seleção, hipóteses secundárias e dados ausentes continuam limitações. Um intervalo favorável não demonstra causalidade nem rentabilidade executável.

## Risco e cobertura social

As duas auditorias parciais reais e seu histórico permanecem no backup e no núcleo Python. Sem concentração, autoridades/programa ou rotas críticas suficientes, a entrada validada continua bloqueada. O Worker classifica risco como indisponível e nunca emite entrada validada. Score de atividade de mercado foi separado de cobertura social; falta de Bluesky não fabrica score social neutro nem impede observar força de mercado.

Fontes futuras possíveis, sem ativação nesta etapa:

| Fonte | Condição para integração gratuita posterior | Limite de interpretação |
|---|---|---|
| Bluesky público | Endpoint permitido, atualmente retornou 403; respeitar backoff | Amostra parcial, busca pelo contrato exato |
| Telegram Bot API | Bot autorizado em grupos/canais selecionados; permissões necessárias | Não dá busca global nem histórico completo; tokens e conteúdo somente em contexto autorizado |
| Discord API | Bot convidado a servidores/canais; permissões e intents necessárias | Sem scraping de mensagens privadas; rate limits por rota e restrições de conteúdo |
| RSS/Atom de fontes oficiais | Feed público com identidade do projeto e contrato verificáveis | Divulgação do próprio projeto não comprova interesse orgânico |

Telegram é documentado como plataforma gratuita; os recursos de envio pago não são usados. Discord e Telegram exigiriam novas permissões de rede e credenciais fora do repositório. Nenhuma conta/bot foi criado, mensagem enviada ou fonte conectada. X/Reddit não são anunciados como busca gratuita irrestrita. Em todas as fontes, símbolo sozinho não identifica moeda; cobertura, autores, repetição e possíveis vieses são separados do risco on-chain.

## Instruções de staging — somente após autorização futura

As configurações a autorizar são: conta Cloudflare/plano Free e orçamento compartilhado, criação de **novo** D1, UUID desse banco, aplicação de schema/seed, futura publicação do Worker isolado com coleta desabilitada e, em outro passo, piloto limitado. Nada disso foi executado aqui.

1. Confira o commit desta branch e rode `python3 -m scripts.staging_preflight`. Deve mostrar preparação segura, UUID não configurado, deploy não autorizado e CPU remota não validada. Confira a franquia já consumida pelos Workers antigos na conta. Não altere o banco produtivo nem habilite billing pago.
2. Depois de autorizar a criação, autentique o Wrangler na conta escolhida, sem colocar tokens no Git. D1/Workers podem exigir permissões no âmbito da conta; se o token não puder se restringir ao banco/script, trate essa amplitude explicitamente. Preferir credencial temporária e revogá-la após o setup.
3. Com autorização explícita, crie somente `edge-radar-monitor-staging`:

   ```bash
   npx --yes wrangler@4.162.0 d1 create edge-radar-monitor-staging
   ```

   Copie o UUID **real retornado** para `cloud-monitor/wrangler.toml`. Confira nome e conta no painel. Não copie o UUID do D1 antigo. Mantenha `MONITOR_ENABLED="false"`, `workers_dev=false` e sem rotas públicas.
4. Após autorizar a inicialização do novo staging, aplique o schema fresco:

   ```bash
   npx --yes wrangler@4.162.0 d1 execute edge-radar-monitor-staging --remote --file=cloud-monitor/schema.sql
   ```

   Para um staging que já use o schema de `c61e3fd`, faça export verificado antes e use **somente** `cloud-monitor/migrations/0003-from-stage2.sql`, uma vez. Essa migração altera tabelas e índices, sem apagar linhas de evidência. Não é para banco produtivo nem para banco fresco.
5. Opcionalmente, restaure o arquivo de validação da etapa 2 para um **novo arquivo local**, conforme `docs/STAGE2.md`. Gere `python3 -m scripts.staging_seed NOVO_BACKUP.sqlite3 NOVO_SEED.sql`. Isso produz 129 contratos e 315 observações originais, sem alertas retroativos, sem acessar Cloudflare. Revise o SQL, confira espaço/cota e só aplique ao staging autorizado. Não é export/migração do banco de produção.
6. Rode o preflight novamente e faça bundle offline:

   ```bash
   WRANGLER_SEND_METRICS=false npx --yes wrangler@4.162.0 deploy --dry-run --config cloud-monitor/wrangler.toml --outdir work/staging-bundle
   ```

   **`--dry-run` é indispensável neste passo.** Não é prova de CPU remota ou autenticação. A publicação real permanece sem autorização nesta entrega.
7. Em uma autorização posterior separada, publicar staging inicialmente desabilitado e conferir os bindings. Um piloto de coleta real deve ser explicitamente limitado, por exemplo 30 minutos, seguido de desligamento e revisão de CPU, quotas, gaps e 429. O critério conservador de aceitação é CPU p95 com folga abaixo de 10 ms (meta de engenharia <=5 ms), sem erros de CPU, e consumo diário projetado dentro das travas. Se falhar, reduzir a carga; não aumentar plano ou remover limites automaticamente.
8. Para pausa operacional, definir `MONITOR_ENABLED=false` e/ou `UPDATE monitor_state SET paused=1,pause_reason='manual' WHERE id=1`. Esses comandos só podem atingir o staging autorizado. Revisar falha, quota e backups antes de qualquer retomada; preservar `samples_reserved`, contadores diários e histórico.
9. Exportar regularmente e antes de migrações:

   ```bash
   npx --yes wrangler@4.162.0 d1 export edge-radar-monitor-staging --remote --output NOVO_EXPORT.sql
   ```

   Salvar com data e SHA-256 em armazenamento controlado pelo usuário. Export manual não é backup externo automatizado; Time Travel Free de sete dias não o substitui. Validar restaurando o SQL em um **novo SQLite local**, conferir integridade/contagens e importar com `python3 -m scripts.import_monitor NOVO_EXPORT.sqlite3 NOVA_ANALISE.sqlite3`. O import recusa destino existente. Nenhum export ou restauração deve sobrescrever produção.

## Validação e pendências

A evidência máquina-legível está em `docs/evidence/stage3-summary.json`. Testes cobrem filas, promoção/rebaixamento, prioridade e pares, orçamento de um dia, limite diário de janelas de minuto, 429/Retry-After, lease com fencing, pausas, SQL nativo contra SQLite, paridade de protocolo/detector/resultado entre JS/Python, controles sem uso de futuro, custos congelados, intervalos desconhecidos e bootstrap por dia. Os fixtures são isolados e não foram inseridos no banco de mercado.

O snapshot real foi restaurado em uma cópia nova e as migrações locais foram verificadas por comparação de todas as linhas originais. Permanecem 129 contratos, 315 observações e duas auditorias parciais; sem alertas históricos fabricados. Bundle offline, tipagem, lint e testes de interface fazem parte da validação; não houve deploy.

Ainda dependem de dados/infraestrutura reais: CPU e `meta` remotos, estabilidade do Cron e das APIs nas frequências propostas, atualização efetiva versus cache, auditoria completa, matching suficiente, sinais novos, baselines de 24–48 horas, horizontes futuros e amostra multidiária para inferência. Não existe comprovação de vantagem estatística ou execução lucrativa.

Fontes oficiais:

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://docs.dexscreener.com/api/reference
- https://api.geckoterminal.com/docs/index.html
- https://support.coingecko.com/articles/6867086195-does-geckoterminal-have-an-api
- https://core.telegram.org/bots/
- https://core.telegram.org/bots/api
- https://discord.com/developers/docs/topics/rate-limits
- https://discord.com/developers/docs/events/gateway

Resultado final dos checks locais: **98 testes Python, 17 testes nativos/política/SQLite, 6 testes de interface desktop/mobile**, build, TypeScript, ESLint/Ruff e bundle Wrangler dry-run passaram. O seed das 129 moedas e 315 observações reais foi aplicado duas vezes em SQLite isolado, preservando todos os dados e sem duplicações ou coortes retroativas. O hash do backup original continua idêntico. Os números de capacidade são os limites do perfil testado, não medições de uma implantação Cloudflare ativa.
