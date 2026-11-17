# ATLAS Esports Lab — CS2 (versão de pesquisa)

Nova aplicação do repositório edge-radar. O código antigo está preservado em `backup/edge-radar-2026-11-17`.

## O que está funcional

- Painel CS2 responsivo com simulação determinística de séries BO3 e MR12;
- probabilidades de vitória por mapa, BO3, placar 2–0/2–1, total de rounds, handicap, kills no mapa e série;
- importação CSV de mapas concluídos, datas e estatísticas opcionais de um jogador;
- estimativa empírica de probabilidades por round e kills/round a partir do histórico importado, com suavização bayesiana;
- teste retrospectivo com divisão temporal 75% treino / 25% teste, Brier Score vs. referência simples;
- registro e resolução local das previsões e exportação CSV.

## Como usar

Acesse o site publicado ou abra `public/index.html` localmente. Na aba **Base histórica**, importe CSV com 1 linha por partida **e mapa** (não uma linha por jogador). Cabeçalho:

```csv
date,match_id,team_a,team_b,map,rounds_a,rounds_b,player,player_team,kills
2026-01-05,EXEMPLO-001,Equipe A,Equipe B,Mirage,13,9,Jogador Exemplo,Equipe A,17
2026-01-07,EXEMPLO-002,Equipe C,Equipe D,Inferno,11,13,Outro Jogador,Equipe D,22
```

Os registros acima são FICTÍCIOS, apenas para documentar o formato. Não foram pré-carregados no app. Para testes sérios, importe dados históricos reais, obtidos licitamente, com identificadores únicos e fontes verificáveis. Campos obrigatórios: date, match_id, team_a, team_b, map, rounds_a, rounds_b. O dataset fica apenas no localStorage do dispositivo. Com várias linhas para jogadores de um mesmo mapa, a importação atual conserva somente uma linha por ID/mapa: esta limitação será corrigida em uma próxima versão com tabelas de mapas e jogadores separadas.

**Data de corte**: use uma data ANTERIOR ao início da partida a ser prevista para evitar vazamento de dados futuros. O backtest avalia resultados de mapas, não mercados financeiros.

## Limites metodológicos

Os parâmetros são gerados por médias regularizadas: equipe por mapa e jogador por round. O motor NÃO considera lado CT/TR, diferenças de qualidade do adversário, alterações de elenco, veto, side swaps, patch, duração real variável de rodada, ajustes intra-mapa ou calibração prospectiva. A probabilidade exibida mede o comportamento do simulador, **não** uma taxa confiável de acerto real. Resultados históricos não implicam rentabilidade futura. Não há execução ou recomendação de apostas.

## Status API Cito

O teste básico retornou resposta, mas consultas protegidas falharam com HTTP 403 e `API_KEY_REVOKED`. Para não expor chaves no frontend, a versão publicada usa CSV local. Não há dados ao vivo reais ou integração protegida em funcionamento. Qualquer conexão futura deve ocorrer somente por backend privado, após regularizar credenciais e direitos de uso.

## Testes

`node tests/simulator.test.cjs` — verifica consistência BO3, limites, casos simétricos, força, parsing CSV e regulação dos parâmetros.

## Tecnologia e custos

HTML, CSS, JavaScript no navegador e Vercel static hosting. Sem serviços de cobrança, operações de dinheiro ou dependências de instalação. A aplicação NÃO cria filas, crons ou chamadas externas; evita consumo inesperado de servidores.