"""Explanatory, versioned heuristics. No score is a calibrated probability."""

import re
import statistics
from .db import load

CLASSIC_SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
STATES = {
    "monitoring": "Monitorando",
    "accelerating": "Em aceleração",
    "validated": "Entrada validada (simulação)",
    "wait": "Aguardar melhor preço",
    "high_risk": "Risco elevado",
    "closed": "Oportunidade encerrada",
}


def clamp(x):
    return round(max(0, min(100, x)), 1)


def growth(current, previous):
    return (
        (current / previous - 1) * 100
        if current is not None and previous is not None and previous > 0
        else None
    )


def social_summary(db, mint, at):
    check = db.execute("SELECT * FROM social_checks WHERE mint=?", (mint,)).fetchone()
    rows = db.execute(
        "SELECT * FROM social WHERE mint=? AND published_at>? AND published_at<=? ORDER BY published_at",
        (mint, at - 7200, at),
    ).fetchall()
    recent = [r for r in rows if r["published_at"] > at - 3600]
    previous = [r for r in rows if r["published_at"] <= at - 3600]
    normalized = [re.sub(r"\s+", " ", r["text"].lower()).strip() for r in recent]
    authors = len({r["author"] for r in recent if r["author"] != "unknown"})
    repetition = 1 - len(set(normalized)) / len(recent) if recent else None
    complete = bool(
        check and at - check["observed_at"] <= 1200 and load(check["data"]).get("ok")
    )
    # A first observation is not evidence of coverage over the previous hour.
    coverage = load(check["data"]).get("coverage_since", at) if check else at
    measured = complete and coverage <= at - 7200
    delta = growth(len(recent), len(previous)) if measured else None
    score = (
        clamp(
            min(authors / 10, 1) * 50
            + min(max(delta or 0, 0) / 200, 1) * 30
            + (1 - (repetition or 0)) * 20
        )
        if measured and recent and delta is not None
        else None
    )
    words = {}
    stop = {
        "https",
        "http",
        "this",
        "that",
        "with",
        "para",
        "uma",
        "com",
        "token",
        "solana",
        "pump",
        "www",
        "the",
        "and",
        "coin",
    }
    for r in recent:
        clean = r["text"].replace(mint, "")
        for word in set(re.findall(r"(?u)\b[\w#]{4,24}\b", clean.lower())):
            if word not in stop and not word.isdigit():
                words.setdefault(word, set()).add(r["author"])
    narratives = [
        {
            "topic": w,
            "authors": len(a),
            "mint": mint,
            "source": "bluesky",
            "observed_at": at,
        }
        for w, a in words.items()
        if len(a) >= 3
    ]
    return {
        "score": score,
        "mentions": len(recent) if complete else None,
        "previous_mentions": len(previous) if measured else None,
        "authors": authors if complete else None,
        "growth_pct": delta,
        "repetition": repetition,
        "complete": complete,
        "coverage_complete": measured,
        "last_check": check["observed_at"] if check else None,
        "narratives": sorted(narratives, key=lambda x: -x["authors"])[:5],
        "limitations": [
            "Amostra de até 30 posts públicos por consulta; contagens não representam toda a rede.",
            "Repetição é indício de coordenação, não detecção comprovada de bots.",
            "X, Reddit e Telegram sem integração ativa.",
        ],
    }


