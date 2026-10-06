let result=null, timer=null, active="summary", selectedTeam="", selectedPlayers=new Set(), phaseFilter="all", sortKey="", sortDir="desc";
let sortInitialized=false;
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
    $("download").href="/api/jobs/"+id+"/excel"; selectedTeam=""; selectedPlayers=new Set(); phaseFilter="all"; sortKey=""; render(); $("run").disabled=false;
  }
  if(j.status==="error"){clearInterval(timer);$("status").innerHTML='<span class="err">'+esc(j.message)+'</span>';$("run").disabled=false;}
}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{active=b.dataset.tab; sortKey=""; render()});
$("teamFilter").onchange=()=>{selectedTeam=$("teamFilter").value; selectedPlayers=new Set([...selectedPlayers].filter(p=>availablePlayers().includes(p))); updatePlayerFilter(); render()};
$("playerFilter").onchange=()=>{selectedPlayers=new Set([...$("playerFilter").selectedOptions].map(o=>o.value)); render()};
$("phaseFilter").onchange=()=>{phaseFilter=$("phaseFilter").value; sortKey=""; render()};
$("sortKey").onchange=()=>{sortKey=$("sortKey").value; render()};
$("sortDir").onchange=()=>{sortDir=$("sortDir").value; render()};
function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function baseDataKey(){return ({bat:"ground_batting",bowl:"ground_bowling",obat:"overall_batting",obowl:"overall_bowling"})[active]||null}
function currentDataKey(){
  const base=baseDataKey();
  if(!base) return null;
  if(phaseFilter!=="all") return ({
    ground_batting:"phase_ground_batting", ground_bowling:"phase_ground_bowling",
    overall_batting:"phase_overall_batting", overall_bowling:"phase_overall_bowling"
  })[base];
  return base;
}
function filterable(){return !!currentDataKey()}
function availablePlayers(){
  const key=currentDataKey();
  return [...new Set((result[key]||[]).filter(r=>!selectedTeam||r.team===selectedTeam).map(r=>r.player).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
function updateTeamFilter(){
  const keys=[currentDataKey()].filter(Boolean);
  const teams=[...new Set(keys.flatMap(k=>(result[k]||[])).map(r=>r.team).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const el=$("teamFilter"); const old=selectedTeam;
  el.innerHTML='<option value="">All teams</option>'+teams.map(t=>'<option value="'+esc(t)+'">'+esc(t)+"</option>").join("");
  selectedTeam=teams.includes(old)?old:""; el.value=selectedTeam;
}
function updatePlayerFilter(){
  const players=availablePlayers(), el=$("playerFilter");
  el.innerHTML=players.map(p=>'<option value="'+esc(p)+'">'+esc(p)+"</option>").join("");
  for(const o of el.options)o.selected=selectedPlayers.has(o.value);
}
function filteredRows(key){
  let rows=result[key]||[];
  if(selectedTeam && rows.some(r=>Object.prototype.hasOwnProperty.call(r,"team"))) rows=rows.filter(r=>r.team===selectedTeam);
  if(selectedPlayers.size && rows.some(r=>Object.prototype.hasOwnProperty.call(r,"player"))) rows=rows.filter(r=>selectedPlayers.has(r.player));
  return rows;
}
function numeric(v){const n=Number(v);return Number.isFinite(n)?n:null}
function sortRows(rows){
  if(!sortKey)return rows;
  const dir=sortDir==="asc"?1:-1;
  return [...rows].sort((a,b)=>{
    const na=numeric(a[sortKey]), nb=numeric(b[sortKey]);
    if(na!==null&&nb!==null)return (na-nb)*dir;
    return String(a[sortKey]??"").localeCompare(String(b[sortKey]??""))*dir;
  });
}
function sortOptions(rows){
  const cols=rows.length?Object.keys(rows[0]):[];
  const preferred=active==="bat"||active==="obat"?["runs","balls","fours","sixes","strike_rate","average"]:["wickets","runs","overs","maidens","economy"];
  return preferred.filter(c=>cols.includes(c)).map(c=>'<option value="'+c+'">'+esc(c.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase()))+'</option>').join("");
}
function render(){
  if(!result)return;
  const map={summary:["ground_summary","Ground Summary"],bat:["ground_batting","Ground Batting"],bowl:["ground_bowling","Ground Bowling"],obat:["overall_batting","Overall Batting"],obowl:["overall_bowling","Overall Bowling"],matches:["matches","Matches"]};
  const [baseKey,title]=map[active];
  const key=currentDataKey()||baseKey;
  const f=filterable(); $("filters").classList.toggle("hidden",!f); $("sortControls").classList.toggle("hidden",!f);
  updateTeamFilter(); updatePlayerFilter();
  $("phaseControl").classList.toggle("hidden",!f);
  $("phaseFilter").value=phaseFilter;
  let rows=filteredRows(key);
  if(f){
    const opts=sortOptions(rows); const preferred=(active==="bat"||active==="obat")?"runs":"wickets";
    if(!rows.some(r=>r[sortKey]!==undefined)) sortKey=opts.includes('value="'+preferred+'"')?preferred:(rows.length?Object.keys(rows[0]).find(c=>preferred===c)||"":"");
    $("sortKey").innerHTML=opts; if(sortKey)$("sortKey").value=sortKey; $("sortDir").value=sortDir;
    rows=sortRows(rows);
  }
  document.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===active));
  if(!rows.length){$("table").innerHTML="<p>No rows returned for the selected filters.</p>";return}
  const cols=Object.keys(rows[0]);
  const sortable=f;
  const head=cols.map(c=>{
    const label=c.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase());
    const isActive=sortable && c===sortKey;
    const arrow=isActive?(sortDir==="asc"?" ↑":" ↓"):"";
    return sortable ? `<th class="sortable ${isActive?"sorted":""}" data-sort="${esc(c)}" title="Click to sort by ${esc(label)}">${esc(label)}${arrow}</th>` : `<th>${esc(label)}</th>`;
  }).join("");
  $("table").innerHTML=`<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.map(row=>"<tr>"+cols.map(c=>"<td>"+esc(row[c])+"</td>").join("")+"</tr>").join("")}</tbody></table></div>`;
  if(sortable){
    document.querySelectorAll("th.sortable").forEach(th=>th.onclick=()=>{
      const key=th.dataset.sort;
      if(sortKey===key) sortDir=sortDir==="asc"?"desc":"asc"; else { sortKey=key; sortDir=(active==="bat"||active==="obat")&&key==="runs"|| (active==="bowl"||active==="obowl")&&key==="wickets" ? "desc" : "asc"; }
      $("sortKey").value=sortKey; $("sortDir").value=sortDir; render();
    });
  }
}
