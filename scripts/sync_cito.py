#!/usr/bin/env python3
"""Sincroniza dados públicos da Cito API para um radar pré-jogo de CS2.

Não coleta odds, não faz scraping; mantenha CITO_API_KEY somente no ambiente.
Os rankings são atuais e tiers são rótulos operacionais (não oficiais).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://api.citoapi.com/api/v1/cs2"
DEFAULT_OUT = Path(__file__).resolve().parents[1] / "public/data/snapshot.json"
DEFAULT_LOG = Path(__file__).resolve().parents[1] / "data/request_history.json"
MIN_QUOTA_RESERVE = 25


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(p, default):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(p, obj):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    temp = p.with_suffix(p.suffix + ".tmp")
    temp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(p)


def num_or_none(v):
    try:
        return float(v) if v is not None else None
    except (ValueError, TypeError):
        return None


def rows(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("items", "matches", "rankings", "results", "players", "stats", "data"):
            if isinstance(data.get(k), list):
                return data[k]
    return []


def clean_rankings(payload):
    data = rows(payload.get("data"))
    out = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        rank = entry.get("rank")
        if rank is None:
            continue
        try:
            rank = int(rank)
        except (ValueError, TypeError):
            continue
        out.append({
            "teamId": entry.get("teamId") or (entry.get("team") or {}).get("id"),
            "name": entry.get("teamName") or (entry.get("team") or {}).get("name") or "Equipe desconhecida",
            "rank": rank, "points": entry.get("points"), "region": entry.get("region") or (entry.get("team") or {}).get("region"),
            "tier": "Tier 1" if rank <= 16 else "Tier 2" if rank <= 40 else "Fora do recorte",
        })
    return sorted(out, key=lambda x: x["rank"])


def index_rankings(rankings):
    by_id = {r["teamId"]: r for r in rankings if r.get("teamId")}
    by_name = {r["name"].casefold().strip(): r for r in rankings if r.get("name")}
    return by_id, by_name


def match_tier(a, b):
    if a is not None and b is not None:
        if a <= 16 and b <= 16:
            return "Tier 1"
        if a <= 40 and b <= 40:
            return "Tier 2"
    return "Não classificada"


def clean_matches(payload, rankings):
    by_id, by_name = index_rankings(rankings)
    output = []
    for m in rows(payload.get("data")):
        if not isinstance(m, dict):
            continue
        id_ = m.get("id")
        if not id_:
            continue
        t1 = m.get("team1Name") or (m.get("team1") or {}).get("name") or "A definir"
        t2 = m.get("team2Name") or (m.get("team2") or {}).get("name") or "A definir"
        r1 = by_id.get(m.get("team1Id")) or by_name.get(t1.casefold().strip())
        r2 = by_id.get(m.get("team2Id")) or by_name.get(t2.casefold().strip())
        maps = []
        for mp in m.get("maps") or []:
            if not isinstance(mp, dict):
                continue
            maps.append({"mapId": mp.get("id") or mp.get("gameId"), "mapNumber": mp.get("mapNumber"),
                         "name": mp.get("mapName") or mp.get("map") or mp.get("name"), "team1Score": mp.get("team1Score"),
                         "team2Score": mp.get("team2Score"), "status": mp.get("status"),
                         "isForfeit":bool(mp.get("isForfeit")), "statsEligible":mp.get("statsEligible")})
        output.append({
            "id": id_, "team1": t1, "team2": t2,
            "team1Id": m.get("team1Id"), "team2Id": m.get("team2Id"),
            "rank1": r1["rank"] if r1 else None, "rank2": r2["rank"] if r2 else None,
            "tier": match_tier(r1["rank"] if r1 else None, r2["rank"] if r2 else None),
            "event": m.get("eventName") or "Evento não informado", "eventTier": (m.get("event") or {}).get("tier"),
            "startsAt": m.get("startsAt"), "status": m.get("status"),
            "bestOf": m.get("bestOf"), "winnerTeamId": m.get("winnerTeamId"),
            "team1Score": m.get("team1Score"), "team2Score": m.get("team2Score"),
            "isForfeit": bool(m.get("isForfeit")), "resultType": m.get("resultType"),
            "maps": maps, "source": "Cito API", "sourceUrl": f"https://cito.gg/matches/{id_}",
            "sourceEndpoint": "/cs2/matches",
            "lastVerified": m.get("lastVerified") or m.get("lastSyncedAt"),
        })
    return output


def clean_player_stats(payload, match):
    out = []
    maps_by_id = {m["mapId"]:m for m in match.get("maps", []) if m.get("mapId")}
    for row in rows(payload.get("data")):
        if not isinstance(row, dict):
            continue
        pid = row.get("playerId")
        mapid = row.get("mapId")
        if not (pid and mapid):
            continue
        mp = maps_by_id.get(mapid, {})
        if mp.get("status") in ("map_not_played", "not_played", "forfeit") or mp.get("isForfeit") or mp.get("statsEligible") is False:
            continue
        map_number_match = re.search(r"-map-(\d+)$", mapid)
        map_num = mp.get("mapNumber") or (int(map_number_match.group(1)) if map_number_match else None)
        stat = {
            "matchId":match["id"], "mapId":mapid, "mapNumber":map_num,
            "mapName":mp.get("name") or row.get("mapName") or None,
            "startsAt":match.get("startsAt"), "event":match.get("event"),
            "matchTier":match.get("tier"), "playerId":pid,
            "player":row.get("playerName") or (row.get("player") or {}).get("nickname") or "Jogador",
            "teamId":row.get("teamId"), "team":row.get("teamName"),
            "kills":row.get("kills"), "deaths":row.get("deaths"),
            "assists":row.get("assists"), "headshots":row.get("headshots"),
            "adr":row.get("adr"), "kast":row.get("kast"), "rating":row.get("rating"),
            "firstKills":row.get("firstKills"), "firstDeaths":row.get("firstDeaths"),
            "roundsPlayed":num_or_none(mp.get("team1Score"))+num_or_none(mp.get("team2Score")) if num_or_none(mp.get("team1Score")) is not None and num_or_none(mp.get("team2Score")) is not None else None,
            "source": "Cito API", "lastSyncedAt":row.get("lastVerified") or row.get("lastSyncedAt"),
            "dataQuality":row.get("dataQuality"),
        }
        out.append(stat)
    return out


class Client:
    def __init__(self, key, log_path, per_run=14, budget=450):
        self.key = key
        self.log_path = Path(log_path)
        self.max_run = per_run
        self.monthly_budget = budget
        self.in_run = 0
        self.log = read_json(self.log_path, {"requests":[]})
        self.log["requests"] = [r for r in self.log.get("requests", [])
                                if isinstance(r, str) and safe_datetime(r) >= datetime.now(timezone.utc)-timedelta(days=30)]
        self.remaining_reported = None

    def get(self, endpoint, params=None):
        if self.in_run >= self.max_run:
            raise RuntimeError("Limite por sincronização atingido")
        if len(self.log["requests"]) >= self.monthly_budget:
            raise RuntimeError("Orçamento local dos últimos 30 dias atingido")
        if self.remaining_reported is not None and self.remaining_reported <= MIN_QUOTA_RESERVE:
            raise RuntimeError("Reserva da franquia da API atingida")
        url = BASE + endpoint
        if params:
            url += "?" + urlencode(params)
        # Limite Free: até 10 req/min. Distribui chamadas ao longo do tempo.
        if self.in_run:
            time.sleep(6.2)
        request = Request(url,headers={"x-api-key":self.key, "Accept":"application/json", "User-Agent":"CS2EdgeAnalytics/0.2"})
        # Conte chamadas mesmo se HTTP 4xx, por cautela
        self.in_run += 1
        self.log["requests"].append(now_iso())
        write_json(self.log_path, self.log)
        try:
            with urlopen(request, timeout=25) as response:
                rem = response.headers.get("X-RateLimit-Monthly-Remaining")
                if rem and rem.isdigit():
                    self.remaining_reported = int(rem)
                obj = json.load(response)
        except HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code} em {endpoint}; verifique a chave/plano/limites") from exc
        except (URLError, OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Falha consultando {endpoint}: {exc}") from exc
        if not isinstance(obj, dict) or obj.get("success") is False:
            raise RuntimeError(f"Resposta inválida da API em {endpoint}: {str(obj)[:180]}")
        return obj


def safe_datetime(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return datetime(2000,1,1,tzinfo=timezone.utc)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--max-requests", type=int, default=14)
    parser.add_argument("--max-details", type=int, default=10)
    parser.add_argument("--budget-30d", type=int, default=450)
    args = parser.parse_args(argv)
    key = os.getenv("CITO_API_KEY")
    if not key:
        print("Falta CITO_API_KEY. Crie uma chave grátis em https://dashboard.citoapi.com/", file=sys.stderr)
        return 2
    client = Client(key, args.log, max(3,args.max_requests), min(450,args.budget_30d))
    prev = read_json(args.out, {})
    archive = {(r.get("mapId"),r.get("playerId")):r
               for r in prev.get("player_maps",[]) if r.get("mapId") and r.get("playerId")}
    try:
        rankings = clean_rankings(client.get("/rankings/world", {"limit":100}))
        upcoming = clean_matches(client.get("/matches/upcoming", {"limit":100}), rankings)
        # 7 dias recentes, consulta diária — não baixa odds.
        past = clean_matches(client.get("/matches/past", {"days":7,"limit":200}), rankings)
        # Coletar prioritariamente partidas elegíveis mais recentes ainda sem estatísticas.
        # Recusa W.O. e mapas não disputados para análises por jogador.
        candidates = [m for m in past if m["tier"] in ("Tier 1","Tier 2") and not m["isForfeit"]]
        candidates.sort(key=lambda m: m.get("startsAt") or "", reverse=True)
        stored_match_ids = {v["matchId"] for v in archive.values()}
        detail_errors=[]
        details_this_run = 0
        for match in candidates:
            if len(stored_match_ids) >= 5000:
                break
            if match["id"] in stored_match_ids:
                continue
            if client.in_run >= client.max_run or client.remaining_reported is not None and client.remaining_reported <= MIN_QUOTA_RESERVE:
                break
            if details_this_run >= args.max_details:
                break
            try:
                details = client.get(f"/matches/{match['id']}/player-stats")
                details_this_run += 1
                parsed = clean_player_stats(details, match)
                for r in parsed:
                    archive[(r["mapId"],r["playerId"])] = r
                if parsed:
                    stored_match_ids.add(match["id"])
                else:
                    detail_errors.append(match["id"]+": sem estatísticas")
            except RuntimeError as ex:
                detail_errors.append(str(ex))
                if 'HTTP 429' in str(ex) or 'HTTP 403' in str(ex) or 'HTTP 401' in str(ex):
                    break
    except RuntimeError as ex:
        print(f"Sincronização interrompida sem sobrescrever o snapshot anterior: {ex}", file=sys.stderr)
        return 1
    # Mantém somente dados detalhados em janela do plano gratuito.
    cutoff = datetime.now(timezone.utc)-timedelta(days=30)
    archive = {k:v for k,v in archive.items() if safe_datetime(v.get("startsAt")) >= cutoff}
    snapshot = {
        "meta": {"mode":"cito_api", "source":"Cito API", "collectedAt":now_iso(),
                 "tierPolicy":"Tier 1: ambas top 16; Tier 2: ambas top 40; caso contrário, não classificada",
                 "historyWindowDays":30, "oddsProviderConnected":False,
                 "requestsThisRun":client.in_run, "remainingMonthlyAPI":client.remaining_reported,
                 "warnings":detail_errors},
        "upcoming":upcoming, "past":past, "rankings":rankings,
        "player_maps":sorted(archive.values(),key=lambda r:(r.get("startsAt") or "",r.get("mapId") or ""),reverse=True),
        "historical_event":[], "map_form":[],
    }
    write_json(args.out,snapshot)
    print(f"Snapshot salvo em {args.out}: {len(upcoming)} agenda; {len(past)} resultados; "
          f"{len(archive)} estatísticas por jogador/mapa; {client.in_run} requisições.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())