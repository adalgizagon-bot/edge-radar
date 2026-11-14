type Nullable = number | null;
type Snapshot = {
  mint: string;
  name: string;
  symbol: string;
  source: string;
  pool: string | null;
  observed_at: number;
  price: Nullable;
  liquidity: Nullable;
  volume5m: Nullable;
  volume24h: Nullable;
  market_cap: Nullable;
  fdv: Nullable;
  buys: Nullable;
  sells: Nullable;
  unique_buyers: Nullable;
  change5m: Nullable;
  change1h: Nullable;
  change24h: Nullable;
};
type Check = {
  key: string;
  label: string;
  passed: boolean | null;
  change: string;
};
type Assessment = {
  short_window?: {
    elapsed_seconds: Nullable;
    changes_pct: Record<string, Nullable>;
  };
  state: string;
  label: string;
  scores: Record<string, Nullable>;
  radars: Record<
    string,
    { eligible: boolean; detected: boolean; reason: string }
  >;
  checks: Check[];
  flags: string[];
  missing: string[];
  limitations: string[];
  deltas: Record<string, Nullable>;
  observed_at: number;
  history_status?: {
    acceleration: string;
    revival: string;
    same_pool_spaced_samples: number;
  };
  selected_strategy: string | null;
  social_timing: string;
};
type Narrative = {
  topic: string;
  authors: number;
  mint: string;
  source: string;
  observed_at: number;
};
type Token = {
  token: {
    mint: string;
    name: string;
    symbol: string;
    pool_created: Nullable;
    active: number;
    first_seen: number;
    last_seen: number;
    inactive_reason: string | null;
  };
  latest: Snapshot | null;
  assessment: Assessment;
  social: {
    mentions: Nullable;
    authors: Nullable;
    growth_pct: Nullable;
    repetition: Nullable;
    score: Nullable;
    complete: boolean;
    coverage_complete: boolean;
    last_check: Nullable;
    limitations: string[];
    narratives: Narrative[];
  };
  security: Record<string, unknown> | null;
  history?: Snapshot[];
  assessment_history?: Assessment[];
};
type Strategy = {
  enabled: boolean;
  take_profit: number;
  stop_loss: number;
  max_minutes: number;
};
type Config = {
  version: number;
  min_liquidity: number;
  min_volume5m: number;
  new_hours: number;
  revival_days: number;
  active_days: number;
  collect_seconds: number;
  refresh_seconds: number;
  stale_seconds: number;
  max_price_change5m: number;
  max_holder_pct: number;
  social_enabled: boolean;
  security_enabled: boolean;
  paper_auto: boolean;
  paper_latency_seconds: number;
  paper_usd: number;
  paper_initial_usd: number;
  paper_max_open: number;
  slippage_bps: number;
  network_fee_usd: number;
  strategies: Record<string, Strategy>;
  weights: Record<string, number>;
};
type Metrics = {
  closed: number;
  open: number;
  wins: number;
  win_rate: Nullable;
  net_pnl: number;
  mean_win: Nullable;
  mean_loss: Nullable;
  expectancy: Nullable;
  profit_factor: Nullable;
  max_drawdown_usd: number;
  balance_realized: number;
  sample_sufficient: boolean;
  note: string;
};
type Trade = {
  id: number;
  mint: string;
  strategy: string;
  category: string;
  regime: string;
  opened_at: number;
  closed_at: Nullable;
  status: string;
  entry_cost: number;
  exit_value: Nullable;
  pnl: Nullable;
  reason: string | null;
};
type Source = {
  name: string;
  status: string;
  last_attempt?: Nullable;
  last_success: Nullable;
  next_attempt?: number;
  failures?: number;
  requests?: number;
  error: string | null;
};
type ResearchGroup = {
  horizon: number;
  detector_group: string;
  cohorts: number;
  matched: number;
  paired_observed: number;
  unavailable_pairs: number;
  mean_excess_return_pct: Nullable;
  mean_alert_return_pct: Nullable;
  mean_control_return_pct: Nullable;
  mean_alert_net_scenario_usd: Nullable;
  mean_control_net_scenario_usd: Nullable;
  contaminated_controls: number;
};
type Overview = {
  research?: {
    cohorts: number;
    groups: ResearchGroup[];
    recent: {
      id: string;
      alert_mint: string;
      control_mint: string | null;
      alert_at: number;
      outcomes: {
        role: string;
        horizon: number;
        status: string;
        data: {
          gross_return_pct: Nullable;
          min_observed_liquidity: Nullable;
          net_scenario_usd: Nullable;
          executable_net_usd: Nullable;
        };
      }[];
    }[];
  };

  tracking?: {
    tracked: number;
    due: number;
    gaps: {
      mint: string;
      started_at: number;
      ended_at: Nullable;
      reason: string;
    }[];
    signals: {
      id: number;
      mint: string;
      kind: string;
      observed_at: number;
      price_observed_at: number;
      price: number;
    }[];
    outcomes: {
      signal_id: number;
      horizon: number;
      status: string;
      data: string;
    }[];
  };
  tokens: Token[];
  total_tokens: number;
  sources: Source[];
  last_run: {
    started_at: number;
    finished_at: Nullable;
    status: string;
    data: string | null;
  } | null;
  collecting: boolean;
  config: Config;
  config_revision: number;
  now: number;
  paper: {
    trades: Trade[];
    metrics: Metrics;
    by_strategy: Record<string, Metrics>;
    by_category: Record<string, Metrics>;
    by_regime: Record<string, Metrics>;
    quote_available: boolean;
    methodology: string;
  };
  narratives: Narrative[];
  limits: string[];
};
const app = document.querySelector<HTMLDivElement>("#app")!;
const detail = document.querySelector<HTMLDialogElement>("#detail")!;
const names: Record<string, string> = {
  overview: "Visão geral",
  radar: "Radar de moedas",
  social: "Radar social",
  paper: "Simulador",
  settings: "Configurações",
};
const strategies: Record<string, string> = {
  early: "Aceleração inicial",
  continuation: "Continuação de tendência",
  revival: "Retomada de interesse",
};
let page = window.location.hash.slice(1) || "overview";
if (!names[page]) page = "overview";
let data: Overview | null = null;
let archive: {
  tokens: Token[];
  total: number;
  offset: number;
  limit: number;
} | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let filters = {
  search: "",
  radar: "all",
  state: "all",
  risk: "all",
  age: "all",
  liquidity: "",
  volume: "",
};
const esc = (x: unknown): string =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const fmt = (n: Nullable | undefined, digits = 0): string =>
  n == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(
        n,
      );
const usd = (n: Nullable | undefined, digits = 0): string =>
  n == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: digits,
      }).format(n);
const compact = (n: Nullable | undefined): string =>
  n == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
const date = (at: Nullable | undefined): string =>
  at == null
    ? "Não observado"
    : new Date(at * 1000).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
