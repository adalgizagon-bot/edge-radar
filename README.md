# EDGE RADAR — MEMECOIN INTELLIGENCE

Reconstrução independente para pesquisa de memecoins Solana: descoberta periódica, histórico persistente, classificação explicável e simulação conservadora. Sem wallet, assinatura de transações, swaps ou dinheiro real.

**Estado atual:** desenvolvimento local implementado e testado. A descoberta com respostas reais ainda **não foi validada**: o proxy deste ambiente retornou `403 Forbidden` para os provedores e suas documentações. Não há tokens ou resultados de mercado pré-carregados. A Fase 2 não deve ser considerada concluída até a rede ser liberada e uma coleta real ser verificada. Veja [relatório de entrega](docs/DELIVERY.md).

## Execução local

Requisitos: Node 22, npm, Python 3.12+, Chromium para testes de navegador. Sem dependências Python para execução do serviço.

```bash
cd /workspace/edge-radar
export npm_config_cache=/workspace/.npm-cache
npm ci --no-audit --no-fund
python3 -m venv .runtime/venv
.runtime/venv/bin/pip install -r requirements-dev.txt
npm run build
npm run dev
```

`npm run dev` inicia o serviço **somente em loopback**, porta 8090, e o coletor periódico. Não publique esse servidor administrativo sem autenticação. Os dados ficam em `.runtime/edge.sqlite3`; exporte `EDGE_DB` para outro volume persistente. Sem `.env` automático: exporte variáveis no shell, sem gravar secrets no projeto. Novas tarefas precisam reiniciar processos.

O comando `npm run collect` executa uma rodada independente. Há lock de processo por banco e intervalo mínimo persistido. O botão **Coletar agora** respeita ambos; não ignora rate limits. Para iniciar a interface sem tráfego externo: `python3 -m server.app --no-collector`.

## Arquitetura e decisão de infraestrutura

- **Frontend TypeScript estrito**, CSS próprio e SVG com amostras observadas; nenhuma tela reaproveitada.
- **Serviço Python modular**, biblioteca padrão, adaptadores HTTP separados e jobs idempotentes.
- **SQLite/WAL**, migrações aditivas, snapshots por fonte/pool, avaliações versionadas, ledger e evidências por operação.
- **Nenhum processo permanente na Vercel.** Next.js, Tailwind e Supabase eram sugestões, não requisitos: esta base reduz dependências, permite instalar sem conta externa e valida o núcleo antes de escolher hospedagem. O SQLite local é uma decisão de desenvolvimento, não um banco compartilhado para funções efêmeras.

Para produção gratuita, o caminho recomendado é portar persistência para **Cloudflare D1** e orquestração para **Workers Cron**, preservando os contratos de domínio e a interface estática. Essa adaptação **não está implementada**; não há configuração que finja um backend persistente na Vercel. Também é possível hospedar este serviço em uma máquina com disco persistente e scheduler. Nenhuma infraestrutura de produção anterior foi excluída ou modificada.

## Módulos

| Caminho | Responsabilidade |
|---|---|
| `server/sources.py` | Adaptadores, cache, orçamento, rate limit compartilhado e backoff |
| `server/db.py` | Esquema, migrações, transações, snapshots, configurações e leases |
| `server/collector.py` | Descoberta, fila persistente, auditoria, social, avaliação e monitoramento |
| `server/analysis.py` | Três radares, scores separados, condições e estados |
| `server/paper.py` | Cotações de leitura, ledger prospectivo, gaps, falhas e métricas |
| `server/app.py` | API e servidor local, defesa de origem e arquivos estáticos |
| `web/` | Visão geral, radar/filtros, detalhes, social, simulador e configurações |
| `tests/` | Fixtures isoladas, cálculos, falhas e UI desktop/mobile |

## Regras dos radares

1. **A — novos:** pool observado com até 24 horas (configurável); não equivale à criação do mint e não significa qualidade.
2. **B — aceleração:** três amostras da mesma fonte e pool, espaçadas por pelo menos cinco minutos. Crescimento de volume ≥50%, compras ≥25%, liquidez estável e volume sustentado. Não compara pools diferentes nem preenche lacunas.
3. **C — retomada:** pool de pelo menos três dias; volume ≥3× a mediana de observações de 24–48 horas antes; baseline exige seis amostras cobrindo quatro horas; pressão compradora ≥60% e liquidez estável.

