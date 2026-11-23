# ATLAS Esports Lab — CS2

Painel estatístico de pesquisa para **Counter-Strike 2**, publicado em https://edge-radar-gamma.vercel.app/ e ligado à Vercel pelo repositório GitHub `adalgizagon-bot/edge-radar`. O projeto antigo de criptomoedas ficou preservado na ramificação `backup/edge-radar-2026-11-17`.

## Cotações do Major Singapore — 23/11/2026

As odds de vencedor BO1 foram capturadas manualmente de um print da BR365 às aproximadamente 16h07 BRT para sete dos oito confrontos de abertura. Liquid × BC.Game permanece sem preços porque não aparece na imagem. A fonte `public/data/major-br365-odds.json` é auditável; o `scripts/radar-feed.mjs` conserva a identificação de captura, coloca apenas mercados de vencedor BO1, normaliza as probabilidades implícitas com a margem da casa e não altera as previsões pré-veto congeladas. Quatro confrontos têm estudo experimental, outros quatro têm amostragem insuficiente; ver uma odd não autoriza fabricar previsão.

## Radar Unificado — interface principal (19/11/2026)

O ATLAS agora tem **uma única área de trabalho**, sem uma página nova a cada data:
- **Radar de odds**: apenas jogos futuros, com filtro por equipes, campeonato e disponibilidade de preços. Selecionar uma partida abre seus mercados à direita, junto da comparação de probabilidades V1/V2, odds e histórico resumido
- **Meu estudo**: uma seleção por partida, odds multiplicadas apenas como exercício matemático, sem aposta automática ou promessa de lucro. As seleções expiram após o horário de início
- **Resultados**: jogos passados e placares confirmados, separadamente da lista de oportunidades

Arquivos de referência:
- `public/index.html`, `public/radar.css`, `public/radar-app.js`, `public/radar-core.js` — interface principal
- `public/data/radar-feed.json` — único catálogo para radar, estudo e histórico
- `scripts/radar-feed.mjs` — consolida partidas Cito, registros imutáveis de V1/V2, odds de prints e resultados
- `public/laboratorio.html` — versão antiga preservada para auditorias e ferramentas técnicas
- `tests/radar-workflow.test.mjs` — evita retrocesso para partidas antigas e repetição de seleção no mesmo jogo

**Fontes e atualizações:** partidas e resultados via Cito, sincronização econômica diária no GitHub Actions; odds de screenshots fornecidos manualmente e **não** capturadas em tempo real. A interface sempre filtra pelo início da partida no horário atual. Se a fonte não trouxer novas partidas, exibe aviso explícito, nunca jogos de dias anteriores como se fossem disponíveis. Jogos sem preços podem aparecer como "sem odds cadastradas", sem números fabricados. As probabilidades são experimentais e não calibradas.

## Estado atual

- **Torneios monitorados inicialmente**: Stake Ranked Episode 6 e Tipsport RUSH Brno 2026. O radar usa os próximos confrontos dessas competições conforme a Cito; as oito partidas de 18/11 estão arquivadas.
- **Kills dos jogadores**: 16 escalações (80 jogadores identificados), com um subconjunto de históricos individuais por mapa; dados ausentes aparecem como indisponíveis, nunca são inventados.
- **Simulador CS2**: séries BO3, MR12, prorrogação, placar exato, total de rounds, handicap e modelo simplificado para kills.
- **Previsões congeladas**: arquivos datados antes do início das partidas para todos os mapas com cobertura suficiente. Mapas que não forem disputados não contam na validação.
- **Validação Cito**: Brier Score, amostra por mercado e correspondência com resultados oficiais recebidos **após** a partida. Antes da conclusão, os registros permanecem pendentes.
- **Base histórica**: importação CSV local e teste retrospectivo temporal 75% treino / 25% teste para uma formulação empírica simplificada.
- **Testes automáticos**: GitHub Actions valida sintaxe do JS e a matemática de previsões imutáveis, MR12/OT e resultados.

## Estrutura

| Caminho | Responsabilidade |
| --- | --- |
| `public/index.html` e `public/radar-*.js` | Nova interface de Radar / Estudo / Resultados, sem credenciais |
| `public/data/tournaments.json` | Agenda e histórico Cito de equipes |
| `public/data/players.json` | Escalações e estatísticas individuais por mapa |
| `public/data/predictions.json` | Probabilidades congeladas antes das partidas |
| `public/data/results.json` | Placar e kills pós-jogo, quando confirmados |
| `public/data/validation.json` | Erros por mercado e conferências |
| `public/data/sync-state.json` | Estado/consumo da sincronização |
| `scripts/model.mjs` | Geração e avaliação probabilística |
| `scripts/refresh.mjs` | Sincronização Cito via GitHub Actions |
| `.github/workflows/atlas-cito-sync.yml` | Atualização diária, com limite máximo de 7 requisições |
| `.github/workflows/atlas-ci.yml` | Testes automáticos de sintaxe e modelo |

