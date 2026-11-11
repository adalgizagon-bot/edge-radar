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


def clean_player_map_rows(payload, player_id, rankings, cutoff=None):
    """Normaliza /cs2/players/{id}/maps — muitos mapas por consulta.

    `days` pode não ser aplicado pela API; a janela gratuita é imposta aqui.
    """
    cutoff = cutoff or datetime.now(timezone.utc) - timedelta(days=30)
    rank_by_id, _ = index_rankings(rankings)
    result = []
    for entry in rows(payload.get("data")):
        if not isinstance(entry, dict):
            continue
        mp = entry.get("map") or {}
        match = mp.get("match") or {}
        started = match.get("startsAt") or entry.get("startsAt")
        if not started or safe_datetime(started) < cutoff:
            continue
        if mp.get("status") != "completed" or mp.get("statsEligible") is False or mp.get("isForfeit") or match.get("isForfeit"):
            continue
        if not entry.get("mapId") or not entry.get("playerId") or entry.get("kills") is None:
            continue
        t1 = rank_by_id.get(match.get("team1Id"), {}).get("rank")
        t2 = rank_by_id.get(match.get("team2Id"), {}).get("rank")
        s1 = num_or_none(mp.get("team1Score"))
        s2 = num_or_none(mp.get("team2Score"))
        result.append({
            "matchId": entry.get("matchId"), "mapId":entry.get("mapId"),
            "mapNumber":mp.get("mapNumber") or entry.get("mapNumber"),
            "mapName":mp.get("mapName") or entry.get("mapName"),
            "startsAt":started, "event": match.get("eventName"),
            "matchTier":match_tier(t1,t2),
            "playerId":entry.get("playerId"),
            "player":entry.get("playerName") or player_id,
            "teamId":entry.get("teamId"), "team":entry.get("teamName"),
            "kills":entry.get("kills"), "deaths":entry.get("deaths"),
            "assists":entry.get("assists"), "headshots":entry.get("headshots"),
            "adr":entry.get("adr"), "kast":entry.get("kast"),
            "rating":entry.get("rating"), "firstKills":entry.get("firstKills"),
            "firstDeaths":entry.get("firstDeaths"),
            "roundsPlayed":s1+s2 if s1 is not None and s2 is not None else None,
            "source":"Cito API", "lastSyncedAt": now_iso(),
            "dataQuality":entry.get("dataQuality"),
        })
    return result


def backfill_matches_from_player_maps(payload, rankings, cutoff=None):
    """Reconstrói placares reais de séries/mapas a partir do histórico individual.

    Não inventa equipes, placares ou resultados: ignora séries sem dados completos.
    Cada mapa é único pelo ID, mesmo quando há linhas de muitos jogadores.
    """
    cutoff = cutoff or datetime.now(timezone.utc)-timedelta(days=30)
    matches = {}
    for row in rows(payload.get("data")):
        if not isinstance(row,dict):
            continue
        mp = row.get("map") or {}
        match = mp.get("match") or {}
        match_id = match.get("id") or row.get("matchId")
        start = match.get("startsAt") or row.get("startsAt")
        if not match_id or not start or safe_datetime(start)<cutoff or safe_datetime(start)>datetime.now(timezone.utc):
            continue
        if mp.get("status")!="completed" or mp.get("statsEligible") is False or mp.get("isForfeit") or match.get("isForfeit"):
            continue
        s1,s2 = num_or_none(mp.get("team1Score")),num_or_none(mp.get("team2Score"))
        if s1 is None or s2 is None:
            continue
        m = matches.setdefault(match_id,dict(match))
        m["id"] = match_id
        m["startsAt"] = start
        m.setdefault("team1Name",(match.get("team1") or {}).get("name"))
        m.setdefault("team2Name",(match.get("team2") or {}).get("name"))
        m.setdefault("team1Id",(match.get("team1") or {}).get("id"))
        m.setdefault("team2Id",(match.get("team2") or {}).get("id"))
        m.setdefault("eventName",(match.get("event") or {}).get("name"))
        m.setdefault("status", "completed")
        record = {"id":mp.get("id") or row.get("mapId"),"mapName":mp.get("mapName") or row.get("mapName"),
                  "mapNumber":mp.get("mapNumber") or row.get("mapNumber"),"status":"completed",
                  "team1Score":int(s1),"team2Score":int(s2),"isForfeit":False,"statsEligible":True}
        if record["id"]:
            m.setdefault("_maps",{})[record["id"]] = record
    finalized=[]
    for match in matches.values():
        new_maps=list(match.pop("_maps",{}).values())
        # Não chamar de vitória da série caso a API não forneça o placar final.
        if not (match.get("team1Id") and match.get("team2Id") and match.get("team1Name") and match.get("team2Name")):
            continue
        match["maps"] = sorted(new_maps,key=lambda x:x.get("mapNumber") or 0)
        candidate=clean_matches({"data":[match]},rankings)
        if candidate:
            candidate[0]["sourceEndpoint"]="/cs2/players/{playerId}/maps"
            candidate[0]["seriesScoreVerified"]=num_or_none(match.get("team1Score")) is not None and num_or_none(match.get("team2Score")) is not None
            finalized.append(candidate[0])
    return finalized


