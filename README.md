# EDGE RADAR CRYPTO — monitoramento por navegador + nuvem

Aplicativo **100% cripto**, sem carteira conectada nem operações reais.

## O que a atualização faz

- Preserva o monitoramento rápido **enquanto o navegador estiver aberto** (PumpPortal WebSocket e consultas DEX Screener).
- Acrescenta um **coletor independente do navegador**: Cloudflare Worker agendado aproximadamente **a cada 1 minuto**.
- Descobre pools PumpSwap da GeckoTerminal e consulta cotações/atividade no DEX Screener.
- Identifica sinais quando existem preço, liquidez, volume de 5 minutos, compras/vendas e variação adequados aos filtros.
- Salva os sinais **no banco Cloudflare D1**, não apenas no `localStorage` do computador.
- Registra o preço realmente observado no sinal e tenta medir as mudanças após 1, 5, 15 e 30 minutos. Se perder a janela, marca `missing`/"Sem amostra". **Não inventa preços retroativos**.
- Permite ler os registros no site na aba **Nuvem 24h**, com paginação para históricos mais antigos e estado real do coletor.
- Mantém separado o histórico que já estava salvo localmente no navegador.

**Limite importante:** verificações de 1 minuto **não são uma stream segundo a segundo**. Movimentos que nascem e terminam em poucos segundos podem escapar. A GeckoTerminal informa que seus endpoints públicos podem ter cache de aproximadamente 1 minuto. Para execução subsegundo e WebSocket 24/7 será necessário um processo persistente, com custos e requisitos diferentes. O código **não realiza trades reais**.

## Publicar na Cloudflare (uma vez)

É necessário uma conta Cloudflare com Workers + D1 habilitados. Não há acesso automatizado à sua conta Cloudflare neste chat; os arquivos estão prontos, mas **a coleta 24/7 não começa antes do deploy**.

### Caminho pelo GitHub Actions (sem terminal local)

1. No painel Cloudflare, abra **Workers & Pages → D1 SQL Database**, crie uma base chamada **`edge-radar-crypto`** e copie o **Database ID (UUID)**.
2. Na Cloudflare, crie um token da API com permissão de editar Workers Scripts e D1 nesse projeto; copie também o **Account ID**.
3. No repositório GitHub `adalgizagon-bot/edge-radar`, abra **Settings → Secrets and variables → Actions** e crie estes três segredos: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e `EDGE_D1_DATABASE_ID`. **Não envie valores secretos no chat.**
4. Em **Actions**, selecione **Publicar coletor Crypto na Cloudflare → Run workflow**. Esse fluxo aplica o `cloud/schema.sql` e implanta `cloud/worker.mjs` com a agenda de um minuto.
5. No resultado da publicação, copie o URL `https://edge-radar-cloud.<seu-subdomínio>.workers.dev`.
6. Abra o Edge Radar na Vercel → **Nuvem 24h** → cole esse endereço → **Conectar**.
7. Confira `https://SEU-URL/api/status`. A resposta só informa `online: true` quando houve uma execução agendada recente **bem-sucedida**. Em seguida confira `/api/signals`.

> Alguns tokens da Cloudflare possuem escopos mais restritos. Caso receba erro de permissão na criação de tabelas ou no deploy, confira as permissões do token, sem colocar credenciais no repositório.

### Alternativa pelo terminal (Wrangler)

Na pasta `cloud/`, após autenticar no Cloudflare:

```bash
npx wrangler login
npx wrangler d1 create edge-radar-crypto
# Substitua REPLACE_WITH_D1_DATABASE_ID no wrangler.toml pelo UUID retornado.
npx wrangler d1 execute edge-radar-crypto --remote --file=./schema.sql --yes
npx wrangler deploy
```

Edite `[vars].FRONTEND_ORIGIN` em `cloud/wrangler.toml` se mudar o domínio oficial da Vercel. O endpoint de consulta tem CORS restrito ao domínio configurado; para usos públicos de alto volume, acrescente proteção de acesso/WAF da Cloudflare.

## Limites, dados e custos

- O cron consulta novos e trending pools, mais cotações em lote para até 90 tokens por rodada.
- No máximo 4 sinais novos por minuto, para controlar os custos de gravação D1 no plano gratuito.
- As estatísticas de longo prazo são guardadas em agregações diárias para reduzir leituras de D1.
- A interface pesquisa o servidor a cada 45 segundos quando configurada.
- O plano gratuito da Cloudflare está sujeito a limites de invocações, tempo de CPU, leituras/gravações e armazenamento. O agendamento também pode ter atraso.
- As APIs de mercado são fontes terceirizadas, com disponibilidade e limites próprios. Se estiverem fora do ar, o coletor reporta o erro, sem fabricar dados.
- O uso do painel e do coletor não oferece garantia de valorização nem de lucro.

## Verificação

```bash
node --test tests/*.cjs tests/*.mjs
```

O site é estático (`public/` para Vercel). O Worker fica em `cloud/`, com banco D1 separado.

### Rotas do coletor

- `GET /api/status` — último batimento, saúde e modo de atualização.
- `GET /api/signals?limit=60&before=<timestamp_em_ms>` — histórico centralizado paginado.
- `GET /api/stats` — totais e métricas observadas nos últimos 90 dias, pré-agregados diariamente.

Todas as rotas são somente leitura; **não existe endpoint público que dispare a coleta**. Apenas o evento agendado do Cloudflare executa consultas externas.