GeckoTerminal alimenta pools novos e páginas rotativas de tendência; perfis DEX Screener acrescentam candidatos, **não evidência de qualidade orgânica**. Uma fila de contratos persistidos é reconsultada independentemente do ranking, por ordem de observação mais antiga. O universo de tokens já descobertos não é apagado. Sem observação por 14 dias (configurável), o contrato fica inativo com motivo; o histórico e as operações permanecem. Posições abertas não expiram automaticamente.

## Scores e entradas

Pesos configuráveis e explicitamente heurísticos. Momentum, fluxo, social, risco e oportunidade são separados. Dados indispensáveis ausentes resultam em `null`, exibido como “—”. Oportunidade exige os componentes com peso positivo e verificações básicas de risco; não renormaliza pesos para esconder dados ausentes.

Os detalhes mostram cada condição atendida, pendente ou desconhecida, e o que precisaria mudar. As regras de segurança verificam autoridades de mint/freeze, programa SPL clássico, concentração por **conta** e liquidez. Contas não equivalem a holders; pools/custódias podem causar falsos positivos. Criador, carteiras relacionadas, locks, extensões Token-2022 e restrições de venda não têm auditoria completa. Nenhum token é classificado como “seguro”.

“Entrada validada” só existe para **simulação** após liquidez, volume, frescor, histórico, estratégia, risco e duas rotas estimadas com custos aceitáveis. Não basta score alto. Sem rotas, os motivos ficam explícitos.

## Social e narrativas

Adaptador público Bluesky pesquisa o **contrato exato**, nunca associa símbolos iguais automaticamente. Armazena posts deduplicados por URI/contrato, horário original, autor e origem. Crescimento só é calculado após duas horas de cobertura contínua. Consultas retornam amostras limitadas: não há promessa de cobertura integral ou detecção comprovada de bots.

Narrativas são termos compartilhados por pelo menos três autores nas menções aos contratos conhecidos. **Descoberta global de narrativas antes de conhecer o token ainda não existe.** X, Reddit e Telegram não estão integrados: sem scraping, acessos presumidos ou contagens inventadas.

## Simulação

Jupiter é um adaptador opcional, **somente leitura**. A disponibilidade do plano gratuito, termos e endpoint ainda precisam de confirmação com rede liberada. Caso disponha de acesso gratuito confirmado, exporte `JUPITER_API_KEY` no backend. Nenhuma chave é enviada ao frontend; a API informa apenas presença/ausência. Não houve contratação de API.

A entrada usa USDC e duas rotas ExactIn, saída mínima com slippage, impacto máximo de 2% por rota, recuperação mínima de 95% após custos, atraso antes das cotações e taxa de rede hipotética configurável. O “fill” é uma estimativa conservadora, sem execução de transação ou garantia de inclusão em bloco. As taxas de pool embutidas na rota não são cobradas novamente; a taxa de rede é uma suposição explícita, não uma cotação de gas.

Entradas podem ser solicitadas na análise de uma moeda; simulação automática é opt-in nas configurações e limitada a uma entrada por rodada. As estratégias são hipóteses, não vencedoras. Cada posição congela a política na entrada. O monitor só encerra com cotação recente, usa o preço estimado observado após gaps e nunca preenche no valor ideal do stop. Sem rota, preserva a posição em `exit_unavailable` e grava o evento. Não apaga perdas. Cotações, condições e horários ficam auditáveis no banco.

Métricas: taxa de acerto, resultado líquido, médias de lucro/prejuízo, expectativa, profit factor, drawdown realizado e resultados por estratégia, categoria e condição do movimento. Posições abertas ficam separadas de resultados realizados. Sem perdas, profit factor é indefinido; sem operações, não há taxa de acerto. Não existe aprendizado automático treinado ou calibração estatística comprovada. Configurações novas afetam decisões futuras; parâmetros de uma janela final não devem ser ajustados usando seus próprios resultados.

## Validação

```bash
npm run build
npm run lint
npm run typecheck
npm test
npm run test:ui
```

Os testes de UI usam banco temporário separado. O teste de interação com contrato intercepta respostas com fixtures marcadas **TEST FIXTURE**, nunca insere esses dados no banco da aplicação. Capturas locais ficam em `.runtime/screenshots/`.

[Fontes, limites e verificação](docs/SOURCES.md) · [Banco e API](docs/ARCHITECTURE.md) · [Relatório por fase](docs/DELIVERY.md).
