const OVERRIDE_KEY = "wos_pack_dataset_override_v1";
const BASE_URL = "data/packs.json";

const $ = (id) => document.getElementById(id);

let baseData = null;
let mergedData = null;

init();

async function init() {
  $("loadBtn").addEventListener("click", () => loadAll());
  $("clearOverrideBtn").addEventListener("click", clearOverride);

  $("addPackBtn").addEventListener("click", addOrUpdatePack);
  $("addRuleBtn").addEventListener("click", addOrUpdateRule);

  $("downloadBtn").addEventListener("click", downloadMerged);
  $("copyBtn").addEventListener("click", copyMerged);

  await loadAll();
}

async function loadAll() {
  setStatus("Loading…", "ok");
  baseData = await loadBase();
  mergedData = mergeWithOverride(baseData, loadOverride());
  renderTables();
  setStatus("Loaded. Changes are saved as admin override until you download + commit.", "ok");
}

async function loadBase() {
  try {
    const res = await fetch(BASE_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load ${BASE_URL} (HTTP ${res.status})`);
    const json = await res.json();
    return normalize(json);
  } catch (e) {
    setStatus(String(e.message || e), "bad");
    return normalize({ schemaVersion: 2, resetUtc: "00:00", packDefs: [], stateRanges: [{ id:"default", label:"Default", minStateDay:1, maxStateDay:9999, rules:[] }] });
  }
}

function normalize(json) {
  json.schemaVersion = json.schemaVersion || 2;
  json.resetUtc = json.resetUtc || "00:00";
  json.packDefs = Array.isArray(json.packDefs) ? json.packDefs : [];
  json.stateRanges = Array.isArray(json.stateRanges) ? json.stateRanges : [];
  if (json.stateRanges.length === 0) {
    json.stateRanges.push({ id:"default", label:"Default", minStateDay:1, maxStateDay:9999, rules:[] });
  }
  json.stateRanges.forEach(r => { r.rules = Array.isArray(r.rules) ? r.rules : []; });
  return json;
}

function loadOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveOverride(data) {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(data));
}

function clearOverride() {
  localStorage.removeItem(OVERRIDE_KEY);
  setStatus("Admin override cleared. Reloading…", "ok");
  loadAll();
}

function mergeWithOverride(base, override) {
  if (!override) return structuredClone(base);

  const out = structuredClone(base);

  // packs: override by id
  const map = new Map(out.packDefs.map(p => [p.id, p]));
  for (const p of override.packDefs) map.set(p.id, p);
  out.packDefs = [...map.values()].sort((a,b) => a.id.localeCompare(b.id));

  // rules: in default range only (simple)
  const baseRange = out.stateRanges[0];
  const oRange = override.stateRanges[0] || { rules: [] };
  const rmap = new Map((baseRange.rules||[]).map(r => [r.id, r]));
  for (const r of (oRange.rules||[])) rmap.set(r.id, r);
  baseRange.rules = [...rmap.values()].sort((a,b) => a.id.localeCompare(b.id));

  return out;
}

function getEditableOverride() {
  const current = loadOverride();
  if (current) return current;
  // start from merged so editors can work from current truth
  return structuredClone(mergedData || baseData);
}

function addOrUpdatePack() {
  const id = $("p_id").value.trim();
  const name = $("p_name").value.trim();
  if (!id || !name) return setStatus("Pack ID + Name are required.", "bad");

  const desc = $("p_desc").value.trim();
  const price = toNum($("p_price").value);
  const buyLimit = toInt($("p_limit").value, 1);
  const resetType = $("p_reset").value;

  const gives = parseJson($("p_gives").value, "Gives must be valid JSON array.");
  if (!Array.isArray(gives)) return;

  const chooseRaw = $("p_choose").value.trim();
  let givesMode = undefined;
  let choose = undefined;
  if (chooseRaw) {
    const ch = parseJson(chooseRaw, "Choose must be valid JSON object.");
    if (!ch) return;
    if (!Number.isFinite(ch.count) || !Array.isArray(ch.pool)) {
      return setStatus("Choose must include { count:number, pool:array }", "bad");
    }
    givesMode = "choose";
    choose = ch;
  }

  const pack = {
    id,
    name,
    desc,
    price: Number.isFinite(price) ? price : undefined,
    currency: "USD",
    buyLimit,
    reset: resetType === "weekly"
      ? { type: "weekly", weekStarts: "Mon" }
      : { type: resetType },
    gives,
    ...(givesMode ? { givesMode, choose } : {})
  };

  const ov = getEditableOverride();
  const i = ov.packDefs.findIndex(p => p.id === id);
  if (i >= 0) ov.packDefs[i] = pack;
  else ov.packDefs.push(pack);

  saveOverride(ov);
  mergedData = mergeWithOverride(baseData, ov);
  renderTables();
  setStatus(`Saved pack: ${id} (override).`, "ok");
}

function addOrUpdateRule() {
  const id = $("r_id").value.trim();
  const title = $("r_title").value.trim();
  const category = $("r_cat").value.trim() || "Other";
  const weekday = $("r_weekday").value;
  const startDay = toInt($("r_start").value, 1);
  const endDay = toInt($("r_end").value, 9999);
  const packsCsv = $("r_packs").value.trim();

  if (!id || !title || !packsCsv) return setStatus("Rule ID + Title + Pack IDs are required.", "bad");

  const packs = packsCsv.split(",").map(s => s.trim()).filter(Boolean);
  const rule = {
    id,
    title,
    category,
    startDay,
    endDay,
    repeat: { freq: "weekly", on: [weekday] },
    packs
  };

  const ov = getEditableOverride();
  if (!ov.stateRanges?.length) ov.stateRanges = [{ id:"default", label:"Default", minStateDay:1, maxStateDay:9999, rules:[] }];
  if (!ov.stateRanges[0].rules) ov.stateRanges[0].rules = [];

  const i = ov.stateRanges[0].rules.findIndex(r => r.id === id);
  if (i >= 0) ov.stateRanges[0].rules[i] = rule;
  else ov.stateRanges[0].rules.push(rule);

  saveOverride(ov);
  mergedData = mergeWithOverride(baseData, ov);
  renderTables();
  setStatus(`Saved rule: ${id} (override).`, "ok");
}

function renderTables() {
  const packs = mergedData.packDefs || [];
  const rules = (mergedData.stateRanges?.[0]?.rules) || [];

  $("counts").textContent = `Packs: ${packs.length}   |   Rules: ${rules.length}   |   Override: ${loadOverride() ? "YES" : "NO"}`;

  // packs table
  const pt = $("packsTable").querySelector("tbody");
  pt.innerHTML = "";
  for (const p of packs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="tag">${esc(p.id)}</span></td>
      <td>${esc(p.name)}</td>
      <td>${esc(p.reset?.type || "—")}</td>
      <td>${esc(p.buyLimit ?? "—")}</td>
      <td>${p.price != null ? `$${p.price}` : "—"}</td>
    `;
    pt.appendChild(tr);
  }

  // rules table
  const rt = $("rulesTable").querySelector("tbody");
  rt.innerHTML = "";
  for (const r of rules) {
    const tr = document.createElement("tr");
    const rep = r.repeat ? `${r.repeat.freq} ${Array.isArray(r.repeat.on) ? r.repeat.on.join(",") : ""}` : "—";
    tr.innerHTML = `
      <td><span class="tag">${esc(r.id)}</span></td>
      <td>${esc(r.title)}</td>
      <td>${esc(r.category || "—")}</td>
      <td>${esc(rep)}</td>
      <td>${esc((r.packs||[]).join(", "))}</td>
    `;
    rt.appendChild(tr);
  }
}

function downloadMerged() {
  const blob = new Blob([JSON.stringify(mergedData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "packs.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Downloaded packs.json. Commit it to /data/packs.json in GitHub.", "ok");
}

async function copyMerged() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(mergedData, null, 2));
    setStatus("Copied JSON to clipboard.", "ok");
  } catch {
    setStatus("Clipboard blocked by browser. Use Download instead.", "bad");
  }
}

function parseJson(text, errMsg) {
  try { return JSON.parse(text); }
  catch { setStatus(errMsg, "bad"); return null; }
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function setStatus(msg, kind) {
  const el = $("status");
  el.className = "meta " + (kind === "bad" ? "bad" : "ok");
  el.textContent = msg;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
