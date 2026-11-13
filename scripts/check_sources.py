"""Read-only HTTPS probes using the configured proxy and normal TLS verification.

Records CONNECT/proxy denials separately from actual API HTTP responses.
Never records credential values or arbitrary exception text.
"""

import argparse
import concurrent.futures
import datetime
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

WSOL = "So11111111111111111111111111111111111111112"
USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
TARGETS = [
    ("dex_profiles", "https://api.dexscreener.com/token-profiles/latest/v1", None),
    ("dex_prices", f"https://api.dexscreener.com/tokens/v1/solana/{WSOL}", None),
    (
        "gecko_new",
        "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token&page=1",
        None,
    ),
    (
        "gecko_trending",
        "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token&page=1",
        None,
    ),
    (
        "solana_mint",
        "https://api.mainnet-beta.solana.com",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [WSOL, {"encoding": "jsonParsed", "commitment": "confirmed"}],
        },
    ),
    (
        "solana_largest_accounts",
        "https://api.mainnet-beta.solana.com",
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "getTokenLargestAccounts",
            "params": [WSOL, {"commitment": "confirmed"}],
        },
    ),
    (
        "bluesky_search",
        "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?"
        + urllib.parse.urlencode({"q": WSOL, "limit": 1, "sort": "latest"}),
        None,
    ),
    (
        "jupiter_quote",
        "https://api.jup.ag/swap/v1/quote?"
        + urllib.parse.urlencode(
            {
                "inputMint": USDC,
                "outputMint": WSOL,
                "amount": 1000000,
                "slippageBps": 100,
                "restrictIntermediateTokens": "true",
            }
        ),
        None,
    ),
    ("dex_docs", "https://docs.dexscreener.com/api/reference", None),
    ("gecko_docs", "https://apiguide.geckoterminal.com/", None),
    ("solana_docs", "https://solana.com/docs/references/clusters", None),
    ("bluesky_docs", "https://docs.bsky.app/docs/api/app-bsky-feed-search-posts", None),
    ("jupiter_docs", "https://dev.jup.ag/docs/api-setup", None),
    ("allowed_control", "https://registry.npmjs.org/typescript/latest", None),
]


def probe(target):
    name, url, body = target
    headers = {
        "Accept": "application/json" if not name.endswith("docs") else "text/html",
        "User-Agent": "EdgeRadar/1.0 (read-only source verification)",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if name == "jupiter_quote" and os.environ.get("JUPITER_API_KEY"):
        headers["x-api-key"] = os.environ["JUPITER_API_KEY"]
    row = {
        "name": name,
        "url": url,
        "method": "POST" if body else "GET",
        "checked_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "host": urllib.parse.urlsplit(url).hostname,
        "api_http_status": None,
        "proxy_http_status": None,
    }
    request = urllib.request.Request(
        url, headers=headers, data=json.dumps(body).encode() if body else None
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = response.read(4_000_001)
            row.update(
                stage="upstream_response",
                api_http_status=response.status,
                bytes=len(payload),
                final_host=urllib.parse.urlsplit(response.url).hostname,
            )
            try:
                data = json.loads(payload)
                row["json_valid"] = True
                row["result_shape"] = type(data).__name__
                row["api_error"] = bool(isinstance(data, dict) and data.get("error"))
            except (ValueError, UnicodeError):
                row["json_valid"] = False
    except urllib.error.HTTPError as error:
        row.update(stage="upstream_http_error", api_http_status=error.code)
    except urllib.error.URLError as error:
        reason = str(error.reason)
        if "Tunnel connection failed: 403" in reason:
            row.update(
                stage="proxy_connect_denied",
                proxy_http_status=403,
                note="CONNECT rejected before TLS to destination; API status unknown",
            )
        else:
            row.update(
                stage="transport_error",
                note="No API response; network, DNS or TLS failure",
            )
    except (TimeoutError, OSError):
        row.update(
            stage="transport_error", note="No API response; timeout or network failure"
        )
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default=".runtime/validation/network-probes.json")
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(probe, TARGETS))
    report = {
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "jupiter_key_present": bool(os.environ.get("JUPITER_API_KEY")),
        "results": results,
    }
    path = Path(args.report)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Keep previous reports; never overwrite evidence from an earlier run.
    if path.exists():
        path = path.with_name(
            path.stem
            + "-"
            + datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%S%f")
            + path.suffix
        )
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    for row in results:
        print(
            row["name"],
            row["host"],
            row["stage"],
            row["api_http_status"] or row["proxy_http_status"],
        )
    print("Credential presence only:", report["jupiter_key_present"])
    print("Report:", path)
    return (
        0
        if all(
            r["stage"] == "upstream_response" and not r.get("api_error")
            for r in results
        )
        else 2
    )


if __name__ == "__main__":
    raise SystemExit(main())
