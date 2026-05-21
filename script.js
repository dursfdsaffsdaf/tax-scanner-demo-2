// script.js — Tax Intel Console
// Vanilla JS. No framework. No secrets. No inline event handlers.
// State persisted in URL hash. Acks in localStorage.
"use strict";

const API_URL    = "/api/tax-intel";
const REFRESH_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const ACK_KEY    = "txintel_acked_v2";
const PORD       = { HIGH:0, MEDIUM:1, LOW:2 };
const JURIDS     = ["ALL","AU","IN","ID","VN","JP","SG","MY"];
const AUTH       = { AU:"ATO",IN:"CBIC",ID:"DGT",VN:"GDT",JP:"NTA",SG:"IRAS",MY:"LHDN" };

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  news:       [],
  deadlines:  [],
  meta:       null,
  filter:     "ALL",
  view:       "action",     // "action" | "intel"
  timeWindow: "all",        // "7d" | "30d" | "all"
  search:     "",
  loading:    true,
  error:      null,
  lastFetch:  null,
  acked:      new Set(JSON.parse(localStorage.getItem(ACK_KEY) || "[]")),
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  content:      $("content"),
  statusDot:    $("status-dot"),
  lastUpdated:  $("last-updated"),
  alertBadge:   $("alert-badge"),
  alertCount:   $("alert-count"),
  statsBar:     $("stats-bar"),
  metaBar:      $("meta-bar"),
  staleBanner:  $("stale-banner"),
  searchBar:    $("search-bar"),
};

// ── Security: URL validation ──────────────────────────────────────────────────
// Only permit http/https. Returns sanitised href or null.
function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null;
  } catch { return null; }
}

// ── URL hash state ────────────────────────────────────────────────────────────
function readHash() {
  const h = new URLSearchParams(location.hash.replace("#", ""));
  state.filter     = h.get("f")  || "ALL";
  state.view       = h.get("v")  || "action";
  state.timeWindow = h.get("tw") || "all";
}

