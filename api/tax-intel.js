// api/tax-intel.js — Production backend
// Dynamic deadline generation · 6h cache · Deduplication · Trust classification
"use strict";

const { XMLParser } = require("fast-xml-parser");

// ── Constants ─────────────────────────────────────────────────────────────────
const CACHE_TTL = 6 * 60 * 60 * 1000;   // 6 h
const _cache    = { data: null, ts: 0 };

const PARSER = new XMLParser({
  ignoreAttributes: true,
  allowBooleanAttributes: true,
});

const QUERIES = {
  AU: { q: "ATO Australia tax update 2026",              gl: "AU" },
  IN: { q: "India CBIC GST income tax update 2026",      gl: "IN" },
  ID: { q: "Indonesia DGT pajak tax regulation 2026",    gl: "ID" },
  VN: { q: "Vietnam GDT tax VAT corporate 2026",         gl: "VN" },
  JP: { q: "Japan NTA consumption tax reform 2026",      gl: "JP" },
  SG: { q: "Singapore IRAS GST tax alert 2026",          gl: "SG" },
  MY: { q: "Malaysia LHDN SST tax update 2026",          gl: "MY" },
};

// ── Date helpers ──────────────────────────────────────────────────────────────
const MONTHS_LONG  = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                       "Jul","Aug","Sep","Oct","Nov","Dec"];

function adj(y, m) {
  // Normalize potentially out-of-range month values
  const mo = ((m % 12) + 12) % 12;
  return { y: y + Math.floor(m / 12), m: mo };
}