const age = (at: Nullable): string =>
  at == null
    ? "Desconhecida"
    : data!.now - at >= 86400
      ? `${Math.floor((data!.now - at) / 86400)}d`
      : `${Math.floor((data!.now - at) / 3600)}h`;
const pct = (n: Nullable | undefined): string =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n, 1)}%`;
const empty = (title: string, text: string): string =>
  `<div class="empty"><div class="empty-icon" aria-hidden="true">⌁</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
function toast(text: string): void {
  const el = document.querySelector<HTMLDivElement>("#toast")!;
  el.textContent = text;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 6500);
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 45000);
  try {
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: c.signal,
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
    return json as T;
  } finally {
    clearTimeout(t);
  }
}
function sourceTag(s: Source): string {
  const text: Record<string, string> = {
    ok: "Disponível",
    unavailable: "Indisponível",
    stale: "Desatualizada",
    not_checked: "Não verificada",
    unknown: "Aguardando",
  };
  return `<span class="tag ${s.status === "ok" ? "good" : s.status === "unavailable" ? "bad" : "warn"}">${esc(text[s.status] || s.status)}</span>`;
}
function stateTag(a: Assessment): string {
  return `<span class="tag ${a.state === "validated" ? "good" : a.state === "high_risk" ? "bad" : a.state === "accelerating" ? "good" : "warn"}">${esc(a.label)}</span>`;
}
function stat(
  label: string,
  value: string,
  foot: string,
  accent = false,
): string {
  return `<article class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value ${accent ? "accent" : ""}">${esc(value)}</div><div class="stat-foot">${esc(foot)}</div></article>`;
}
function sources(): string {
  return data!.sources
    .map(
      (s) =>
        `<div class="source"><strong>${esc(s.name)}</strong>${sourceTag(s)}<p>${s.last_success ? "Último sucesso: " + date(s.last_success) : "Nenhuma resposta confirmada"}${s.error ? " · " + esc(s.error) : ""}${s.next_attempt && s.next_attempt > data!.now ? " · Nova tentativa após " + date(s.next_attempt) : ""}</p></div>`,
    )
    .join("");
}
function table(tokens: Token[], full = false): string {
  if (!tokens.length)
    return empty(
      data!.total_tokens
        ? "Nenhum contrato corresponde aos filtros"
        : "Aguardando descobertas verificáveis",
      data!.total_tokens
        ? "Ajuste os filtros para consultar o histórico preservado."
        : "O coletor só registra tokens recebidos das fontes. Consulte a situação das APIs; nenhum dado demonstrativo é exibido.",
    );
  return `<div class="table-scroll"><table><thead><tr><th>Moeda / contrato</th><th>Idade do pool</th><th>Capitalização</th><th>Liquidez</th><th>Volume 5m</th><th>Preço 5m</th><th>Compras / vendas</th>${full ? "<th>Mom. / fluxo / social / risco</th>" : "<th>Momentum</th>"}<th>Classificação</th><th>Fonte / observação</th></tr></thead><tbody>${tokens
    .map((t) => {
      const x = t.latest,
        a = t.assessment;
      return `<tr data-mint="${esc(t.token.mint)}"><td><div class="token-name"><div class="token-avatar" aria-hidden="true">${esc(t.token.symbol.slice(0, 2))}</div><div><button class="link-button" data-detail="${esc(t.token.mint)}"><b>${esc(t.token.symbol)}</b></button><div class="tiny">${esc(t.token.name.slice(0, 24))}</div><div class="tiny mono">${esc(t.token.mint.slice(0, 5))}…${esc(t.token.mint.slice(-5))}</div></div></div></td><td>${age(t.token.pool_created)}</td><td>${compact(x?.market_cap ?? x?.fdv)}<div class="tiny">${x?.market_cap != null ? "Market cap" : x?.fdv != null ? "FDV" : "Não informado"}</div></td><td>${usd(x?.liquidity)}</td><td>${usd(x?.volume5m)}</td><td class="${(x?.change5m ?? 0) >= 0 ? "positive" : "negative"}">${pct(x?.change5m)}</td><td><span class="positive">${fmt(x?.buys)}</span> / <span class="negative">${fmt(x?.sells)}</span><div class="tiny">transações, não pessoas</div></td><td>${full ? ["momentum", "flow", "social", "risk"].map((k) => `<span class="score" title="${k}">${fmt(a.scores[k])}</span>`).join(" / ") : `<span class="score">${fmt(a.scores.momentum)}</span>`}</td><td>${stateTag(a)}</td><td>${esc(x?.source ?? "—")}<div class="tiny">${date(x?.observed_at)}${x && data!.now - x.observed_at > data!.config.stale_seconds ? " · desatualizado" : ""}</div></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function radarCards(): string {
  return `<div class="radar-grid">${[
    [
      "A",
      "new",
      "Novos lançamentos",
      "Idade do pool ≤ " + data!.config.new_hours + " horas.",
    ],
    [
      "B",
      "acceleration",
      "Em aceleração",
      "Mudança sustentada de volume e fluxo.",
    ],
    [
      "C",
      "revival",
      "Em retomada",
      "Pools antigos + reativação sobre baseline histórico.",
    ],
  ]
    .map(
      ([letter, key, title, text]) =>
        `<article class="radar-card"><span class="letter">RADAR ${letter}</span><b>${data!.tokens.filter((t) => t.assessment.radars[key!]?.detected).length}</b><h3>${esc(title)}</h3><p class="sub">${esc(text)}</p><button class="link-button" data-radar="${key}">Investigar radar →</button></article>`,
    )
    .join("")}</div>`;
}
function overviewPage(): string {
  const d = data!,
    metrics = d.paper.metrics;
  return `<div class="stats">${stat("Contratos preservados", fmt(d.total_tokens), "Histórico persistente · Solana", true)}${stat("Acelerações identificadas", fmt(d.tokens.filter((t) => t.assessment.radars.acceleration?.detected).length), "3 amostras comparáveis · mínimo 10 min")}${stat("Alertas de risco", fmt(d.tokens.filter((t) => t.assessment.flags.length).length), "Alertas observados, não auditoria completa")}${stat("Resultado líquido simulado", metrics.closed ? usd(metrics.net_pnl, 2) : "—", metrics.closed ? `${metrics.closed} operações encerradas` : "Sem operações encerradas")}</div>${radarCards()}<section class="panel"><div class="panel-head"><div><h2>Últimas moedas observadas</h2><p class="sub">Contratos reais · condições e evidências por moeda</p></div><button class="secondary compact" data-nav="radar">Abrir radar ↗</button></div>${table(d.tokens.filter((t) => t.token.active).slice(0, 8))}<div class="data-notes">Scores são heurísticos. “—” indica dados insuficientes. Novidade e popularidade não constituem sinal de entrada.</div></section><div class="panel-grid"><section class="panel"><div class="panel-head"><div><h2>Inteligência de narrativas</h2><p class="sub">Associação por contrato · autores independentes observados</p></div><button class="secondary compact" data-nav="social">Explorar ↗</button></div>${narratives()}</section><section class="panel"><div class="panel-head"><h2>Situação das fontes</h2><span class="tag">${d.sources.filter((s) => s.status === "ok").length}/${d.sources.length} disponíveis</span></div><div class="panel-body">${sources()}</div></section></div>`;
}
function filtered(): Token[] {
  return (archive?.tokens ?? data!.tokens).filter((t) => {
    const x = t.latest,
      a = t.assessment,
      f = filters;
    const poolAge = t.token.pool_created
      ? data!.now - t.token.pool_created
      : null;
    return (
      (!f.search ||
        `${t.token.name} ${t.token.symbol} ${t.token.mint}`
          .toLowerCase()
          .includes(f.search.toLowerCase())) &&
      (f.radar === "all" || a.radars[f.radar]?.detected) &&
      (f.state === "all" || a.state === f.state) &&
      (f.risk === "all" ||
        (f.risk === "alert"
          ? a.flags.length > 0
          : f.risk === "incomplete"
            ? a.scores.risk == null
            : a.scores.risk != null && a.flags.length === 0)) &&
      (f.age === "all" ||
        (poolAge != null &&
          (f.age === "new" ? poolAge <= 86400 : poolAge > 86400))) &&
      (!f.liquidity ||
        (x?.liquidity != null && x.liquidity >= Number(f.liquidity))) &&
      (!f.volume || (x?.volume5m != null && x.volume5m >= Number(f.volume)))
    );
  });
}
const options = (values: [string, string][], selected: string): string =>
  values
    .map(
      ([v, l]) =>
        `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(l)}</option>`,
    )
    .join("");
function trackingPanel(): string {
  const t = data!.tracking;
  if (!t) return "";
  return `<section class="panel gap-top"><div class="panel-head"><h2>Continuidade e avaliação dos alertas</h2><span class="tag">${t.tracked} acompanhados · ${t.due} pendentes</span></div><div class="panel-body"><p class="sub">${t.gaps.filter((g) => g.ended_at === null).length} lacunas abertas nas últimas 100 registradas. Sair do ranking não remove o contrato da fila. Histórico insuficiente permanece identificado.</p><p class="sub">Horizontes de 5, 15, 30 e 60 min usam a mesma fonte e pool, com tolerância de 3 min. Máximas e mínimas são apenas das amostras; não representam retorno executável.</p>${
    t.signals.length
      ? `<div class="table-scroll"><table><thead><tr><th>Alerta</th><th>Contrato</th><th>Horário do alerta / preço</th><th>Preço observado</th><th>Acompanhamento</th></tr></thead><tbody>${t.signals
          .map(
            (s) =>
              `<tr><td>${esc(s.kind)}</td><td><button class="link-button" data-detail="${esc(s.mint)}">${esc(s.mint.slice(0, 8))}…</button></td><td>${date(s.observed_at)}<div class="tiny">Preço: ${date(s.price_observed_at)}</div></td><td>${usd(s.price)}</td><td>${
                t.outcomes
                  .filter((o) => o.signal_id === s.id)
                  .map((o) => {
                    const x = JSON.parse(o.data);
                    return `${o.horizon}m: ${o.status === "observed" ? pct(x.change_pct) : o.status === "missing" ? "sem amostra" : "pendente"} · máxima amostrada ${pct(x.sampled_max_gain_pct)} · mínima ${pct(x.sampled_max_drawdown_pct)} · liquidez mín. ${usd(x.min_observed_liquidity)}`;
                  })
                  .join("<br>") || "Aguardando dados futuros"
              }</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : '<p class="sub gap-top">Ainda sem alertas cronológicos de aceleração ou retomada. Nenhuma amostra é criada para completar janelas.</p>'
  }</div></section>`;
}
function researchPanel(): string {
  const r = data!.research;
  if (!r) return "";
  return `<section class="panel gap-top"><div class="panel-head"><h2>Alertas e grupo de referência</h2><span class="tag">${r.cohorts} coortes prospectivas</span></div><div class="panel-body"><p class="sub">Referência escolhida no alerta, por idade do pool, liquidez, volume e cobertura de risco. Horizonte principal: 30 minutos. Sem seleção por resultados futuros.</p><p class="sub">Movimentos entre amostras são desconhecidos. Extremos amostrados não são preços executáveis; stops e saídas nesses extremos não são presumidos. Cenário líquido usa US$20, custos de 1% + slippage de 1% por lado e US$0,05 de rede por lado. Sem rotas, execução e resultado executável permanecem não verificados.</p>${r.groups.length ? `<div class="table-scroll"><table><thead><tr><th>Motor / horizonte</th><th>Pares observados / coortes</th><th>Valorização alerta / referência</th><th>Diferença observada</th><th>Líquido em cenário, alerta / referência</th><th>Pares indisponíveis</th></tr></thead><tbody>${r.groups.map((g) => `<tr><td>${esc(g.detector_group)} / ${g.horizon}m</td><td>${g.paired_observed} / ${g.cohorts}</td><td>${pct(g.mean_alert_return_pct)} / ${pct(g.mean_control_return_pct)}</td><td>${pct(g.mean_excess_return_pct)}</td><td>${usd(g.mean_alert_net_scenario_usd)} / ${usd(g.mean_control_net_scenario_usd)}</td><td>${g.unavailable_pairs}</td></tr>`).join("")}</tbody></table></div>` : '<p class="sub gap-top">Aguardando alertas reais e referências comparáveis. Sem evidência de vantagem estatística.</p>'}${
    r.recent.length
      ? `<h3 class="gap-top">Liquidez e observações recentes</h3>${r.recent
          .slice(-5)
          .map(
            (c) =>
              `<p class="sub">${date(c.alert_at)} · ${esc(c.alert_mint.slice(0, 8))} / ${c.control_mint ? esc(c.control_mint.slice(0, 8)) : "sem referência comparável"}<br>${c.outcomes.map((o) => `${esc(o.role)} ${o.horizon}m: ${o.status === "observed" ? pct(o.data.gross_return_pct) : esc(o.status)} · liquidez mín. amostrada ${usd(o.data.min_observed_liquidity)} · execução não verificada`).join("<br>")}</p>`,
          )
          .join("")}`
      : ""
  }</div></section>`;
}
function radarPage(): string {
  return `${radarCards()}${trackingPanel()}${researchPanel()}<section class="panel"><div class="panel-head"><div><h2>Universo monitorado</h2><p class="sub">${data!.total_tokens} contratos preservados · inativos continuam no histórico</p></div><span class="tag">Solana / SPL</span></div><div class="filterbar"><label>Buscar moeda ou contrato<input id="search" type="search" value="${esc(filters.search)}" placeholder="Símbolo, nome, contrato"></label><label>Radar<select data-filter="radar">${options(
    [
      ["all", "Todos os radares"],
      ["new", "A · Moedas novas"],
      ["acceleration", "B · Aceleração"],
      ["revival", "C · Retomada"],
    ],
    filters.radar,
  )}</select></label><label>Estado<select data-filter="state">${options(
    [
      ["all", "Todos os estados"],
      ["monitoring", "Monitorando"],
      ["accelerating", "Em aceleração"],
      ["validated", "Entrada validada (sim.)"],
      ["wait", "Aguardar preço"],
      ["high_risk", "Risco elevado"],
      ["closed", "Encerrada"],
    ],
    filters.state,
  )}</select></label><label>Risco<select data-filter="risk">${options(
    [
      ["all", "Todos"],
      ["alert", "Com alerta"],
      ["incomplete", "Dados incompletos"],
      ["checked", "Sem alerta básico"],
    ],
    filters.risk,
  )}</select></label><label>Idade do pool<select data-filter="age">${options(
    [
      ["all", "Todas as idades"],
      ["new", "Até 24 horas"],
      ["old", "Acima de 24 horas"],
    ],
    filters.age,
  )}</select></label><label>Liquidez mínima US$<input data-filter="liquidity" type="number" min="0" value="${esc(filters.liquidity)}" placeholder="Sem mínimo"></label><label>Volume 5m mín. US$<input data-filter="volume" type="number" min="0" value="${esc(filters.volume)}" placeholder="Sem mínimo"></label><button id="archive-search" class="secondary compact">Buscar em todo o histórico</button><button id="clear-filters" class="secondary compact">Limpar</button></div><div id="radar-table">${table(filtered(), true)}${archivePagination()}</div><div class="data-notes">Clique no nome para investigar. Compras/vendas são contagens de transações. Idade refere-se ao pool observado. Amostras históricas não são candles completos.</div></section>`;
}
function narratives(): string {
  return data!.narratives.length
    ? data!.narratives
        .slice(0, 12)
        .map(
          (n) =>
            `<article class="narrative"><div class="row"><h3>${esc(n.topic)}</h3><span class="tag">${n.authors} autores</span></div><p class="sub">${esc(n.source)} · ${date(n.observed_at)}</p><button class="link-button" data-detail="${esc(n.mint)}">Investigar ${esc(n.mint.slice(0, 8))}… →</button></article>`,
        )
        .join("")
    : empty(
        "Nenhuma narrativa com evidência suficiente",
        "Uma narrativa exige pelo menos três autores na amostra com menção ao contrato exato. Ausência de cobertura não significa ausência de interesse.",
      );
}
function socialPage(): string {
  return `<div class="notice"><span>ⓘ</span><div><strong>Cobertura social parcial.</strong> Bluesky público, até 30 posts por contrato e consulta. Crescimento só é calculado após cobertura contínua de duas horas; não representa toda a rede. X, Reddit e Telegram estão sem integração ativa.</div></div><div class="panel-grid"><section class="panel"><div class="panel-head"><h2>Radar de narrativas</h2><span class="tag">Amostra pública</span></div>${narratives()}</section><section class="panel"><div class="panel-head"><h2>Qualidade e momento da atenção</h2></div><div class="panel-body"><h3>01 · Social antes do preço</h3><p class="sub">Menções crescem >25%, enquanto a variação de 5 min fica entre −3% e +3%. Hipótese para investigação, não sinal comprovado.</p><h3 class="gap-top">02 · Social e fluxo juntos</h3><p class="sub">Crescimento de menções acompanhado por pressão compradora superior a 60%, sem extensão >20%.</p><h3 class="gap-top">03 · Divulgação tardia</h3><p class="sub">Valorização >20% antes da análise social requer cautela. Não representa oportunidade inicial.</p><h3 class="gap-top">Controles de identidade</h3><p class="sub">Contrato como identificador; símbolos sozinhos não são associados. Repetição textual e autores distintos são observados, sem afirmar detecção comprovada de bots.</p></div></section></div><section class="panel gap-top"><div class="panel-head"><h2>Evidências por contrato</h2></div>${
    data!.tokens.some((t) => t.social.complete)
      ? `<div class="table-scroll"><table><thead><tr><th>Contrato</th><th>Menções / hora</th><th>Autores</th><th>Crescimento</th><th>Repetição</th><th>Cobertura 2 h</th></tr></thead><tbody>${data!.tokens
          .filter((t) => t.social.complete)
          .map(
            (t) =>
              `<tr><td><button class="link-button" data-detail="${esc(t.token.mint)}">${esc(t.token.symbol)}</button></td><td>${fmt(t.social.mentions)}</td><td>${fmt(t.social.authors)}</td><td>${pct(t.social.growth_pct)}</td><td>${pct(t.social.repetition == null ? null : t.social.repetition * 100)}</td><td>${t.social.coverage_complete ? "Amostrada" : "Incompleta"}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : empty(
          "Consultas sociais ainda não confirmadas",
          "Consulte o status de Bluesky. O sistema não fabrica contagens, narrativas ou autores.",
        )
  }</section>`;
}
function metricsTable(groups: Record<string, Metrics>): string {
  return Object.keys(groups).length
    ? `<div class="table-scroll"><table><thead><tr><th>Grupo</th><th>Encerradas</th><th>Acerto</th><th>Resultado</th><th>Expectativa</th><th>Profit factor</th><th>Drawdown</th></tr></thead><tbody>${Object.entries(
        groups,
      )
        .map(
          ([k, m]) =>
            `<tr><td>${esc(strategies[k] ?? k)}</td><td>${m.closed}</td><td>${pct(m.win_rate)}</td><td>${usd(m.net_pnl, 2)}</td><td>${usd(m.expectancy, 2)}</td><td>${fmt(m.profit_factor, 2)}</td><td>${usd(m.max_drawdown_usd, 2)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`
    : empty(
        "Sem amostra histórica",
        "Resultados só aparecem após operações estimadas realmente registradas.",
      );
}
function paperPage(): string {
  const p = data!.paper,
    m = p.metrics;
  return `<div class="notice"><span>ⓘ</span><div><strong>Laboratório sem dinheiro real.</strong> ${esc(p.methodology)} ${!p.quote_available ? "A chave opcional Jupiter não está configurada: não é possível abrir posições com cotação estimada." : ""}</div></div><div class="stats">${stat("Operações encerradas", fmt(m.closed), `${m.open} posições abertas ou sem saída`)}${stat("Resultado líquido", m.closed ? usd(m.net_pnl, 2) : "—", "Inclui custos estimados e perdas", true)}${stat("Taxa de acerto", pct(m.win_rate), "Sem operações = sem taxa calculada")}${stat("Expectativa por operação", usd(m.expectancy, 2), "Sem calibração ou vantagem comprovada")}</div><div class="stats">${stat("Lucro médio", usd(m.mean_win, 2), "Somente operações positivas")}${stat("Prejuízo médio", usd(m.mean_loss, 2), "Somente operações negativas")}${stat("Profit factor", fmt(m.profit_factor, 2), "Indefinido sem perdas observadas")}${stat("Drawdown realizado", m.closed ? usd(m.max_drawdown_usd, 2) : "—", "Recuo do saldo ao longo dos fechamentos")}</div><section class="panel"><div class="panel-head"><h2>Hipóteses de estratégia</h2><button class="compact secondary" data-nav="settings">Editar parâmetros</button></div><div class="panel-body strategy-grid">${Object.entries(
    data!.config.strategies,
  )
    .map(
      ([k, s]) =>
        `<article class="strategy"><span class="tag ${s.enabled ? "good" : ""}">${s.enabled ? "Habilitada" : "Desabilitada"}</span><h3 class="gap-top">${esc(strategies[k])}</h3><p>${esc(k === "early" ? "Volume +50%, compras +25% e liquidez estável antes de extensão de preço." : k === "continuation" ? "Tendência observada de +3% com correção moderada de 1–8% e pressão ≥60%." : "Pool antigo com volume ≥3× baseline de 24–48 horas e compradores predominantes.")}</p><p>Alvo líquido +${s.take_profit}% · stop ${s.stop_loss}% · prazo ${s.max_minutes} min. Parâmetros congelados na entrada.</p></article>`,
    )
    .join(
      "",
    )}</div></section><section class="panel"><div class="panel-head"><h2>Diário de operações estimadas</h2><span class="tag">Capital inicial ${usd(data!.config.paper_initial_usd)}</span></div>${p.trades.length ? `<div class="table-scroll"><table><thead><tr><th>Moeda</th><th>Estratégia</th><th>Entrada</th><th>Custo</th><th>Saída líquida</th><th>Resultado</th><th>Estado / motivo</th></tr></thead><tbody>${p.trades.map((t) => `<tr><td><button class="link-button" data-detail="${esc(t.mint)}">${esc(t.mint.slice(0, 8))}…</button></td><td>${esc(strategies[t.strategy])}</td><td>${date(t.opened_at)}</td><td>${usd(t.entry_cost, 2)}</td><td>${usd(t.exit_value, 2)}</td><td class="${(t.pnl ?? 0) >= 0 ? "positive" : "negative"}">${usd(t.pnl, 2)}</td><td>${esc(t.status)}<div class="tiny">${esc(t.reason ?? "Aguardando cotação")}</div></td></tr>`).join("")}</tbody></table></div>` : empty("Nenhuma operação simulada", "Abra uma moeda para verificar condições e solicitar uma entrada estimada. Sem duas rotas recentes e critérios atendidos, nenhuma posição será criada.")}</section>${[
    ["Estratégia", p.by_strategy],
    ["Categoria de descoberta", p.by_category],
    ["Condição do movimento", p.by_regime],
  ]
    .map(
      ([title, group]) =>
        `<section class="panel"><div class="panel-head"><h2>Resultados por ${esc(title)}</h2></div>${metricsTable(group as Record<string, Metrics>)}</section>`,
    )
    .join(
      "",
    )}<p class="validation-note">Avaliação fora da amostra: defina parâmetros antes da janela futura e preserve os snapshots. Não existe ajuste automático treinado ou estratégia validada. Evite conclusões antes de 100 fechamentos por hipótese e de uma avaliação temporal independente.</p>`;
}
const fieldLabels: Record<string, string> = {
  min_liquidity: "Liquidez mínima (US$)",
  min_volume5m: "Volume mínimo em 5m (US$)",
  new_hours: "Pool novo até (horas)",
  revival_days: "Pool em retomada após (dias)",
  active_days: "Expirar sem observação (dias)",
  collect_seconds: "Coleta geral (segundos)",
  refresh_seconds: "Atualização da tela (segundos)",
  stale_seconds: "Cotação desatualizada após (seg.)",
  max_price_change5m: "Extensão máxima em 5m (%)",
  max_holder_pct: "Maior conta / supply máximo (%)",
  paper_latency_seconds: "Atraso antes da cotação (seg.)",
  paper_usd: "Valor por posição (USDC)",
  paper_initial_usd: "Capital inicial fictício (US$)",
  paper_max_open: "Máximo de posições abertas",
  slippage_bps: "Tolerância de slippage (bps)",
  network_fee_usd: "Taxa de rede estimada por lado (US$)",
};
const bounds: Record<string, [number, number, string]> = {
  min_liquidity: [1000, 10000000, "100"],
  min_volume5m: [100, 10000000, "100"],
  new_hours: [1, 48, "1"],
  revival_days: [3, 90, "1"],
  active_days: [1, 365, "1"],
  collect_seconds: [180, 3600, "1"],
  refresh_seconds: [15, 600, "1"],
  stale_seconds: [60, 1800, "1"],
  max_price_change5m: [1, 100, "0.1"],
  max_holder_pct: [1, 50, "0.1"],
  paper_latency_seconds: [0, 30, "1"],
  paper_usd: [1, 100, "0.1"],
  paper_initial_usd: [100, 10000, "1"],
  paper_max_open: [1, 10, "1"],
  slippage_bps: [10, 300, "1"],
  network_fee_usd: [0, 5, "0.01"],
};
function settingsPage(): string {
  const c = data!.config;
  return `<form id="settings-form" class="panel"><div class="panel-head"><div><h2>Parâmetros do laboratório</h2><p class="sub">Salvos no banco local · revisão ${data!.config_revision} · sem alteração de produção</p></div><span class="tag warn">Heurísticas v1</span></div>${[
    [
      "Coleta e universo",
      [
        "min_liquidity",
        "min_volume5m",
        "new_hours",
        "revival_days",
        "active_days",
        "collect_seconds",
        "refresh_seconds",
        "stale_seconds",
        "max_price_change5m",
        "max_holder_pct",
      ],
    ],
    [
      "Simulação e custos",
      [
        "paper_latency_seconds",
        "paper_usd",
        "paper_initial_usd",
        "paper_max_open",
        "slippage_bps",
        "network_fee_usd",
      ],
    ],
  ]
    .map(
      ([title, keys]) =>
        `<div class="form-section"><h3>${title}</h3><div class="form-grid">${(keys as string[]).map((k) => `<label>${fieldLabels[k]}<input required type="number" name="${k}" min="${bounds[k]![0]}" max="${bounds[k]![1]}" step="${bounds[k]![2]}" value="${c[k as keyof Config]}" ${k === "paper_initial_usd" && data!.paper.trades.length ? "readonly" : ""}></label>`).join("")}</div></div>`,
    )
    .join(
      "",
    )}<div class="form-section"><h3>Fontes opcionais</h3><div class="form-grid"><label class="check-label"><input type="checkbox" name="social_enabled" ${c.social_enabled ? "checked" : ""}> Consultar Bluesky público</label><label class="check-label"><input type="checkbox" name="security_enabled" ${c.security_enabled ? "checked" : ""}> Consultar Solana RPC</label><label class="check-label"><input type="checkbox" name="paper_auto" ${c.paper_auto ? "checked" : ""}> Simulação automática de entradas validadas</label></div><p class="sub gap-top">Desabilitar uma consulta não elimina dados históricos. Verificações antigas deixam de satisfazer os critérios de frescor.</p></div><div class="form-section"><h3>Pesos do resumo de oportunidade</h3><div class="form-grid">${Object.entries(
    c.weights,
  )
    .map(
      ([k, v]) =>
        `<label>${esc(k)} (0–1)<input type="number" name="weight.${k}" min="0" max="1" step="0.01" required value="${v}"></label>`,
    )
    .join(
      "",
    )}</div><p class="sub gap-top">Soma obrigatória = 1. Momentum = 60% crescimento do volume + 20% preço + 20% consistência; fluxo = 50% pressão compradora + 30% crescimento de compras + 20% liquidez. Componentes limitados a 0–100. Social exige cobertura suficiente. Risco desconta o resumo; dados ausentes com peso positivo deixam o resumo incompleto.</p></div>${Object.entries(
    c.strategies,
  )
    .map(
      ([k, s]) =>
        `<div class="form-section"><h3>${esc(strategies[k])}</h3><label class="check-label"><input type="checkbox" name="strategy.${k}.enabled" ${s.enabled ? "checked" : ""}>Habilitar hipótese</label><div class="form-grid gap-top">${[
          ["take_profit", "Alvo líquido (%)", 1, 100],
          ["stop_loss", "Stop observado (%)", -50, -1],
          ["max_minutes", "Permanência máxima (min)", 2, 240],
        ]
          .map(
            ([f, label, min, max]) =>
              `<label>${label}<input type="number" name="strategy.${k}.${f}" min="${min}" max="${max}" required step="0.1" value="${s[f as keyof Strategy]}"></label>`,
          )
          .join("")}</div></div>`,
    )
    .join(
      "",
    )}<div class="form-actions"><button class="primary" type="submit">Salvar configuração</button><span id="settings-error" role="alert" class="sub">Parâmetros novos afetam decisões futuras. Posições abertas mantêm sua política original.</span></div></form>`;
}
function render(): void {
  if (!data) return;
  const d = data;
  const unavailable = d.sources.filter((s) => s.status === "unavailable");
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-mark" aria-hidden="true">⌁</div><span>EDGE RADAR<small>MEMECOIN INTELLIGENCE</small></span></div><div class="navlabel">WORKSPACE / SOLANA</div><nav aria-label="Navegação principal">${Object.entries(
    names,
  )
    .map(
      ([k, v], i) =>
        `<button data-nav="${k}" class="${page === k ? "active" : ""}" ${page === k ? 'aria-current="page"' : ""}><span class="navicon" aria-hidden="true">${["◫", "⌖", "◎", "⇄", "⚙"][i]}</span>${v}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-note"><div class="network"><span class="dot"></span> Rede Solana</div>Pesquisa independente.<br>Sem wallet. Sem ordens reais.<br><br><span class="tag">V1 / RESEARCH BUILD</span></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">Workspace <span class="muted"> / </span> <b>${names[page]}</b></div><div class="top-actions"><span class="tag">${d.collecting ? "COLETANDO" : "ATUALIZAÇÃO PERIÓDICA"} · ${d.config.collect_seconds / 60} MIN</span><button class="secondary" id="refresh">Atualizar</button><button class="primary" id="collect" ${d.collecting ? "disabled" : ""}>${d.collecting ? "Coletando…" : "Coletar agora"}</button></div></header><div class="content" id="content"><div class="heading"><div><div class="eyebrow">INTELIGÊNCIA ON-CHAIN / SEM EXECUÇÃO REAL</div><h1>${names[page] === "Visão geral" ? "Encontre o movimento. Entenda o risco." : names[page]}</h1><p class="sub">${page === "overview" ? "Descoberta, evidências e simulação. Cada sinal precisa de contexto." : page === "radar" ? "Três radares independentes. Um histórico que não desaparece." : page === "social" ? "Atenção social vinculada a contratos, com limites de cobertura explícitos." : page === "paper" ? "Hipóteses testáveis. Custos explícitos. Nenhuma transação enviada." : "Regras explicáveis e parâmetros preservados por decisão."}</p></div><span class="tag">${date(d.now)} · Brasília</span></div>${unavailable.length ? `<div class="notice"><span>◉</span><div><strong>${unavailable.length} ${unavailable.length === 1 ? "fonte indisponível" : "fontes indisponíveis"}.</strong> ${unavailable.map((s) => esc(s.name)).join(", ")}. A coleta continua com as fontes disponíveis; análises sem evidência ficam incompletas.${!d.total_tokens ? " Não há cotações confirmadas para exibir." : ""}</div></div>` : ""}${page === "overview" ? overviewPage() : page === "radar" ? radarPage() : page === "social" ? socialPage() : page === "paper" ? paperPage() : settingsPage()}<footer class="footer"><span>EDGE RADAR · Heurísticas experimentais, sem probabilidade de lucro comprovada.</span><span>Dados observados · fontes independentes · horários de Brasília</span></footer></div></main></div>`;
  bind();
}
function navigate(next: string): void {
  if (!names[next]) return;
  page = next;
  window.location.hash = next;
  render();
  window.scrollTo({ top: 0 });
}
function bind(): void {
  document
    .querySelector("#archive-search")
    ?.addEventListener("click", () => void searchArchive());
  bindArchivePaging(app);
  app
    .querySelectorAll<HTMLElement>("[data-nav]")
    .forEach((el) =>
      el.addEventListener("click", () => navigate(el.dataset.nav!)),
    );
  app.querySelectorAll<HTMLElement>("[data-radar]").forEach((el) =>
    el.addEventListener("click", () => {
      filters.radar = el.dataset.radar!;
      navigate("radar");
    }),
  );
  bindDetails(app);
  document
    .querySelector("#refresh")
    ?.addEventListener("click", () => void refresh(true));
  document.querySelector("#collect")?.addEventListener("click", async () => {
    try {
      await api("/api/collect", "POST", {});
      toast("Coleta solicitada. O intervalo mínimo e o lock continuam ativos.");
      setTimeout(() => void refresh(), 1000);
    } catch (e) {
      toast(String(e));
    }
  });
  document
    .querySelector<HTMLInputElement>("#search")
    ?.addEventListener("input", (e) => {
      filters.search = (e.target as HTMLInputElement).value;
      renderTable();
    });
  app
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter]")
    .forEach((el) =>
      el.addEventListener("change", () => {
        filters[el.dataset.filter as keyof typeof filters] = el.value;
        renderTable();
      }),
    );
  document.querySelector("#clear-filters")?.addEventListener("click", () => {
    filters = {
      search: "",
      radar: "all",
      state: "all",
      risk: "all",
      age: "all",
      liquidity: "",
      volume: "",
    };
    render();
  });
  document
    .querySelector<HTMLFormElement>("#settings-form")
    ?.addEventListener("submit", (e) => {
      e.preventDefault();
      void saveConfig(e.currentTarget as HTMLFormElement);
    });
}
function bindDetails(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>("[data-detail]")
    .forEach((el) =>
      el.addEventListener("click", () => void showDetail(el.dataset.detail!)),
    );
}
function archivePagination(): string {
  if (!archive) return "";
  return `<div class="data-notes row"><span>Histórico completo: ${archive.total} resultados. Página ${Math.floor(archive.offset / 100) + 1}. Os filtros adicionais se aplicam à página carregada.</span><div><button class="compact" data-archive-offset="${Math.max(0, archive.offset - 100)}" ${archive.offset === 0 ? "disabled" : ""}>Anterior</button> <button class="compact" data-archive-offset="${archive.offset + 100}" ${archive.offset + 100 >= archive.total ? "disabled" : ""}>Próxima</button></div></div>`;
}
async function searchArchive(offset = 0): Promise<void> {
  try {
    archive = await api(
      "/api/archive?q=" +
        encodeURIComponent(filters.search) +
        "&offset=" +
        offset,
    );
    renderTable();
  } catch (error) {
    toast(String(error));
  }
}
function bindArchivePaging(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>("[data-archive-offset]")
    .forEach((el) =>
      el.addEventListener(
        "click",
        () => void searchArchive(Number(el.dataset.archiveOffset)),
      ),
    );
}
function renderTable(): void {
  const el = document.querySelector("#radar-table");
  if (el) {
    el.innerHTML = table(filtered(), true) + archivePagination();
    bindArchivePaging(el);
    bindDetails(el);
  }
}
function chart(
  points: Snapshot[],
  key: "price" | "volume5m" | "buys" | "liquidity",
): string {
  const latest = points.at(-1);
  const rows = points.filter(
    (p) =>
      p.source === latest?.source && p.pool === latest?.pool && p[key] != null,
  );
  if (rows.length < 2)
    return empty(
      "Histórico insuficiente",
      "O gráfico exige ao menos duas observações da mesma fonte e pool. Nenhum candle é reconstruído.",
    );
  const values = rows.map((p) => p[key]!);
  const low = Math.min(...values),
    high = Math.max(...values);
  const first = rows[0]!,
    last = rows.at(-1)!;
  const coords = rows
    .map(
      (p) =>
        `${55 + ((p.observed_at - first.observed_at) / (last.observed_at - first.observed_at || 1)) * 660},${175 - ((p[key]! - low) / (high - low || 1)) * 145}`,
    )
    .join(" ");
  return `<svg class="chart" viewBox="0 0 770 220" role="img" aria-label="${esc(key)}: ${rows.length} amostras observadas; mínimo ${low}, máximo ${high}"><path d="M55 30H720 M55 102H720 M55 175H720" stroke="#27333c" stroke-dasharray="4 5"/><polyline points="${coords}" fill="none" stroke="#c9f27a" stroke-width="2.5"/><text x="5" y="32">${esc(compact(high))}</text><text x="5" y="178">${esc(compact(low))}</text><text x="55" y="205">${date(first.observed_at)}</text><text x="610" y="205">${date(last.observed_at)}</text></svg><div class="data-notes">${rows.length} amostras · ${esc(latest?.source)} · linhas entre observações, não candles completos. Lacunas não comprovam continuidade.</div>`;
}
async function showDetail(mint: string): Promise<void> {
  detail.innerHTML = '<div class="detail-body">Carregando evidências…</div>';
  if (!detail.open) detail.showModal();
  try {
    const t = await api<Token>("/api/token/" + encodeURIComponent(mint));
    renderDetail(t);
  } catch (e) {
    detail.innerHTML = `<div class="detail-body"><button id="close-detail">Fechar</button><p role="alert">${esc(e)}</p></div>`;
    document
      .querySelector("#close-detail")
      ?.addEventListener("click", () => detail.close());
  }
}
function renderDetail(t: Token): void {
  const a = t.assessment,
    s = t.latest,
    h = t.history ?? [];
  detail.innerHTML = `<header class="detail-head"><div class="row"><div><div class="eyebrow">CONTRATO / SOLANA</div><h2>${esc(t.token.name)} <span class="muted">${esc(t.token.symbol)}</span></h2></div><button id="close-detail" aria-label="Fechar análise">✕</button></div><div class="contract-line"><code>${esc(t.token.mint)}</code><button class="compact" id="copy-contract">Copiar</button><a target="_blank" rel="noopener noreferrer" href="https://dexscreener.com/solana/${esc(t.token.mint)}">Fonte externa ↗</a></div></header><div class="detail-body"><div class="row">${stateTag(a)}<span class="sub">Avaliação ${date(a.observed_at)}</span></div><p class="sub gap-top">Primeira descoberta ${date(t.token.first_seen)} · Idade do pool ${age(t.token.pool_created)} · ${esc(s?.source ?? "Sem cotação")} ${date(s?.observed_at)}</p><div class="stats gap-top">${[
    ["momentum", "Momentum"],
    ["flow", "Fluxo"],
    ["social", "Social"],
    ["risk", "Risco ↑"],
    ["opportunity", "Oportunidade"],
  ]
    .map(([k, label]) =>
      stat(
        label!,
        fmt(a.scores[k!]),
        a.scores[k!] == null ? "Análise incompleta" : "Heurístico / 100",
        k === "opportunity",
      ),
    )
    .join(
      "",
    )}</div><section class="panel"><div class="panel-head"><h2>Histórico observado</h2><label>Série<select id="chart-series">${options(
    [
      ["price", "Preço (US$)"],
      ["volume5m", "Volume 5m (US$)"],
      ["buys", "Compras (transações)"],
      ["liquidity", "Liquidez (US$)"],
    ],
    "price",
  )}</select></label></div><div id="detail-chart">${chart(h, "price")}</div></section><div class="panel-grid two"><section class="panel"><div class="panel-head"><h2>Condições para simulação</h2></div><div class="panel-body">${a.checks.map((c) => `<div class="check ${c.passed ? "pass" : ""}"><span class="symbol">${c.passed ? "✓" : c.passed === null ? "?" : "○"}</span><div><strong>${esc(c.label)}</strong><p>${c.passed ? "Condição atendida." : esc(c.change)}</p></div></div>`).join("")}<p class="validation-note">“Entrada validada” refere-se exclusivamente a uma estimativa de simulação. Não certifica segurança ou execução futura.</p><button class="primary" id="paper-open" ${!data!.paper.quote_available ? "disabled" : ""}>Avaliar rotas e simular ${usd(data!.config.paper_usd)}</button>${!data!.paper.quote_available ? '<p class="sub">Jupiter sem credencial opcional. Não há estimativa executável para abrir posição.</p>' : ""}</div></section><section class="panel"><div class="panel-head"><h2>Riscos e dados ausentes</h2></div><div class="panel-body">${a.flags.length ? `<ul class="details-list negative">${a.flags.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="sub">Nenhum alerta nas informações disponíveis. Isso não significa que o token seja seguro.</p>'}<h3 class="gap-top">Verificações pendentes</h3><ul class="details-list">${[...a.missing, ...a.limitations].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${t.security && t.security.token_program ? `<h3 class="gap-top">Observações on-chain</h3><p class="sub">Emissão: ${t.security.mint_authority ? "autoridade ativa" : "sem autoridade registrada"} · Freeze: ${t.security.freeze_authority ? "autoridade ativa" : "sem autoridade registrada"}</p><p class="sub">Maior conta: ${pct(t.security.largest_account_pct as Nullable)} do supply. Pode ser pool ou custódia; não equivale a concentração de holders.</p>` : ""}</div></section></div><section class="panel gap-top"><div class="panel-head"><h2>Identificação e sinais sociais</h2></div><div class="panel-body"><div class="row"><p class="sub">Menções: ${fmt(t.social.mentions)} · autores: ${fmt(t.social.authors)} · crescimento: ${pct(t.social.growth_pct)}</p><span class="tag">${esc(a.social_timing)}</span></div><p class="sub gap-top">${esc(t.social.limitations.join(" "))}</p><h3 class="gap-top">Movimento entre observações</h3><p class="sub">Intervalo observado: ${fmt(a.short_window?.elapsed_seconds ?? null)}s · preço ${pct(a.short_window?.changes_pct.price ?? null)} · volume móvel 5m ${pct(a.short_window?.changes_pct.volume5m ?? null)} · liquidez ${pct(a.short_window?.changes_pct.liquidity ?? null)}. Janelas móveis se sobrepõem; transações não são compradores únicos. O caminho entre pontos é desconhecido.</p><h3 class="gap-top">Histórico temporal</h3><p class="sub">Aceleração: ${esc(a.history_status?.acceleration ?? "insufficient")} · retomada: ${esc(a.history_status?.revival ?? "insufficient")} · ${a.history_status?.same_pool_spaced_samples ?? 0}/3 amostras espaçadas da mesma fonte/pool. Idade do token: não observada.</p><h3 class="gap-top">Radares</h3>${Object.entries(
    a.radars,
  )
    .map(
      ([k, r]) =>
        `<p class="sub"><strong>${esc(k)}: ${r.detected ? "detectado" : r.eligible ? "elegível, sem sinal" : "fora do critério"}</strong> · ${esc(r.reason)}</p>`,
    )
    .join(
      "",
    )}</div></section><section class="panel"><div class="panel-head"><h2>Evolução dos scores e oportunidades</h2></div>${
    t.assessment_history?.length
      ? `<div class="table-scroll"><table><thead><tr><th>Avaliação</th><th>Momentum</th><th>Fluxo</th><th>Social</th><th>Risco</th><th>Estado</th></tr></thead><tbody>${t.assessment_history
          .slice(0, 30)
          .map(
            (x) =>
              `<tr><td>${date(x.observed_at)}</td>${["momentum", "flow", "social", "risk"].map((k) => `<td>${fmt(x.scores[k])}</td>`).join("")}<td>${esc(x.label)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : empty(
          "Nenhuma avaliação persistida",
          "As avaliações são registradas a cada coleta.",
        )
  }</section></div>`;
  document
    .querySelector("#close-detail")
    ?.addEventListener("click", () => detail.close());
  document
    .querySelector("#copy-contract")
    ?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(t.token.mint);
        toast("Contrato copiado.");
      } catch {
        toast("Não foi possível copiar. Selecione o endereço exibido.");
      }
    });
  document
    .querySelector<HTMLSelectElement>("#chart-series")
    ?.addEventListener("change", (e) => {
      document.querySelector("#detail-chart")!.innerHTML = chart(
        h,
        (e.target as HTMLSelectElement).value as
          | "price"
          | "volume5m"
          | "buys"
          | "liquidity",
      );
    });
  document
    .querySelector<HTMLButtonElement>("#paper-open")
    ?.addEventListener("click", async (e) => {
      const button = e.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await api("/api/paper/open", "POST", { mint: t.token.mint });
        toast("Posição fictícia registrada com cotações estimadas atuais.");
        detail.close();
        await refresh();
      } catch (error) {
        toast(String(error));
        button.disabled = false;
      }
    });
}
async function saveConfig(form: HTMLFormElement): Promise<void> {
  const c = structuredClone(data!.config);
  const formData = new FormData(form);
  for (const k of Object.keys(fieldLabels))
    (c as unknown as Record<string, unknown>)[k] = Number(formData.get(k));
  c.social_enabled = formData.has("social_enabled");
  c.security_enabled = formData.has("security_enabled");
  c.paper_auto = formData.has("paper_auto");
  for (const k of Object.keys(c.weights))
    c.weights[k] = Number(formData.get("weight." + k));
  for (const [k, s] of Object.entries(c.strategies)) {
    s.enabled = formData.has("strategy." + k + ".enabled");
    for (const f of ["take_profit", "stop_loss", "max_minutes"] as const)
      s[f] = Number(formData.get("strategy." + k + "." + f));
  }
  try {
    await api("/api/settings", "PUT", {
      config: c,
      revision: data!.config_revision,
    });
    toast("Configuração salva. Posições existentes mantêm seus parâmetros.");
    await refresh(true);
  } catch (error) {
    const el = document.querySelector("#settings-error")!;
    el.textContent = String(error);
    el.classList.add("field-error");
  }
}
async function refresh(force = false): Promise<void> {
  clearTimeout(timer);
  try {
    const next = await api<Overview>("/api/overview");
    document.querySelector<HTMLElement>("#connection-error")!.hidden = true;
    data = next;
    const editing =
      page === "settings" && document.activeElement?.closest("form");
    const filtering =
      page === "radar" && document.activeElement?.closest(".filterbar");
    if (force || (!editing && !filtering)) render();
  } catch (e) {
    if (!data) {
      app.innerHTML = `<main class="error-panel"><h1>Serviço local indisponível</h1><p>${esc(e)}</p><p>Inicie python3 -m server.app e execute npm run build.</p><button id="retry">Tentar novamente</button></main>`;
      document
        .querySelector("#retry")
        ?.addEventListener("click", () => void refresh());
    } else {
      const banner = document.querySelector<HTMLElement>("#connection-error")!;
      banner.textContent =
        "Serviço indisponível. Dados da última resposta: " +
        date(data.now) +
        ". As classificações não estão sendo reavaliadas.";
      banner.hidden = false;
      data.now = Math.floor(Date.now() / 1000);
      if (page === "radar") renderTable();
    }
  } finally {
    timer = setTimeout(
      () => void refresh(),
      (data?.config.refresh_seconds ?? 45) * 1000,
    );
  }
}
window.addEventListener("hashchange", () => {
  const next = window.location.hash.slice(1);
  if (names[next] && next !== page) {
    page = next;
    render();
  }
});
void refresh();