def evaluate(token, history, security, social, config, at, quote_check=None):
    history = [x for x in history if x["observed_at"] <= at]
    latest = history[-1] if history else {}
    # Compare only the same provider and pool. Do not infer acceleration across pool changes.
    samples = [
        x
        for x in history
        if x.get("source") == latest.get("source")
        and x.get("pool") == latest.get("pool")
        and x.get("price") is not None
        and x["observed_at"] <= at
    ]
    spaced = []
    for x in reversed(samples):
        if not spaced or spaced[-1]["observed_at"] - x["observed_at"] >= 300:
            spaced.append(x)
        if len(spaced) == 3:
            break
    consistent = len(spaced) >= 3 and at - spaced[-1]["observed_at"] <= 2400
    baseline = spaced[-1] if consistent else {}
    deltas = {
        key: growth(latest.get(key), baseline.get(key))
        for key in ["volume5m", "buys", "liquidity", "price"]
    }
    volumes = [x.get("volume5m") for x in spaced]
    sustained = (
        consistent
        and all(v is not None for v in volumes)
        and volumes[0] >= volumes[1] >= volumes[2]
    )
    momentum = None
    if consistent and deltas["volume5m"] is not None and deltas["price"] is not None:
        momentum = clamp(
            max(deltas["volume5m"], 0) / 2 * 0.6
            + max(deltas["price"], 0) * 3 * 0.2
            + (100 if sustained else 0) * 0.2
        )
    buys = latest.get("buys")
    sells = latest.get("sells")
    pressure = (
        buys / (buys + sells)
        if buys is not None and sells is not None and buys + sells > 0
        else None
    )
    flow = None
    if (
        pressure is not None
        and deltas["buys"] is not None
        and deltas["liquidity"] is not None
    ):
        flow = clamp(
            pressure * 100 * 0.5
            + min(max(deltas["buys"], 0), 100) * 0.3
            + min(max(deltas["liquidity"], 0) * 5, 100) * 0.2
        )
    flags = []
    missing = []
    liquidity = latest.get("liquidity")
    if liquidity is None:
        missing.append("Liquidez ausente")
    elif liquidity < config["min_liquidity"]:
        flags.append("Liquidez abaixo do limite configurado")
    fresh_security = (
        security
        if security and 0 <= at - security.get("observed_at", 0) <= 1800
        else None
    )
    if fresh_security:
        if fresh_security.get("mint_authority"):
            flags.append("Autoridade de emissão ativa")
        if fresh_security.get("freeze_authority"):
            flags.append("Autoridade de congelamento ativa")
        if fresh_security.get("largest_account_pct") is None:
            missing.append("Concentração não observada")
        elif fresh_security["largest_account_pct"] > config["max_holder_pct"]:
            flags.append(
                "Maior conta excede limite de concentração (pode ser pool/custódia)"
            )
        if fresh_security.get("token_program") != CLASSIC_SPL:
            flags.append("Programa ou extensões de token sem suporte de execução")
    else:
        missing.append("Auditoria on-chain ausente ou desatualizada")
    if pressure is not None and pressure > 0.95 and buys is not None and buys >= 30:
        flags.append("Fluxo unilateral extremo: investigar manipulação")
    if deltas["liquidity"] is not None and deltas["liquidity"] < -20:
        flags.append("Queda de liquidez superior a 20%")
    risk = clamp(len(flags) * 30) if not missing else None
    social_score = social.get("score")
    scores = {"momentum": momentum, "flow": flow, "social": social_score, "risk": risk}
    weights = config["weights"]
    opportunity = (
        round(sum(scores[k] * w for k, w in weights.items() if w > 0), 1)
        if all(scores[k] is not None for k, w in weights.items() if w > 0)
        else None
    )
    if risk is None:
        opportunity = None
    elif opportunity is not None:
        opportunity = round(opportunity * (1 - risk / 100), 1)
    scores["opportunity"] = opportunity
    age = (at - token["pool_created"]) if token.get("pool_created") else None
    # Three independent detectors: eligibility is separate from a detected event.
    old_base = [
        x
        for x in samples
        if at - 48 * 3600 <= x["observed_at"] <= at - 24 * 3600
        and x.get("volume5m") is not None
    ]
    old_volume = (
        statistics.median(x["volume5m"] for x in old_base)
        if len(old_base) >= 6
        and old_base[-1]["observed_at"] - old_base[0]["observed_at"] >= 4 * 3600
        else None
    )
    revival_ratio = (
        latest.get("volume5m") / old_volume
        if old_volume and latest.get("volume5m") is not None
        else None
    )
    radars = {
        "new": {
            "eligible": age is not None and 0 <= age <= config["new_hours"] * 3600,
            "detected": age is not None and 0 <= age <= config["new_hours"] * 3600,
            "reason": "Idade do pool, não necessariamente criação do token; novidade não implica qualidade",
        },
        "acceleration": {
            "eligible": True,
            "detected": bool(
                consistent
                and sustained
                and (deltas["volume5m"] or 0) >= 50
                and (deltas["buys"] or 0) >= 25
                and deltas["liquidity"] is not None
                and deltas["liquidity"] >= 0
            ),
            "reason": "3 amostras da mesma fonte/pool, separadas por ≥5 min; volume +50%, compras +25%, liquidez estável",
        },
        "revival": {
            "eligible": age is not None and age >= config["revival_days"] * 86400,
            "detected": bool(
                age is not None
                and age >= config["revival_days"] * 86400
                and revival_ratio is not None
                and revival_ratio >= 3
                and pressure is not None
                and pressure >= 0.6
                and deltas["liquidity"] is not None
                and deltas["liquidity"] >= 0
            ),
            "reason": "Pool antigo; volume ≥3× mediana observada de 24–48 h antes, pressão compradora ≥60% e liquidez estável",
            "baseline_volume": old_volume,
        },
    }
    prices = [
        x["price"] for x in samples if at - x["observed_at"] <= 3600 and x.get("price")
    ]
    pullback = (
        (latest.get("price") / max(prices) - 1) * 100
        if prices and latest.get("price")
        else None
    )
    early = bool(
        radars["acceleration"]["detected"]
        and latest.get("change5m") is not None
        and 0 < latest["change5m"] <= config["max_price_change5m"]
    )
    continuation = bool(
        consistent
        and deltas["price"] is not None
        and deltas["price"] >= 3
        and pullback is not None
        and -8 <= pullback <= -1
        and pressure is not None
        and pressure >= 0.6
    )
    strategies = {
        "early": early,
        "continuation": continuation,
        "revival": radars["revival"]["detected"],
    }
    selected = next(
        (k for k, v in strategies.items() if v and config["strategies"][k]["enabled"]),
        None,
    )
    checks = []

    def check(key, label, passed, change):
        checks.append({"key": key, "label": label, "passed": passed, "change": change})

    fresh = bool(
        latest and 0 <= at - latest.get("observed_at", 0) <= config["stale_seconds"]
    )
    check(
        "fresh",
        "Cotação de mercado recente",
        fresh,
        "Aguardar nova observação dentro da janela de frescor",
    )
    check(
        "liquidity",
        "Liquidez suficiente",
        liquidity >= config["min_liquidity"] if liquidity is not None else None,
        f"Mínimo US$ {config['min_liquidity']:,.0f}",
    )
    check(
        "volume",
        "Volume recente suficiente",
        latest["volume5m"] >= config["min_volume5m"]
        if latest.get("volume5m") is not None
        else None,
        f"Mínimo US$ {config['min_volume5m']:,.0f} em 5 minutos",
    )
    check(
        "risk",
        "Verificações on-chain básicas disponíveis e sem alerta",
        not flags if not missing else None,
        "Consultar mint/freeze, programa e concentração; resolver alertas identificados",
    )
    check(
        "history",
        "Histórico comparável",
        consistent,
        "Coletar pelo menos 3 amostras da mesma fonte/pool, separadas por 5 minutos",
    )
    check(
        "strategy",
        "Hipótese de estratégia satisfeita",
        bool(selected),
        "Esperar aceleração inicial, correção em tendência ou retomada com baseline de 24 h",
    )
    change = latest.get("change5m")
    check(
        "price",
        "Movimento sem extensão excessiva",
        change <= config["max_price_change5m"] if change is not None else None,
        "Aguardar variação de 5 min abaixo do limite configurado",
    )
    quote_valid = (
        quote_check
        and 0 <= at - quote_check.get("observed_at", 0) <= 30
        and quote_check.get("ok")
    )
    check(
        "quote",
        "Rota estimada de compra e venda; custos aceitáveis",
        bool(quote_valid) if quote_check else None,
        "Obter duas cotações Jupiter recentes; recuperação ≥95% após custos, impacto ≤2% por rota",
    )
    state = "monitoring"
    if radars["acceleration"]["detected"]:
        state = "accelerating"
    if change is not None and change > config["max_price_change5m"]:
        state = "wait"
    if all(x["passed"] is True for x in checks):
        state = "validated"
    if flags:
        state = "high_risk"
    if not token.get("active", 1):
        state = "closed"
    timing = "incomplete"
    if social.get("growth_pct") is not None and change is not None:
        timing = (
            "social_before_price"
            if social["growth_pct"] > 25 and abs(change) < 3
            else "social_and_flow"
            if social["growth_pct"] > 25
            and pressure is not None
            and pressure > 0.6
            and change <= 20
            else "late_promotion"
            if change > 20
            else "no_divergence"
        )
    return {
        "state": state,
        "label": STATES[state],
        "scores": scores,
        "radars": radars,
        "strategies": strategies,
        "selected_strategy": selected,
        "checks": checks,
        "flags": flags,
        "missing": missing,
        "deltas": deltas,
        "pressure": pressure,
        "social_timing": timing,
        "heuristic": True,
        "formula_version": "v1",
        "observed_at": at,
        "limitations": [
            "Transações de compra não são compradores únicos.",
            "Fluxo e repetição não comprovam atividade orgânica.",
            "Janelas de volume podem se sobrepor; avaliação usa amostras espaçadas.",
            "Criador, coordenação entre carteiras, lock de liquidez e restrições de venda não completamente verificados.",
        ],
    }
