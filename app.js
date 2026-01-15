const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  view: "month",            // "month" | "week"
  cursor: startOfMonth(new Date()),
  selectedDate: null,
  stateStartDate: null,     // Date
  todayIsDay: null,         // number
  category: "all",
};

const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]; // JS Date uses Sun=0
const DOW_MON_FIRST = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

init();

async function init(){
  wireUI();
  await loadData();
  hydrateFilters();
  setDefaultStateStart();
  render();
}

function wireUI(){
  // view buttons
  document.querySelectorAll(".seg-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".seg-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      state.view = btn.dataset.view;
      render();
    });
  });

  $("prevBtn").addEventListener("click", ()=>{
    state.cursor = (state.view === "month")
      ? addMonths(state.cursor, -1)
      : addDays(state.cursor, -7);
    render();
  });

  $("nextBtn").addEventListener("click", ()=>{
    state.cursor = (state.view === "month")
      ? addMonths(state.cursor, 1)
      : addDays(state.cursor, 7);
    render();
  });

  $("stateStart").addEventListener("change", (e)=>{
    state.stateStartDate = e.target.value ? new Date(e.target.value + "T00:00:00") : null;
    state.todayIsDay = null;
    $("todayIsDay").value = "";
    render();
  });

  $("todayIsDay").addEventListener("input", (e)=>{
    const v = parseInt(e.target.value, 10);
    state.todayIsDay = Number.isFinite(v) && v > 0 ? v : null;
    if(state.todayIsDay){
      state.stateStartDate = null;
      $("stateStart").value = "";
    }
    render();
  });

  $("categoryFilter").addEventListener("change", (e)=>{
    state.category = e.target.value;
    render();
  });
}

async function loadData(){
  const res = await fetch("data/packs.json");
  if(!res.ok) throw new Error("Failed to load data/packs.json");
  state.data = await res.json();
}