def merge_match_records(existing, incoming):
    """Une mapas históricos sem apagar placares já conferidos."""
    if not existing:
        return incoming
    joined={**existing}
    for field in ("event","status","bestOf","team1Score","team2Score","winnerTeamId","team1","team2","team1Id","team2Id","rank1","rank2","tier"):
        if joined.get(field) in (None,'',"A definir","Evento não informado") and incoming.get(field) is not None:
            joined[field]=incoming[field]
    maps={m.get('mapId'):m for m in joined.get('maps',[]) if m.get('mapId')}
    for mp in incoming.get('maps',[]):
        mid=mp.get('mapId')
        if mid and (mid not in maps or maps[mid].get('status')!='completed'):
            maps[mid]=mp
    joined['maps']=sorted(maps.values(),key=lambda m:m.get('mapNumber') or 0)
    joined['seriesScoreVerified']=bool(joined.get('seriesScoreVerified') or incoming.get('seriesScoreVerified'))
    return joined


def clean_roster(payload, team_id):
    """Descarta treinadores e entradas inativas."""
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        return []
    return [
        {"playerId":p.get("playerId"), "name":p.get("playerNickname"),
         "teamId":team_id, "team":p.get("teamName")}
        for p in data.get("roster", [])
        if isinstance(p, dict) and p.get("playerId")
        and p.get("isActive") is not False
        and str(p.get("role", "")).lower() not in ("coach", "analyst", "manager")
    ]



def aggregate_team_map_totals(player_rows):
    """Total real de eliminações por equipe/mapa somente com cinco atletas.

    Jamais soma quatro atletas ou preenche um quinto jogador com zero.
    Os mapas podem conter substituições: mais de cinco jogadores também são
    rejeitados até existir uma regra auditável para esse caso.
    """
    groups = {}
    for row in player_rows:
        if not (row.get("mapId") and row.get("teamId") and row.get("playerId")):
            continue
        key = (row["mapId"], row["teamId"])
        groups.setdefault(key, {})[row["playerId"]] = row
    result = []
    for (_, team_id), players in groups.items():
        observations = list(players.values())
        if len(observations) != 5 or any(
            num_or_none(r.get("kills")) is None or num_or_none(r.get("deaths")) is None
            for r in observations
        ):
            continue
        example = observations[0]
        if any(r.get("mapName") != example.get("mapName") for r in observations):
            continue
        result.append({
            "mapId": example["mapId"], "matchId": example.get("matchId"),
            "mapNumber": example.get("mapNumber"), "mapName": example.get("mapName"),
            "teamId": team_id, "team": example.get("team"),
            "startsAt": example.get("startsAt"), "playersRecorded": 5,
            "kills": int(sum(num_or_none(r["kills"]) for r in observations)),
            "deaths": int(sum(num_or_none(r["deaths"]) for r in observations)),
            "roundsPlayed": example.get("roundsPlayed"),
            "source": "Cito API / jogadores por mapa",
        })
    return sorted(result, key=lambda row: (row.get("startsAt") or "", row["mapId"]), reverse=True)


