import test from 'node:test';
import assert from 'node:assert/strict';
import { recentOpponents,longMapHistory,rankedSnapshot } from '../scripts/strength-sync.mjs';
const asOf='2026-11-17T23:30:00Z';
const team={id:'cs2-team-1',name:'Alpha'};
const rankings={rankingDate:'2026-11-17',ranks:[{id:'cs2-team-2',rank:20,name:'Beta'}]};
const sample=[
 {id:'M1',team1Id:'cs2-team-1',team2Id:'cs2-team-2',team1Name:'Alpha',team2Name:'Beta',status:'completed',startsAt:'2026-11-16T12:00:00Z',
 winnerTeamId:'cs2-team-2',team1Score:1,team2Score:2,
 team2:{worldRanking:10},maps:[
  {mapName:'Mirage',status:'completed',team1Score:12,team2Score:13,statsEligible:true},
  {mapName:'Nuke',status:'map_not_played',team1Score:null,team2Score:null,statsEligible:false}]},
 {id:'M2',team1Id:'cs2-team-2',team2Id:'cs2-team-1',team1Name:'Beta',team2Name:'Alpha',status:'completed',startsAt:'2026-11-15T12:00:00Z',
 winnerTeamId:'cs2-team-1',team1Score:0,team2Score:2,team1:{worldRanking:15},maps:[]},
 {id:'future',team1Id:'cs2-team-1',team2Id:'cs2-team-2',team1Name:'Alpha',team2Name:'Beta',
  status:'completed',startsAt:'2026-11-19T12:00:00Z',winnerTeamId:'cs2-team-1',team1Score:2,team2Score:0},
 {id:'live',team1Id:'cs2-team-1',team2Id:'cs2-team-2',status:'live',startsAt:'2026-11-17T12:00:00Z'}
];
test('opponent history filters future and uncompleted matches and uses dated ranking source',()=>{
 const d=recentOpponents(sample,team,rankings,asOf);
 assert.equal(d.recent.length,2);
 assert.equal(d.recent[0].result,'L');
 assert.equal(d.recent[1].result,'W');
 assert.equal(d.recent[0].opponent.rank,20);
 assert.equal(d.recent[0].maps.length,1);
 assert.equal(d.recent[0].maps[0].ourRounds,12);
 assert.ok(d.recent.every(x=>Date.parse(x.startsAt)<Date.parse(asOf)));
});
test('annual stats preserve current or removed map metadata',()=>{
 const data=longMapHistory({windowDays:365,totalMaps:89,totalMapWins:45,mapWinPercent:50.56,
 maps:[{mapName:'Ancient',played:43,wins:28,winPercent:65,inPool:true},{mapName:'Train',played:5,wins:2,winPercent:40,inPool:false}]},team);
 assert.equal(data.totalMaps,89);assert.equal(data.maps.length,2);assert.equal(data.maps[1].inPool,false);
});
test('ranking snapshot cannot imply historic positions',()=>{
 const d=rankedSnapshot([{teamId:'cs2-team-2',teamName:'Beta',rank:20,rankingDate:'2026-11-17'}, {teamId:'cs2-team-3',teamName:'Gamma',rank:51}],asOf);
 assert.equal(d.rankingDate,'2026-11-17');assert.equal(d.ranks.length,2);
 assert.match(d.note,/não posição histórica/);
});
