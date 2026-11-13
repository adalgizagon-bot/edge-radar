"""Conservative quote-based paper ledger. All decisions are forward-only."""

from .db import dump, load, transaction, now
from .sources import USDC, SourceError


def metrics(trades, initial=1000):
    closed = sorted(
        [t for t in trades if t["status"] == "closed"],
        key=lambda t: (t["closed_at"], t["id"]),
    )
    pnl = [t["pnl"] for t in closed]
    wins = [x for x in pnl if x > 0]
    losses = [x for x in pnl if x < 0]
    balance = peak = initial
    drawdown = 0
    for value in pnl:
        balance += value
        peak = max(peak, balance)
        drawdown = max(drawdown, peak - balance)
    return {
        "closed": len(pnl),
        "open": sum(t["status"] in ("open", "exit_unavailable") for t in trades),
        "wins": len(wins),
        "win_rate": len(wins) / len(pnl) * 100 if pnl else None,
        "net_pnl": round(sum(pnl), 6),
        "mean_win": sum(wins) / len(wins) if wins else None,
        "mean_loss": sum(losses) / len(losses) if losses else None,
        "expectancy": sum(pnl) / len(pnl) if pnl else None,
        "profit_factor": sum(wins) / abs(sum(losses)) if losses else None,
        "max_drawdown_usd": round(drawdown, 6),
        "balance_realized": round(balance, 6),
        "sample_sufficient": len(pnl) >= 100,
        "note": "Saldo realizado exclui posições abertas; sem amostra não há evidência de vantagem.",
    }


def group_metrics(trades, key, initial):
    return {
        v: metrics([t for t in trades if t[key] == v], initial)
        for v in sorted({t[key] for t in trades})
    }


def roundtrip(quotes, mint, config, at):
    cost = int(config["paper_usd"] * 1_000_000)
    buy = quotes.quote(USDC, mint, cost, config["slippage_bps"])
    amount = int(buy["otherAmountThreshold"])
    sell = quotes.quote(mint, USDC, amount, config["slippage_bps"])
    if any(
        q.get("observed_at", at + 1) > at + 30 or at - q.get("observed_at", 0) > 30
        for q in [buy, sell]
    ):
        raise SourceError("Cotação expirada")
    recovered = (
        int(sell["otherAmountThreshold"]) / 1_000_000 - 2 * config["network_fee_usd"]
    )
    return {
        "ok": recovered >= config["paper_usd"] * 0.95,
        "observed_at": max(buy["observed_at"], sell["observed_at"]),
        "buy": buy,
        "sell": sell,
        "recovery_pct": recovered / config["paper_usd"] * 100,
    }


def open_position(db, mint, assessment, config, roundtrip_quote, at):
    if assessment["state"] != "validated" or not assessment.get("selected_strategy"):
        raise ValueError("Entrada não atende aos critérios de simulação")
    if at - assessment["observed_at"] > 30 or assessment["observed_at"] > at:
        raise ValueError("Avaliação expirada")
    q = roundtrip_quote
    if not q.get("ok") or not 0 <= at - q["observed_at"] <= 30:
        raise ValueError("Cotação ausente ou expirada")
    strategy = assessment["selected_strategy"]
    if not config["strategies"][strategy]["enabled"]:
        raise ValueError("Estratégia desabilitada")
    with transaction(db):
        rows = [dict(x) for x in db.execute("SELECT * FROM trades")]
        if (
            sum(t["status"] in ("open", "exit_unavailable") for t in rows)
            >= config["paper_max_open"]
        ):
            raise ValueError("Limite de posições atingido")
        if any(t["mint"] == mint and t["status"] != "closed" for t in rows):
            raise ValueError("Moeda já possui posição")
        available = (
            config["paper_initial_usd"]
            + sum(t["pnl"] or 0 for t in rows)
            - sum(t["entry_cost"] for t in rows if t["status"] != "closed")
        )
        entry = config["paper_usd"] + config["network_fee_usd"]
        if available < entry:
            raise ValueError("Saldo fictício insuficiente")
        # Opening uses the conservative min output quoted now, never the historical low.
        category = next(
            (
                k
                for k in ["revival", "new", "acceleration"]
                if assessment["radars"][k]["detected"]
            ),
            "watch",
        )
        regime = (
            "extended"
            if assessment["deltas"].get("price", 0)
            and assessment["deltas"]["price"] > 10
            else "moderate"
        )
        policy = {
            "strategy": config["strategies"][strategy],
            "slippage_bps": config["slippage_bps"],
            "network_fee_usd": config["network_fee_usd"],
        }
        cursor = db.execute(
            "INSERT INTO trades(mint,strategy,category,regime,opened_at,status,input_usd,token_amount,entry_cost,entry_quote,policy,peak,fees) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                mint,
                strategy,
                category,
                regime,
                at,
                "open",
                config["paper_usd"],
                q["buy"]["otherAmountThreshold"],
                entry,
                dump(q["buy"]),
                dump(policy),
                0,
                config["network_fee_usd"],
            ),
        )
        trade_id = cursor.lastrowid
        db.execute(
            "INSERT INTO trade_events(trade_id,observed_at,kind,data) VALUES(?,?,?,?)",
            (
                trade_id,
                at,
                "opened",
                dump(
                    {
                        "assessment": assessment,
                        "roundtrip": q,
                        "assumption": "Saída mínima estimada com slippage; não houve execução real nem confirmação de liquidação.",
                    }
                ),
            ),
        )
    return trade_id


