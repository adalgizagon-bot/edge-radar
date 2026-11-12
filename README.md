# Edge Radar Crypto — somente Pump.fun / PumpSwap

Monitor de descoberta e filtragem de tokens em Solana, sem carteira, chaves privadas ou execução de trades reais.

## Funcionalidades
- Evento de novos lançamentos e migrações Pump.fun por um único WebSocket da PumpPortal.
- Pools recentes e em tendência da PumpSwap via GeckoTerminal, com filtro de DEX antes de exibir tokens.
- Enriquecimento com preço, liquidez, volume, preço 5 min e quantidade de compras/vendas via DEX Screener.
- Separação entre **Oportunidades em análise**, **Observação**, **Novos**, **Todos** e **Favoritos**. Sem preço fresco, token só aparece nas listas de descoberta/observação, nunca como oportunidade.
- Links de investigação manual em X, Google Notícias e Pump.fun. **Não há análise automática de sentimento social** nesta versão.
- Simulador local de compra e venda com custos estimados, sem operações reais e sem custódia.

## Executar
Site estático: abrir `public/index.html` por um servidor HTTP local, ou publicar pasta `public/` na Vercel. Em alguns navegadores, chamadas de APIs externas podem falhar por CORS, rate limit ou bloqueadores. A interface exibe esses erros em vez de fabricar dados.

## Rodar testes
`node --test tests/test_edge_crypto.cjs`

## Arquitetura e limites
- O browser precisa permanecer aberto para eventos ao vivo; não existe serviço 24/7.
- Apenas `subscribeNewToken` e `subscribeMigration` gratuitos. Trades individuais em streaming são pagos e **não ativados**. Uma única conexão WebSocket.
- Pools GeckoTerminal são consultados a cada 45 segundos (2 requisições por consulta, no máximo). Quotes DEX Screener em lotes de 30 tokens a cada 8 segundos, limite de 90 endereços por ciclo.
- Fontes públicas podem ter atraso, liquidez ou volume faltantes; filtros não estimam lucro nem chance real de valorização.
- **Não** armazenar chave de carteira ou API privada no frontend, repositório ou no navegador.
- Dados favoritos, eventos recentes e simulação ficam no `localStorage` deste navegador; se limpar os dados, perderá esses registros.

## Fontes
- https://pumpportal.fun/data-api/real-time/
- https://pumpportal.fun/fees/
- https://api.geckoterminal.com/docs/index.html
- https://docs.dexscreener.com/api/reference

## Migração da antiga versão
Este repositório foi convertido inteiramente para cripto a pedido do proprietário. As rotinas de CS2, arquivos de histórico esportivo, testes antigos e workflows esportivos foram retirados da branch principal. O histórico do Git continua guardando commits anteriores, sem executá-los no site atual.