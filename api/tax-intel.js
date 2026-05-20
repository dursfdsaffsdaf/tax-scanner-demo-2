// ─── api/tax-intel.js ────────────────────────────────────────────────────────
// Vercel Serverless Function (Node 18+).
// Also works as an Express route: router.get('/api/tax-intel', handler)
//
// Dependencies (package.json):
//   { "dependencies": { "fast-xml-parser": "^4.3.0" } }
//
// Env vars (Vercel dashboard / .env):
//   ANTHROPIC_API_KEY  — optional; enables one-shot Haiku summarization
//
// Deploy: push to Vercel, set env vars, done.
// Local:  node -e "require('./api/tax-intel').default({},{setHeader:()=>{},status:()=>({json:console.log})})"
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const { XMLParser } = require("fast-xml-parser");

// ── Cache (module-level; survives warm Lambda invocations) ───────────────────
const CACHE_TTL = 6 * 60 * 60 * 1000;          // 6 h
const _cache    = { data: null, ts: 0 };

// ── XML parser (reused across calls) ─────────────────────────────────────────
const PARSER = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
});

// ── Google News RSS queries ───────────────────────────────────────────────────
// Using Google News RSS: deterministic, no auth, no browser automation.
// Each query targets English-language results for that jurisdiction.
const QUERIES = {
  AU: { q:"ATO Australia tax update 2026",                 gl:"AU" },
  IN: { q:"India CBIC GST income tax update 2026",         gl:"IN" },
  ID: { q:"Indonesia DGT pajak tax regulation 2026",       gl:"ID" },
  VN: { q:"Vietnam GDT tax VAT corporate 2026",            gl:"VN" },
  JP: { q:"Japan NTA consumption tax reform 2026",         gl:"JP" },
  SG: { q:"Singapore IRAS GST tax alert 2026",             gl:"SG" },
  MY: { q:"Malaysia LHDN SST tax update 2026",             gl:"MY" },
};

