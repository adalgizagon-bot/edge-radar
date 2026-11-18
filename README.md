# ATLAS Esports Lab — CS2

Painel estatístico de pesquisa para **Counter-Strike 2**, publicado em https://edge-radar-gamma.vercel.app/ e ligado à Vercel pelo repositório GitHub `adalgizagon-bot/edge-radar`. O projeto antigo de criptomoedas ficou preservado na ramificação `backup/edge-radar-2026-11-17`.

## Estado atual

- **Torneios em teste**: Stake Ranked Episode 6 e Tipsport RUSH Brno 2026, com 8 partidas previstas em 18/11/2026 e estatísticas de 16 equipes obtidas via Cito API.
- **Kills dos jogadores**: 16 escalações (80 jogadores identificados), com um subconjunto de históricos individuais por mapa; dados ausentes aparecem como indisponíveis, nunca são inventados.
- **Simulador CS2**: séries BO3, MR12, prorrogação, placar exato, total de rounds, handicap e modelo simplificado para kills.
- **Previsões congeladas**: arquivos datados antes do início das partidas para todos os mapas com cobertura suficiente. Mapas que não forem disputados não contam na validação.
- **Validação Cito**: Brier Score, amostra por mercado e correspondência com resultados oficiais recebidos **após** a partida. Antes da conclusão, os registros permanecem pendentes.
- **Base histórica**: importação CSV local e teste retrospectivo temporal 75% treino / 25% teste para uma formulação empírica simplificada.
- **Testes automáticos**: GitHub Actions valida sintaxe do JS e a matemática de previsões imutáveis, MR12/OT e resultados.

## Estrutura

| Caminho | Responsabilidade |
| --- | --- |
| `public/index.html` e `public/*.js` | Interface web estática, sem credenciais |
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
