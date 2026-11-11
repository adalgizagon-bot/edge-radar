import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).resolve().parents[1]/'scripts/sync_cito.py'
spec=importlib.util.spec_from_file_location('cito_sync', SCRIPT)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class CitoNormalizerTests(unittest.TestCase):
    def test_rankings_tier(self):
        d=mod.clean_rankings({'data':[{'teamName':'Alpha','teamId':'1','rank':1,'points':900},{'teamName':'Beta','teamId':'2','rank':19},{'teamName':'Gamma','teamId':'3','rank':50}]})
        self.assertEqual([e['tier'] for e in d],['Tier 1','Tier 2','Fora do recorte'])
    def test_match_tier_strict(self):
        self.assertEqual(mod.match_tier(1,16),'Tier 1')
        self.assertEqual(mod.match_tier(1,30),'Tier 2')
        self.assertEqual(mod.match_tier(4,None),'Não classificada')
        self.assertEqual(mod.match_tier(5,42),'Não classificada')
    def test_match_no_odds_and_rank(self):
        ranks=mod.clean_rankings({'data':[{'teamName':'Alpha','teamId':'1','rank':1},{'teamName':'Beta','teamId':'2','rank':2}]})
        item=mod.clean_matches({'data':[{'id':'cs2-match-1','team1Name':'Alpha','team2Name':'Beta','team1Id':'1','team2Id':'2','startsAt':'2026-11-11T10:00:00Z','eventName':'Example','status':'upcoming','bestOf':3,'odds':[{'odd':1.9}]}]},ranks)
        self.assertEqual(item[0]['tier'],'Tier 1')
        self.assertNotIn('odds',item[0]);self.assertEqual(item[0]['bestOf'],3)
    def test_player_stats_map(self):
        match={'id':'cs2-match-1','tier':'Tier 2','startsAt':'2026-11-11T10:00:00Z','event':'Test','maps':[{'mapId':'cs2-match-1-map-1','mapNumber':1,'name':'Mirage'}]}
        p={'data':[{'mapId':'cs2-match-1-map-1','playerId':'p3','playerName':'Ace','kills':24,'headshots':12,'deaths':16,'assists':4,'adr':100.2}]}
        x=mod.clean_player_stats(p,match)[0]
        self.assertEqual(x['kills'],24);self.assertEqual(x['mapName'],'Mirage');self.assertEqual(x['mapNumber'],1)
    def test_rows_unknown_safe(self):
        self.assertEqual(mod.rows({'data':[1,2]}),[1,2]);self.assertEqual(mod.rows(None),[])
    def test_historical_snapshot_real_not_fabricated_odds(self):
        d=json.loads((SCRIPT.parent.parent/'public/data/snapshot.json').read_text())
        self.assertEqual(d['meta']['mode'],'cito_api')
        self.assertFalse(d['meta']['oddsProviderConnected'])
        self.assertGreaterEqual(len(d['player_maps']),100)
        self.assertEqual(len(d['upcoming']),7)
        self.assertEqual(len(d['rankings']),40)
        self.assertEqual(len({(r['mapId'],r['playerId']) for r in d['player_maps']}),len(d['player_maps']))
    def test_real_cito_map_name(self):
        rankings=mod.clean_rankings({'data':[{'teamId':'t1','teamName':'A','rank':1},{'teamId':'t2','teamName':'B','rank':3}]})
        matches=mod.clean_matches({'data':[{'id':'match-1','team1Id':'t1','team2Id':'t2','team1Name':'A','team2Name':'B',
            'maps':[{'id':'m-1','mapNumber':1,'mapName':'Nuke','status':'completed','statsEligible':True,'team1Score':13,'team2Score':9},
                    {'id':'m-2','mapNumber':2,'mapName':'Ancient','status':'map_not_played','statsEligible':False}]}]},rankings)
        self.assertEqual(matches[0]['maps'][0]['name'],'Nuke')
        self.assertEqual(matches[0]['sourceUrl'],'https://cito.gg/matches/match-1')
        rows=mod.clean_player_stats({'data':[{'mapId':'m-1','playerId':'p1','playerName':'Ace','kills':17},
                                                 {'mapId':'m-2','playerId':'p1','playerName':'Ace','kills':0}]},matches[0])
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['roundsPlayed'],22)
    def test_player_maps_30day_window_and_map_quality(self):
        from datetime import datetime, timedelta, timezone
        recent=(datetime.now(timezone.utc)-timedelta(days=2)).isoformat()
        old=(datetime.now(timezone.utc)-timedelta(days=45)).isoformat()
        def row(id, when, status="completed", eligible=True):
            return {"mapId":"map-"+id, "playerId":"p1", "playerName":"Ace", "kills":17,
                    "map":{"mapNumber":1,"mapName":"Mirage","team1Score":13,"team2Score":11,
                           "status":status,"statsEligible":eligible,"match":{"startsAt":when,"team1Id":"a","team2Id":"b"}}}
        payload={"data":[row("new",recent),row("old",old),row("no",recent,"map_not_played",False)]}
        rankings=[{"teamId":"a","name":"A","rank":2},{"teamId":"b","name":"B","rank":4}]
        results=mod.clean_player_map_rows(payload,"p1",rankings)
        self.assertEqual(len(results),1)
        self.assertEqual(results[0]["kills"],17)
        self.assertEqual(results[0]["roundsPlayed"],24)
        self.assertEqual(results[0]["matchTier"],"Tier 1")

    def test_roster_excludes_coaches_and_inactive(self):
        rows=[{"teamId":"T","playerId":"p1","playerNickname":"First","isActive":True,"role":"rifler"},
              {"teamId":"T","playerId":"p2","playerNickname":"Coach","isActive":True,"role":"coach"},
              {"teamId":"T","playerId":"p3","playerNickname":"Benched","isActive":False,"role":"entry"}]
        self.assertEqual([r["playerId"] for r in mod.clean_roster({"data":{"roster":rows}},"T")],["p1"])

    def test_usage_budget(self):
        with tempfile.TemporaryDirectory() as t:
            log=Path(t)/'usage.json'
            log.write_text(json.dumps({'requests':[mod.now_iso()]*3}))
            c=mod.Client('test-key',log,per_run=10,budget=3)
            with self.assertRaisesRegex(RuntimeError,'Orçamento local'):
                c.get('/matches/upcoming')

if __name__=='__main__':unittest.main()