function isoDate(y, m, d) {
  // Clamp d to valid days in the month
  const maxDay = new Date(y, m + 1, 0).getDate();
  const clamped = Math.min(d, maxDay);
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(clamped).padStart(2,"0")}`;
}

function shortLabel(y, m) {
  const a = adj(y, m);
  return `${MONTHS_SHORT[a.m]} ${a.y}`;
}

function longLabel(y, m) {
  const a = adj(y, m);
  return `${MONTHS_LONG[a.m]} ${a.y}`;
}

function fyLabel(y, startMo = 6) {
  // Australian FY: July Y-1 → June Y
  // startMo=6 → Jul = FY starts, so FY label is "FY{y-1}–{yy}"
  if (startMo === 6) return `FY${y-1}–${String(y).slice(-2)}`;
  return `FY${y}`;
}

// ── Dynamic deadline generation ───────────────────────────────────────────────
// Generates a rolling 90-day window (7 days past → 83 days future).
// All rules are statutory; no hardcoded calendar months.
function generateDeadlines(now = new Date()) {
  const all = [];
  const winStart = new Date(now); winStart.setDate(winStart.getDate() - 7);
  const winEnd   = new Date(now); winEnd.setDate(winEnd.getDate() + 90);

  function push(dl) {
    const d = new Date(dl.deadline);
    if (d >= winStart && d <= winEnd) all.push(dl);
  }

  // Iterate over current month −1 … +3 to ensure the window is covered
  for (let mo = -1; mo <= 3; mo++) {
    const Y  = now.getFullYear();
    const M  = now.getMonth() + mo;   // may be < 0 or > 11
    const { y, m } = adj(Y, M);       // normalised
    const { y: py, m: pm } = adj(y, m - 1); // prior month

    // ── AUSTRALIA ────────────────────────────────────────────────────────────
    // Monthly BAS (prior month period): 21st of this month
    push({
      jurisdiction: "AU", priority: "HIGH",
      deadline: isoDate(y, m, 21),
      description: `Monthly BAS lodgment and payment (${shortLabel(py, pm)})`,
      tax_type: "GST", authority: "ATO",
      period: shortLabel(py, pm),
      notes: "Monthly GST reporters. Moves to next business day if falls on weekend/holiday.",
    });

    // Quarterly BAS: due month → (quarter-end month + 1), 28th
    // AU FY quarters: Jul–Sep (due 28 Oct), Oct–Dec (due 28 Feb), Jan–Mar (due 28 Apr), Apr–Jun (due 28 Jul)
    const qBAS = [
      { dueM: 9,  periodLabel: "Jul–Sep" },  // Oct
      { dueM: 1,  periodLabel: "Oct–Dec" },  // Feb (use last day)
      { dueM: 3,  periodLabel: "Jan–Mar" },  // Apr
      { dueM: 6,  periodLabel: "Apr–Jun" },  // Jul
    ];
    qBAS.forEach(({ dueM, periodLabel }) => {
      if (m === dueM) {
        push({
          jurisdiction: "AU", priority: "MEDIUM",
          deadline: isoDate(y, m, 28),
          description: `Quarterly BAS lodgment and payment (${periodLabel} ${y})`,
          tax_type: "GST", authority: "ATO",
          period: `${periodLabel} ${y}`,
          notes: "Tax agent clients may qualify for extended due dates.",
        });
      }
    });

    // Pillar Two GIR: 30 June each year (for prior AU FY)
    if (m === 5) {
      push({
        jurisdiction: "AU", priority: "HIGH",
        deadline: isoDate(y, 5, 30),
        description: "Pillar Two Global Information Return (GIR) lodgment",
        tax_type: "PILLAR2", authority: "ATO",
        period: fyLabel(y),
        notes: "MOL AccessPortal Pty Ltd (MOL008) obligation as Group Entity. Blocker for CGDMTR.",
      });
    }

    // CGDMTR: 30 July each year (30 days after GIR)
    if (m === 6) {
      push({
        jurisdiction: "AU", priority: "HIGH",
        deadline: isoDate(y, 6, 30),
        description: "Country-by-Country Notification (CGDMTR) lodgment",
        tax_type: "PILLAR2", authority: "ATO",
        period: fyLabel(y),
        notes: "Due 30 days after GIR lodgment. Ensure GIR lodged first (30 Jun).",
      });
    }

    // ── INDIA ────────────────────────────────────────────────────────────────
    // GSTR-1: 11th of month for prior month
    push({
      jurisdiction: "IN", priority: "HIGH",
      deadline: isoDate(y, m, 11),
      description: `GSTR-1 outward supplies return (${shortLabel(py, pm)})`,
      tax_type: "GST", authority: "CBIC",
      period: shortLabel(py, pm),
      notes: "Monthly filers. E-filing mandatory via GST portal.",
    });

    // GSTR-3B: 20th of month for prior month
    push({
      jurisdiction: "IN", priority: "HIGH",
      deadline: isoDate(y, m, 20),
      description: `GSTR-3B net tax return and payment (${shortLabel(py, pm)})`,
      tax_type: "GST", authority: "CBIC",
      period: shortLabel(py, pm),
      notes: "Monthly filers. Includes ITC claim reconciliation.",
    });

    // Advance tax quarterly (Indian FY Apr–Mar): 15 Jun / 15 Sep / 15 Dec / 15 Mar
    const advTax = [
      { m: 5,  q: "Q1", pct: "15%"  },
      { m: 8,  q: "Q2", pct: "45%"  },
      { m: 11, q: "Q3", pct: "75%"  },
      { m: 2,  q: "Q4", pct: "100%" },
    ];
    advTax.forEach(({ m: am, q, pct }) => {
      if (m === am) {
        const indFY = m >= 3 ? y : y - 1;
        push({
          jurisdiction: "IN", priority: "MEDIUM",
          deadline: isoDate(y, m, 15),
          description: `Advance tax ${q} instalment — ${pct} of estimated CIT liability`,
          tax_type: "CIT", authority: "IT Dept",
          period: `${q} FY${indFY}–${String(indFY+1).slice(-2)}`,
          notes: "Applicable if estimated tax liability exceeds INR 10,000.",
        });
      }
    });

    // ── INDONESIA ────────────────────────────────────────────────────────────
    // WHT remittance: 10th of month for prior month
    push({
      jurisdiction: "ID", priority: "HIGH",
      deadline: isoDate(y, m, 10),
      description: `WHT remittance — Art 21/23/26/4(2) (${shortLabel(py, pm)})`,
      tax_type: "WHT", authority: "DGT",
      period: shortLabel(py, pm),
      notes: "Art 26 dividends on ROPL flow. Verify DGT-2/3 certificates current.",
    });

    // Monthly SPT (VAT + WHT return): 20th of month for prior month
    push({
      jurisdiction: "ID", priority: "HIGH",
      deadline: isoDate(y, m, 20),
      description: `Monthly SPT lodgment — VAT and WHT returns (${shortLabel(py, pm)})`,
      tax_type: "VAT", authority: "DGT",
      period: shortLabel(py, pm),
      notes: "e-Filing via DJP Online. Includes PPN Masa VAT self-assessment.",
    });

    // ── VIETNAM ──────────────────────────────────────────────────────────────
    // VAT monthly: 20th of month for prior month
    push({
      jurisdiction: "VN", priority: "HIGH",
      deadline: isoDate(y, m, 20),
      description: `VAT monthly return and payment (${shortLabel(py, pm)})`,
      tax_type: "VAT", authority: "GDT",
      period: shortLabel(py, pm),
      notes: "THS Game JSC. Revenue above VND 50B threshold; e-filing mandatory.",
    });

    // FCT/WHT monthly: 20th of month for prior month
    push({
      jurisdiction: "VN", priority: "HIGH",
      deadline: isoDate(y, m, 20),
      description: `FCT/WHT monthly declaration (${shortLabel(py, pm)})`,
      tax_type: "WHT", authority: "GDT",
      period: shortLabel(py, pm),
      notes: "Cross-border payments ROPL↔THS. Conservative FCT: 10% CIT, 0% VAT.",
    });

    // CIT provisional quarterly: 30 Apr (Q1), 30 Jul (Q2), 30 Oct (Q3), 30 Jan (Q4)
    const vnCIT = [
      { m: 3,  q: "Q1" }, { m: 6,  q: "Q2" },
      { m: 9,  q: "Q3" }, { m: 0,  q: "Q4" },
    ];
    vnCIT.forEach(({ m: cm, q }) => {
      if (m === cm) {
        push({
          jurisdiction: "VN", priority: "MEDIUM",
          deadline: isoDate(y, m, 30),
          description: `CIT provisional payment — ${q} (${y})`,
          tax_type: "CIT", authority: "GDT",
          period: `${q} ${y}`,
          notes: "Provisional quarterly CIT. Based on estimated annual profit.",
        });
      }
    });

    // ── JAPAN ────────────────────────────────────────────────────────────────
    // Corporate tax + JCT: 2 months after FY end (March FY → May 31)
    if (m === 4) {
      push({
        jurisdiction: "JP", priority: "MEDIUM",
        deadline: isoDate(y, 4, 31),
        description: `Corporate tax and JCT return (FY ending March ${y})`,
        tax_type: "CIT", authority: "NTA",
        period: `FY Mar ${y}`,
        notes: "2 months after FY end. Confirm RGJKK FY end date.",
      });
    }

    // Pillar Two QDMTT: with CIT for April FY-end entities (extended Jun 30)
    if (m === 5) {
      push({
        jurisdiction: "JP", priority: "HIGH",
        deadline: isoDate(y, 5, 30),
        description: `Pillar Two QDMTT top-up tax — FY ending April ${y}`,
        tax_type: "PILLAR2", authority: "NTA",
        period: `FY Apr ${y}`,
        notes: "FY2026 Japan tax reform enacted March 2026. Check RGJKK applicability.",
      });
    }

    // ── SINGAPORE ────────────────────────────────────────────────────────────
    // WHT: 15th of month for prior month payments
    push({
      jurisdiction: "SG", priority: "HIGH",
      deadline: isoDate(y, m, 15),
      description: `Withholding tax payment (${shortLabel(py, pm)} payments)`,
      tax_type: "WHT", authority: "IRAS",
      period: shortLabel(py, pm),
      notes: "15th of following month. File IR37/IR37A if applicable.",
    });

    // GST F5 quarterly (1 month after quarter end):
    // Q1 Jan–Mar → 30 Apr | Q2 Apr–Jun → 31 Jul | Q3 Jul–Sep → 31 Oct | Q4 Oct–Dec → 31 Jan
    const sgGST = [
      { m: 3, qLabel: "Q1 Jan–Mar", py: 0 },
      { m: 6, qLabel: "Q2 Apr–Jun", py: 0 },
      { m: 9, qLabel: "Q3 Jul–Sep", py: 0 },
      { m: 0, qLabel: "Q4 Oct–Dec", py: -1 },  // due Jan, period in prior year
    ];
    sgGST.forEach(({ m: gm, qLabel, py: pyAdj }) => {
      if (m === gm) {
        push({
          jurisdiction: "SG", priority: "HIGH",
          deadline: isoDate(y, m, 31),    // clamped to last day
          description: `GST F5 quarterly return (${qLabel} ${y + pyAdj})`,
          tax_type: "GST", authority: "IRAS",
          period: `${qLabel} ${y + pyAdj}`,
          notes: "e-Filing via myTax Portal. RMS/ROPL entities.",
        });
      }
    });

    // ECI: 3 months after FY end — Dec FY end → Mar 31
    if (m === 2) {
      push({
        jurisdiction: "SG", priority: "HIGH",
        deadline: isoDate(y, 2, 31),
        description: `ECI filing (FY ending December ${y - 1})`,
        tax_type: "CIT", authority: "IRAS",
        period: `FY Dec ${y - 1}`,
        notes: "3 months after FY end. Mandatory e-filing. ROPL/RMS entities.",
      });
    }
    // Mar FY end → Jun 30
    if (m === 5) {
      push({
        jurisdiction: "SG", priority: "MEDIUM",
        deadline: isoDate(y, 5, 30),
        description: `ECI filing (FY ending March ${y})`,
        tax_type: "CIT", authority: "IRAS",
        period: `FY Mar ${y}`,
        notes: "3 months after FY end. Mandatory e-filing.",
      });
    }

    // ── MALAYSIA ─────────────────────────────────────────────────────────────
    // CP204 monthly instalment: 10th of each month
    push({
      jurisdiction: "MY", priority: "HIGH",
      deadline: isoDate(y, m, 10),
      description: `CP204 monthly CIT instalment payment (${longLabel(y, m)})`,
      tax_type: "CIT", authority: "LHDN",
      period: longLabel(y, m),
      notes: "10th of each month. Ensure CP204 estimated liability is current.",
    });

    // SST-02 bimonthly: due 28th of month following 2-month period end
    // Periods & due months: Dec–Jan→Feb | Feb–Mar→Apr | Apr–May→Jun | Jun–Jul→Aug | Aug–Sep→Oct | Oct–Nov→Dec
    const sst = [
      { m: 1,  period: "Dec–Jan" }, { m: 3,  period: "Feb–Mar" },
      { m: 5,  period: "Apr–May" }, { m: 7,  period: "Jun–Jul" },
      { m: 9,  period: "Aug–Sep" }, { m: 11, period: "Oct–Nov" },
    ];
    sst.forEach(({ m: sm, period }) => {
      if (m === sm) {
        push({
          jurisdiction: "MY", priority: "HIGH",
          deadline: isoDate(y, m, 28),
          description: `SST-02 return and payment (${period})`,
          tax_type: "SST", authority: "RMCD",
          period,
          notes: "Bimonthly; 28th of following period end. File via MySST portal.",
        });
      }
    });
  }

  // Deduplicate (same J + deadline + tax_type + first 35 chars of description)
  const seen = new Set();
  return all
    .filter(d => {
      const k = `${d.jurisdiction}|${d.deadline}|${d.tax_type}|${d.description.slice(0, 35)}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
}