## Alerta de risco — pontuação não representa segurança

A escala 0–100 é uma pontuação de **atividade de mercado**, não uma avaliação de golpe, liquidez executável nem probabilidade de retorno. Todos os cards mostram **ENTRADA NÃO VALIDADA**. O atalho para RugCheck abre auditoria externa, mas não constitui certificação de segurança. Ainda faltam verificações automáticas de concentração de carteiras, permissões de mint/freeze, retirada de liquidez e cotação de venda para o valor negociado. Ordens stop loss não impedem perda total quando a liquidez desaparece. O radar não executa trades reais.

## Escudo v7 — simulação de saída e avaliação de sinais

A camada de risco consulta a API pública da Jupiter Tokens V2 por lote. Na nuvem, no máximo **uma moeda por ciclo agendado** recebe uma consulta de cotação de saída pela API Jupiter Swap V2 `GET /swap/v2/order`, **sem parâmetro taker**. A consulta é só leitura, não conecta carteira e não cria, assina nem envia uma transação.

O valor hipotético é **US$ 15 por posição**. A conversão da quantidade de token para unidades atômicas usa os decimais da API. O escudo mantém entrada bloqueada mesmo quando a cotação é favorável: um preço estimado não garante saída futura, e taxas de rede, novas mudanças de preço e falhas de execução podem alterar o resultado. Cotações com menos de 85% de recuperação versus valor teórico são sinalizadas; o limite ainda precisa de calibração.

Novas rotas de leitura:
- `GET /api/risk?limit=40` — triagem e motivos de risco para os tokens acompanhados
- `GET /api/exit-quotes?limit=30` — amostras de rota de saída, com data e condição, não ordens
- `GET /api/evaluation` — médias e contagens de variações de preço após 5 minutos, agrupadas pelo risco registrado no instante do sinal

Novas tabelas no D1: `exit_quotes` e `signal_evidence`. O snapshot de risco por sinal é imutável para evitar viés retrospectivo. Os sinais antigos não são reclassificados artificialmente. A avaliação NÃO representa retorno líquido nem comprova estratégia lucrativa.

Para publicar: o workflow GitHub Actions `Publicar coletor Crypto na Cloudflare` aplica as tabelas remotas, publica o Worker, e consulta os endpoints públicos como teste. Não requer chaves privadas, conexão de carteira nem compra automática. Se a Jupiter estiver indisponível, a avaliação ficará não verificada; nenhuma entrada é liberada.

Os limites e algoritmos são experimentais e devem ser avaliados com uma amostra suficiente e diferentes regimes de mercado. Evite operar dinheiro real com base somente nesses sinais.


## Experimento noturno A/B — Agente IA × Regras (somente fictício)

Nova aba **Teste IA × Regras**, alimentada por `GET /api/paper`, independente do navegador.
Duas contas virtuais separadas, US$ 1.000 cada, posições de US$ 20, no máximo 3 abertas;
custos simulados de 1% na entrada e 1% na saída, stop por variação de preço em -7%,
limite máximo de 20 minutos e alvo fixo de +12% (regras) ou +20% (IA).
A IA também pode optar por vender antes do alvo, após dois minutos. O stop e o tempo
máximo de permanência prevalecem sobre a decisão da IA.

**As operações NÃO são reais.** Não há carteiras, assinaturas, ordens ou endpoints de
execução. Preços do DEX Screener e estimativas Jupiter não são cotações garantidas;
slippage, liquidez e gaps podem fazer o retorno real ser muito diferente.
Não confundir lucro realizado simulado com patrimônio total: posições abertas não são
marcadas a mercado no painel até haver nova cotação. Sem dados = sem negociação.

Ativação deliberada no painel **Cloudflare → Workers → edge-radar-cloud → Settings → Variables and Secrets**,
após publicar as tabelas D1 com o pipeline:

- `PAPER_EXPERIMENT_ENABLED=true` (texto) — ativa as duas contas e as operações fictícias;
- `PAPER_AI_ENABLED=true` (texto) — habilita chamadas à IA;
- `OPENAI_API_KEY` — salvar como **Secret** no Worker, jamais em frontend, GitHub ou mensagens;
- `PAPER_AI_MODEL=gpt-5-mini` (opcional) — modelo usado nas respostas estruturadas.

Na falta da chave ou da flag, a estratégia de IA permanece inativa; a estratégia de regras
pode continuar sozinha. A chamada é feita pelo Worker via API Responses com
`store:false`, apenas para tokens elegíveis e posições abertas, com até 480 chamadas
por dia (reduzível com `PAPER_AI_DAILY_LIMIT`) (horário de Brasília). A tabela `paper_ai_usage` armazena contagem real de
chamadas e tokens; na falta de resposta válida, a IA não abre novas posições.
Nenhuma informação da chave é exposta por `/api/paper`.

Segurança: uma possível compra fictícia requer auditoria Jupiter completa,
liquidez de pelo menos US$ 20 mil, atividade orgânica, verificação do token e uma
estimativa de venda Jupiter da **mesma rodada** com impacto aceitável. Uma oportunidade
com sinais insuficientes não recebe entrada, ainda que a pontuação de atividade seja 100.
A proteção de saída tenta observar preço atual; sem preço não é inventada venda.
A estratégia de IA nunca consegue contornar estas condições.

O experimento usa cron Cloudflare, não precisa manter o computador ligado.
Ative a chave de IA somente depois de validar o deploy de D1 e o painel.