## Sincronização automática ativa

A conexão Cito para a rotina GitHub Actions foi testada em 18/11/2026 UTC. O segredo `CITO_API_KEY` já estava salvo e **não foi necessário criar ou divulgar outra chave**. A primeira execução concluiu com sucesso: cinco requisições feitas, zero avisos, 16 escalações e 34 jogadores com estatísticas individuais por mapa. O commit automático foi `580cd6e`, com deploy da Vercel em produção.

- [Ver rotina programada no GitHub](https://github.com/adalgizagon-bot/edge-radar/actions/workflows/atlas-cito-sync.yml)
- [Abrir a plataforma](https://edge-radar-gamma.vercel.app/)

A execução está agendada **uma vez ao dia, 07:07 UTC (04:07 Brasília)**, com **até sete requisições Cito por execução** e espaçamento mínimo de sete segundos. A rotina revisa jogos futuros, resultados encerrados, uma escalação, uma equipe e até dois jogadores por execução conforme orçamento disponível. O limite teórico de 210 consultas em 30 execuções é adicional ao consumo de outras integrações da mesma conta; confira o painel Cito periodicamente.

O site é estático: o GitHub Actions consulta a API com o segredo protegido, grava novos arquivos JSON e a Vercel publica automaticamente o commit. A interface mostra a hora da última atualização, sem afirmar que os dados são ao vivo. Evite publicar a chave em arquivos ou mensagens.

## Força dos adversários e amostras de 365 dias (V0.7)

Nova aba **Força dos adversários**: confronto lado a lado para as 16 equipes acompanhadas, com 15 séries recentes por time (240 observações de equipe), placares, mapas realmente disputados e ranking dos adversários quando disponível. Os dados são da Cito. O ranking consultado em **17/11/2026** não corresponde necessariamente ao ranking no dia de cada partida. O ranking faltante aparece como indisponível.

Também foram consultados os **365 dias de estatísticas por mapa** das 16 equipes, além do histórico de 90 dias já existente. Essas janelas são **aninhadas**: não se deve somar 365+90 nem pressupor que resultados antigos sejam representativos da escalação atual. O painel compara a taxa de vitórias por mapa, o tamanho da amostra e os resultados recentes contra rivais do top 20, 21–50, 51–100, 101+ e sem ranking.

O indicador `acima/abaixo do esperado por ranking` compara os resultados com um **modelo simples e não calibrado** baseado na diferença entre rankings atuais e dá mais peso às partidas recentes (meia-vida de 45 dias). Trata-se de um **indicador exploratório**, não de probabilidade de vitória ou de suposta vantagem nas odds. Isso impede confundir mera taxa bruta de vitórias com a qualidade dos adversários, mas **não corrige completamente** mudanças de elenco, mapas, força da competição e ranking histórico.

Arquivos:
- `public/data/team-opponents.json` — até 15 séries completas por equipe com adversário e ranking conhecido
- `public/data/team-long-history.json` — mapas e vitórias dos últimos 365 dias
- `public/data/team-rankings.json` — fotografia datada do ranking Cito
- `public/strength.js`, `public/strength-core.js`, `public/strength.css` — interface e estatísticas explicativas
- `scripts/strength-sync.mjs` — normalização segura para atualizações diárias
- `tests/strength.test.cjs`, `tests/strength-sync.test.mjs` — testes de cobertura e filtragem temporal

A rotina diária do GitHub Actions continua limitada a **até sete requisições por execução**. Agora intercala resultados de partidas, estatísticas de 90 dias, últimos adversários de uma equipe, histórico de 365 dias (com ranking atualizado aos domingos) e dados de jogadores, conforme a quota disponível. Os 16 times são atualizados gradualmente. Os dados de contexto **não reescrevem previsões já congeladas**. Antes de usar força de adversários para alterar probabilidades de apostas, o novo método precisa ser comparado prospectivamente ao modelo anterior com os mesmos jogos e datas de corte.

## Radar pré-veto — mercados completos de BO3 (V0.6)

A página inicial agora compara 80 preços da BR365, transcritos de **oito prints fornecidos em 17/11/2026 por volta de 21h49 em Brasília**, com o histórico CS2 da Cito. São preços fotografados, **não cotações disponíveis em tempo real**. A plataforma não possui acesso à conta ou ao saldo da BR365.

Os mercados analisados antes do veto são: vencedor da série BO3, handicap de mapas da série (+1,5/−1,5), placar exato da série (2–0, 2–1, 0–2, 1–2) e total de mapas acima/abaixo de 2,5. Essas apostas são **independentes do veto para sua definição**, ao contrário de mercados de kills, rounds ou vencedor de um mapa específico.

No novo simulador, o veto é tratado como desconhecido. Ele usa apenas mapas nos quais as duas equipes disputaram pelo menos quatro partidas nos 90 dias de histórico. Enumera todas as sequências ordenadas possíveis de três mapas, atribuindo a **mesma importância a cada sequência**. Isso **não corresponde à distribuição real de vetos ou picks**, que depende das escolhas das equipes e de seu contexto. O modelo também não ajusta adequadamente a força dos oponentes ou mudanças de elenco, portanto suas probabilidades **não estão calibradas**.

Foi possível formar estimativas para **7 de 8 partidas**. Para BBL × Envy existem menos de três mapas em comum com amostra mínima, e por isso a plataforma exibe **somente preços da BR365** sem fabricar projeções. A equipe chamada de `Betclic` na Cito corresponde a `Betclic Apogee Esports`, apresentada como `Apogee Esports` na BR365. O identificador da partida é conferido.

As probabilidades de mercado sem margem são calculadas normalizando as probabilidades implícitas em cada família de mercado (vencedor, handicap, placar e total). A diferença em pontos percentuais entre esse valor e o modelo é uma **divergência para investigar** — não é evidência de lucro ou valor esperado positivo comprovado. Especialmente divergências enormes são suspeitas de erro de modelo. O construtor de cenários de 2, 3, 4 ou 8 jogos inclui no máximo **um mercado por partida** e não utiliza seleções de mapas que dependem de veto. Na configuração de 8 jogos, BBL × Envy pode constar com odd registrada, mas a probabilidade conjunta do modelo fica **indisponível**.

Arquivos:
- `public/data/br365-series-odds.json` — 80 cotações transcritas dos screenshots
- `scripts/series-model.mjs` — modelo teórico pré-veto e cálculo sem margem
- `public/data/series-forecasts.json` — previsões congeladas antes do começo
- `public/data/series-validation.json` — acertos e Brier Score de séries concluídas
- `public/series-radar.js`, `public/series-radar.css` — interface de radar e construtor
- `tests/series-model.test.mjs` — testes de consistência e regressão

A rotina GitHub Actions calcula a validação de séries encerradas quando a Cito confirma os placares. Os preços históricos nunca são reclassificados como odds atuais. Para mercados de mapas específicos, aguarde o veto confirmado e novos preços.

## Metodologia e precauções

O modelo usa rates de rounds da equipe em um mapa, suavizados, para calcular uma probabilidade simplificada por round; por simulação/distribuição MR12 e OT, obtém resultados por mapa, handicaps e totais. Kills usam taxa histórica individual por round e Poisson simplificada com duração projetada do mapa. **Não há calibração comprovada**, ajuste explícito por adversário, CT/TR, veto, elenco confirmado, patch, viés de seleção ou probabilidade de odds.

As previsões por mapa são criadas para todos os mapas candidatos com dados suficientes **antes da partida**. Só as partidas e mapas efetivamente disputados entram nas métricas; congelamentos antigos nunca são regravados. A data de origem e a hora do congelamento permanecem armazenadas, com trilha de commits GitHub. Métricas de precisão não comprovam lucro nem justificam dinheiro real.

As estatísticas da Cito estão sujeitas ao plano, cobertura e direitos de uso do provedor. Não revenda o feed bruto sem licença adequada. Não há integração com casas de apostas, execução automática ou apostas financeiras.

## Base histórica CSV opcional

Uma linha por jogador/mapa, repetindo `match_id` e o placar para vários jogadores do mesmo mapa:

```csv
date,match_id,team_a,team_b,map,rounds_a,rounds_b,player,player_team,kills
2026-01-05,EXEMPLO-001,Equipe A,Equipe B,Mirage,13,9,Jogador Exemplo,Equipe A,17
```

Esses dados são **fictícios** e ilustram apenas o esquema. Use dados históricos reais e identificadores únicos. O CSV fica no navegador, sem envio ao servidor. Para rodar localmente, abra `public/index.html`.

## Testar

```bash
node --test tests/model.test.mjs
node --check scripts/refresh.mjs
node --check public/players.js
node --check public/validation.js
```

O antigo simulador mantém seus testes em `tests/simulator.test.cjs`. A validação automatizada roda em `.github/workflows/atlas-ci.yml`.
