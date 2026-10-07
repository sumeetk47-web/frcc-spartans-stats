let result=null, timer=null, active="summary", selectedTeam="", selectedGround="", selectedPlayers=new Set(), phaseFilter="all", sortKey="", sortDir="desc";
const $=id=>document.getElementById(id);
$("run").onclick=async()=>{
  $("run").disabled=true; $("content").classList.add("hidden"); $("download").classList.add("hidden");
  const r=await fetch("/api/jobs?refresh=1",{method:"POST"}); const j=await r.json();
  timer=setInterval(()=>poll(j.job_id),700); poll(j.job_id);
};
async function poll(id){
  const r=await fetch("/api/jobs/"+id); const j=await r.json();
  $("bar").style.width=(j.progress||0)+"%"; $("status").textContent=j.message||j.status;
  if(j.status==="done"){
    clearInterval(timer); result=await (await fetch("/api/jobs/"+id+"/result")).json();
    $("content").classList.remove("hidden"); $("download").classList.remove("hidden");
    $("download").href="/api/jobs/"+id+"/excel"; selectedTeam=""; selectedGround=""; selectedPlayers=new Set(); phaseFilter="all"; sortKey=""; render(); $("run").disabled=false;
  }
  if(j.status==="error"){clearInterval(timer);$("status").innerHTML='<span class="err">'+esc(j.message)+'</span>';$('run').disabled=false;}
}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{active=b.dataset.tab; sortKey=""; render()});
$("teamFilter").onchange=()=>{selectedTeam=$("teamFilter").value; selectedPlayers=new Set([...selectedPlayers].filter(p=>availablePlayers().includes(p))); updatePlayerFilter(); render()};
$("groundFilter").onchange=()=>{selectedGround=$("groundFilter").value; render()};
$("playerFilter").onchange=()=>{selectedPlayers=new Set([...$("playerFilter").selectedOptions].map(o=>o.value)); render()};
$("phaseFilter").onchange=()=>{phaseFilter=$("phaseFilter").value; sortKey=""; render()};
$("sortKey").onchange=()=>{sortKey=$("sortKey").value; render()};
$("sortDir").onchange=()=>{sortDir=$("sortDir").value; render()};
$("analysisTeam").onchange=()=>{if(active==='player')playerDashboard();else if(active==='matchups')matchupDashboard()};
$("analysisPlayer").onchange=()=>{if(active==='player')playerDashboard();else if(active==='matchups')matchupDashboard()};
$("analysisOpponent").onchange=()=>{if(active==='matchups')matchupDashboard()};
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function baseDataKey(){return ({bat:"ground_batting",bowl:"ground_bowling",obat:"overall_batting",obowl:"overall_bowling"})[active]||null}
function currentDataKey(){
  const base=baseDataKey(); if(!base)return null;
  if(phaseFilter!=="all") return ({ground_batting:"phase_ground_batting",ground_bowling:"phase_ground_bowling",overall_batting:"phase_overall_batting",overall_bowling:"phase_overall_bowling"})[base];
  return base;
}
function filterable(){return !!currentDataKey()}
function availablePlayers(){
  const key=currentDataKey();
  return [...new Set((result[key]||[]).filter(r=>!selectedTeam||r.team===selectedTeam).filter(r=>!selectedGround||!r.ground||r.ground===selectedGround).map(r=>r.player).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
function updateTeamFilter(){
  const key=currentDataKey(); const teams=[...new Set((result[key]||[]).map(r=>r.team).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const el=$("teamFilter"), old=selectedTeam; el.innerHTML='<option value="">All teams</option>'+teams.map(t=>'<option value="'+esc(t)+'">'+esc(t)+"</option>").join(""); selectedTeam=teams.includes(old)?old:""; el.value=selectedTeam;
}
function updateGroundFilter(){
  const keys=["ground_batting","ground_bowling","phase_ground_batting","phase_ground_bowling"];
  const grounds=[...new Set(keys.flatMap(k=>(result[k]||[])).map(r=>r.ground).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const el=$("groundFilter"), old=selectedGround; el.innerHTML='<option value="">All grounds</option>'+grounds.map(g=>'<option value="'+esc(g)+'">'+esc(g)+"</option>").join(""); selectedGround=grounds.includes(old)?old:""; el.value=selectedGround;
}
function updatePlayerFilter(){const players=availablePlayers(),el=$("playerFilter");el.innerHTML=players.map(p=>'<option value="'+esc(p)+'">'+esc(p)+"</option>").join("");for(const o of el.options)o.selected=selectedPlayers.has(o.value)}
function filteredRows(key){let rows=result[key]||[];if(selectedTeam&&rows.some(r=>Object.prototype.hasOwnProperty.call(r,"team")))rows=rows.filter(r=>r.team===selectedTeam);if(selectedGround&&rows.some(r=>Object.prototype.hasOwnProperty.call(r,"ground")))rows=rows.filter(r=>r.ground===selectedGround);if(selectedPlayers.size&&rows.some(r=>Object.prototype.hasOwnProperty.call(r,"player")))rows=rows.filter(r=>selectedPlayers.has(r.player));if(phaseFilter!=="all"&&rows.some(r=>Object.prototype.hasOwnProperty.call(r,"phase")))rows=rows.filter(r=>r.phase===phaseFilter);return rows}
function numeric(v){const n=Number(v);return Number.isFinite(n)?n:null}
function sortRows(rows){if(!sortKey)return rows;const dir=sortDir==="asc"?1:-1;return [...rows].sort((a,b)=>{const na=numeric(a[sortKey]),nb=numeric(b[sortKey]);if(na!==null&&nb!==null)return(na-nb)*dir;return String(a[sortKey]??"").localeCompare(String(b[sortKey]??""))*dir})}
function colLabel(c){return ({zeros:"0s",ones:"1s",twos:"2s",threes:"3s",fours:"4s",sixes:"6s"})[c]||c.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase())}
function sortOptions(rows){const cols=rows.length?Object.keys(rows[0]):[];const preferred=active==="bat"||active==="obat"?["runs","balls","zeros","ones","twos","threes","fours","sixes","strike_rate","average"]:["wickets","runs","overs","maidens","economy"];return preferred.filter(c=>cols.includes(c)).map(c=>'<option value="'+c+'">'+esc(colLabel(c))+"</option>").join("")}
function shotCell(row,c){if(!["zeros","ones","twos","threes","fours","sixes"].includes(c))return esc(row[c]);const n=Number(row[c]);const balls=Number(row.balls);if(!Number.isFinite(n))return esc(row[c]);const pct=Number.isFinite(balls)&&balls>0?Math.round(n/balls*100):0;return '<span class="shot-stat"><strong>'+esc(n)+'</strong><span class="shot-pct">'+pct+'%</span></span>'}
function renderTable(tableRows,sortable){const cols=Object.keys(tableRows[0]);const head=cols.map(c=>{const label=colLabel(c);const isActive=sortable&&c===sortKey;const arrow=isActive?(sortDir==="asc"?" ↑":" ↓"):"";return sortable?'<th class="sortable '+(isActive?"sorted":"")+'" data-sort="'+esc(c)+'" title="Click to sort by '+esc(label)+'">'+esc(label)+arrow+'</th>':'<th>'+esc(label)+'</th>'}).join("");return '<div class="tablewrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+tableRows.map(row=>'<tr>'+cols.map(c=>'<td>'+shotCell(row,c)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>'}
function analysisRows(key){return (result[key]||[])}
function unique(a){return [...new Set(a.filter(Boolean))].sort((x,y)=>String(x).localeCompare(String(y)))}
function fillSelect(id,items,old,allLabel){const el=$(id);el.innerHTML=(allLabel?'<option value="">'+esc(allLabel)+'</option>':'')+items.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');if(items.includes(old))el.value=old;return el.value}
function aggregateMatchups(rows, key, filterFn){const m={};for(const r of rows){if(filterFn&&!filterFn(r))continue;const name=r[key];if(!name)continue;const k=name;const x=m[k]||(m[k]={name:k,balls:0,runs:0,dismissals:0,wickets:0,fours:0,sixes:0,matches:0});x.balls+=Number(r.balls)||0;x.runs+=Number(r.runs)||0;x.dismissals+=Number(r.dismissals)||0;x.wickets+=Number(r.bowler_wickets)||0;x.fours+=Number(r.fours)||0;x.sixes+=Number(r.sixes)||0;x.matches+=1}return Object.values(m).map(x=>({...x,strike_rate:x.balls?+(100*x.runs/x.balls).toFixed(1):0})).sort((a,b)=>b.runs-a.runs)}
function analysisOptions(){const allBat=analysisRows("overall_batting"),allBowl=analysisRows("overall_bowling"),teams=unique([...allBat,...allBowl].map(r=>r.team));const t=$("analysisTeam");const old=t.value;t.innerHTML='<option value="">All teams</option>'+teams.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');if(teams.includes(old))t.value=old;const team=t.value;const players=unique([...allBat,...allBowl].filter(r=>!team||r.team===team).map(r=>r.player));const ps=$("analysisPlayer");const oldp=ps.value;ps.innerHTML=players.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');if(players.includes(oldp))ps.value=oldp;const p=ps.value;const oppRows=(result.matchups||[]).filter(r=>(r.batter===p&&(!team||r.batter_team===team))||(r.bowler===p&&(!team||r.bowler_team===team)));const opps=unique(oppRows.map(r=>r.batter===p?r.bowler_team:r.batter_team));const os=$("analysisOpponent");const oldo=os.value;os.innerHTML='<option value="">All opponents</option>'+opps.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');if(opps.includes(oldo))os.value=oldo}
function metric(label,value){return '<div class="metric-card"><div class="metric-label">'+esc(label)+'</div><div class="metric-value">'+esc(value)+'</div></div>'}
function playerDashboard(){analysisOptions();const player=$("analysisPlayer").value;if(!player){$("analysisContent").innerHTML='<div class="analysis-section">Select a player to view the dashboard.</div>';return}const team=$("analysisTeam").value;const bat=(result.overall_batting||[]).find(r=>r.player===player&&(!team||r.team===team));const bowl=(result.overall_bowling||[]).find(r=>r.player===player&&(!team||r.team===team));const bm=(result.player_batting_match||[]).filter(r=>r.player===player&&(!team||r.team===team)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));const bl=(result.player_bowling_match||[]).filter(r=>r.player===player&&(!team||r.team===team)).sort((a,b)=>String(b.date).localeCompare(String(a.date)));let html='<h2 class="analysis-title">'+esc(player)+'</h2><p class="muted">2026 performance dashboard</p><div class="analysis-grid">';if(bat){const boundary=(Number(bat.fours||0)+Number(bat.sixes||0));html+=metric('Runs',bat.runs)+metric('Average',bat.average||'—')+metric('Strike Rate',bat.strike_rate||'—')+metric('Highest',bat.highest_score||0)+metric('4s + 6s',boundary)+metric('Dot Ball %',bat.balls?((100*Number(bat.zeros||0)/Number(bat.balls)).toFixed(1)+'%'):'—')}if(bowl){html+=metric('Wickets',bowl.wickets)+metric('Economy',bowl.economy||'—')+metric('Bowling Avg',bowl.average||'—')+metric('Overs',bowl.overs||'0.0')}html+='</div>';
let tips=[];if(bat){const dot=bat.balls?100*Number(bat.zeros||0)/Number(bat.balls):0;const bnd=bat.balls?100*(Number(bat.fours||0)+Number(bat.sixes||0))/Number(bat.balls):0;if(dot>=40)tips.push(['bad','Reduce dot balls: '+dot.toFixed(1)+'% of balls faced are dots.']);else if(dot<=30)tips.push(['good','Strong strike rotation: dot-ball rate is '+dot.toFixed(1)+'%.']);if(Number(bat.strike_rate||0)<120)tips.push(['warn','Strike rate is '+bat.strike_rate+'. Look for more scoring options without increasing dismissal risk.']);if(bnd>=20)tips.push(['good','Boundary impact is strong: '+bnd.toFixed(1)+' boundaries per 100 balls.']);}
if(bowl&&Number(bowl.economy||0)>9)tips.push(['bad','Bowling economy is '+bowl.economy+'. Focus on limiting boundary balls and controlling the death overs.']);else if(bowl&&Number(bowl.economy||0)<=7.5)tips.push(['good','Economy of '+bowl.economy+' is a major strength.']);if(bat&&bm.length>=4){const recent=bm.slice(0,5),prev=bm.slice(5,10);const avg=r=>r.length?r.reduce((s,x)=>s+Number(x.runs||0),0)/r.length:0;if(prev.length&&avg(recent)>avg(prev)*1.2)tips.push(['good','Recent batting form is improving: last '+recent.length+' innings average '+avg(recent).toFixed(1)+' runs vs '+avg(prev).toFixed(1)+' previously.']);if(prev.length&&avg(recent)<avg(prev)*0.8)tips.push(['warn','Recent batting output has dropped: '+avg(recent).toFixed(1)+' runs per innings vs '+avg(prev).toFixed(1)+' previously.']);}
html+='<div class="analysis-section"><h3>Improvement Analyzer</h3>'+ (tips.length?tips.map(t=>'<div class="tip '+t[0]+'">'+esc(t[1])+'</div>').join(''):'<div class="tip">Not enough data yet for a specific improvement recommendation.</div>')+'</div>';
html+='<div class="analysis-section"><h3>Recent batting</h3>';if(bm.length){html+='<table class="analysis-table"><tr><th>Date</th><th>Opponent</th><th>Runs</th><th>Balls</th><th>SR</th></tr>'+bm.slice(0,10).map(r=>'<tr><td>'+esc(r.date)+'</td><td>'+esc(r.opponent)+'</td><td>'+esc(r.runs)+'</td><td>'+esc(r.balls)+'</td><td>'+esc(r.strike_rate)+'</td></tr>').join('')+'</table>'}else html+='<span class="muted">No batting innings found.</span>';html+='</div>';
$("analysisContent").innerHTML=html}
function matchupDashboard(){
  analysisOptions();
  const player=$("analysisPlayer").value,team=$("analysisTeam").value,opp=$("analysisOpponent").value;
  const allRows=(result.matchups||[]);
  const asBatter=allRows.filter(r=>r.batter===player&&(!team||r.batter_team===team)&&(!opp||r.bowler_team===opp));
  const asBowler=allRows.filter(r=>r.bowler===player&&(!team||r.bowler_team===team)&&(!opp||r.batter_team===opp));
  if(!player){$("analysisContent").innerHTML='<div class="analysis-section">Select a player to see matchup intelligence.</div>';return}
  const againstBowlers=aggregateMatchups(asBatter,'bowler');
  const againstBatters=aggregateMatchups(asBowler,'batter');
  let html='<h2 class="analysis-title">Matchup Intelligence: '+esc(player)+'</h2><p class="muted">Matchups use a minimum 6-ball sample when enough data is available.</p>';

  function matchupTable(title,items,mode,bad){
    let a=items.filter(x=>x.balls>=6);
    if(!a.length)a=items;
    if(!a.length)return '<div class="analysis-section"><h3>'+title+'</h3><div class="muted">No matchup data found.</div></div>';
    let sorted;
    if(mode==='bat'){
      sorted=bad?[...a].sort((x,y)=>y.dismissals-x.dismissals||x.runs-y.runs):[...a].sort((x,y)=>y.runs-x.runs||x.dismissals-y.dismissals);
    }else{
      sorted=bad?[...a].sort((x,y)=>y.runs-x.runs||x.wickets-y.wickets):[...a].sort((x,y)=>y.wickets-x.wickets||x.runs-y.runs);
    }
    sorted=sorted.slice(0,8);
    const heading=mode==='bat'?'Bowler':'Batter';
    const outcome=mode==='bat'?(bad?'Times out':'Runs'):(bad?'Runs conceded':'Wickets');
    let h='<div class="analysis-section"><h3>'+title+'</h3><table class="analysis-table"><tr><th>'+heading+'</th><th>Balls</th><th>Runs</th><th>SR</th><th>'+outcome+'</th></tr>';
    h+=sorted.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+x.balls+'</td><td>'+x.runs+'</td><td>'+x.strike_rate+'</td><td>'+(mode==='bat'?(bad?x.dismissals:x.runs):(bad?x.runs:x.wickets))+'</td></tr>').join('');
    return h+'</table></div>';
  }

  html+='<div class="analysis-section"><h2>Batting Matchups</h2><p class="muted">As a batter: more runs scored is better; getting out more often is worse.</p></div>';
  html+=matchupTable('Better Matchups — Batting',againstBowlers,'bat',false);
  html+=matchupTable('Bad Matchups — Batting',againstBowlers,'bat',true);
  html+='<div class="analysis-section"><h2>Bowling Matchups</h2><p class="muted">As a bowler: more wickets is better; conceding more runs is worse.</p></div>';
  html+=matchupTable('Better Matchups — Bowling',againstBatters,'bowl',false);
  html+=matchupTable('Bad Matchups — Bowling',againstBatters,'bowl',true);
  if(!asBatter.length&&!asBowler.length)html+='<div class="analysis-section">No ball-by-ball matchup data found for this player.</div>';
  $("analysisContent").innerHTML=html;
}
function renderAnalysis(){const isA=active==='player'||active==='matchups';$("analysisPanel").classList.toggle('hidden',!isA);$("table").classList.toggle('hidden',isA);$("filters").classList.toggle('hidden',true);$("sortControls").classList.toggle('hidden',true);if(active==='player')playerDashboard();if(active==='matchups')matchupDashboard()}
function render(){
  if(!result)return;
  if(active==='player'||active==='matchups'){renderAnalysis();document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===active));return}
  const map={summary:["ground_summary","Ground Summary"],bat:["ground_batting","Ground Batting"],bowl:["ground_bowling","Ground Bowling"],obat:["overall_batting","Overall Batting"],obowl:["overall_bowling","Overall Bowling"],matches:["matches","Matches"]};
  const [baseKey]=map[active],key=currentDataKey()||baseKey; const f=filterable(); $("filters").classList.toggle("hidden",!f); $("sortControls").classList.toggle("hidden",!f); updateTeamFilter(); updateGroundFilter(); updatePlayerFilter(); $("phaseControl").classList.toggle("hidden",!(active==="bat"||active==="bowl"||active==="obat"||active==="obowl")); $("phaseFilter").value=phaseFilter;
  let rows=filteredRows(key);
  if(f){const opts=sortOptions(rows),preferred=(active==="bat"||active==="obat")?"runs":"wickets";if(!rows.some(r=>r[sortKey]!==undefined))sortKey=opts.includes('value="'+preferred+'"')?preferred:(rows.length?Object.keys(rows[0]).find(c=>preferred===c)||"":"");$("sortKey").innerHTML=opts;if(sortKey)$('sortKey').value=sortKey;$('sortDir').value=sortDir;}
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===active));
  if(!rows.length){$("table").innerHTML="<p>No rows returned for the selected filters.</p>";return}
  const sortable=f;
  if(active==="bat"||active==="bowl"){
    const groups=[...new Set(rows.map(r=>r.ground||"Unknown Ground"))].sort((a,b)=>a.localeCompare(b));
    $("table").innerHTML=groups.map(g=>{const groupRows=sortRows(rows.filter(r=>(r.ground||"Unknown Ground")===g));return '<section class="ground-group"><h3>'+esc(g)+'</h3>'+renderTable(groupRows,sortable)+'</section>'}).join("");
  }else{$("table").innerHTML=renderTable(sortRows(rows),sortable)}
  if(sortable)document.querySelectorAll("th.sortable").forEach(th=>th.onclick=()=>{const k=th.dataset.sort;if(sortKey===k)sortDir=sortDir==="asc"?"desc":"asc";else{sortKey=k;sortDir=((active==="bat"||active==="obat")&&k==="runs")||((active==="bowl"||active==="obowl")&&k==="wickets")?"desc":"asc"}$("sortKey").value=sortKey;$("sortDir").value=sortDir;render()});
}