// ── News helpers ──────────────────────────────────────────────────────────────
function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
}

function parseIsoDate(raw) {
  const d = raw ? new Date(raw) : null;
  return (d && !isNaN(d)) ? d.toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
}

function inferPriority(text) {
  const t = String(text || "").toLowerCase();
  if (/enacted|new law|new rate|reform|penalty|enforcement|mandatory|\bdeadline\b|pillar.?two|qdmtt|\butpr\b|\biir\b/.test(t)) return "HIGH";
  if (/draft|proposed?|consultation|discussion paper/.test(t)) return "LOW";
  return "MEDIUM";
}

function inferTags(text) {
  const t = String(text || "").toLowerCase();
  const tags = [];
  if (/\bgst\b|vat|consumption.?tax|\bjct\b|\bsst\b/.test(t))           tags.push("GST");
  if (/corporate.?tax|\bcit\b|income.?tax/.test(t))                      tags.push("CIT");
  if (/withhold|\bwht\b|withholding/.test(t))                            tags.push("WHT");
  if (/transfer.?pric|arm.?length/.test(t))                              tags.push("TP");
  if (/pillar.?two|pillar.?2|\bglobe\b|qdmtt|\biir\b|\butpr\b/.test(t)) tags.push("PILLAR2");
  if (/digital|e.?commerce|platform|crypto|fintech/.test(t))             tags.push("DIGITAL");
  return tags.length ? tags : ["OTHER"];
}

