# Fontes e integração externa

**Diagnóstico atualizado:** [continuação e evidências de rede](LIVE_VALIDATION.md). Os 403 foram confirmados no CONNECT do proxy; os dez hosts estão no rascunho, mas não na política aplicada. Não são respostas das APIs.

Acesso real tentado em 13/11/2026. O proxy retornou `Tunnel connection failed: 403 Forbidden` para documentações e APIs. **Não foi possível confirmar nesta sessão os termos, cotas vigentes, autenticação atual ou formatos por respostas reais.** Os adaptadores estão isolados e testados com fixtures de contrato, não certificados em produção. Nenhuma fonte de dados foi contratada.

| Fonte | Uso | Documentação oficial | Estado nesta entrega |
|---|---|---|---|
| DEX Screener | perfis recentes; preços e atividade por até 30 contratos por lote | https://docs.dexscreener.com/api/reference | Bloqueada pela política de rede |
| GeckoTerminal | pools novos e tendências Solana, páginas rotativas | https://apiguide.geckoterminal.com/ | Bloqueada pela política de rede |
| Solana RPC público | mint/freeze, supply, maiores contas | https://solana.com/docs/references/clusters | Adaptador testado; chamada real ainda não realizada |
| Bluesky público | pesquisa por contrato, posts/autores/horários | https://docs.bsky.app/docs/api/app-bsky-feed-search-posts | Bloqueada pela política de rede |
| Jupiter | cotações de leitura USDC↔token, sem swap ou taker | https://dev.jup.ag/docs/api-setup | Sem chave; plano gratuito e API a confirmar |

## Política conservadora local

Estes valores são **limites do aplicativo**, não uma afirmação sobre as cotas contratuais atuais dos fornecedores:

- Coleta geral: 180 segundos ou mais; teto de 24 requisições externas por rodada.
- Descoberta Gecko: duas consultas por rodada; espaçamento de três segundos por provedor.
- DEX: perfis e lotes de até 30 contratos, até três lotes por rodada; espaçamento de dois segundos.
- Segurança: até dois contratos por rodada, duas consultas RPC por contrato; rotação da fila. Em universos grandes, a auditoria pode expirar antes da próxima consulta, explicitamente bloqueando entrada.
- Social: até dois contratos por rodada; cache de dez minutos; até 30 posts por consulta.
- Jupiter: duas consultas por candidato e uma por posição monitorada. Não há chamada paga de IA.
- Timeout HTTP de sete segundos; resposta limitada a 4 MB; cache por URL/corpo. Cache não substitui disponibilidade.
- Backoff exponencial de dois minutos até uma hora. Respeita `Retry-After` em 429; a próxima rodada é a retentativa. Reservas de horário são atômicas por provedor e banco.

O orçamento e a cadência limitam a cobertura: não se garante detectar todo token ou cada movimento curto. Não anunciar tempo real. DEX profiles podem refletir campanhas promocionais; entrar na descoberta não confere qualidade. Comparações financeiras usam fonte e pool consistentes.

## Rede necessária

O rascunho do ambiente recebeu adições para:

- `api.dexscreener.com`, `docs.dexscreener.com`
- `api.geckoterminal.com`, `apiguide.geckoterminal.com`
- `public.api.bsky.app`, `docs.bsky.app`
- `api.mainnet-beta.solana.com`, `solana.com`
- `api.jup.ag`, `dev.jup.ag`

Salvar um rascunho não aplica a política ao processo atual. Aplique as alterações nas configurações do ambiente e depois repita a coleta e a leitura das documentações. Não desabilite TLS, não contorne o proxy e não substitua dados por fixtures para aparentar sucesso.

## Próxima validação com rede disponível

1. Confirmar termos, limites e endpoints na documentação oficial, registrando data e links.
2. Rodar `npm run collect` em banco real vazio e verificar contratos Solana, fontes e horários.
3. Repetir a coleta respeitando 180 s e confirmar atualização dos mesmos contratos, persistência após retirada do ranking e deduplicação.
4. Observar por pelo menos dez minutos para testar aceleração; pelo menos 24–48 horas para baseline de retomada. Não inventar histórico anterior ao início da coleta.
5. Verificar RPC com contrato conhecido e comparar com explorer; confirmar interpretação de contas de token, extensões e supply.
6. Confirmar acesso público Bluesky e duas horas de cobertura antes de medir crescimento.
7. Se houver plano gratuito Jupiter válido, validar suas unidades de impacto e slippage, rotas e autenticação com cotações somente leitura antes de habilitar simulação automática.

X, Reddit e Telegram não têm integração nesta versão. Não presumimos que scraping ou APIs irrestritas sejam permitidos. Um radar global de narrativas independente do universo conhecido continua pendente.
