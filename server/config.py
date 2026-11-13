import copy

DEFAULTS = {
    "version": 1,
    "min_liquidity": 20000,
    "min_volume5m": 2000,
    "new_hours": 24,
    "revival_days": 3,
    "active_days": 14,
    "collect_seconds": 180,
    "refresh_seconds": 45,
    "stale_seconds": 600,
    "max_price_change5m": 20,
    "max_holder_pct": 20,
    "social_enabled": True,
    "security_enabled": True,
    "paper_auto": False,
    "paper_latency_seconds": 3,
    "paper_usd": 20,
    "paper_initial_usd": 1000,
    "paper_max_open": 3,
    "slippage_bps": 100,
    "network_fee_usd": 0.05,
    "strategies": {
        "early": {
            "enabled": True,
            "take_profit": 12,
            "stop_loss": -6,
            "max_minutes": 20,
        },
        "continuation": {
            "enabled": True,
            "take_profit": 15,
            "stop_loss": -7,
            "max_minutes": 30,
        },
        "revival": {
            "enabled": True,
            "take_profit": 10,
            "stop_loss": -5,
            "max_minutes": 25,
        },
    },
    "weights": {"momentum": 0.45, "flow": 0.35, "social": 0.20},
}


def validate(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError("Configuração incompleta ou campos desconhecidos")
    value = copy.deepcopy(value)
    bounds = {
        "min_liquidity": (1000, 10000000),
        "min_volume5m": (100, 10000000),
        "new_hours": (1, 48),
        "revival_days": (3, 90),
        "active_days": (1, 365),
        "collect_seconds": (180, 3600),
        "refresh_seconds": (15, 600),
        "stale_seconds": (60, 1800),
        "max_price_change5m": (1, 100),
        "max_holder_pct": (1, 50),
        "paper_usd": (1, 100),
        "paper_initial_usd": (100, 10000),
        "paper_max_open": (1, 10),
        "paper_latency_seconds": (0, 30),
        "slippage_bps": (10, 300),
        "network_fee_usd": (0, 5),
    }
    import math

    for key, (low, high) in bounds.items():
        x = value[key]
        if (
            isinstance(x, bool)
            or not isinstance(x, (int, float))
            or not math.isfinite(x)
            or not low <= x <= high
        ):
            raise ValueError("Valor inválido: " + key)
    for key in [
        "collect_seconds",
        "refresh_seconds",
        "stale_seconds",
        "paper_max_open",
        "slippage_bps",
    ]:
        if value[key] != int(value[key]):
            raise ValueError("Inteiro necessário: " + key)
    if value["version"] != 1:
        raise ValueError("Versão de configuração inválida")
    for key in ["social_enabled", "security_enabled", "paper_auto"]:
        if type(value[key]) is not bool:
            raise ValueError("Booleano necessário: " + key)
    if set(value["weights"]) != {"momentum", "flow", "social"}:
        raise ValueError("Pesos inválidos")
    if (
        any(
            type(x) not in (float, int) or not math.isfinite(x) or x < 0
            for x in value["weights"].values()
        )
        or abs(sum(value["weights"].values()) - 1) > 0.00001
    ):
        raise ValueError("Pesos devem somar 1")
    if set(value["strategies"]) != {"early", "continuation", "revival"}:
        raise ValueError("Estratégias inválidas")
    for p in value["strategies"].values():
        if (
            not isinstance(p, dict)
            or set(p) != {"enabled", "take_profit", "stop_loss", "max_minutes"}
            or type(p["enabled"]) is not bool
        ):
            raise ValueError("Perfil de estratégia inválido")
        for key, low, high in [
            ("take_profit", 1, 100),
            ("stop_loss", -50, -1),
            ("max_minutes", 2, 240),
        ]:
            x = p[key]
            if (
                type(x) not in (int, float)
                or not math.isfinite(x)
                or not low <= x <= high
            ):
                raise ValueError("Saída inválida")
    return value
