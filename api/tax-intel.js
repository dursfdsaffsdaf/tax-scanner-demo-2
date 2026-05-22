// api/tax-intel.js
// Weekly Claude-generated tax intelligence. No RSS. No noise.
// One Sonnet + web_search call per week, cached by ISO week number.
"use strict";

const { XMLParser } = require("fast-xml-parser");   // kept for deadline XML helpers if needed

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;   // 7 days
const _cache    = { data: null, ts: 0, week: null };

// ISO week key — changes every Monday, triggering fresh generation
function weekKey(d = new Date()) {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const week = Math.ceil(((d - jan4) / 86_400_000 + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Intelligence prompt ───────────────────────────────────────────────────────
const INTEL_SYSTEM = `\
You are a senior tax intelligence analyst for Razer Group — a publicly listed global gaming, \
fintech, and digital payments company. Your job is to identify the most operationally significant \
corporate tax developments from the past 7 days.

RAZER ENTITY FOOTPRINT AND TAX EXPOSURES:
• AU  — MOL AccessPortal Pty Ltd (MOL008): GST, CIT, Pillar Two GIR filer, CGDMTR
• IN  — Razer Online Pvt Ltd: OIDAR GST, WHT, transfer pricing (Deloitte-managed)
• ID  — PT MOL AccessPortal: VAT, WHT Art 21/23/26, CIT, transfer pricing
• VN  — THS Game JSC: VAT, FCT/WHT, CIT, transfer pricing (BDO Vietnam)
• JP  — Razer Gold Japan K.K. (RGJKK): JCT, CIT, Pillar Two QDMTT (enacted Mar 2026)
• SG  — RMS Managed Services Pte Ltd, Razer Online Pte Ltd: GST, WHT, CIT, ECI
• MY  — RMS Reloads Sdn Bhd: SST, CIT, WHT, CP204

PRIORITY TOPICS (always search for these first):
1. Pillar Two / GloBE — QDMTT, IIR, UTPR, transitional safe harbours, GIR/CGDMTR lodgment
2. Digital services tax and e-commerce / platform VAT obligations
3. Transfer pricing — new documentation rules, safe harbour updates, APA developments
4. WHT rate changes, treaty updates, or new treaty positions
5. CIT rate changes, new incentives, or significant enforcement actions affecting tech/payments

STRICT EXCLUSIONS — do NOT include:
• Personal income tax, individual tax disputes, estate or inheritance matters
• Residential property transactions, stamp duty on personal transfers
• Individual enforcement stories (fines on private citizens, pensioners, etc.)
• Generic budget announcements with no specific corporate tax measure identified
• Opinion columns with no new legislative or regulatory development
• Anything that would not affect a Singapore-headquartered multinational

Search the web for current developments, then return ONLY a valid JSON array — no markdown fences, \
no prose, nothing before or after the array:
[{
  "jurisdiction": "AU|IN|ID|VN|JP|SG|MY|GLOBAL",
  "title": "concise factual headline (no clickbait)",
  "date": "YYYY-MM-DD",
  "summary": "2-3 sentences: what changed, effective date if known, impact on corporate taxpayers",
  "razer_relevance": "1 sentence on specific relevance to Razer Group entities or exposures",
  "source": "source name",
  "url": "url or empty string",
  "tags": ["PILLAR2","GST","CIT","WHT","TP","DIGITAL"],
  "trust": "HIGH|MEDIUM|LOW",
  "priority": "HIGH|MEDIUM|LOW"
}]

Trust guide: HIGH = tax authority or OECD; MEDIUM = Big 4 or major law firm; LOW = media or other.
Priority guide: HIGH = enacted/effective/imminent deadline; MEDIUM = draft/consultation; LOW = guidance/interpretation.
Return 5–10 items maximum. Quality over quantity.`;

// ── Generate intelligence via Claude + web search ─────────────────────────────
async function generateIntelligence(apiKey) {
  if (!apiKey) return { items: [], error: "ANTHROPIC_API_KEY not set" };

  let messages = [{
    role: "user",
    content: `Search for the most significant corporate and indirect tax regulatory developments \
from the past 7 days across Australia, India, Indonesia, Vietnam, Japan, Singapore, and Malaysia. \
Prioritise Pillar Two/GloBE developments globally and in these jurisdictions. \
Today is ${new Date().toISOString().split("T")[0]}.`,
  }];

  // web_search_20250305 is a server-side tool — Claude handles searches internally.
  // Loop handles the rare case where stop_reason is tool_use rather than end_turn.
  for (let i = 0; i < 6; i++) {
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system:     INTEL_SYSTEM,
          messages,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
        signal: AbortSignal.timeout(90_000),    // 90s — web search can be slow
      });
    } catch (e) {
      return { items: [], error: `Fetch failed: ${e.message}` };
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { items: [], error: `API ${res.status}: ${err?.error?.message || "unknown"}` };
    }

    const data = await res.json();

    if (data.stop_reason === "end_turn") {
      const text = data.content.filter(b => b.type === "text").map(b => b.text).join("\n");
      return { items: parseIntelJSON(text), error: null };
    }

    if (data.stop_reason === "tool_use") {
      messages = [
        ...messages,
        { role: "assistant", content: data.content },
        {
          role: "user",
          content: data.content
            .filter(b => b.type === "tool_use")
            .map(b => ({ type: "tool_result", tool_use_id: b.id, content: "ok" })),
        },
      ];
      continue;
    }

    break;  // unexpected stop_reason
  }

  return { items: [], error: "Max iterations reached" };
}

