# Relatório da reconstrução

Entrega de desenvolvimento em 13/11/2026, na branch `rebuild/memecoin-radar-v1`. O commit correspondente é informado na entrega e pode ser consultado com `git log -1 --oneline`. **Nenhum deploy, push ou alteração de infraestrutura externa foi executado.**

## Recuperação verificada

O checkout estava limpo antes da remoção: não havia alterações locais nem arquivos não rastreados a preservar. Foram criados, antes do `git rm`:

- branch `backup/edge-radar-antes-reconstrucao`, apontando para `2dc7e9bb1983280503bfa5930db7913e1dd2c9db`;
- `/workspace/backups/edge-radar-before-rebuild-20261113T215706Z.tar.gz`, com checkout e `.git`; presença de `.git/HEAD` conferida;
- `/workspace/backups/edge-radar-20261113T215706Z.bundle`, verificado com `git bundle verify`.

O histórico anterior continua recuperável. Nenhum dado D1 remoto, wallet, secret, projeto Vercel ou recurso Cloudflare foi excluído. Processos locais do frontend e Worker antigos, iniciados no onboarding, foram encerrados. Nenhum código, tela, teste ou algoritmo anterior é importado pela nova implementação.

## Fase 1 — limpeza, arquitetura e interfaces

**Implementado e validado localmente:** limpeza com backup; backend Python modular; banco SQLite/WAL com migrações; frontend TypeScript estrito; seis áreas de navegação; detalhes por contrato com gráficos de amostras reais quando disponíveis; filtros; parâmetros persistidos com revisão; CI de validação sem deploy.

APIs usadas nesta fase: nenhuma API externa necessária. Instalação limpa via `npm ci`, build, TypeScript, ESLint, Ruff e interface desktop/mobile passaram. A persistência e as migrações passaram em testes. A arquitetura escolhida e as limitações para hospedagem estão em `ARCHITECTURE.md`.

**Falta para publicação:** autenticação e backend persistente hospedado; adaptação para D1/Workers ou alternativa gratuita validada. O servidor atual é exclusivamente local e não deve ser publicado como API administrativa aberta.

## Fase 2 — descoberta e persistência

**Implementado, mas não aceito ainda como funcional com mercado real:** adaptadores GeckoTerminal/DEX Screener; pools novos, tendências rotativas, perfis e reconsulta de contratos persistidos; três detectores independentes; histórico conservado; expiração explícita sem apagar dados; fonte, horário e pool por observação; cache preservando horário original; backoff, orçamento e lock.

Testes progressivos com fixtures isoladas demonstraram geração de aceleração após três coletas, deduplicação, preservação fora do ranking, falhas parciais e baseline histórico além de 360 amostras. Os testes **não** demonstram sucesso com mercado real.

**Bloqueio observado:** chamadas reais a DEX Screener e GeckoTerminal retornaram `403 Forbidden` no proxy; a coleta real registrou zero tokens, sem inventar observações. O painel mostra ambas as fontes indisponíveis. É necessário aplicar os domínios salvos no rascunho do ambiente, confirmar documentação/cotas e repetir a coleta. A retomada exige construir seu baseline de 24–48 h; o histórico anterior não é fabricado. **Fase 2 permanece pendente de validação externa.**

## Fase 3 — mercado, risco e scores

Implementados e testados com fixtures: momentum, fluxo, social, risco e oportunidade separados; pesos configuráveis; condições explicáveis; limites de frescor; comparações restritas à mesma fonte/pool; dados ausentes como desconhecidos; alertas de liquidez, autoridades e concentração por conta. Adaptador Solana RPC para mint/freeze, supply e maiores contas.

Não há auditoria completa de criador, carteiras associadas, coordenação, lock de LP, Token-2022 ou restrições de venda. Contas de token não são holders únicos. Não há classificação “seguro” ou probabilidade de lucro. Falta validar RPC e scores com dados reais e amostras independentes. Não foi realizado treinamento estatístico.

## Fase 4 — inteligência social

Implementados e testados com fixtures: adaptador Bluesky público por contrato exato; deduplicação de URI/contrato; autores, repetição, crescimento condicionado à cobertura de duas horas; termos compartilhados por pelo menos três autores; timing social versus preço/fluxo e interface com cobertura explícita.

Não há integração X, Reddit ou Telegram. Não há radar global que descobre narrativas antes de conhecer contratos, nem comprovação de bots. Documentação e API Bluesky estão bloqueadas pelo proxy, então a integração real e as condições atuais de acesso seguem pendentes. Nenhuma menção fictícia aparece no aplicativo.

## Fase 5 — entrada, simulador e desempenho

Implementados e testados prospectivamente com fixtures: estados e checklist; reavaliação antes da entrada; atraso configurável; adaptador Jupiter de duas rotas estimadas somente leitura; limites de recuperação/impacto; políticas congeladas; entradas manuais ou automáticas opt-in; saldo e concorrência; saídas por alvo/stop/prazo; gaps preenchidos pela cotação atual estimada; falhas preservadas como `exit_unavailable`; métricas por estratégia, categoria e condição.

Testes incluem perdas, rotas indisponíveis, cotação futura/expirada, ausência de look-ahead, duplicidade e custos. **Nenhuma operação real ou simulada com cotação real foi registrada.** Não há `JUPITER_API_KEY` no ambiente e o plano gratuito/endpoint atual não foi confirmado. Sem rota, não existe fill. Resultados fora da amostra e aprendizagem estatística ainda precisam de coleta histórica; não são prometidos.

## Fase 6 — qualidade e preparação

Verificado no ambiente atual:

- `npm ci --no-audit --no-fund`: passou, lockfile preservado;
- `npm run build`: passou;
- `npm run typecheck`: passou;
- `npm run lint`: ESLint, Ruff e formatação Python passaram;
- `npm test`: **61 testes de backend passaram**;
- `npm run test:ui`: **6 testes passaram**, em Chromium desktop e mobile;
- revisão das capturas desktop/mobile; sem transbordamento horizontal da página;
- API real local e frontend compilado responderam HTTP 200;
- estado real da coleta: zero tokens e HTTP 403 nos provedores; esse resultado é bloqueio, não sucesso de descoberta;
- backup online SQLite criado e verificado com `integrity_check`.

Os testes de UI usam banco temporário e respostas interceptadas identificadas como `TEST FIXTURE` apenas para o teste de detalhes. A base de mercado do aplicativo permanece vazia. Capturas do aplicativo real: `.runtime/screenshots/current-desktop.png` e `.runtime/screenshots/current-mobile.png`.

Não foi validado um ambiente novo restaurado/publicado, tampouco produção. Nenhuma API paga ou modelo de IA foi contratado ou chamado. O rascunho do ambiente deve conter instalação e inicialização desta nova versão, substituindo as instruções antigas de Wrangler.

## Próximo passo que desbloqueia o objetivo prioritário

Aplicar nas configurações do ambiente a liberação dos domínios listados em `SOURCES.md`. Depois: confirmar as documentações, executar coleta real, verificar persistência e observar o baseline necessário. Não considerar a reconstrução completa nem publicar antes dessa validação. A configuração de Jupiter é opcional para a descoberta e só deve ocorrer após confirmar acesso gratuito. Nunca enviar chaves pelo chat.
