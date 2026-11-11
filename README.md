# CS2 Edge — integração Cito API (versão inicial)

**O que funciona:** radar pré-live com agenda e histórico real da Cito, 100 registros reais de jogador por mapa (4 séries), 7 confrontos pré-jogo, 40 equipes ranqueadas e 1.356 cenários exploratórios (não recomendações). Inclui Tier 1/2, filtros, jogos específicos, mercado de rounds e cadastro/comparação de odds **manuais** por casa. O HTML abre offline com snapshot datado de 11/11/2026.

**O que ainda não está pronto:** publicar esta versão em substituição ao site `creativechant2.chatgpt.site`, automatizar atualização no domínio anterior e construir projeções calibradas de acerto. Este pacote não inclui a fonte do projeto Creativechant; é um painel independente e importador que podemos integrar quando houver acesso ao código do site original.

## 1. Abrir o painel agora

Abra `public/index.html` no navegador. Ele possui fallback embutido com 100 linhas de estatísticas reais de jogadores por mapa, consultadas via Cito API em 11/11/2026. Nenhuma odd é inventada. As 100 linhas são **estatísticas por mapa**. O radar mostra frequências históricas, nunca estimativas validadas de probabilidade. Como cada jogador tem apenas 2–3 mapas na amostra inicial, nenhum cenário é considerado validado.

Em um servidor, o HTML tenta carregar `public/data/snapshot.json` automaticamente. Também permite escolher um JSON pelo botão **Importar JSON** para atualização nesta sessão.

## 2. Conseguir uma chave grátis

Visite https://dashboard.citoapi.com/ e crie uma chave pessoal Cito API; leia https://citoapi.com/docs/quickstart/ e https://citoapi.com/terms/.

O plano gratuito divulgado tem 500 consultas por 30 dias e histórico detalhado de 30 dias; a API está em beta. A Cito permite análises para apostadores individuais, mas não oferece feeds oficialmente licenciados de apostas. Antes de uso comercial/redistribuição, confirme direitos e condições.

**A conexão MCP da Cito no ChatGPT não injeta automaticamente o segredo no servidor web.** Para atualizar o site, a implantação requer um segredo de servidor separado. **Não cole sua chave em chat, HTML, GitHub ou Vercel variável `NEXT_PUBLIC_*`.** Salve em segredo do servidor ou em GitHub Actions Secret `CITO_API_KEY`.

## 3. Rodar o importador

**Windows PowerShell** (na pasta do projeto):

```powershell
$env:CITO_API_KEY = "sua_chave_pessoal"
python scripts/sync_cito.py
python -m http.server 8000 --directory public
```

**Linux/macOS**:

```bash
export CITO_API_KEY="sua_chave_pessoal"
python3 scripts/sync_cito.py
python3 -m http.server 8000 --directory public
```

Abra http://localhost:8000. O script busca `/rankings/world`, `/matches/upcoming`, `/matches/past?days=7` e estatísticas por mapa de até dez séries elegíveis por execução. **Não busca odds**, não usa HLTV nem BO3.gg por scraping e nunca envia a chave ao navegador.

O script mantém `data/request_history.json` para limitar a cota local dos últimos 30 dias a 450, até 10 consultas por execução no GitHub Actions (espaçadas em 6,2 segundos para respeitar 10 chamadas/minuto), e uma margem de pelo menos 25 solicitações de reserva quando os cabeçalhos de limite vêm da API. O registro precisa persistir (e não ser apagado) para funcionar entre execuções. Cotas reais do provedor prevalecem.

> Primeira sincronização substitui o snapshot fixo; esta atualização só ocorre após inserir uma chave válida e executar o script. Sem acesso de rede externo, o importador não consegue buscar novos dados.

## 4. Publicação automática em novo projeto no GitHub + Vercel (opcional)

1. Crie um repositório **privado** no GitHub e envie os arquivos deste projeto.
2. Na página **Settings → Secrets and variables → Actions**, crie o segredo `CITO_API_KEY`.
3. Na aba **Actions**, abra **Atualizar CS2 Edge (Cito API)** e execute **Run workflow** uma vez. A agenda fica configurada para **uma execução por dia** (máximo configurado de ~300 requisições em 30 dias no GitHub Actions), respeitando também o orçamento local.
4. Importe o repositório na Vercel como **Other**. `vercel.json` publica `public/` como site estático. Cada commit do workflow com JSON atualizado aciona novo deploy.

Para integrar ao **CS2 Edge Analytics já publicado** (Creativechant), precisamos editar o código-fonte daquele projeto e apontar a interface para `snapshot.json`. Este pacote ainda não altera aquele domínio.

## 5. Critérios de análise

- **Tier 1** = equipes do confronto ambas entre as posições 1 e 16 do ranking atual.
- **Tier 2** = equipes do confronto ambas entre 1 e 40, sem ser Tier 1.
- **Não classificada** = ranking ausente ou confronto misto. Esta é uma definição operacional, não o tier oficial do torneio.
- Estatísticas por mapa são deduplicadas por `(mapId, playerId)`.
- Dados de forfeits (W.O.) não entram no histórico de jogadores.
- Para o laboratório, menos de 12 observações = amostra insuficiente. A partir de 12, exibe a frequência e o limite inferior do intervalo Wilson 95%. Um alerta exploratório só aparece se houver pelo menos 20 observações e esse limite inferior superar a probabilidade implícita na odd. **Isto não é um modelo de probabilidade calibrado nem demonstra vantagem lucrativa.**
- A janela da API grátis é de 30 dias, e o arquivo preserva apenas registros detalhados elegíveis nessa janela. Para um modelo estatístico robusto será necessário coletar histórico suficiente, monitorar mudanças de elenco e validar previsões por *backtesting* sem vazamento de dados.
- O painel guarda odds apenas no `localStorage` do navegador; nenhuma casa é conectada.

