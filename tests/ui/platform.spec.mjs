import { test, expect } from "@playwright/test";
test("navigation, truthful empty states and responsive layout", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Encontre o movimento. Entenda o risco.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aguardando descobertas verificáveis" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  for (const label of [
    "Radar de moedas",
    "Radar social",
    "Simulador",
    "Configurações",
    "Visão geral",
  ]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await expect(
      nav.getByRole("button", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `.runtime/screenshots/${info.project.name}-overview.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("settings persist and rejected weights explain the failure", async ({
  page,
}) => {
  await page.goto("/#settings");
  const liquidity = page.getByLabel("Liquidez mínima (US$)", { exact: true });
  await liquidity.fill("25000");
  await page
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Configuração salva");
  await page.reload();
  await expect(liquidity).toHaveValue("25000");
  await page.getByLabel("momentum (0–1)", { exact: true }).fill("0.99");
  await page
    .getByRole("button", { name: "Salvar configuração", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Pesos devem somar 1");
});
test("filters and contract detail use isolated explicit test fixtures", async ({
  page,
}) => {
  // This mocked response exists only inside this test, never in runtime persistence.
  const base = await (await page.request.get("/api/overview")).json();
  const mint = "So11111111111111111111111111111111111111112";
  const at = base.now;
  const assessment = {
    state: "monitoring",
    label: "Monitorando",
    scores: {
      momentum: null,
      flow: null,
      social: null,
      risk: null,
      opportunity: null,
    },
    radars: {
      new: { eligible: true, detected: true, reason: "TEST FIXTURE" },
      acceleration: { eligible: true, detected: false, reason: "TEST FIXTURE" },
      revival: { eligible: false, detected: false, reason: "TEST FIXTURE" },
    },
    checks: [
      {
        key: "history",
        label: "Histórico comparável",
        passed: null,
        change: "Coletar 3 amostras",
      },
    ],
    flags: [],
    missing: ["TEST FIXTURE: sem auditoria"],
    limitations: ["TEST FIXTURE: não é dado real"],
    deltas: {},
    observed_at: at,
    selected_strategy: null,
    social_timing: "incomplete",
  };
  const token = {
    token: {
      mint,
      name: "TEST FIXTURE ONLY",
      symbol: "TEST",
      pool_created: at - 3600,
      active: 1,
      first_seen: at,
      last_seen: at,
    },
    latest: {
      source: "test-fixture",
      observed_at: at,
      liquidity: 50000,
      volume5m: 2000,
      buys: 20,
      sells: 10,
      change5m: 4,
    },
    assessment,
    social: {
      mentions: null,
      authors: null,
      growth_pct: null,
      repetition: null,
      complete: false,
      coverage_complete: false,
      last_check: null,
      limitations: ["TEST FIXTURE"],
      narratives: [],
    },
    security: null,
    history: [],
    assessment_history: [],
  };
  await page.route("**/api/overview", (route) =>
    route.fulfill({ json: { ...base, total_tokens: 1, tokens: [token] } }),
  );
  await page.route("**/api/token/*", (route) => route.fulfill({ json: token }));
  await page.goto("/#radar");
  await expect(
    page.getByRole("button", { name: "TEST", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Buscar moeda ou contrato").fill("does-not-exist");
  await expect(
    page.getByRole("heading", {
      name: "Nenhum contrato corresponde aos filtros",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await page.getByRole("button", { name: "TEST", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "TEST FIXTURE ONLY TEST" }),
  ).toBeVisible();
  await expect(dialog.getByText(mint, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Avaliar rotas e simular/ }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Fechar análise" }).click();
  await expect(dialog).not.toBeVisible();
});
