let result=null, timer=null, active="summary", selectedTeam="", selectedGround="", selectedPlayers=new Set(), phaseFilter="all", sortKey="", sortDir="desc";
const $=id=>document.getElementById(id);
$("run").onclick=async()=>{
  $("run").disabled=true; $("content").classList.add("hidden"); $("download").classList.add("hidden");
  const r=await fetch("/api/jobs",{method:"POST"}); const j=await r.json();
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
function colLabel(c){return ({ones:"1s",twos:"2s",threes:"3s",fours:"4s",sixes:"6s"})[c]||c.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase())}
function sortOptions(rows){const cols=rows.length?Object.keys(rows[0]):[];const preferred=active==="bat"||active==="obat"?["runs","balls","ones","twos","threes","fours","sixes","strike_rate","average"]:["wickets","runs","overs","maidens","economy"];return preferred.filter(c=>cols.includes(c)).map(c=>'<option value="'+c+'">'+esc(colLabel(c))+"</option>").join("")}
function renderTable(tableRows,sortable){const cols=Object.keys(tableRows[0]);const head=cols.map(c=>{const label=colLabel(c);const isActive=sortable&&c===sortKey;const arrow=isActive?(sortDir==="asc"?" ↑":" ↓"):"";return sortable?'<th class="sortable '+(isActive?"sorted":"")+'" data-sort="'+esc(c)+'" title="Click to sort by '+esc(label)+'">'+esc(label)+arrow+'</th>':'<th>'+esc(label)+'</th>'}).join("");return '<div class="tablewrap"><table><thead><tr>'+head+'</tr></thead><tbody>'+tableRows.map(row=>'<tr>'+cols.map(c=>'<td>'+esc(row[c])+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>'}
function render(){
  if(!result)return;
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