// ── Deterministic June 2026 deadline database ────────────────────────────────
// Statutory rules encoded directly — no scraping, no AI, always correct.
// Deadlines are tailored to Razer Group's entity portfolio.
const JUNE_DEADLINES = [
  // AUSTRALIA
  { jurisdiction:"AU", deadline:"2026-06-21", description:"Monthly BAS lodgment and payment (May 2026)",
    tax_type:"GST",     authority:"ATO",   priority:"HIGH",   period:"May 2026",
    notes:"For monthly GST reporters. Moves to next business day if falls on weekend." },
  { jurisdiction:"AU", deadline:"2026-06-30", description:"Pillar Two Global Information Return (GIR) lodgment",
    tax_type:"PILLAR2", authority:"ATO",   priority:"HIGH",   period:"FY2024-25",
    notes:"MOL AccessPortal Pty Ltd (MOL008) obligation as Group Entity. Hard blocker for CGDMTR (due 30 Jul)." },
  // INDIA
  { jurisdiction:"IN", deadline:"2026-06-11", description:"GSTR-1 outward supplies return (May 2026)",
    tax_type:"GST",     authority:"CBIC",  priority:"HIGH",   period:"May 2026",
    notes:"Monthly filers. E-filing mandatory via GST portal." },
  { jurisdiction:"IN", deadline:"2026-06-20", description:"GSTR-3B net tax payment and return (May 2026)",
    tax_type:"GST",     authority:"CBIC",  priority:"HIGH",   period:"May 2026",
    notes:"Monthly filers. Includes ITC claim reconciliation." },
  { jurisdiction:"IN", deadline:"2026-06-15", description:"Advance tax Q1 instalment — 15% of estimated CIT (FY2026-27)",
    tax_type:"CIT",     authority:"IT Dept", priority:"MEDIUM", period:"Q1 FY2026-27",
    notes:"Applicable if estimated liability exceeds INR 10,000." },
  // INDONESIA
  { jurisdiction:"ID", deadline:"2026-06-10", description:"WHT remittance — Art 21/23/26/4(2) (May 2026)",
    tax_type:"WHT",     authority:"DGT",   priority:"HIGH",   period:"May 2026",
    notes:"Art 26 dividends on ROPL flow one month in arrears. Verify DGT-2/3 certificates current." },
  { jurisdiction:"ID", deadline:"2026-06-20", description:"Monthly SPT lodgment — VAT and WHT returns (May 2026)",
    tax_type:"VAT",     authority:"DGT",   priority:"HIGH",   period:"May 2026",
    notes:"e-Filing via DJP Online. Includes 11/12 VAT SA adjustment. Preparer: Rahmah Ayu." },
  // VIETNAM
  { jurisdiction:"VN", deadline:"2026-06-20", description:"VAT monthly return and payment (May 2026)",
    tax_type:"VAT",     authority:"GDT",   priority:"HIGH",   period:"May 2026",
    notes:"Applies to THS Game JSC (revenue above VND 50B threshold)." },
  { jurisdiction:"VN", deadline:"2026-06-20", description:"FCT/WHT monthly declaration (May 2026)",
    tax_type:"WHT",     authority:"GDT",   priority:"HIGH",   period:"May 2026",
    notes:"Covers cross-border payments ROPL↔THS. Conservative FCT position: 10% CIT, 0% VAT." },
  { jurisdiction:"VN", deadline:"2026-06-30", description:"TP Local File — BDO Vietnam internal review deadline",
    tax_type:"TP",      authority:"GDT",   priority:"HIGH",   period:"FY2025",
    notes:"BDO draft expected 28–29 May. FAR interview 13–14 May. Sign-off with Minna before lodgment." },
  // JAPAN
  { jurisdiction:"JP", deadline:"2026-06-30", description:"JCT provisional return (FY ending April 2026)",
    tax_type:"JCT",     authority:"NTA",   priority:"MEDIUM", period:"FY Apr 2026",
    notes:"Check RGJKK FY end. Includes QDMTT top-up if Pillar Two QDMTT applies to RGJKK." },
  // SINGAPORE
  { jurisdiction:"SG", deadline:"2026-06-15", description:"Withholding tax payment (May 2026 payments)",
    tax_type:"WHT",     authority:"IRAS",  priority:"HIGH",   period:"May 2026",
    notes:"15th of following month. File IR37 if applicable. Consider RMS Private Ruling WHT implications." },
  { jurisdiction:"SG", deadline:"2026-06-30", description:"ECI filing (FY ending March 2026)",
    tax_type:"CIT",     authority:"IRAS",  priority:"HIGH",   period:"FY Mar 2026",
    notes:"Within 3 months of FY end. Mandatory e-filing via myTax Portal. ROPL/RMS entities." },
  // MALAYSIA
  { jurisdiction:"MY", deadline:"2026-06-10", description:"CP204 monthly CIT instalment payment",
    tax_type:"CIT",     authority:"LHDN",  priority:"HIGH",   period:"June 2026",
    notes:"10th of each month. Confirm estimated CIT liability is current." },
  { jurisdiction:"MY", deadline:"2026-06-28", description:"SST-02 return and payment (Apr–May 2026 bimonthly period)",
    tax_type:"SST",     authority:"RMCD",  priority:"HIGH",   period:"Apr–May 2026",
    notes:"Bimonthly; 28th of following period end. File via MySST portal. RMS Reloads entity." },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function stripHtml(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
}

function parseDate(raw) {
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
  if (/\bgst\b|vat|consumption.?tax|\bjct\b|\bsst\b/.test(t))               tags.push("GST");
  if (/corporate.?tax|\bcit\b|income.?tax/.test(t))                          tags.push("CIT");
  if (/withhold|\bwht\b|withholding/.test(t))                                tags.push("WHT");
  if (/transfer.?pric|arm.?length/.test(t))                                  tags.push("TP");
  if (/pillar.?two|pillar.?2|\bglobe\b|qdmtt|\biir\b|\butpr\b/.test(t))     tags.push("PILLAR2");
  if (/digital|e.?commerce|platform|crypto|fintech/.test(t))                 tags.push("DIGITAL");
  return tags.length ? tags : ["OTHER"];
}

// ── RSS fetch (Google News) ───────────────────────────────────────────────────
async function fetchJurisdiction(code, cfg) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q",    cfg.q);
  url.searchParams.set("hl",   "en");
  url.searchParams.set("gl",   cfg.gl);
  url.searchParams.set("ceid", `${cfg.gl}:en`);

  const res = await fetch(url.toString(), {
    headers: { "Accept": "application/rss+xml, application/xml, text/xml, */*" },
    signal:  AbortSignal.timeout(8_000),
  });

  if (!res.ok) return [];

  const xml  = await res.text();
  const doc  = PARSER.parse(xml);
  const raw  = doc?.rss?.channel?.item ?? [];
  const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  return items.slice(0, 5).map(item => {
    const titleRaw = String(item.title  || "");
    const descRaw  = String(item.description || "");
    const title    = titleRaw.replace(/\s+-\s+[^-]*$/, "").trim();   // strip "- Source Name"
    const summary  = stripHtml(descRaw);
    const combined = `${title} ${summary}`;
    const src      = typeof item.source === "object"
                       ? String(item.source["#text"] || item.source["@_url"] || "")
                       : String(item.source || "");
    return {
      jurisdiction: code,
      title:        title || "Untitled",
      date:         parseDate(item.pubDate),
      summary,
      source:       src,
      url:          String(item.link || ""),
      tags:         inferTags(combined),
      priority:     inferPriority(combined),
    };
  });
}