def coverage_stats(player_rows, team_totals, past):
    return {
        "playerMapRows": len(player_rows),
        "uniquePlayerIds": len({r.get("playerId") for r in player_rows if r.get("playerId")}),
        "uniqueMapIds": len({r.get("mapId") for r in player_rows if r.get("mapId")}),
        "completeTeamKillMaps": len(team_totals),
        "completedSeries": len([m for m in past if m.get("status") == "completed"]),
        "partialTeamKillMapsExcluded": max(0, len({(r.get("mapId"), r.get("teamId")) for r in player_rows if r.get("mapId") and r.get("teamId")}) - len(team_totals)),
    }


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
            if exc.code == 401:
                raise RuntimeError("HTTP 401: a chave REST em CITO_API_KEY não foi aceita. Use a API Key pessoal do painel Cito (não o link MCP nem o código de setup); não divulgue a chave.") from exc
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
    parser.add_argument("--max-requests", type=int, default=10)
    parser.add_argument("--max-details", type=int, default=1,
                        help="Novos confrontos para descobrir jogadores")
    parser.add_argument("--max-rosters", type=int, default=1)
    parser.add_argument("--max-player-pages", type=int, default=5)
    parser.add_argument("--budget-30d", type=int, default=300)
    args = parser.parse_args(argv)
    key = (os.getenv("CITO_API_KEY") or "").strip()
    if not key:
        print("Falta CITO_API_KEY. Cadastre uma chave REST do painel Cito em GitHub Actions Secrets.", file=sys.stderr)
        return 2
    if not key.startswith("cito_") or key.startswith("cito_setup_"):
        print("CITO_API_KEY deve ser a API Key REST da conta Cito, não link MCP nem código de setup.", file=sys.stderr)
        return 2
    client = Client(key, args.log, max(3,args.max_requests), min(450,args.budget_30d))
    prev = read_json(args.out, {})
    cutoff = datetime.now(timezone.utc)-timedelta(days=30)
    archive = {(r.get("mapId"),r.get("playerId")):r
               for r in prev.get("player_maps",[]) if r.get("mapId") and r.get("playerId")
               and safe_datetime(r.get("startsAt")) >= cutoff}
    old_results = {m["id"]:m for m in prev.get("past",[])
                   if isinstance(m,dict) and m.get("id") and safe_datetime(m.get("startsAt")) >= cutoff}
    roster_cache = {r["teamId"]:r for r in prev.get("rosters",[])
                    if isinstance(r,dict) and r.get("teamId")}
    last_player_sync = (prev.get("meta") or {}).get("playerLastFetched") or {}
    warnings = []
    try:
        rankings = clean_rankings(client.get("/rankings/world", {"limit":100}))
        upcoming = clean_matches(client.get("/matches/upcoming", {"limit":100}), rankings)
        recent = clean_matches(client.get("/matches/past", {"days":7,"limit":200}), rankings)
        for m in recent:
            old_results[m["id"]] = merge_match_records(old_results.get(m["id"]),m)
        # Descobre elencos das próximas partidas elegíveis: um time novo por dia.
        priority_teams = list(dict.fromkeys(
            tid for m in upcoming if m["tier"] in ("Tier 1","Tier 2")
            for tid in (m.get("team1Id"),m.get("team2Id")) if tid))
        roster_queries = 0
        for tid in priority_teams:
            if tid in roster_cache or roster_queries >= args.max_rosters or client.in_run >= client.max_run:
                continue
            try:
                roster = clean_roster(client.get(f"/teams/{tid}"),tid)
                roster_queries += 1
                if roster:
                    roster_cache[tid] = {"teamId":tid,"checkedAt":now_iso(),"players":roster}
                else:
                    warnings.append(f"Sem elenco ativo para {tid}")
            except RuntimeError as ex:
                warnings.append(str(ex))
                if "HTTP 401" in str(ex) or "HTTP 429" in str(ex):
                    break
        # Uma partida nova pode revelar atletas não cadastrados no arquivo.
        stored_matches = {v.get("matchId") for v in archive.values()}
        candidates = [m for m in recent if m["tier"] in ("Tier 1","Tier 2")
                      and not m.get("isForfeit") and m["id"] not in stored_matches]
        candidates.sort(key=lambda x:x.get("startsAt") or "",reverse=True)
        for m in candidates[:args.max_details]:
            if client.in_run >= client.max_run:
                break
            try:
                parsed = clean_player_stats(client.get(f"/matches/{m['id']}/player-stats"),m)
                for row in parsed:
                    archive[(row["mapId"],row["playerId"])] = row
            except RuntimeError as ex:
                warnings.append(str(ex))
                if "HTTP 401" in str(ex) or "HTTP 429" in str(ex):
                    break
        # Em vez de uma consulta por partida, cada consulta de jogador retorna
        # até 100 mapas. Filtramos localmente a janela contratual de 30 dias.
        players = {}
        for row in archive.values():
            if row.get("playerId") and row.get("teamId"):
                players[row["playerId"]] = {"playerId":row["playerId"],"teamId":row["teamId"]}
        for roster in roster_cache.values():
            for p in roster.get("players",[]):
                players[p["playerId"]] = p
        active = set(priority_teams)
        def priority(p):
            fetched = safe_datetime(last_player_sync.get(p["playerId"]))
            return (0 if p.get("teamId") in active else 1, fetched, p["playerId"])
        pending = sorted(players.values(),key=priority)
        updated = 0
        for p in pending:
            if updated >= args.max_player_pages or client.in_run >= client.max_run:
                break
            # Evita buscar novamente uma página sincronizada nas últimas 24 horas.
            if safe_datetime(last_player_sync.get(p["playerId"])) >= datetime.now(timezone.utc)-timedelta(hours=24):
                continue
            try:
                payload = client.get(f"/players/{p['playerId']}/maps", {"days":30,"limit":100})
                parsed = clean_player_map_rows(payload,p["playerId"],rankings,cutoff)
                for historical_match in backfill_matches_from_player_maps(payload,rankings,cutoff):
                    old_results[historical_match["id"]] = merge_match_records(
                        old_results.get(historical_match["id"]),historical_match)
                for row in parsed:
                    archive[(row["mapId"],row["playerId"])] = row
                last_player_sync[p["playerId"]] = now_iso()
                updated += 1
            except RuntimeError as ex:
                warnings.append(str(ex))
                if "HTTP 401" in str(ex) or "HTTP 429" in str(ex):
                    break
    except RuntimeError as ex:
        print(f"Sincronização interrompida sem sobrescrever o snapshot anterior: {ex}", file=sys.stderr)
        return 1
    archive = {k:v for k,v in archive.items() if safe_datetime(v.get("startsAt")) >= cutoff}
    result_matches = sorted(old_results.values(),key=lambda m:m.get("startsAt") or "", reverse=True)
    player_rows = sorted(archive.values(),key=lambda r:(r.get("startsAt") or "",r.get("mapId") or ""),reverse=True)
    team_totals = aggregate_team_map_totals(player_rows)
    coverage = coverage_stats(player_rows, team_totals, result_matches)
    snapshot = {
        "meta": {"mode":"cito_api", "source":"Cito API", "collectedAt":now_iso(),
                 "tierPolicy":"Tier 1: ambas top 16; Tier 2: ambas top 40; caso contrário, não classificada",
                 "historyWindowDays":30, "oddsProviderConnected":False,
                 "requestsThisRun":client.in_run, "remainingMonthlyAPI":client.remaining_reported,
                 "playerLastFetched":last_player_sync,
                 "warnings":warnings},
        "upcoming":upcoming, "past":result_matches, "rankings":rankings,
        "player_maps":player_rows,
        "team_map_totals":team_totals,
        "coverage":coverage,
        "rosters":sorted(roster_cache.values(),key=lambda r:r.get("teamId") or ""),
        "historical_event":[], "map_form":[],
    }
    write_json(args.out,snapshot)
    print(f"Snapshot: {len(upcoming)} partidas futuras, {len(result_matches)} resultados, "
          f"{len(archive)} registros jogador/mapa; {client.in_run} consultas Cito; "
          f"{updated} jogadores atualizados.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())