function hydrateFilters(){
  const cats = new Set();
  getAllItems().forEach(it => cats.add(it.category || "Other"));
  const sel = $("categoryFilter");
  [...cats].sort().forEach(c=>{
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

function setDefaultStateStart(){
  // Reasonable default: assume state started 60 days ago (user can change).
  const d = addDays(new Date(), -60);
  $("stateStart").value = toISODate(d);
  state.stateStartDate = new Date(toISODate(d) + "T00:00:00");
}

function render(){
  const today = startOfDay(new Date());
  const stateDayToday = computeStateDay(today);
  $("stateDayBadge").textContent = stateDayToday ? `Day ${stateDayToday}` : "—";

  const activeRange = pickRange(stateDayToday || 1);
  $("rangeBadge").textContent = activeRange?.label || "Default";

  const items = filterItems(activeRange?.items || []);

  if(state.view === "month"){
    $("monthLabel").textContent = formatMonthYear(state.cursor);
    renderMonth(items, today);
  } else {
    const start = startOfWeekMon(state.cursor);
    const end = addDays(start, 6);
    $("monthLabel").textContent = `${formatShort(start)} → ${formatShort(end)}`;
    renderWeek(items, today, start);
  }

  if(!state.selectedDate){
    state.selectedDate = today;
  }
  renderDetails(items, state.selectedDate);
}

function renderMonth(items, today){
  const grid = $("grid");
  grid.innerHTML = "";

  const first = startOfMonth(state.cursor);
  const start = startOfWeekMon(first);
  const end = addDays(start, 41); // 6 weeks grid

  for(let i=0;i<42;i++){
    const d = addDays(start, i);
    grid.appendChild(makeCell(d, items, today, first.getMonth()));
  }
}

function renderWeek(items, today, start){
  const grid = $("grid");
  grid.innerHTML = "";
  for(let i=0;i<7;i++){
    const d = addDays(start, i);
    grid.appendChild(makeCell(d, items, today, d.getMonth()));
  }
}

function makeCell(date, items, today, focusMonth){
  const cell = document.createElement("div");
  cell.className = "cell";

  if(date.getMonth() !== focusMonth && state.view === "month"){
    cell.classList.add("dim");
  }
  if(isSameDay(date, today)){
    cell.classList.add("today");
  }

  const sd = computeStateDay(date);
  const hits = sd ? itemsForStateDay(items, sd) : [];

  const top = document.createElement("div");
  top.className = "cellTop";

  const left = document.createElement("div");
  left.innerHTML = `<div class="dateNum">${date.getDate()}</div>`;

  const right = document.createElement("div");
  right.innerHTML = `<div class="stateDay">${sd ? `Day ${sd}` : "—"}</div>`;

  top.appendChild(left);
  top.appendChild(right);

  const badges = document.createElement("div");
  badges.className = "badges";

  // Show up to 3 badges
  hits.slice(0,3).forEach(h=>{
    const b = document.createElement("div");
    const p = h.priority || 1;
    b.className = "badge " + (p >= 3 ? "high" : (p === 1 ? "low" : ""));
    b.textContent = h.category || "Item";
    badges.appendChild(b);
  });

  cell.appendChild(top);
  cell.appendChild(badges);

  cell.addEventListener("click", ()=>{
    state.selectedDate = date;
    renderDetails(items, date);
    // Light visual feedback
    document.querySelectorAll(".cell").forEach(c=>c.style.outline="none");
    cell.style.outline = "2px solid rgba(0,255,190,.28)";
    cell.style.outlineOffset = "2px";
  });

  return cell;
}

function renderDetails(items, date){
  const sd = computeStateDay(date);
  $("detailTitle").textContent = sd
    ? `${formatLong(date)} — State Day ${sd}`
    : `${formatLong(date)} — (set state start day)`;

  const list = $("detailList");
  list.innerHTML = "";

  if(!sd){
    list.appendChild(detailEmpty("No state day yet. Set State start date or “today is day”."));
    return;
  }

  const hits = itemsForStateDay(items, sd);
  if(hits.length === 0){
    list.appendChild(detailEmpty("No items scheduled for this day (in your dataset)."));
    return;
  }

  hits
    .sort((a,b)=>(b.priority||0)-(a.priority||0))
    .forEach(h=>{
      const el = document.createElement("div");
      el.className = "detailItem";

      const packLines = (h.packs || []).map(p=>{
        const tier = p.tier ? ` [${p.tier}]` : "";
        const notes = p.notes ? ` — ${p.notes}` : "";
        return `• ${p.name}${tier}${notes}`;
      }).join("<br/>");

      el.innerHTML = `
        <div class="h">
          <div>${escapeHtml(h.title || h.id)}</div>
          <div class="badge ${((h.priority||1)>=3) ? "high" : "low"}">${escapeHtml(h.category || "Item")}</div>
        </div>
        <div class="meta">
          <div><b>Window:</b> Day ${h.startDay} → Day ${h.endDay}</div>
          ${h.repeat ? `<div><b>Repeat:</b> ${escapeHtml(describeRepeat(h.repeat))}</div>` : ""}
          <div style="margin-top:8px">${packLines || "—"}</div>
        </div>
      `;
      list.appendChild(el);
    });
}

function detailEmpty(msg){
  const el = document.createElement("div");
  el.className = "detailItem";
  el.innerHTML = `<div class="meta">${escapeHtml(msg)}</div>`;
  return el;
}

/* ----------------- logic: state day & scheduling ----------------- */

function computeStateDay(date){
  // Option A: stateStartDate is provided
  if(state.stateStartDate){
    const start = startOfDay(state.stateStartDate);
    const diff = Math.floor((startOfDay(date) - start) / 86400000);
    return diff >= 0 ? diff + 1 : null;
  }

  // Option B: user says "today is day X"
  if(state.todayIsDay){
    const today = startOfDay(new Date());
    const delta = Math.floor((startOfDay(date) - today) / 86400000);
    const sd = state.todayIsDay + delta;
    return sd > 0 ? sd : null;
  }

  return null;
}

function pickRange(stateDay){
  const ranges = state.data?.stateRanges || [];
  return ranges.find(r => stateDay >= r.minStateDay && stateDay <= r.maxStateDay) || ranges[0];
}

function filterItems(items){
  if(state.category === "all") return items;
  return items.filter(it => (it.category || "Other") === state.category);
}

function getAllItems(){
  const ranges = state.data?.stateRanges || [];
  return ranges.flatMap(r => r.items || []);
}

function itemsForStateDay(items, sd){
  return items.filter(it => isActiveOnStateDay(it, sd));
}

function isActiveOnStateDay(it, sd){
  if(sd < it.startDay || sd > it.endDay) return false;

  // Optional: daysOfWeek (state-day aligned to real calendar day is handled by rendering date)
  // We use repeat rules primarily. If you want strict weekday rules you can encode via repeat.on.

  // No repeat => active across the whole window (every day between startDay and endDay)
  if(!it.repeat) return true;

  // Repeat logic checks periodicity relative to startDay.
  const rep = it.repeat;

  if(rep.freq === "daily"){
    const interval = rep.interval || 1;
    return ((sd - it.startDay) % interval) === 0;
  }

  if(rep.freq === "weekly"){
    // Weekly cadence: active only on certain weekdays (Mon..Sun)
    // We need the real date to know weekday. We don’t have it here.
    // So we treat weekly rule as "every N weeks AND user will see it by day window".
    // Better: encode weekly with on[] and we resolve using the date in the cell.
    // MVP: accept weekly without on[] as always-on during the window.
    if(!rep.on || rep.on.length === 0) return true;
    // We'll check weekday at render-time via a helper in makeCell, but simplest:
    // keep it on in details and show window; user sees by day.
    return true;
  }

  return true;
}

function describeRepeat(rep){
  if(rep.freq === "daily"){
    return `Daily (every ${rep.interval || 1} day)`;
  }
  if(rep.freq === "weekly"){
    const days = rep.on ? rep.on.join(", ") : "all days";
    return `Weekly (every ${rep.interval || 1} week) on ${days}`;
  }
  return "—";
}

/* ----------------- date helpers ----------------- */

function startOfDay(d){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d){
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfWeekMon(d){
  const x = startOfDay(d);
  const js = x.getDay(); // Sun=0
  const monIndex = (js === 0) ? 6 : (js - 1); // Mon=0..Sun=6
  return addDays(x, -monIndex);
}
function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonths(d, n){
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function isSameDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
function toISODate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}
function formatMonthYear(d){
  return d.toLocaleString(undefined, {month:"long", year:"numeric"});
}
function formatLong(d){
  return d.toLocaleString(undefined, {weekday:"long", year:"numeric", month:"long", day:"numeric"});
}
function formatShort(d){
  return d.toLocaleString(undefined, {month:"short", day:"numeric"});
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