// ── Source trust scoring ──────────────────────────────────────────────────────
// Returns HIGH | MEDIUM | LOW
// HIGH  = tax authority / OECD / intergovernmental body
// MEDIUM = Big 4, major law firms, established advisory firms
// LOW   = media, blogs, aggregators, unknown
function classifyTrust(source, url) {
  const s = (String(source || "") + " " + String(url || "")).toLowerCase();
  if (/\.gov\.au|ato\.gov|iras\.gov\.sg|cbic\.gov\.in|pajak\.go\.id|nta\.go\.jp|gdt\.gov\.vn|hasil\.gov\.my|customs\.gov\.my|mof\.go\.jp|treasury\.gov|oecd\.org|imf\.org|worldbank\.org|un\.org/.test(s))
    return "HIGH";
  if (/deloitte|kpmg|pwc|pricewaterhouse|ernst.young|\bey\.com\b|baker.mckenzie|linklaters|clifford.chance|freshfields|allen.overy|norton.rose|mayer.brown|rajah.tann|tricor|crowe|bdo|grant.thornton|withersworldwide/.test(s))
    return "MEDIUM";
  return "LOW";
}

// ── Deduplication (Jaccard similarity on normalised title tokens) ─────────────
function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")   // remove all punctuation
    .replace(/\s+/g, " ")        // collapse whitespace
    .trim();
}