function writeHash() {
  history.replaceState(null, "", `#f=${state.filter}&v=${state.view}&tw=${state.timeWindow}`);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchData() {
  setStatus("busy");
  state.error = null;
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res  = await fetch(API_URL, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.news      = Array.isArray(data.news)      ? data.news      : [];
    state.deadlines = Array.isArray(data.deadlines) ? data.deadlines : [];
    state.meta      = data.meta || null;
    state.lastFetch = new Date();
    state.loading   = false;
    setStatus("live");
    updateHeader();
    updateMeta();
    checkStaleness();
    render();
  } catch (e) {
    clearTimeout(tid);
    state.loading = false;
    state.error   = e.name === "AbortError" ? "Request timed out (15 s)" : e.message;
    setStatus("error");
    render();
  }
}

// ── Acknowledge ───────────────────────────────────────────────────────────────
function ackId(dl) { return `${dl.jurisdiction}|${dl.deadline}|${dl.tax_type}`; }

function toggleAck(id) {
  state.acked.has(id) ? state.acked.delete(id) : state.acked.add(id);
  localStorage.setItem(ACK_KEY, JSON.stringify([...state.acked]));
  render();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysFrom(ds) {
  if (!ds) return 9999;
  const d = new Date(ds);
  return isNaN(d) ? 9999 : Math.ceil((d - new Date()) / 86_400_000);
}

function urgencyClass(days) {
  if (days < 0)   return "overdue";
  if (days <= 7)  return "urgent";
  if (days <= 30) return "imminent";
  return "scheduled";
}

function fmtDate(ds) {
  if (!ds) return "";
  const d = new Date(ds);
  return isNaN(d) ? ds : d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}

function fmtCountdown(days) {
  if (days < 0)   return "PAST";
  if (days === 0) return "TODAY";
  return `+${days}d`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.round(s/60)}m ago`;
  if (s < 86400) return `${Math.round(s/3600)}h ago`;
  return `${Math.round(s/86400)}d ago`;
}

// HTML escape — no inline event handlers means this is defence-in-depth only
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── Badge builders ────────────────────────────────────────────────────────────
function jBadge(code)  { return `<span class="badge badge-j badge-${esc(code)}">${esc(code)}</span>`; }
function pBadge(p)     { return `<span class="badge badge-p badge-${esc(p)}">${esc(p)}</span>`; }
function chip(t)       { return `<span class="chip">${esc(t)}</span>`; }

// Trust badge: HIGH=OFFICIAL, MEDIUM=ADVISORY, LOW=MEDIA (human-readable labels)
const TRUST_LABEL = { HIGH:"OFFICIAL", MEDIUM:"ADVISORY", LOW:"MEDIA" };
function trustBadge(t) {
  const label = TRUST_LABEL[t] || esc(t);
  return `<span class="badge badge-trust badge-trust-${esc(t)}" title="Source trust: ${esc(t)}">${label}</span>`;
}

// ── Status + header ───────────────────────────────────────────────────────────
function setStatus(s) {
  if (el.statusDot) el.statusDot.className = `status-dot ${s}`;
}

function updateHeader() {
  if (el.lastUpdated && state.lastFetch) {
    el.lastUpdated.textContent =
      `Updated ${state.lastFetch.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}`;
  }
  const highN = state.deadlines.filter(d => d.priority === "HIGH" && daysFrom(d.deadline) <= 30).length
              + state.news.filter(n => n.priority === "HIGH").length;
  if (el.alertBadge) {
    el.alertBadge.classList.toggle("visible", highN > 0);
    if (el.alertCount) el.alertCount.textContent = `${highN} HIGH`;
  }
}

function updateMeta() {
  if (!el.metaBar || !state.meta) return;
  const m = state.meta;
  el.metaBar.textContent = [
    m.fetched_at   ? `Feed: ${timeAgo(m.fetched_at)}` : null,
    m.cached       ? `Cached (+${m.cache_age_s}s)` : "Live",
    m.news_count   != null ? `${m.news_count} items` : null,
    m.deduplicated ? `${m.deduplicated} deduped` : null,
  ].filter(Boolean).join(" · ");
}

// ── Stale feed detection ──────────────────────────────────────────────────────
// >12h → warning   |   >24h → critical
function checkStaleness() {
  if (!el.staleBanner) return;
  const fetchedAt = state.meta?.fetched_at;
  if (!fetchedAt) { el.staleBanner.style.display = "none"; return; }

  const ageH = (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000;

  if (ageH >= 24) {
    el.staleBanner.className = "stale-banner critical";
    el.staleBanner.innerHTML =
      `⚠ Feed data is ${Math.round(ageH)}h old — backend may be down. ` +
      `<button class="banner-retry" data-action="retry">Refresh now</button>`;
    el.staleBanner.style.display = "block";
  } else if (ageH >= 12) {
    el.staleBanner.className = "stale-banner warning";
    el.staleBanner.innerHTML = `⚠ Feed data is ${Math.round(ageH)}h old.`;
    el.staleBanner.style.display = "block";
  } else {
    el.staleBanner.style.display = "none";
  }
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function updateStats() {
  if (!el.statsBar) return;
  const dl   = filterByJ(state.deadlines, "jurisdiction");
  const news = filterByJ(state.news,      "jurisdiction");
  const u7   = dl.filter(d => { const x=daysFrom(d.deadline); return x>=0&&x<=7;    }).length;
  const u30  = dl.filter(d => { const x=daysFrom(d.deadline); return x>7&&x<=30;    }).length;
  const hN   = news.filter(n => n.priority==="HIGH").length;
  el.statsBar.innerHTML = `
    <span class="stat-item">Deadlines: <span class="val">${dl.length}</span></span>
    <span class="stat-divider"></span>
    <span class="stat-item">≤7d: <span class="val ${u7>0?"danger":""}">${u7}</span></span>
    <span class="stat-item">8–30d: <span class="val ${u30>0?"warning":""}">${u30}</span></span>
    <span class="stat-divider"></span>
    <span class="stat-item">Intel: <span class="val">${news.length}</span></span>
    <span class="stat-item">HIGH: <span class="val ${hN>0?"danger":""}">${hN}</span></span>
    ${state.filter!=="ALL"?`<span class="stat-divider"></span><span class="stat-item">Filter: <span class="val">${esc(state.filter)}</span></span>`:""}`;
}

// ── Filtering ─────────────────────────────────────────────────────────────────
function filterByJ(arr, field) {
  return state.filter === "ALL" ? arr : arr.filter(x => x[field] === state.filter);
}

function filterByWindow(items) {
  if (state.timeWindow === "all") return items;
  const limit = state.timeWindow === "7d" ? 7 : 30;
  return items.filter(d => { const x=daysFrom(d.deadline); return x>=-1&&x<=limit; });
}

function filterBySearch(items, fields) {
  const q = state.search.trim().toLowerCase();
  if (!q) return items;
  return items.filter(x => fields.some(f => String(x[f]||"").toLowerCase().includes(q)));
}

// ── Action Board ──────────────────────────────────────────────────────────────
function renderActionBoard() {
  let dl = filterByJ(state.deadlines, "jurisdiction");
  dl = filterByWindow(dl);
  dl = filterBySearch(dl, ["description","tax_type","authority","notes","jurisdiction"]);
  dl.sort((a,b) => new Date(a.deadline) - new Date(b.deadline));

  const groups = { overdue:[], urgent:[], imminent:[], scheduled:[] };
  dl.forEach(d => groups[urgencyClass(daysFrom(d.deadline))].push(d));

  const SECTIONS = [
    { key:"overdue",   label:"OVERDUE — ACTION REQUIRED",    cls:"urgent"    },
    { key:"urgent",    label:"URGENT — ≤ 7 days",            cls:"urgent"    },
    { key:"imminent",  label:"IMMINENT — 8–30 days",         cls:"imminent"  },
    { key:"scheduled", label:"SCHEDULED — > 30 days",        cls:"scheduled" },
  ];

  let html = "";
  SECTIONS.forEach(({ key, label, cls }) => {
    const items = groups[key];
    if (!items.length) return;
    html += `
      <div class="urgency-header">
        <span class="urgency-label ${cls}">${label}</span>
        <span class="urgency-rule ${cls}"></span>
        <span class="section-count">${items.length}</span>
      </div>`;
    items.forEach(d => {
      const days    = daysFrom(d.deadline);
      const urg     = urgencyClass(days);
      const id      = ackId(d);
      const isAcked = state.acked.has(id);
      // No inline onclick — data-ack-id picked up by delegated listener
      html += `
        <div class="dl-card ${urg}${isAcked?" acked":""}">
          <div class="dl-card-meta">
            <span class="dl-countdown ${urg}">${fmtCountdown(days)}</span>
            <span class="dl-date">${fmtDate(d.deadline)}</span>
          </div>
          <div class="dl-card-body">
            <div class="dl-badges">${jBadge(d.jurisdiction)}${chip(d.tax_type)}${d.priority==="HIGH"?pBadge("HIGH"):""}</div>
            <div class="dl-title">${esc(d.description)}</div>
            <div class="dl-meta-row">${esc(d.authority)}${d.period?" · "+esc(d.period):""}</div>
            ${d.notes?`<div class="dl-notes">${esc(d.notes)}</div>`:""}
          </div>
          <div class="dl-card-actions">
            <button class="ack-btn" data-ack-id="${esc(id)}">${isAcked?"✓ done":"mark done"}</button>
          </div>
        </div>`;
    });
  });

  return dl.length
    ? html
    : `<div class="no-results">No deadlines match the current filter${state.search?" / search":""}.</div>`;
}

// ── Intelligence Feed ─────────────────────────────────────────────────────────
function renderIntelFeed() {
  let news = filterByJ(state.news, "jurisdiction");
  news = filterBySearch(news, ["title","summary","source","tags"]);

  if (!news.length) {
    return `<div class="no-results">No intelligence items match the current filter${state.search?" / search":""}.</div>`;
  }

  // Group by jurisdiction
  const byJ = {};
  news.forEach(n => { (byJ[n.jurisdiction] = byJ[n.jurisdiction] || []).push(n); });

  // Fix 4: Sort within each group by priority first, then date descending (newest first)
  Object.values(byJ).forEach(arr =>
    arr.sort((a, b) => {
      const pd = (PORD[a.priority] ?? 1) - (PORD[b.priority] ?? 1);
      return pd !== 0 ? pd : new Date(b.date).getTime() - new Date(a.date).getTime();
    })
  );

  const jOrder = state.filter === "ALL"
    ? JURIDS.slice(1).filter(j => byJ[j]?.length)
    : [state.filter].filter(j => byJ[j]?.length);

  let html = "";
  jOrder.forEach(jCode => {
    const items = byJ[jCode] || [];
    if (!items.length) return;
    html += `
      <div class="intel-group">
        <div class="intel-group-header">
          ${jBadge(jCode)}
          <span class="intel-group-label">${esc(AUTH[jCode]||jCode)}</span>
          <span class="section-count">${items.length}</span>
        </div>`;
    items.forEach(item => {
      const tags  = (item.tags || []).slice(0, 4).map(chip).join("");
      // Fix 2: validate URL before rendering
      const href  = safeUrl(item.url);
      const title = href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`
        : esc(item.title);
      // No inline onclick — data-expandable picked up by delegated listener
      html += `
        <div class="intel-card ${esc(item.priority)}" data-expandable>
          <div class="intel-card-top">
            ${pBadge(item.priority)}
            ${item.trust ? trustBadge(item.trust) : ""}
            ${tags}
            <span class="intel-date">${esc(item.date)}</span>
          </div>
          <div class="intel-title">${title}</div>
          ${item.summary?`<div class="intel-summary">${esc(item.summary)}</div>`:""}
          ${item.source ?`<div class="intel-source">via ${esc(item.source)}</div>`:""}
        </div>`;
    });
    html += `</div>`;
  });
  return html;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  // Sync filter pills
  document.querySelectorAll(".j-btn").forEach(btn => {
    btn.classList.toggle("active",
      btn.dataset.j === state.filter || (state.filter==="ALL" && btn.classList.contains("all"))
    );
  });
  // Sync view toggle
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
  });
  // Sync time window (shown only for action view)
  const twWrap = $("timeWindowFilter");
  if (twWrap) {
    twWrap.style.display = state.view === "action" ? "flex" : "none";
    twWrap.querySelectorAll(".tw-btn").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.tw === state.timeWindow)
    );
  }

  updateStats();

  if (state.loading) {
    el.content.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Fetching intelligence across 7 jurisdictions…</p>
      </div>`;
    return;
  }

  if (state.error && !state.news.length && !state.deadlines.length) {
    el.content.innerHTML = `
      <div class="error-state">
        <strong>Unable to connect to backend</strong><br>${esc(state.error)}
        <br><button class="retry-btn" data-action="retry">Retry</button>
      </div>`;
    return;
  }

  el.content.innerHTML = state.view === "action"
    ? renderActionBoard()
    : renderIntelFeed();
}

// ── Export to CSV ─────────────────────────────────────────────────────────────
function exportCSV() {
  const src  = filterByJ(state.view==="action" ? state.deadlines : state.news, "jurisdiction");
  const rows = state.view === "action"
    ? [["Jurisdiction","Deadline","Description","Tax Type","Authority","Priority","Period","Notes"],
       ...src.map(d=>[d.jurisdiction,d.deadline,d.description,d.tax_type,d.authority,d.priority,d.period||"",d.notes||""])]
    : [["Jurisdiction","Date","Title","Priority","Trust","Tags","Source","URL"],
       ...src.map(n=>[n.jurisdiction,n.date,n.title,n.priority,n.trust||"",(n.tags||[]).join("|"),n.source||"",safeUrl(n.url)||""])];
  const csv  = rows.map(r => r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const a    = Object.assign(document.createElement("a"), {
    href:     URL.createObjectURL(new Blob([csv], { type:"text/csv" })),
    download: `tax-intel-${state.view}-${new Date().toISOString().split("T")[0]}.csv`,
  });
  a.click();
}

// ── Delegated event listeners (Fix 1 — no inline onclick anywhere) ───────────
function setupDelegated() {
  // Content area: ack buttons, intel card expand, retry
  el.content.addEventListener("click", e => {
    // Ack / unack button
    const ackBtn = e.target.closest(".ack-btn[data-ack-id]");
    if (ackBtn) { e.stopPropagation(); toggleAck(ackBtn.dataset.ackId); return; }

    // Intel card toggle expand (but not when clicking a link)
    if (!e.target.closest("a")) {
      const card = e.target.closest(".intel-card[data-expandable]");
      if (card) { card.classList.toggle("expanded"); return; }
    }

    // Retry / refresh buttons
    if (e.target.closest("[data-action='retry']")) { fetchData(); return; }
  });

  // Stale banner retry
  if (el.staleBanner) {
    el.staleBanner.addEventListener("click", e => {
      if (e.target.closest("[data-action='retry']")) fetchData();
    });
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const map = {
      "1": () => { state.view="action";  writeHash(); render(); },
      "2": () => { state.view="intel";   writeHash(); render(); },
      "7": () => { state.timeWindow="7d";  writeHash(); render(); },
      "3": () => { state.timeWindow="30d"; writeHash(); render(); },
      "0": () => { state.filter="ALL";   writeHash(); render(); },
    };
    if (map[e.key]) { map[e.key](); return; }
    if (e.key==="/"||e.key==="f") { el.searchBar?.focus(); e.preventDefault(); }
    if (e.key==="Escape")          { state.search=""; if(el.searchBar)el.searchBar.value=""; render(); }
  });
}

// ── Build static chrome (no inline onclick — use addEventListener) ─────────────
function buildToolbar() {
  const jWrap = $("jurisdictionFilters");
  if (jWrap) {
    jWrap.innerHTML = JURIDS.map(j =>
      `<button class="j-btn${j==="ALL"?" all":""}" data-j="${j}">${j}</button>`
    ).join("");
    jWrap.addEventListener("click", e => {
      const btn = e.target.closest(".j-btn");
      if (btn) { state.filter = btn.dataset.j; writeHash(); render(); }
    });
  }

  const vWrap = $("viewToggle");
  if (vWrap) {
    vWrap.innerHTML = `
      <button class="view-btn" data-view="action">ACTION BOARD</button>
      <button class="view-btn" data-view="intel">INTEL FEED</button>`;
    vWrap.addEventListener("click", e => {
      const btn = e.target.closest(".view-btn");
      if (btn) { state.view = btn.dataset.view; writeHash(); render(); }
    });
  }

  const twWrap = $("timeWindowFilter");
  if (twWrap) {
    twWrap.innerHTML = [
      { tw:"7d", label:"7 Days" }, { tw:"30d", label:"30 Days" }, { tw:"all", label:"All" }
    ].map(({ tw, label }) =>
      `<button class="tw-btn" data-tw="${tw}">${label}</button>`
    ).join("");
    twWrap.addEventListener("click", e => {
      const btn = e.target.closest(".tw-btn");
      if (btn) { state.timeWindow = btn.dataset.tw; writeHash(); render(); }
    });
  }

  // Export (static element in HTML)
  $("export-btn")?.addEventListener("click", exportCSV);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  readHash();
  buildToolbar();
  setupDelegated();
  setupKeyboard();

  if (el.searchBar) {
    el.searchBar.addEventListener("input", e => { state.search = e.target.value; render(); });
  }

  fetchData();
  setInterval(fetchData, REFRESH_MS);
  window.addEventListener("hashchange", () => { readHash(); render(); });
});
