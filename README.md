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