function tokenize(s) {
  return new Set(normalizeTitle(s).split(" ").filter(w => w.length > 3));
}

function jaccard(a, b) {
  const sa = tokenize(a), sb = tokenize(b);
  if (!sa.size || !sb.size) return 0;
  const inter = [...sa].filter(w => sb.has(w)).length;
  return inter / (sa.size + sb.size - inter);
}

function deduplicateNews(items) {
  const out = [];
  for (const item of items) {
    const isDup = out.some(r =>
      (r.url && item.url && r.url === item.url) ||
      jaccard(r.title, item.title) > 0.65
    );
    if (!isDup) out.push(item);
  }
  return out;
}

// ── RSS fetch (Google News) ───────────────────────────────────────────────────
async function fetchJurisdiction(code, cfg) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q",    cfg.q);
  url.searchParams.set("hl",   "en");
  url.searchParams.set("gl",   cfg.gl);
  url.searchParams.set("ceid", `${cfg.gl}:en`);

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];

  const xml  = await res.text();
  const doc  = PARSER.parse(xml);
  const raw  = doc?.rss?.channel?.item ?? [];
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  return items.slice(0, 5).map(item => {
    const titleRaw = String(item.title  || "");
    const title    = titleRaw.replace(/\s+-\s+[^-]*$/, "").trim();
    const summary  = stripHtml(item.description);
    const src      = String(
      typeof item.source === "object" ? (item.source["#text"] || "") : (item.source || "")
    );
    const link     = String(item.link || "");
    return {
      jurisdiction: code,
      title:   title || "Untitled",
      date:    parseIsoDate(item.pubDate),
      summary,
      source:  src,
      trust:   classifyTrust(src, link),
      url:     link,
      tags:    inferTags(`${title} ${summary}`),
      priority: inferPriority(`${title} ${summary}`),
    };
  });
}

