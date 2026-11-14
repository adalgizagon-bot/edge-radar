"""Loopback development server. Do not expose this unauthenticated admin API publicly."""

import argparse
import json
import logging
import mimetypes
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from .db import connect, settings, save_settings, dump, load, now, history
from .collector import collect, assessment
from .sources import HTTP, Quotes, SourceError, MINT
from .paper import roundtrip, open_position, report
from . import tracking, research

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("edge.http")


def overview(db):
    config, revision = settings(db)
    at = now()
    tokens = []
    for r in db.execute("SELECT mint FROM tokens ORDER BY last_seen DESC LIMIT 1000"):
        x = assessment(db, r["mint"], at)
        tokens.append(x)
    source_rows = [
        dict(r)
        for r in db.execute(
            "SELECT name,status,last_attempt,last_success,next_attempt,failures,requests,error FROM source_state"
        )
    ]
    for r in source_rows:
        if (
            r["status"] == "ok"
            and at - (r["last_success"] or 0) > config["stale_seconds"]
        ):
            r["status"] = "stale"
    seen = {r["name"] for r in source_rows}
    for name in ["geckoterminal", "dexscreener", "solana_rpc", "bluesky", "jupiter"]:
        if name not in seen:
            source_rows.append(
                {
                    "name": name,
                    "status": "not_checked",
                    "last_success": None,
                    "error": "Credencial opcional necessária"
                    if name == "jupiter"
                    else None,
                }
            )
    run = db.execute("SELECT * FROM job_runs ORDER BY id DESC LIMIT 1").fetchone()
    running = db.execute("SELECT expires FROM jobs WHERE expires>?", (at,)).fetchone()
    return {
        "tracking": tracking.report(db, at),
        "research": research.report(db, infer=False),
        "tokens": tokens,
        "total_tokens": db.execute("SELECT count(*) FROM tokens").fetchone()[0],
        "sources": source_rows,
        "last_run": dict(run) if run else None,
        "collecting": bool(running),
        "config": config,
        "config_revision": revision,
        "now": at,
        "paper": report(db, config),
        "narratives": [n for t in tokens for n in t["social"]["narratives"]],
        "limits": [
            "Lista principal exibe no máximo 1.000 contratos; histórico é retido no banco.",
            "Coleta periódica, sem garantia de cobertura de todos os lançamentos.",
        ],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "EdgeRadar/1.0"

    def log_message(self, fmt, *args):
        log.info(fmt, *args)

    def respond(self, status, data, kind="application/json; charset=utf-8"):
        raw = dump(data).encode() if kind.startswith("application/json") else data
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
        )
        self.end_headers()
        self.wfile.write(raw)

    def allowed(self):
        # DNS rebinding and cross-origin mutation defense for the local admin server.
        host = self.headers.get("Host", "")
        expected = {
            "127.0.0.1:" + str(self.server.server_port),
            "localhost:" + str(self.server.server_port),
        }
        if host not in expected:
            return False
        origin = self.headers.get("Origin")
        return not origin or origin in {"http://" + h for h in expected}

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def dispatch(self, method):
        if not self.allowed():
            self.respond(403, {"error": "Acesso restrito à origem local"})
            return
        path = urllib.parse.urlsplit(self.path).path
        db = None
        try:
            if path.startswith("/api/"):
                db = connect()
                config, revision = settings(db)
                if method == "GET" and path == "/api/research":
                    self.respond(200, research.report(db))
                    return
                if method == "GET" and path == "/api/tracking":
                    self.respond(200, tracking.report(db, now()))
                    return
                if method == "GET" and path == "/api/overview":
                    self.respond(200, overview(db))
                    return
                if method == "GET" and path == "/api/archive":
                    query = urllib.parse.parse_qs(
                        urllib.parse.urlsplit(self.path).query
                    )
                    search = query.get("q", [""])[0][:200]
                    offset = max(0, int(query.get("offset", ["0"])[0]))
                    count = db.execute(
                        "SELECT count(*) FROM tokens WHERE instr(lower(name||' '||symbol||' '||mint),lower(?))>0",
                        (search,),
                    ).fetchone()[0]
                    matches = db.execute(
                        "SELECT mint FROM tokens WHERE instr(lower(name||' '||symbol||' '||mint),lower(?))>0 ORDER BY last_seen DESC,mint LIMIT 100 OFFSET ?",
                        (search, offset),
                    ).fetchall()
                    self.respond(
                        200,
                        {
                            "tokens": [assessment(db, r["mint"]) for r in matches],
                            "total": count,
                            "offset": offset,
                            "limit": 100,
                        },
                    )
                    return
                if method == "GET" and path.startswith("/api/token/"):
                    mint = path.rsplit("/", 1)[-1]
                    if not MINT.fullmatch(mint):
                        raise ValueError("Contrato inválido")
                    x = assessment(db, mint)
                    x["history"] = history(db, mint, 1000)
                    tracking.initialize(db)
                    x["security_history"] = [
                        load(r["data"])
                        for r in db.execute(
                            "SELECT data FROM security_attempts WHERE mint=? ORDER BY observed_at DESC,id DESC LIMIT 30",
                            (mint,),
                        )
                    ]
                    x["assessment_history"] = [
                        load(r["data"])
                        for r in db.execute(
                            "SELECT data FROM assessments WHERE mint=? ORDER BY observed_at DESC LIMIT 120",
                            (mint,),
                        )
                    ]
                    self.respond(200, x)
                    return
                if method in ("POST", "PUT"):
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length < 50000 or not self.headers.get(
                        "Content-Type", ""
                    ).startswith("application/json"):
                        raise ValueError("JSON necessário, limite 50 kB")
                    body = json.loads(self.rfile.read(length))
                    if not isinstance(body, dict):
                        raise ValueError("Corpo JSON deve ser um objeto")
                    if method == "PUT" and path == "/api/settings":
                        updated = save_settings(db, body["config"], body["revision"])
                        self.respond(200, {"revision": updated})
                        return
                    if method == "POST" and path == "/api/collect":

                        def run():
                            local = connect()
                            try:
                                collect(local)
                            except Exception:
                                log.exception("collection failed")
                            finally:
                                local.close()

                        threading.Thread(target=run, daemon=True).start()
                        self.respond(
                            202,
                            {
                                "status": "queued",
                                "note": "Respeita intervalo mínimo e lock de execução",
                            },
                        )
                        return
                    if method == "POST" and path == "/api/paper/open":
                        mint = body.get("mint", "")
                        if not MINT.fullmatch(mint):
                            raise ValueError("Contrato inválido")
                        initial = assessment(db, mint)
                        unmet = [
                            c["label"]
                            for c in initial["assessment"]["checks"]
                            if c["key"] != "quote" and c["passed"] is not True
                        ]
                        if unmet:
                            raise ValueError("Condições pendentes: " + ", ".join(unmet))
                        time.sleep(config["paper_latency_seconds"])
                        q = roundtrip(Quotes(HTTP(db, budget=2)), mint, config, now())
                        x = assessment(db, mint, now(), q)
                        trade = open_position(
                            db, mint, x["assessment"], config, q, now()
                        )
                        self.respond(
                            201, {"trade_id": trade, "assessment": x["assessment"]}
                        )
                        return
                self.respond(404, {"error": "Rota inexistente"})
                return
            if method != "GET":
                self.respond(405, {"error": "Método não permitido"})
                return
            requested = path.lstrip("/") or "index.html"
            static = (ROOT / "dist" / requested).resolve()
            if not static.is_relative_to(ROOT / "dist") or not static.is_file():
                self.respond(
                    404, {"error": "Arquivo não encontrado; execute npm run build"}
                )
                return
            self.respond(
                200,
                static.read_bytes(),
                mimetypes.guess_type(str(static))[0] or "application/octet-stream",
            )
        except (ValueError, KeyError, json.JSONDecodeError) as e:
            self.respond(400, {"error": str(e)[:200]})
        except SourceError as e:
            self.respond(503, {"error": str(e)[:200]})
        except Exception:
            log.exception("request failure")
            self.respond(500, {"error": "Falha interna; consulte os logs locais"})
        finally:
            if db:
                db.close()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8090)
    p.add_argument("--no-collector", action="store_true")
    args = p.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    db = connect()
    db.close()
    if not args.no_collector:

        def loop():
            while True:
                local = connect()
                try:
                    collect(local)
                except Exception:
                    log.exception("scheduled collection failed")
                finally:
                    local.close()
                time.sleep(15)

        threading.Thread(target=loop, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    log.info(
        "Local development server on port %d; scheduled collector %s",
        args.port,
        not args.no_collector,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
