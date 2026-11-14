"""Public adapters. A response time is observation time, not a block timestamp."""

import hashlib
import json
import math
import os
import re
import time
import random
from email.utils import parsedate_to_datetime
import urllib.error
import urllib.parse
import urllib.request
from .db import dump, load, now, transaction

MINT = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"


class SourceError(Exception):
    pass


def number(value):
    try:
        n = float(value)
        return n if math.isfinite(n) and n >= 0 else None
    except (ValueError, TypeError):
        return None


def signed(value):
    try:
        n = float(value)
        return n if math.isfinite(n) else None
    except (ValueError, TypeError):
        return None


class HTTP:
    def __init__(self, db, budget=36):
        self.db = db
        self.remaining = budget
        self.last_observed_at = 0
        db.execute(
            "CREATE TABLE IF NOT EXISTS http_inflight(provider TEXT PRIMARY KEY,expires INTEGER NOT NULL)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS request_events(id INTEGER PRIMARY KEY,provider TEXT NOT NULL,method TEXT NOT NULL,attempted_at INTEGER NOT NULL,http_status INTEGER,error_kind TEXT,retry_at INTEGER)"
        )
        db.execute(
            "CREATE TABLE IF NOT EXISTS http_cache(key TEXT PRIMARY KEY,expires INTEGER NOT NULL,data TEXT NOT NULL,observed_at INTEGER NOT NULL DEFAULT 0)"
        )

        if "observed_at" not in {
            r["name"] for r in db.execute("PRAGMA table_info(http_cache)")
        }:
            db.execute(
                "ALTER TABLE http_cache ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0"
            )
            db.execute("DELETE FROM http_cache WHERE observed_at=0")

    def request(self, provider, url, ttl=60, body=None, headers=None, gap=2):
        at = now()
        gap = max(gap, 10) if provider == "solana_rpc" else gap
        key = hashlib.sha256((url + dump(body)).encode()).hexdigest()
        cached = self.db.execute(
            "SELECT * FROM http_cache WHERE key=?", (key,)
        ).fetchone()
        if cached and cached["expires"] > at:
            self.last_observed_at = cached["observed_at"]
            return load(cached["data"])
        if self.remaining <= 0:
            raise SourceError("Orçamento de requisições da rodada esgotado")
        # A single shared budget per database/day complements per-round limits.
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS request_budget(day INTEGER PRIMARY KEY,requests INTEGER NOT NULL)"
        )
        # Reserve provider slots atomically across collector and manual quote requests.
        with transaction(self.db):
            day = at // 86400
            self.db.execute("INSERT OR IGNORE INTO request_budget VALUES(?,0)", (day,))
            used = self.db.execute(
                "SELECT requests FROM request_budget WHERE day=?", (day,)
            ).fetchone()[0]
            if used >= 6000:
                raise SourceError("Orçamento global diário esgotado")
            state = self.db.execute(
                "SELECT * FROM source_state WHERE name=?", (provider,)
            ).fetchone()
            if state and state["next_attempt"] > at:
                raise SourceError(provider + ": em pausa/backoff")
            slot = max(at, (state["last_attempt"] or 0) + gap) if state else at
            if slot - at > 30:
                raise SourceError(provider + ": fila de requisições ocupada")
            self.db.execute(
                "INSERT INTO source_state(name,status) VALUES(?,?) ON CONFLICT(name) DO NOTHING",
                (provider, "unknown"),
            )
            self.db.execute(
                "UPDATE request_budget SET requests=requests+1 WHERE day=?", (day,)
            )
            self.db.execute(
                "UPDATE source_state SET last_attempt=?,requests=requests+1 WHERE name=?",
                (slot, provider),
            )
        if slot > now():
            time.sleep(slot - now())
        current = self.db.execute(
            "SELECT next_attempt FROM source_state WHERE name=?", (provider,)
        ).fetchone()
        if current["next_attempt"] > now():
            raise SourceError(provider + ": em pausa/backoff")
        with transaction(self.db):
            self.db.execute("DELETE FROM http_inflight WHERE expires<=?", (now(),))
            if self.db.execute(
                "SELECT 1 FROM http_inflight WHERE provider=?", (provider,)
            ).fetchone():
                raise SourceError(provider + ": requisição em andamento; adiada")
            self.db.execute(
                "INSERT INTO http_inflight VALUES(?,?)", (provider, now() + 30)
            )
        self.remaining -= 1
        request = urllib.request.Request(
            url,
            data=dump(body).encode() if body is not None else None,
            headers={
                "Accept": "application/json",
                "User-Agent": "EdgeRadar/1.0 (local research; no trading)",
                **({"Content-Type": "application/json"} if body is not None else {}),
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=7) as response:
                raw = response.read(4_000_001)
                if len(raw) > 4_000_000:
                    raise SourceError("Resposta excede limite de tamanho")
                result = json.loads(raw)
            if isinstance(result, dict) and result.get("error"):
                raise SourceError("Provedor retornou erro de aplicação")
        except (
            urllib.error.URLError,
            TimeoutError,
            ValueError,
            SourceError,
            OSError,
        ) as error:
            failures = (state["failures"] if state else 0) + 1
            status = getattr(error, "code", None)
            proxy_denied = status is None and "Tunnel connection failed: 403" in str(
                error
            )
            delay = min(3600, 60 * 2 ** min(failures, 6))
            delay += random.randint(0, 15)
            if status == 429:
                value = error.headers.get("Retry-After", "0") if error.headers else "0"
                try:
                    retry = float(value)
                except (ValueError, TypeError):
                    try:
                        retry = parsedate_to_datetime(value).timestamp() - now()
                    except (ValueError, TypeError, OverflowError):
                        retry = 0
                # Never shorten a provider's Retry-After, including values > 1 hour.
                delay = max(delay, math.ceil(retry))
            # Never persist full exception/URL; it could include private provider details.
            if proxy_denied:
                message = "Proxy CONNECT negado (HTTP 403); API não alcançada"
            elif status:
                message = f"Resposta HTTP {status} após CONNECT; origem a confirmar"
            else:
                message = "Rede, formato ou acesso indisponível"
            self.db.execute(
                "UPDATE source_state SET status=?,failures=?,next_attempt=?,error=? WHERE name=?",
                ("unavailable", failures, now() + delay, message, provider),
            )
            self.db.execute(
                "INSERT INTO request_events(provider,method,attempted_at,http_status,error_kind,retry_at) VALUES(?,?,?,?,?,?)",
                (
                    provider,
                    body.get("method", "GET") if isinstance(body, dict) else "GET",
                    at,
                    status,
                    "connect_denied"
                    if proxy_denied
                    else "http"
                    if status
                    else "transport_or_schema",
                    now() + delay,
                ),
            )
            raise SourceError(provider + ": " + message) from None
        finally:
            self.db.execute("DELETE FROM http_inflight WHERE provider=?", (provider,))
        self.db.execute(
            "INSERT INTO request_events(provider,method,attempted_at,http_status) VALUES(?,?,?,200)",
            (
                provider,
                body.get("method", "GET") if isinstance(body, dict) else "GET",
                at,
            ),
        )
        self.db.execute(
            "UPDATE source_state SET status=?,last_success=?,failures=0,next_attempt=0,error=NULL WHERE name=?",
            ("ok", now(), provider),
        )
        self.db.execute(
            "INSERT OR REPLACE INTO http_cache(key,expires,data,observed_at) VALUES(?,?,?,?)",
            (key, now() + ttl, dump(result), now()),
        )
        self.db.execute("DELETE FROM http_cache WHERE expires<?", (now() - 3600,))
        self.last_observed_at = now()
        return result


class Market:
    def __init__(self, http):
        self.http = http

    def gecko(self, kind, page=1):
        route = "new_pools" if kind == "new" else "trending_pools"
        raw = self.http.request(
            "geckoterminal",
            f"https://api.geckoterminal.com/api/v2/networks/solana/{route}?include=base_token&page={page}",
            ttl=180,
            gap=3,
        )
        if not isinstance(raw, dict) or not isinstance(raw.get("data"), list):
            raise SourceError("GeckoTerminal: esquema de resposta inválido")
        included = {x["id"]: x.get("attributes", {}) for x in raw.get("included", [])}
        result = []
        for pool in raw.get("data", []):
            a = pool.get("attributes", {})
            rel = pool.get("relationships", {})
            ref = rel.get("base_token", {}).get("data", {}).get("id", "")
            token = included.get(ref, {})
            mint = token.get("address") or ref.removeprefix("solana_")
            if not MINT.fullmatch(mint) or mint == USDC:
                continue
            created = None
            try:
                from datetime import datetime

                created = int(
                    datetime.fromisoformat(
                        a["pool_created_at"].replace("Z", "+00:00")
                    ).timestamp()
                )
            except (KeyError, ValueError, TypeError):
                pass
            tx = a.get("transactions", {}).get("m5", {})
            result.append(
                {
                    "mint": mint,
                    "name": token.get("name") or a.get("name", "").split(" / ")[0],
                    "symbol": token.get("symbol"),
                    "source": "geckoterminal",
                    "observed_at": getattr(self.http, "last_observed_at", now()),
                    "pool": a.get("address"),
                    "pool_created": created,
                    "price": number(a.get("base_token_price_usd")),
                    "liquidity": number(a.get("reserve_in_usd")),
                    "volume5m": number(a.get("volume_usd", {}).get("m5")),
                    "volume24h": number(a.get("volume_usd", {}).get("h24")),
                    "buys": number(tx.get("buys")),
                    "sells": number(tx.get("sells")),
                    "unique_buyers": number(tx.get("buyers")),
                    "change5m": signed(a.get("price_change_percentage", {}).get("m5")),
                    "change1h": signed(a.get("price_change_percentage", {}).get("h1")),
                    "change24h": signed(
                        a.get("price_change_percentage", {}).get("h24")
                    ),
                    "market_cap": number(a.get("market_cap_usd")),
                    "fdv": number(a.get("fdv_usd")),
                }
            )
        return deduplicate(result)

    def profiles(self):
        raw = self.http.request(
            "dexscreener",
            "https://api.dexscreener.com/token-profiles/latest/v1",
            ttl=180,
            gap=2,
        )
        if not isinstance(raw, list):
            raise SourceError("DEX Screener: esquema de perfis inválido")
        return list(
            dict.fromkeys(
                x["tokenAddress"]
                for x in raw
                if x.get("chainId") == "solana"
                and MINT.fullmatch(x.get("tokenAddress", ""))
            )
        )[:15]

    def prices(self, mints):
        mints = [m for m in mints if MINT.fullmatch(m)][:30]
        if not mints:
            return []
        raw = self.http.request(
            "dexscreener",
            "https://api.dexscreener.com/tokens/v1/solana/" + ",".join(mints),
            ttl=60,
            gap=2,
        )
        if not isinstance(raw, list):
            raise SourceError("DEX Screener: esquema de pares inválido")
        result = []
        for pair in raw:
            token = pair.get("baseToken", {})
            mint = token.get("address", "")
            if pair.get("chainId") != "solana" or mint not in mints:
                continue
            tx = pair.get("txns", {}).get("m5", {})
            created = number(pair.get("pairCreatedAt"))
            result.append(
                {
                    "mint": mint,
                    "name": token.get("name"),
                    "symbol": token.get("symbol"),
                    "source": "dexscreener",
                    "observed_at": getattr(self.http, "last_observed_at", now()),
                    "pool": pair.get("pairAddress"),
                    "pool_created": int(created / 1000) if created else None,
                    "price": number(pair.get("priceUsd")),
                    "liquidity": number(pair.get("liquidity", {}).get("usd")),
                    "volume5m": number(pair.get("volume", {}).get("m5")),
                    "volume24h": number(pair.get("volume", {}).get("h24")),
                    "buys": number(tx.get("buys")),
                    "sells": number(tx.get("sells")),
                    "unique_buyers": None,
                    "change5m": signed(pair.get("priceChange", {}).get("m5")),
                    "change1h": signed(pair.get("priceChange", {}).get("h1")),
                    "change24h": signed(pair.get("priceChange", {}).get("h24")),
                    "market_cap": number(pair.get("marketCap")),
                    "fdv": number(pair.get("fdv")),
                }
            )
        return deduplicate(result)


def deduplicate(rows):
    pools = {}
    for x in rows:
        # One representative pool: largest observed liquidity; not aggregate multi-pool volume.
        if x["mint"] not in pools or (x.get("liquidity") or 0) > (
            pools[x["mint"]].get("liquidity") or 0
        ):
            pools[x["mint"]] = x
    return list(pools.values())


class Security:
    def __init__(self, http):
        self.http = http

    def inspect(self, mint):
        if not MINT.fullmatch(mint):
            raise SourceError("Contrato inválido")
        rpc = "https://api.mainnet-beta.solana.com"
        raw = self.http.request(
            "solana_rpc",
            rpc,
            ttl=600,
            body={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getAccountInfo",
                "params": [mint, {"encoding": "jsonParsed", "commitment": "confirmed"}],
            },
            gap=3,
        )
        mint_at = getattr(self.http, "last_observed_at", now())
        value = raw.get("result", {}).get("value") or {}
        parsed = (
            value.get("data", {}).get("parsed", {})
            if isinstance(value.get("data"), dict)
            else {}
        )
        info = parsed.get("info", {})
        if (
            parsed.get("type") != "mint"
            or not {"supply", "decimals", "mintAuthority", "freezeAuthority"}
            <= info.keys()
        ):
            raise SourceError("Conta não é mint SPL analisável")
        supply = number(info.get("supply"))
        concentration_error = None
        try:
            raw2 = self.http.request(
                "solana_rpc",
                rpc,
                ttl=600,
                body={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "getTokenLargestAccounts",
                    "params": [mint, {"commitment": "confirmed"}],
                },
                gap=3,
            )
        except SourceError as error:
            raw2 = {}
            concentration_error = str(error)
        largest = raw2.get("result", {}).get("value", [])
        amounts = [number(x.get("amount")) for x in largest]
        max_pct = (
            max((x / supply * 100 for x in amounts if x is not None), default=None)
            if supply
            else None
        )
        return {
            "complete": max_pct is not None,
            "checks": {
                "mint_authority": {"status": "observed"},
                "freeze_authority": {"status": "observed"},
                "token_program": {"status": "observed"},
                "supply_decimals": {"status": "observed"},
                "largest_accounts": {
                    "status": "missing" if max_pct is None else "observed",
                    "error": concentration_error,
                },
            },
            "mint_authority": info.get("mintAuthority"),
            "freeze_authority": info.get("freezeAuthority"),
            "decimals": info.get("decimals"),
            "largest_account_pct": max_pct,
            "supply": info.get("supply"),
            "token_program": value.get("owner"),
            "source": "solana_rpc",
            "observed_at": min(mint_at, getattr(self.http, "last_observed_at", now())),
            "limitations": [
                "Contas de token não equivalem a holders: pools e custódias podem concentrar saldo.",
                "Criador, carteiras relacionadas, extensão Token-2022 e lock de liquidez não verificados.",
            ],
        }


class Social:
    def __init__(self, http):
        self.http = http

    def search(self, mint):
        raw = self.http.request(
            "bluesky",
            "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?"
            + urllib.parse.urlencode({"q": mint, "limit": 30, "sort": "latest"}),
            ttl=600,
            gap=3,
        )
        if not isinstance(raw, dict) or not isinstance(raw.get("posts"), list):
            raise SourceError("Bluesky: esquema de resposta inválido")
        rows = []
        from datetime import datetime

        for post in raw.get("posts", []):
            record = post.get("record", {})
            text = record.get("text", "")
            # Exact contract only: symbols/names do not establish identity.
            if not re.search(
                r"(?<![1-9A-HJ-NP-Za-km-z])"
                + re.escape(mint)
                + r"(?![1-9A-HJ-NP-Za-km-z])",
                text,
            ):
                continue
            try:
                published = int(
                    datetime.fromisoformat(
                        record["createdAt"].replace("Z", "+00:00")
                    ).timestamp()
                )
            except (KeyError, ValueError, TypeError):
                continue
            if published > now() + 60:
                continue
            rows.append(
                {
                    "id": post["uri"],
                    "mint": mint,
                    "published_at": published,
                    "author": post.get("author", {}).get("did", "unknown"),
                    "text": text[:2000],
                    "source": "bluesky",
                }
            )
        return rows


class Quotes:
    """Read-only Jupiter quotes; never request swap transactions or signing."""

    def __init__(self, http):
        self.http = http

    def quote(self, input_mint, output_mint, amount, slippage):
        key = os.environ.get("JUPITER_API_KEY")
        if not key:
            raise SourceError(
                "Cotação Jupiter indisponível: JUPITER_API_KEY opcional não configurada"
            )
        query = urllib.parse.urlencode(
            {
                "inputMint": input_mint,
                "outputMint": output_mint,
                "amount": str(amount),
                "slippageBps": int(slippage),
                "restrictIntermediateTokens": "true",
            }
        )
        raw = self.http.request(
            "jupiter",
            "https://api.jup.ag/swap/v1/quote?" + query,
            ttl=0,
            headers={"x-api-key": key},
            gap=2,
        )
        try:
            if (
                raw["inputMint"] != input_mint
                or raw["outputMint"] != output_mint
                or int(raw["inAmount"]) != int(amount)
                or raw["swapMode"] != "ExactIn"
            ):
                raise ValueError()
            if (
                not raw["routePlan"]
                or int(raw["otherAmountThreshold"]) <= 0
                or int(raw["outAmount"]) < int(raw["otherAmountThreshold"])
            ):
                raise ValueError()
            impact = number(raw["priceImpactPct"])
            if impact is None or impact > 2:
                raise ValueError()
            raw["observed_at"] = now()
            raw["source"] = "jupiter"
            raw["estimated_only"] = True
        except (KeyError, ValueError, TypeError):
            raise SourceError("Cotação incompleta ou impacto acima de 2%") from None
        return raw