def monitor(db, quotes, at):
    for row in db.execute(
        "SELECT * FROM trades WHERE status IN ('open','exit_unavailable')"
    ).fetchall():
        t = dict(row)
        policy = load(t["policy"])
        strategy = policy["strategy"]
        try:
            q = quotes.quote(
                t["mint"], USDC, int(t["token_amount"]), policy["slippage_bps"]
            )
            at = max(at, now())
            if not 0 <= at - q.get("observed_at", 0) <= 30:
                raise SourceError("Cotação de saída expirada")
            value = int(q["otherAmountThreshold"]) / 1e6 - policy["network_fee_usd"]
            change = (value / t["entry_cost"] - 1) * 100
            reason = (
                "stop"
                if change <= strategy["stop_loss"]
                else "target"
                if change >= strategy["take_profit"]
                else "time"
                if at - t["opened_at"] >= strategy["max_minutes"] * 60
                else None
            )
            with transaction(db):
                db.execute(
                    "INSERT INTO trade_events(trade_id,observed_at,kind,data) VALUES(?,?,?,?)",
                    (
                        t["id"],
                        at,
                        "quote",
                        dump(
                            {"quote": q, "net_value": value, "net_change_pct": change}
                        ),
                    ),
                )
                db.execute(
                    "UPDATE trades SET status='open',peak=MAX(peak,?),reason=NULL WHERE id=?",
                    (change, t["id"]),
                )
                if reason:
                    # Never fill at the stop threshold: record the current executable estimate, including gaps.
                    db.execute(
                        "UPDATE trades SET status='closed',closed_at=?,exit_value=?,pnl=?,exit_quote=?,reason=?,fees=fees+? WHERE id=?",
                        (
                            at,
                            value,
                            value - t["entry_cost"],
                            dump(q),
                            reason,
                            policy["network_fee_usd"],
                            t["id"],
                        ),
                    )
        except (SourceError, ValueError, KeyError) as error:
            with transaction(db):
                db.execute(
                    "UPDATE trades SET status='exit_unavailable',reason=? WHERE id=?",
                    (str(error)[:200], t["id"]),
                )
                db.execute(
                    "INSERT INTO trade_events(trade_id,observed_at,kind,data) VALUES(?,?,?,?)",
                    (
                        t["id"],
                        at,
                        "exit_unavailable",
                        dump({"reason": str(error)[:200]}),
                    ),
                )


def report(db, config):
    trades = [
        dict(r)
        for r in db.execute("SELECT * FROM trades ORDER BY opened_at DESC,id DESC")
    ]
    base = config["paper_initial_usd"]
    return {
        "trades": trades,
        "metrics": metrics(trades, base),
        "by_strategy": group_metrics(trades, "strategy", base),
        "by_category": group_metrics(trades, "category", base),
        "by_regime": group_metrics(trades, "regime", base),
        "quote_available": bool(__import__("os").environ.get("JUPITER_API_KEY")),
        "methodology": "Cotações estimadas ExactIn com saída mínima, custos e slippage; sem transação real. Sem cotação, sem fill. Stops sujeitos a gaps e atraso. Métricas não incluem valorização de posições abertas. Hipóteses congeladas por entrada; teste fora da amostra deve usar janela temporal futura.",
    }