## 6. Testes locais

```bash
python -m unittest discover -s tests -v
```

Os testes verificam tiers, normalização de rankings e partidas, conversão de kills por mapa, orçamento de chamadas e exclusão de duplicatas.

## Documentação

- https://citoapi.com/docs/quickstart/
- https://dashboard.citoapi.com/docs/api/cs2/matches/
- https://dashboard.citoapi.com/docs/api/cs2/rankings/
- https://citoapi.com/docs/rate-limits/
- https://citoapi.com/terms/

## Atualização verificada em 11/11/2026

- Conexão Cito MCP autenticada; plano Free verificado, com 500 consultas/30 dias, limite de 10 chamadas/minuto.
- Dados reais iniciais: 40 equipes, 7 próximas partidas elegíveis, 4 séries concluídas e 100 linhas de jogadores por mapa; nada é simulado.
- O painel gera 1.356 cenários *exploratórios* (mercado, linha e direção) a partir do histórico de um ou mais jogos em que a equipe participa. Com menos de 12 mapas não há diagnóstico de acerto; elencos, mapas e vetos futuros não são confirmados por esse levantamento.
- Uma casa/odd inserida é vinculada ao ID do jogo, de modo que a comparação não mistura partidas diferentes. Odds ficam no `localStorage` do navegador.
- O script descarta mapas marcados como não disputados, conserva IDs de jogador/mapa e evita contagens duplicadas.
- A versão publicada no endereço Creativechant não foi alterada: só é possível substituí-la quando houver acesso de edição/deploy desse projeto.

### Verificação local

`python -m unittest discover -s tests -v` testa normalizadores, controle de cotas, rejeição de mapas não disputados e dados de demonstração. A interface foi aberta em Chromium e foram verificados o radar, a análise de linha e as odds manuais.


## 7. Implantação pessoal sem mensalidade: GitHub + Vercel

- **GitHub Free:** repositório privado e GitHub Actions dentro da franquia mensal; não habilite pagamento extra nem runners pagos. O workflow já está limitado a no máximo 10 requisições Cito por execução, 1 execução ao dia, com orçamento local de 300/30 dias. O restante da franquia Cito pode ser usado pelo acesso MCP e testes manuais.
- **Vercel Hobby:** importar repositório e publicar `public/` como site estático, sem função serverless, banco, middleware, otimização dinâmica de imagem ou cron Vercel. Uso **somente pessoal/não comercial** pelas regras do Hobby. Habilite configurações de proteção contra tráfego abusivo na Vercel quando disponíveis.
- **Segredo:** criar `CITO_API_KEY` em GitHub → Settings → Secrets and variables → Actions. Não colocar a chave em arquivo do GitHub nem em variável pública da Vercel. A API só é consultada no GitHub Actions; o navegador carrega snapshot estático.
- **Atualização:** o workflow salva JSON e faz commit quando houver mudanças; integração Git com Vercel publica a versão atualizada. Conferir permissões `Actions` para gravação no repositório privado se o push do bot falhar.
- **Atenção:** partidas e estatísticas publicadas via Vercel são visíveis para quem possuir o URL, apesar do código estar em repositório privado. Não usar como produto comercial sem verificar contratos e licenças dos fornecedores.
- **Diagnóstico:** execute `python -m unittest discover -s tests -v` (8 testes) antes do primeiro deploy.

## Atualização: histórico ampliado por jogador (11/11/2026)

A coleta de detalhes foi remodelada: `/cs2/players/{playerId}/maps?limit=100` fornece até 100 mapas por consulta. O importador faz filtro local estrito de **30 dias**, pois alguns endpoints podem ignorar `days`. A rotina diária (10 consultas) inclui ranking, agenda, últimos resultados, atualização de um elenco, um jogo ainda não indexado e até 5 jogadores. A rotina conserva dados já importados e os deduplica por ID de mapa e jogador. Resultados anteriores também são preservados por 30 dias. O objetivo é aumentar amostras sem consumir a franquia de 500 consultas/mês; o orçamento local continua em 300/30 dias.

Se o GitHub Actions acusar **HTTP 401**, o segredo foi configurado, porém o servidor recusou seu conteúdo. A chave MCP, o link MCP e os códigos `cito_setup_...` não são necessariamente uma chave REST. No [dashboard da Cito](https://dashboard.citoapi.com/) crie/copiei uma **API Key pessoal de dados**, geralmente iniciada por `cito_` (ou `cito_live_`), e substitua o segredo `CITO_API_KEY` no GitHub. Não envie a chave pelo chat.

**Não existe certeza de lucro:** frequências históricas são descrições, não probabilidades calibradas; mudanças de elenco, adversário e seleção de mapa exigem validação.