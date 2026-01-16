const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "wos_pack_purchases_v1";

const state = {
  data: { schemaVersion: 2, resetUtc: "00:00", packDefs: [], stateRanges: [] },

  view: "month",
  cursor: startOfMonthLocal(new Date()),
  selectedDate: null,

  stateStartDateUtc: null,
  todayIsDay: null,

  category: "all",
  purchases: [],

  loadError: null
};

init();

async function init(){
  wireUI();
  state.purchases = loadPurchases();

  await loadDataSafe();
  hydrateFiltersSafe();

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

async function loadDataSafe(){
  state.loadError = null;

  try{
    const res = await fetch("data/packs.json", { cache: "no-store" });
    if(!res.ok) throw new Error(`packs.json not found (HTTP ${res.status})`);
    const json = await res.json();

    // minimal validation
    json.packDefs = Array.isArray(json.packDefs) ? json.packDefs : [];
    json.stateRanges = Array.isArray(json.stateRanges) ? json.stateRanges : [];

    state.data = json;
  }catch(err){
    state.loadError = String(err?.message || err);
    // keep empty dataset so UI still renders
    state.data = { schemaVersion: 2, resetUtc: "00:00", packDefs: [], stateRanges: [] };
  }
}

function hydrateFiltersSafe(){
  const sel = $("categoryFilter");
  // reset to only "All"
  sel.innerHTML = `<option value="all">All</option>`;

  const cats = new Set();
  getAllRules().forEach(r => cats.add(r.category || "Other"));

  [...cats].sort().forEach(c=>{
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

function setDefaultStateStartUTC(){
  const now = new Date();
  const start = addDaysUTC(utcMidnightFromUTC(now), -60);
  $("stateStart").value = toISODateUTC(start);
  state.stateStartDateUtc = parseDateAsUtcMidnight($("stateStart").value);
}

function render(){
  const todayUtcMidnight = utcMidnightFromUTC(new Date());
  const stateDayToday = computeStateDay(todayUtcMidnight);
  $("stateDayBadge").textContent = stateDayToday ? `Day ${stateDayToday}` : "—";

  const activeRange = pickRange(stateDayToday || 1);
  $("rangeBadge").textContent = activeRange?.label || "Default";

  const rules = filterRules(activeRange?.rules || []);

  if(state.view === "month"){
    $("monthLabel").textContent = formatMonthYear(state.cursor);
    renderMonth(rules, todayUtcMidnight);
  } else {
    const start = startOfWeekMonLocal(state.cursor);
    const end = addDaysLocal(start, 6);
    $("monthLabel").textContent = `${formatShort(start)} → ${formatShort(end)}`;
    renderWeek(rules, todayUtcMidnight, start);
  }

  if(!state.selectedDate) state.selectedDate = new Date();
  renderDetails(rules, state.selectedDate);
}

/* ----------------- calendar ----------------- */

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

  // map displayed local Y/M/D to UTC midnight of same date
  const cellUtcMid = utcMidnightFromLocalYMD(dateLocal);

  if(isSameUtcDay(cellUtcMid, todayUtcMidnight)){
    cell.classList.add("today");
  }

  const sd = computeStateDay(cellUtcMid);
  const act = sd ? rulesActiveOnDate(rules, cellUtcMid, sd) : [];

  const actForBadges = act.filter(a => ruleHasAnyAvailablePack(a.rule, cellUtcMid));

  const top = document.createElement("div");
  top.className = "cellTop";
  top.innerHTML = `
    <div class="dateNum">${dateLocal.getDate()}</div>
    <div class="stateDay">${sd ? `Day ${sd}` : "—"}</div>
  `;

  const badges = document.createElement("div");
  badges.className = "badges";

  const seen = new Set();
  for(const a of actForBadges){
    const cat = a.rule.category || "Item";
    if(seen.has(cat)) continue;
    seen.add(cat);

    const b = document.createElement("div");
    b.className = "badge " + (seen.size === 1 ? "high" : "");
    b.textContent = cat;
    badges.appendChild(b);

    if(seen.size >= 3) break;
  }

  cell.appendChild(top);
  cell.appendChild(badges);

  cell.addEventListener("click", ()=>{
    state.selectedDate = dateLocal;
    renderDetails(rules, dateLocal);
  });

  return cell;
}

function ruleHasAnyAvailablePack(rule, dayUtcMid){
  const packs = (rule.packs || []).map(id => getPackDef(id)).filter(Boolean);
  if(packs.length === 0) return false;
  return packs.some(p => getPurchaseStatus(p, dayUtcMid).available);
}

/* ----------------- details ----------------- */

function renderDetails(rules, dateLocal){
  const list = $("detailList");
  list.innerHTML = "";

  if(state.loadError){
    $("detailTitle").textContent = "Dataset error";
    list.appendChild(detailEmpty(
      `Could not load data/packs.json. Fix it and refresh.\n\nError: ${state.loadError}`
    ));
    return;
  }

  const dateUtcMid = utcMidnightFromLocalYMD(dateLocal);
  const sd = computeStateDay(dateUtcMid);

  $("detailTitle").textContent = sd
    ? `${formatLong(dateLocal)} — State Day ${sd} (UTC reset)`
    : `${formatLong(dateLocal)} — set state start day`;

  if(!sd){
    list.appendChild(detailEmpty("No state day yet. Set State start date or “today is state day”."));
    return;
  }

  const active = rulesActiveOnDate(rules, dateUtcMid, sd);

  if(active.length === 0){
    list.appendChild(detailEmpty("No packs scheduled for this day (in your dataset)."));
    return;
  }

  for(const a of active){
    const rule = a.rule;
    const packs = (rule.packs || []).map(id => getPackDef(id)).filter(Boolean);

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
        <button class="smallBtn primary" data-buy="${escapeHtml(packDef.id)}" ${available ? "" : "disabled"} type="button">Mark as bought</button>
        ${!available ? `<span style="opacity:.8">Next reset: ${escapeHtml(formatUtc(nextAtUtc))} UTC</span>` : ""}
      </div>
    </div>
  `;

  const btn = el.querySelector(`[data-buy="${cssEscape(packDef.id)}"]`);
  if(btn){
    btn.addEventListener("click", ()=>{
      recordPurchase(packDef.id, Date.now());
      render();
    });
  }

  return el;
}

function renderGives(packDef){
  let lines = [];

  if(Array.isArray(packDef.gives) && packDef.gives.length){
    lines.push(`<div><b>Includes:</b></div>`);
    for(const g of packDef.gives){
      lines.push(`<div>• ${escapeHtml(g.item)} x${escapeHtml(g.qty)}</div>`);
    }
  }

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
  el.innerHTML = `<div class="meta" style="white-space:pre-wrap">${escapeHtml(msg)}</div>`;
  return el;
}

/* ----------------- activation rules ----------------- */

function getAllRules(){
  return (state.data?.stateRanges || []).flatMap(r => r.rules || []);
}

function getPackDef(id){
  return (state.data?.packDefs || []).find(p => p.id === id) || null;
}

function pickRange(stateDay){
  const ranges = state.data?.stateRanges || [];
  return ranges.find(r => stateDay >= r.minStateDay && stateDay <= r.maxStateDay) || ranges[0] || { label:"Default", rules:[] };
}

function filterRules(rules){
  if(state.category === "all") return rules;
  return rules.filter(r => (r.category || "Other") === state.category);
}

function rulesActiveOnDate(rules, dateUtcMid, stateDay){
  const out = [];

  for(const rule of rules){
    if(stateDay < rule.startDay || stateDay > rule.endDay) continue;

    if(!rule.repeat){
      out.push({ rule, windowText: `State Day ${rule.startDay} → ${rule.endDay}` });
      continue;
    }

    const rep = rule.repeat;

    if(rep.freq === "weekly"){
      const on = Array.isArray(rep.on) ? rep.on : [];

      // single day means: starts at that weekday 00:00 UTC and lasts 7 days
      if(on.length === 1){
        const startName = on[0];
        const startUtc = startOfWeekWindowUtc(dateUtcMid, startName);
        const endUtc = addDaysUTC(startUtc, 7);
        if(dateUtcMid >= startUtc && dateUtcMid < endUtc){
          out.push({ rule, windowText: `${startName} 00:00 UTC → next ${startName} 00:00 UTC` });
        }
      } else if(on.length > 1){
        const wd = weekdayUtc(dateUtcMid);
        if(on.includes(wd)){
          out.push({ rule, windowText: `Weekly on ${on.join(", ")} (00:00 UTC reset)` });
        }
      } else {
        out.push({ rule, windowText: `Weekly (00:00 UTC reset)` });
      }
      continue;
    }

    if(rep.freq === "daily"){
      out.push({ rule, windowText: `Daily (00:00 UTC reset)` });
      continue;
    }

    if(rep.freq === "monthly"){
      const onDay = rep.onDay || 1;
      if(dateUtcMid.getUTCDate() === onDay){
        out.push({ rule, windowText: `Monthly on day ${onDay} (00:00 UTC reset)` });
      }
      continue;
    }
  }

  return out;
}

/* ----------------- purchases ----------------- */

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
  if(resetType === "daily"){
    const s = nowUtcMid;
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

  const s = nowUtcMid;
  const e = addDaysUTC(s, 1);
  return { start: s, end: e };
}

/* ----------------- state day (UTC) ----------------- */

function computeStateDay(dateUtcMid){
  const dayNum = utcDayNumber(dateUtcMid);

  if(state.stateStartDateUtc){
    const startNum = utcDayNumber(state.stateStartDateUtc);
    const diff = dayNum - startNum;
    return diff >= 0 ? diff + 1 : null;
  }

  if(state.todayIsDay){
    const todayNum = utcDayNumber(utcMidnightFromUTC(new Date()));
    const delta = dayNum - todayNum;
    const sd = state.todayIsDay + delta;
    return sd > 0 ? sd : null;
  }

  return null;
}

/* ----------------- UTC helpers ----------------- */

function utcMidnightFromUTC(d){
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function utcMidnightFromLocalYMD(dLocal){
  return new Date(Date.UTC(dLocal.getFullYear(), dLocal.getMonth(), dLocal.getDate()));
}

function utcDayNumber(dUtcMid){
  return Math.floor(Date.UTC(dUtcMid.getUTCFullYear(), dUtcMid.getUTCMonth(), dUtcMid.getUTCDate()) / 86400000);
}

function parseDateAsUtcMidnight(ymd){
  const [y,m,da] = ymd.split("-").map(n => parseInt(n,10));
  return new Date(Date.UTC(y, m - 1, da));
}

function addDaysUTC(dUtcMid, n){
  return new Date(Date.UTC(dUtcMid.getUTCFullYear(), dUtcMid.getUTCMonth(), dUtcMid.getUTCDate() + n));
}

function toISODateUTC(dUtcMid){
  const y = dUtcMid.getUTCFullYear();
  const m = String(dUtcMid.getUTCMonth()+1).padStart(2,"0");
  const da = String(dUtcMid.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function weekdayUtc(dUtcMid){
  const js = dUtcMid.getUTCDay();
  const map = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return map[js];
}

function startOfWeekWindowUtc(dateUtcMid, startDayName){
  const map = { "Mon":1,"Tue":2,"Wed":3,"Thu":4,"Fri":5,"Sat":6,"Sun":0 };
  const target = map[startDayName] ?? 1;
  const current = dateUtcMid.getUTCDay();

  let diff = current - target;
  if(diff < 0) diff += 7;
  return addDaysUTC(dateUtcMid, -diff);
}

function isSameUtcDay(aUtcMid, bUtcMid){
  return aUtcMid.getTime() === bUtcMid.getTime();
}

function formatUtc(dUtcMid){
  const y = dUtcMid.getUTCFullYear();
  const m = String(dUtcMid.getUTCMonth()+1).padStart(2,"0");
  const da = String(dUtcMid.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${da} 00:00`;
}

/* ----------------- Local UI helpers ----------------- */

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

/* ----------------- safety ----------------- */

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function cssEscape(s){
  return String(s).replace(/"/g, '\\"');
}