function parseIntelJSON(text) {
  try {
    const s = text.replace(/```json|```/g, "").trim();
    const m = s.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// ── Dynamic deadline generation ───────────────────────────────────────────────
// (unchanged — deterministic statutory rules)

const MONTHS_LONG  = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                      "Jul","Aug","Sep","Oct","Nov","Dec"];

function adj(y, m) {
  const mo = ((m % 12) + 12) % 12;
  return { y: y + Math.floor(m / 12), m: mo };
}
function isoDate(y, m, d) {
  const max = new Date(y, m + 1, 0).getDate();
  const day = Math.min(d, max);
  return `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function shortLabel(y, m) { const a=adj(y,m); return `${MONTHS_SHORT[a.m]} ${a.y}`; }
function longLabel(y, m)  { const a=adj(y,m); return `${MONTHS_LONG[a.m]} ${a.y}`;  }
function fyLabel(y)        { return `FY${y-1}–${String(y).slice(-2)}`; }

function generateDeadlines(now = new Date()) {
  const all = [];
  const winStart = new Date(now); winStart.setDate(winStart.getDate() - 7);
  const winEnd   = new Date(now); winEnd.setDate(winEnd.getDate() + 90);
  function push(dl) { const d=new Date(dl.deadline); if(d>=winStart&&d<=winEnd) all.push(dl); }

  for (let mo = -1; mo <= 3; mo++) {
    const Y = now.getFullYear(), M = now.getMonth() + mo;
    const { y, m } = adj(Y, M);
    const { y: py, m: pm } = adj(y, m - 1);

    // ── AU ──
    push({ jurisdiction:"AU", priority:"HIGH", deadline:isoDate(y,m,21),
      description:`Monthly BAS lodgment and payment (${shortLabel(py,pm)})`,
      tax_type:"GST", authority:"ATO", period:shortLabel(py,pm),
      notes:"Monthly reporters. Next business day if weekend/holiday." });
    const qBAS=[{dueM:9,p:"Jul–Sep"},{dueM:1,p:"Oct–Dec"},{dueM:3,p:"Jan–Mar"},{dueM:6,p:"Apr–Jun"}];
    qBAS.forEach(({dueM,p})=>{ if(m===dueM) push({ jurisdiction:"AU", priority:"MEDIUM",
      deadline:isoDate(y,m,28), description:`Quarterly BAS (${p} ${y})`,
      tax_type:"GST", authority:"ATO", period:`${p} ${y}`,
      notes:"Tax agent lodgment may be extended." }); });
    if(m===5) push({ jurisdiction:"AU", priority:"HIGH", deadline:isoDate(y,5,30),
      description:"Pillar Two Global Information Return (GIR) lodgment",
      tax_type:"PILLAR2", authority:"ATO", period:fyLabel(y),
      notes:"MOL AccessPortal Pty Ltd (MOL008). Blocker for CGDMTR (30 Jul)." });
    if(m===6) push({ jurisdiction:"AU", priority:"HIGH", deadline:isoDate(y,6,30),
      description:"Country-by-Country Notification (CGDMTR) lodgment",
      tax_type:"PILLAR2", authority:"ATO", period:fyLabel(y),
      notes:"30 days after GIR. Ensure GIR lodged first." });

    // ── IN ──
    push({ jurisdiction:"IN", priority:"HIGH", deadline:isoDate(y,m,11),
      description:`GSTR-1 outward supplies return (${shortLabel(py,pm)})`,
      tax_type:"GST", authority:"CBIC", period:shortLabel(py,pm), notes:"Monthly filers." });
    push({ jurisdiction:"IN", priority:"HIGH", deadline:isoDate(y,m,20),
      description:`GSTR-3B net tax return and payment (${shortLabel(py,pm)})`,
      tax_type:"GST", authority:"CBIC", period:shortLabel(py,pm), notes:"Includes ITC reconciliation." });
    [{m:5,q:"Q1",pct:"15%"},{m:8,q:"Q2",pct:"45%"},{m:11,q:"Q3",pct:"75%"},{m:2,q:"Q4",pct:"100%"}]
      .forEach(({m:am,q,pct})=>{ if(m===am) push({ jurisdiction:"IN", priority:"MEDIUM",
        deadline:isoDate(y,m,15), description:`Advance tax ${q} instalment — ${pct} of estimated CIT`,
        tax_type:"CIT", authority:"IT Dept",
        period:`${q} FY${m>=3?y:y-1}–${String((m>=3?y:y-1)+1).slice(-2)}`,
        notes:"Applicable if estimated liability > INR 10,000." }); });

    // ── ID ──
    push({ jurisdiction:"ID", priority:"HIGH", deadline:isoDate(y,m,10),
      description:`WHT remittance — Art 21/23/26/4(2) (${shortLabel(py,pm)})`,
      tax_type:"WHT", authority:"DGT", period:shortLabel(py,pm),
      notes:"Art 26 dividends on ROPL flow. Verify DGT-2/3 certificates." });
    push({ jurisdiction:"ID", priority:"HIGH", deadline:isoDate(y,m,20),
      description:`Monthly SPT — VAT and WHT returns (${shortLabel(py,pm)})`,
      tax_type:"VAT", authority:"DGT", period:shortLabel(py,pm),
      notes:"e-Filing via DJP Online. Includes PPN Masa." });

    // ── VN ──
    push({ jurisdiction:"VN", priority:"HIGH", deadline:isoDate(y,m,20),
      description:`VAT monthly return and payment (${shortLabel(py,pm)})`,
      tax_type:"VAT", authority:"GDT", period:shortLabel(py,pm),
      notes:"THS Game JSC. Revenue above VND 50B threshold." });
    push({ jurisdiction:"VN", priority:"HIGH", deadline:isoDate(y,m,20),
      description:`FCT/WHT monthly declaration (${shortLabel(py,pm)})`,
      tax_type:"WHT", authority:"GDT", period:shortLabel(py,pm),
      notes:"ROPL↔THS cross-border payments. 10% CIT, 0% VAT conservative position." });
    [{m:3,q:"Q1"},{m:6,q:"Q2"},{m:9,q:"Q3"},{m:0,q:"Q4"}].forEach(({m:cm,q})=>{
      if(m===cm) push({ jurisdiction:"VN", priority:"MEDIUM", deadline:isoDate(y,m,30),
        description:`CIT provisional payment — ${q} (${y})`,
        tax_type:"CIT", authority:"GDT", period:`${q} ${y}`, notes:"Based on estimated annual profit." }); });

    // ── JP ──
    if(m===4) push({ jurisdiction:"JP", priority:"MEDIUM", deadline:isoDate(y,4,31),
      description:`Corporate tax and JCT return (FY ending March ${y})`,
      tax_type:"CIT", authority:"NTA", period:`FY Mar ${y}`, notes:"2 months after FY end. Confirm RGJKK FY." });
    if(m===5) push({ jurisdiction:"JP", priority:"HIGH", deadline:isoDate(y,5,30),
      description:`Pillar Two QDMTT top-up tax — FY ending April ${y}`,
      tax_type:"PILLAR2", authority:"NTA", period:`FY Apr ${y}`,
      notes:"Enacted Mar 2026. Confirm RGJKK applicability." });

    // ── SG ──
    push({ jurisdiction:"SG", priority:"HIGH", deadline:isoDate(y,m,15),
      description:`Withholding tax payment (${shortLabel(py,pm)} payments)`,
      tax_type:"WHT", authority:"IRAS", period:shortLabel(py,pm), notes:"15th of following month." });
    [{m:3,qL:"Q1 Jan–Mar",py:0},{m:6,qL:"Q2 Apr–Jun",py:0},{m:9,qL:"Q3 Jul–Sep",py:0},{m:0,qL:"Q4 Oct–Dec",py:-1}]
      .forEach(({m:gm,qL,py:pyA})=>{ if(m===gm) push({ jurisdiction:"SG", priority:"HIGH",
        deadline:isoDate(y,m,31), description:`GST F5 quarterly return (${qL} ${y+pyA})`,
        tax_type:"GST", authority:"IRAS", period:`${qL} ${y+pyA}`, notes:"e-Filing via myTax Portal. RMS/ROPL." }); });
    if(m===2) push({ jurisdiction:"SG", priority:"HIGH", deadline:isoDate(y,2,31),
      description:`ECI filing (FY ending December ${y-1})`, tax_type:"CIT", authority:"IRAS",
      period:`FY Dec ${y-1}`, notes:"3 months after FY end. ROPL/RMS entities." });
    if(m===5) push({ jurisdiction:"SG", priority:"MEDIUM", deadline:isoDate(y,5,30),
      description:`ECI filing (FY ending March ${y})`, tax_type:"CIT", authority:"IRAS",
      period:`FY Mar ${y}`, notes:"3 months after FY end." });

    // ── MY ──
    push({ jurisdiction:"MY", priority:"HIGH", deadline:isoDate(y,m,10),
      description:`CP204 monthly CIT instalment payment (${longLabel(y,m)})`,
      tax_type:"CIT", authority:"LHDN", period:longLabel(y,m), notes:"10th of each month." });
    [{m:1,p:"Dec–Jan"},{m:3,p:"Feb–Mar"},{m:5,p:"Apr–May"},{m:7,p:"Jun–Jul"},{m:9,p:"Aug–Sep"},{m:11,p:"Oct–Nov"}]
      .forEach(({m:sm,p})=>{ if(m===sm) push({ jurisdiction:"MY", priority:"HIGH",
        deadline:isoDate(y,m,28), description:`SST-02 return and payment (${p})`,
        tax_type:"SST", authority:"RMCD", period:p, notes:"Bimonthly; 28th of following period. MySST portal." }); });
  }

  const seen = new Set();
  return all
    .filter(d => { const k=`${d.jurisdiction}|${d.deadline}|${d.tax_type}|${d.description.slice(0,35)}`; return seen.has(k)?false:(seen.add(k),true); })
    .sort((a,b) => new Date(a.deadline)-new Date(b.deadline));
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type",                 "application/json");
  res.setHeader("Cache-Control",                "s-maxage=86400, stale-while-revalidate=3600");

  if (req.method === "OPTIONS") return res.status(200).end();

  const now    = new Date();
  const wk     = weekKey(now);
  const force  = req.query.force === "1";
  const apiKey = process.env.ANTHROPIC_API_KEY || "";

  // Cache hit: same week, not forced
  if (!force && _cache.data && _cache.week === wk) {
    return res.status(200).json({
      ..._cache.data,
      meta: { ..._cache.data.meta, cached: true, cache_age_s: Math.round((now - _cache.ts) / 1000) },
    });
  }

  // Generate fresh intelligence
  const deadlines = generateDeadlines(now);
  const { items: news, error: intelError } = await generateIntelligence(apiKey);

  // Next Monday (refresh boundary)
  const nextMonday = new Date(now);
  const daysUntil = (8 - nextMonday.getDay()) % 7 || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntil);
  nextMonday.setHours(0, 0, 0, 0);

  const body = {
    news,
    deadlines,
    meta: {
      fetched_at:     now.toISOString(),
      week:           wk,
      next_refresh:   nextMonday.toISOString(),
      cached:         false,
      cache_age_s:    0,
      news_count:     news.length,
      source:         "claude-sonnet-4-20250514+web_search",
      ...(intelError ? { intel_error: intelError } : {}),
    },
  };

  _cache.data = body;
  _cache.ts   = now;
  _cache.week = wk;

  return res.status(200).json(body);
};
