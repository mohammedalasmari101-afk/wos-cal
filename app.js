const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "wos_pack_purchases_v1";

const state = {
  data: null,

  view: "month",            // "month" | "week"
  cursor: startOfMonthLocal(new Date()),
  selectedDate: null,

  stateStartDateUtc: null,  // Date at UTC midnight
  todayIsDay: null,         // number (UTC-based)

  category: "all",
  purchases: []             // [{packId, ts}] where ts = ms UTC
};

const DOW_MON_FIRST = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

init();

async function init(){
  wireUI();
  state.purchases = loadPurchases();
  await loadData();
  hydrateFilters();

  setDefaultStateStartUTC();
  render();
}

function wireUI(){
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
      ? addMonthsLocal(state.cursor, -1)
      : addDaysLocal(state.cursor, -7);
    render();
  });

  $("nextBtn").addEventListener("click", ()=>{
    state.cursor = (state.view === "month")
      ? addMonthsLocal(state.cursor, 1)
      : addDaysLocal(state.cursor, 7);
    render();
  });

  $("stateStart").addEventListener("change", (e)=>{
    state.stateStartDateUtc = e.target.value ? parseDateAsUtcMidnight(e.target.value) : null;
    state.todayIsDay = null;
    $("todayIsDay").value = "";
    render();
  });

  $("todayIsDay").addEventListener("input", (e)=>{
    const v = parseInt(e.target.value, 10);
    state.todayIsDay = Number.isFinite(v) && v > 0 ? v : null;
    if(state.todayIsDay){
      state.stateStartDateUtc = null;
      $("stateStart").value = "";
    }
    render();
  });

  $("categoryFilter").addEventListener("change", (e)=>{
    state.category = e.target.value;
    render();
  });

  $("clearPurchasesBtn").addEventListener("click", ()=>{
    state.purchases = [];
    savePurchases(state.purchases);
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
  getAllRules().forEach(r => cats.add(r.category || "Other"));
  const sel = $("categoryFilter");
  [...cats].sort().forEach(c=>{
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

function setDefaultStateStartUTC(){
  // default: 60 UTC days ago
  const now = new Date();
  const start = addDaysUTC(now, -60);
  $("stateStart").value = toISODateUTC(start);
  state.stateStartDateUtc = parseDateAsUtcMidnight($("stateStart").value);
}

function render(){
  const todayUtcMidnight = utcMidnight(new Date());
  const stateDayToday = computeStateDay(todayUtcMidnight);
  $("stateDayBadge").textContent = stateDayToday ? `Day ${stateDayToday}` : "—";

  const activeRange = pickRange(stateDayToday || 1);
  $("rangeBadge").textContent = activeRange?.label || "Default";

  const rules = filterRules(activeRange?.rules || []);

  // header label (monthly calendar real dates)
  if(state.view === "month"){
    $("monthLabel").textContent = formatMonthYear(state.cursor);
    renderMonth(rules, todayUtcMidnight);
  } else {
    const start = startOfWeekMonLocal(state.cursor);
    const end = addDaysLocal(start, 6);
    $("monthLabel").textContent = `${formatShort(start)} → ${formatShort(end)}`;
    renderWeek(rules, todayUtcMidnight, start);
  }

  if(!state.selectedDate){
    state.selectedDate = new Date(); // local click date; fine
  }
  renderDetails(rules, state.selectedDate);
}

/* ----------------- calendar grid ----------------- */

function renderMonth(rules, todayUtcMidnight){
  const grid = $("grid");
  grid.innerHTML = "";

  const first = startOfMonthLocal(state.cursor);
  const start = startOfWeekMonLocal(first);
  const focusMonth = first.getMonth();

  for(let i=0;i<42;i++){
    const dLocal = addDaysLocal(start, i);
    grid.appendChild(makeCell(dLocal, rules, todayUtcMidnight, focusMonth));
  }
}

function renderWeek(rules, todayUtcMidnight, startLocal){
  const grid = $("grid");
  grid.innerHTML = "";
  for(let i=0;i<7;i++){
    const dLocal = addDaysLocal(startLocal, i);
    grid.appendChild(makeCell(dLocal, rules, todayUtcMidnight, dLocal.getMonth()));
  }
}

function makeCell(dateLocal, rules, todayUtcMidnight, focusMonth){
  const cell = document.createElement("div");
  cell.className = "cell";

  if(dateLocal.getMonth() !== focusMonth && state.view === "month"){
    cell.classList.add("dim");
  }

  const cellUtcMid = utcMidnight(dateLocal);
  if(isSameUtcDay(cellUtcMid, todayUtcMidnight)){
    cell.classList.add("today");
  }

  const sd = computeStateDay(cellUtcMid);
  const act = sd ? rulesActiveOnDate(rules, cellUtcMid, sd) : [];

  const top = document.createElement("div");
  top.className = "cellTop";
  top.innerHTML = `
    <div class="dateNum">${dateLocal.getDate()}</div>
    <div class="stateDay">${sd ? `Day ${sd}` : "—"}</div>
  `;

  const badges = document.createElement("div");
  badges.className = "badges";

  // show up to 3 categories present
  const seen = new Set();
  for(const a of act){
    if(seen.has(a.rule.category)) continue;
    seen.add(a.rule.category);
    const b = document.createElement("div");
    b.className = "badge " + (seen.size === 1 ? "high" : "");
    b.textContent = a.rule.category || "Item";
    badges.appendChild(b);
    if(seen.size >= 3) break;
  }

  cell.appendChild(top);
  cell.appendChild(badges);

  cell.addEventListener("click", ()=>{
    state.selectedDate = dateLocal;
    renderDetails(rules, dateLocal);

    document.querySelectorAll(".cell").forEach(c=>c.style.outline="none");
    cell.style.outline = "2px solid rgba(0,255,190,.28)";
    cell.style.outlineOffset = "2px";
  });

  return cell;
}

/* ----------------- details panel ----------------- */

function renderDetails(rules, dateLocal){
  const dateUtcMid = utcMidnight(dateLocal);
  const sd = computeStateDay(dateUtcMid);

  $("detailTitle").textContent = sd
    ? `${formatLong(dateLocal)} — State Day ${sd} (UTC reset)`
    : `${formatLong(dateLocal)} — set state start day`;

  const list = $("detailList");
  list.innerHTML = "";

  if(!sd){
    list.appendChild(detailEmpty("No state day yet. Set State start date or “today is state day”."));
    return;
  }

  const active = rulesActiveOnDate(rules, dateUtcMid, sd);

  if(active.length === 0){
    list.appendChild(detailEmpty("No packs scheduled for this day (in your dataset)."));
    return;
  }

  // flatten to pack cards, grouped by rule
  for(const a of active){
    const rule = a.rule;
    const packs = (rule.packs || []).map(id => getPackDef(id)).filter(Boolean);

    // rule header
    const header = document.createElement("div");
    header.className = "detailItem";
    header.innerHTML = `
      <div class="h">
        <div>${escapeHtml(rule.title || rule.id)}</div>
        <div class="badge high">${escapeHtml(rule.category || "Rule")}</div>
      </div>
      <div class="meta">
        <div><b>Active window:</b> ${escapeHtml(a.windowText)}</div>
        <div><b>Packs:</b> ${packs.length}</div>
      </div>
    `;
    list.appendChild(header);

    // pack cards
    for(const p of packs){
      list.appendChild(renderPackCard(p, dateUtcMid));
    }
  }
}

function renderPackCard(packDef, nowUtcMid){
  const el = document.createElement("div");
  el.className = "detailItem";

  const { used, limit, available, nextAtUtc } = getPurchaseStatus(packDef, nowUtcMid);

  const price = (packDef.price != null) ? `$${packDef.price}` : "";
  const givesHtml = renderGives(packDef);

  el.innerHTML = `
    <div class="h">
      <div>${escapeHtml(packDef.name)} ${price ? `<span style="opacity:.75;font-weight:800;margin-left:8px">${price}</span>` : ""}</div>
      <div class="badge low">${escapeHtml(packDef.reset?.type || "—")}</div>
    </div>
    <div class="meta">
      ${packDef.desc ? `<div>${escapeHtml(packDef.desc)}</div>` : ""}
      <div style="margin-top:8px">${givesHtml}</div>
      <div style="margin-top:10px">
        <b>Purchases this period:</b> ${used}/${limit}
        &nbsp;—&nbsp;
        ${available
          ? `<span class="statusOk">AVAILABLE</span>`
          : `<span class="statusBad">LOCKED</span> <span style="opacity:.85">until ${escapeHtml(formatUtc(nextAtUtc))} UTC</span>`
        }
      </div>
      <div class="actions">
        <button class="smallBtn primary" data-buy="${escapeHtml(packDef.id)}" ${available ? "" : "disabled"}>Mark as bought</button>
        ${!available ? `<span style="opacity:.8">Next reset: ${escapeHtml(formatUtc(nextAtUtc))} UTC</span>` : ""}
      </div>
    </div>
  `;

  const btn = el.querySelector(`[data-buy="${cssEscape(packDef.id)}"]`);
  if(btn){
    btn.addEventListener("click", ()=>{
      recordPurchase(packDef.id, Date.now());
      render(); // refresh everything
    });
  }

  return el;
}

function renderGives(packDef){
  let lines = [];

  // standard gives
  if(Array.isArray(packDef.gives) && packDef.gives.length){
    lines.push(`<div><b>Includes:</b></div>`);
    for(const g of packDef.gives){
      lines.push(`<div>• ${escapeHtml(g.item)} x${escapeHtml(g.qty)}</div>`);
    }
  }

  // choose pool
  if(packDef.givesMode === "choose" && packDef.choose){
    lines.push(`<div style="margin-top:8px"><b>Choose ${escapeHtml(packDef.choose.count)}:</b></div>`);
    for(const c of (packDef.choose.pool || [])){
      lines.push(`<div>• ${escapeHtml(c.item)} x${escapeHtml(c.qty)}</div>`);
    }
  }

  return lines.join("");
}

function detailEmpty(msg){
  const el = document.createElement("div");
  el.className = "detailItem";
  el.innerHTML = `<div class="meta">${escapeHtml(msg)}</div>`;
  return el;
}

/* ----------------- rule activation (schema v2) ----------------- */

function getAllRules(){
  return (state.data?.stateRanges || []).flatMap(r => r.rules || []);
}

function getPackDef(id){
  return (state.data?.packDefs || []).find(p => p.id === id) || null;
}

function pickRange(stateDay){
  const ranges = state.data?.stateRanges || [];
  return ranges.find(r => stateDay >= r.minStateDay && stateDay <= r.maxStateDay) || ranges[0];
}

function filterRules(rules){
  if(state.category === "all") return rules;
  return rules.filter(r => (r.category || "Other") === state.category);
}

function rulesActiveOnDate(rules, dateUtcMid, stateDay){
  const out = [];

  for(const rule of rules){
    if(stateDay < rule.startDay || stateDay > rule.endDay) continue;

    // No repeat => active every day in window
    if(!rule.repeat){
      out.push({ rule, windowText: `State Day ${rule.startDay} → ${rule.endDay}` });
      continue;
    }

    const rep = rule.repeat;

    if(rep.freq === "weekly"){
      // Two cases:
      // A) on has ONE day => "starts that day and lasts until next same day"
      //    (your Mon -> next Mon requirement)
      // B) on has MULTIPLE days => active only on those days
      const on = Array.isArray(rep.on) ? rep.on : [];
      const wd = weekdayUtc(dateUtcMid); // "Mon".."Sun"

      if(on.length === 1){
        const startDayName = on[0];
        const startUtc = startOfWeekWindowUtc(dateUtcMid, startDayName);
        const endUtc = addDaysUTC(startUtc, 7);
        if(dateUtcMid >= startUtc && dateUtcMid < endUtc){
          out.push({ rule, windowText: `${startDayName} 00:00 UTC → next ${startDayName} 00:00 UTC` });
        }
      } else if(on.length > 1) {
        if(on.includes(wd)){
          out.push({ rule, windowText: `Weekly on ${on.join(", ")} (00:00 UTC reset)` });
        }
      } else {
        // weekly with no on[] => treat as always active in window
        out.push({ rule, windowText: `Weekly (00:00 UTC reset)` });
      }

      continue;
    }

    if(rep.freq === "daily"){
      out.push({ rule, windowText: `Daily (00:00 UTC reset)` });
      continue;
    }

    if(rep.freq === "monthly"){
      // minimal support: show on the 1st by default, or rep.onDay
      const onDay = rep.onDay || 1;
      const dayOfMonthUtc = dateUtcMid.getUTCDate();
      if(dayOfMonthUtc === onDay){
        out.push({ rule, windowText: `Monthly on day ${onDay} (00:00 UTC reset)` });
      }
      continue;
    }
  }

  return out;
}

/* ----------------- purchases / cooldown ----------------- */

function loadPurchases(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(arr)) return [];
    return arr.filter(x => x && typeof x.packId === "string" && typeof x.ts === "number");
  }catch{
    return [];
  }
}

function savePurchases(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

function recordPurchase(packId, tsMs){
  state.purchases.push({ packId, ts: tsMs });
  savePurchases(state.purchases);
}

function getPurchaseStatus(packDef, nowUtcMid){
  const limit = Number.isFinite(packDef.buyLimit) ? packDef.buyLimit : 1;
  const resetType = packDef.reset?.type || "daily";

  const period = getResetPeriod(resetType, packDef.reset, nowUtcMid);

  const used = state.purchases.filter(p =>
    p.packId === packDef.id &&
    p.ts >= period.start.getTime() &&
    p.ts < period.end.getTime()
  ).length;

  const available = used < limit;
  const nextAtUtc = available ? null : period.end;

  return { used, limit, available, nextAtUtc };
}

function getResetPeriod(resetType, resetCfg, nowUtcMid){
  // nowUtcMid is a Date at UTC midnight of the calendar day
  const start = new Date(nowUtcMid.getTime());

  if(resetType === "daily"){
    const s = start;
    const e = addDaysUTC(s, 1);
    return { start: s, end: e };
  }

  if(resetType === "weekly"){
    const weekStarts = resetCfg?.weekStarts || "Mon";
    const s = startOfWeekWindowUtc(nowUtcMid, weekStarts);
    const e = addDaysUTC(s, 7);
    return { start: s, end: e };
  }

  if(resetType === "monthly"){
    const s = new Date(Date.UTC(nowUtcMid.getUTCFullYear(), nowUtcMid.getUTCMonth(), 1));
    const e = new Date(Date.UTC(nowUtcMid.getUTCFullYear(), nowUtcMid.getUTCMonth() + 1, 1));
    return { start: s, end: e };
  }

  // fallback
  const e = addDaysUTC(start, 1);
  return { start, end: e };
}

/* ----------------- state day (UTC midnight) ----------------- */

function computeStateDay(dateUtcMid){
  const dayNum = utcDayNumber(dateUtcMid);

  // Option A: state start
  if(state.stateStartDateUtc){
    const startNum = utcDayNumber(state.stateStartDateUtc);
    const diff = dayNum - startNum;
    return diff >= 0 ? diff + 1 : null;
  }

  // Option B: today is day X
  if(state.todayIsDay){
    const todayNum = utcDayNumber(utcMidnight(new Date()));
    const delta = dayNum - todayNum;
    const sd = state.todayIsDay + delta;
    return sd > 0 ? sd : null;
  }

  return null;
}

/* ----------------- UTC helpers ----------------- */

function utcMidnight(d){
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcDayNumber(d){
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

function parseDateAsUtcMidnight(ymd){
  const [y,m,da] = ymd.split("-").map(n => parseInt(n,10));
  return new Date(Date.UTC(y, m - 1, da));
}

function addDaysUTC(d, n){
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function toISODateUTC(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const da = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function weekdayUtc(dUtcMid){
  // returns "Mon".."Sun"
  const js = dUtcMid.getUTCDay(); // Sun=0
  const map = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return map[js];
}

// For "weekStarts" or weekly rule "on" start day:
// returns the UTC midnight of the most recent <startDayName> at/ before dateUtcMid
function startOfWeekWindowUtc(dateUtcMid, startDayName){
  const map = { "Mon":1,"Tue":2,"Wed":3,"Thu":4,"Fri":5,"Sat":6,"Sun":0 };
  const target = map[startDayName] ?? 1;
  const current = dateUtcMid.getUTCDay(); // 0..6 (Sun..Sat)

  let diff = current - target;
  if(diff < 0) diff += 7;
  return addDaysUTC(dateUtcMid, -diff);
}

function isSameUtcDay(aUtc, bUtc){
  return aUtc.getTime() === bUtc.getTime();
}

/* ----------------- local date helpers (for UI layout only) ----------------- */

function startOfMonthLocal(d){
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfWeekMonLocal(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const js = x.getDay(); // Sun=0
  const monIndex = (js === 0) ? 6 : (js - 1); // Mon=0..Sun=6
  x.setDate(x.getDate() - monIndex);
  return x;
}
function addDaysLocal(d, n){
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function addMonthsLocal(d, n){
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
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

function formatUtc(dUtc){
  // dUtc is Date at UTC boundary; show YYYY-MM-DD 00:00
  const y = dUtc.getUTCFullYear();
  const m = String(dUtc.getUTCMonth()+1).padStart(2,"0");
  const da = String(dUtc.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${da} 00:00`;
}

/* ----------------- safety ----------------- */

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function cssEscape(s){
  // basic
  return String(s).replace(/"/g, '\\"');
}