// ── Optional: one-shot Haiku summarization ────────────────────────────────────
// Runs only if ANTHROPIC_API_KEY is set. One call, all jurisdictions, max 1200 tok.
// Falls back silently — raw titles/snippets are still shown without it.
async function enrichSummaries(items, apiKey) {
  if (!apiKey || items.length === 0) return items;

  const block = items
    .map((it, i) => `${i + 1}. [${it.jurisdiction}] ${it.title}`)
    .join("\n");

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
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        system:     "Tax news summarizer for a multinational. Input: numbered headlines. "
                  + "Output: JSON array ONLY — [{\"idx\":1,\"summary\":\"≤25 words\",\"priority\":\"HIGH|MEDIUM|LOW\"}]. "
                  + "No markdown, no prose, no explanation.",
        messages: [{ role:"user", content:block }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { return items; }   // timeout or network error — return raw items

  if (!res.ok) return items;

  const d    = await res.json().catch(() => ({}));
  const text = d.content?.find(b => b.type === "text")?.text ?? "[]";

  let enriched;
  try { enriched = JSON.parse(text); } catch { return items; }

  return items.map((it, i) => {
    const e = enriched.find(x => x.idx === i + 1);
    return e
      ? { ...it, summary: e.summary || it.summary, priority: e.priority || it.priority }
      : it;
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type",                 "application/json");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Cache hit — return immediately
  if (_cache.data && Date.now() - _cache.ts < CACHE_TTL) {
    return res.status(200).json(_cache.data);
  }

  try {
    // Parallel RSS fetch for all 7 jurisdictions — fastest path
    const results = await Promise.allSettled(
      Object.entries(QUERIES).map(([code, cfg]) => fetchJurisdiction(code, cfg))
    );

    let news = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

    // Optional single-pass AI enrichment (server-side only, key never leaves backend)
    news = await enrichSummaries(news, process.env.ANTHROPIC_API_KEY);

    const body = { news, deadlines: JUNE_DEADLINES };
    _cache.data = body;
    _cache.ts   = Date.now();

    return res.status(200).json(body);
  } catch {
    // Always return valid JSON — deadlines are static and always available
    return res.status(200).json({ news: [], deadlines: JUNE_DEADLINES });
  }
};
