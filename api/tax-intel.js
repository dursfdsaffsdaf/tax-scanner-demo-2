"use strict";

const { XMLParser } = require("fast-xml-parser");
const parser = new XMLParser();

/* ─────────────────────────────
   ENTITIES
───────────────────────────── */
const ENTITIES = [
  { id: "ROPL-MY", jurisdiction: "MY", taxes: ["SST","CIT"], owner: "MY" },
  { id: "RGJKK-JP", jurisdiction: "JP", taxes: ["CIT"], owner: "JP" }
];

/* ─────────────────────────────
   DEADLINES
───────────────────────────── */

function adjust(date) {
  let d = new Date(date);
  while ([0,6].includes(d.getDay())) {
    d.setDate(d.getDate()+1);
  }
  return d.toISOString().slice(0,10);
}

function genDeadlines(now=new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,"0");

  return ENTITIES.flatMap(e => {
    let out = [];

    if (e.jurisdiction==="MY" && e.taxes.includes("SST")) {
      const d = `${y}-${m}-28`;
      out.push({
        entity_id: e.id,
        jurisdiction: e.jurisdiction,
        description: "SST filing",
        deadline: d,
        adjusted_deadline: adjust(d),
        priority: "HIGH",
        owner: e.owner,
        status: "OPEN"
      });
    }

    if (e.jurisdiction==="JP" && now.getMonth()===4) {
      const d = `${y}-05-31`;
      out.push({
        entity_id: e.id,
        jurisdiction: e.jurisdiction,
        description: "Corporate tax filing",
        deadline: d,
        adjusted_deadline: adjust(d),
        priority: "MEDIUM",
        owner: e.owner,
        status: "OPEN"
      });
    }

    return out;
  });
}

/* ─────────────────────────────
   TRUST
───────────────────────────── */

const TRUST_MEDIUM = [
  "deloitte","pwc","ey","kpmg",
  "bdo","rsm","grantthornton",
  "crowe","bakertilly","mazars","forvis"
];

function classifyTrust(src="") {
  const s = src.toLowerCase();
  if (/gov|oecd|iras|lhdn|ato/.test(s)) return "HIGH";
  if (TRUST_MEDIUM.some(x => s.includes(x))) return "MEDIUM";
  return "LOW";
}

/* ─────────────────────────────
   SCORING (PARAM-DRIVEN)
───────────────────────────── */

function score(text, trust, weights) {
  let s = 0;

  if (trust==="HIGH") s += weights.trust_high;
  if (/enforcement|penalty|mandatory|pillar/i.test(text))
    s += weights.legal;
  if (/gst|vat|sst|cit|wht/i.test(text))
    s += weights.tax;

  if (s >= weights.high_cutoff) return "HIGH";
  if (s >= weights.med_cutoff) return "MEDIUM";
  return "LOW";
}

/* ─────────────────────────────
   ENTITY MAPPING
───────────────────────────── */

function mapEntities(j) {
  return ENTITIES.filter(e => e.jurisdiction===j).map(e=>e.id);
}

function actions(text) {
  if (/pillar/i.test(text)) return ["Model ETR","Check exposure"];
  if (/gst|sst|vat/i.test(text)) return ["Review indirect tax"];
  return ["Review"];
}

/* ─────────────────────────────
   NEWS INGESTION (RESTORED)
───────────────────────────── */

async function fetchNews(weights, filterJ) {
  const url = "https://news.google.com/rss/search?q=tax+regulation";
  const xml = await fetch(url).then(r=>r.text());
  const data = parser.parse(xml);

  const items = data?.rss?.channel?.item || [];

  return items.slice(0,25).map(i => {

    const text = (i.title||"")+" "+(i.description||"");
    const trust = classifyTrust(i.source || "");
    const priority = score(text, trust, weights);

    const j = detectJurisdiction(text);

    return {
      jurisdiction: j,
      title: i.title,
      priority,
      trust,
      linked_entities: mapEntities(j),
      recommended_actions: actions(text)
    };

  }).filter(n => !filterJ || n.jurisdiction===filterJ);
}

/* simple heuristic */
function detectJurisdiction(text="") {
  const t = text.toLowerCase();
  if (t.includes("malaysia")) return "MY";
  if (t.includes("japan")) return "JP";
  if (t.includes("singapore")) return "SG";
  return "GLOBAL";
}

/* ─────────────────────────────
   HANDLER
───────────────────────────── */

module.exports = async function handler(req,res){

  const weights = {
    trust_high: Number(req.query.th||3),
    legal: Number(req.query.legal||3),
    tax: Number(req.query.tax||2),
    high_cutoff: Number(req.query.hc||6),
    med_cutoff: Number(req.query.mc||3)
  };

  const filterJ = req.query.j || null;

  const deadlines = genDeadlines();
  const news = await fetchNews(weights, filterJ);

  res.json({
    deadlines: filterJ
      ? deadlines.filter(d=>d.jurisdiction===filterJ)
      : deadlines,
    news
  });
};