// ── Optional single-pass Haiku summarization ──────────────────────────────────
async function enrichSummaries(items, apiKey) {
  if (!apiKey || !items.length) return items;
  const block = items.map((it, i) => `${i + 1}. [${it.jurisdiction}] ${it.title}`).join("\n");
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        system: "Tax news summarizer. Return ONLY a JSON array: " +
                "[{\"idx\":1,\"summary\":\"≤25 words\",\"priority\":\"HIGH|MEDIUM|LOW\"}]. No markdown.",
        messages: [{ role: "user", content: block }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return items;
    const d    = await res.json().catch(() => ({}));
    const text = d.content?.find(b => b.type === "text")?.text || "[]";
    const enriched = JSON.parse(text);
    return items.map((it, i) => {
      const e = enriched.find(x => x.idx === i + 1);
      return e ? { ...it, summary: e.summary || it.summary, priority: e.priority || it.priority } : it;
    });
  } catch { return items; }
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type",                 "application/json");
  // CDN-level caching: serve stale up to 6 h, revalidate in background
  res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=3600");

  if (req.method === "OPTIONS") return res.status(200).end();

  const now = new Date();

  // Module-level cache hit
  if (_cache.data && now.getTime() - _cache.ts < CACHE_TTL) {
    const cached = { ..._cache.data, meta: { ..._cache.data.meta, cached: true, cache_age_s: Math.round((now.getTime() - _cache.ts) / 1000) } };
    return res.status(200).json(cached);
  }

  try {
    const results = await Promise.allSettled(
      Object.entries(QUERIES).map(([code, cfg]) => fetchJurisdiction(code, cfg))
    );

    let rawNews = results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    const beforeDedup = rawNews.length;
    rawNews = deduplicateNews(rawNews);
    const deduped = beforeDedup - rawNews.length;

    rawNews = await enrichSummaries(rawNews, process.env.ANTHROPIC_API_KEY);

    const deadlines = generateDeadlines(now);

    const body = {
      news:      rawNews,
      deadlines,
      meta: {
        fetched_at:     now.toISOString(),
        cached:         false,
        cache_age_s:    0,
        news_count:     rawNews.length,
        deadline_count: deadlines.length,
        deduplicated:   deduped,
      },
    };

    _cache.data = body;
    _cache.ts   = now.getTime();

    return res.status(200).json(body);
  } catch (err) {
    // Always return valid JSON with static deadlines as fallback
    const deadlines = generateDeadlines(now);
    return res.status(200).json({
      news: [], deadlines,
      meta: { fetched_at: now.toISOString(), cached: false, cache_age_s: 0,
              news_count: 0, deadline_count: deadlines.length, deduplicated: 0, error: err.message },
    });
  }
};
