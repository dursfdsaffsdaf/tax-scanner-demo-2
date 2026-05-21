"use strict";

/*
REBUILT BACKEND

- Entity-scoped deadlines (not jurisdiction)
- Applicability filtering
- Business day adjustment
- Intel → impact → entity mapping
- Action generation
*/

const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser();

/* ─────────────────────────────────────────────
   ENTITY MODEL (SOURCE OF TRUTH)
───────────────────────────────────────────── */

const ENTITIES = [
  {
    id: "ROPL-MY",
    jurisdiction: "MY",
    taxes: { SST: true, CIT: true, WHT: true },
    sst_frequency: "bimonthly",
    fy_end_month: 12,
    owner: "MY"
  },
  {
    id: "RGJKK-JP",
    jurisdiction: "JP",
    taxes: { CIT: true },
    fy_end_month: 3,
    owner: "JP"
  }
];

/* ─────────────────────────────────────────────
   DEADLINES
───────────────────────────────────────────── */

function isBusinessDay(date) {
  const d = new Date(date);
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

function adjust(date) {
  let d = new Date(date);
  while (!isBusinessDay(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

function genDeadlines(now = new Date()) {
  const out = [];
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  ENTITIES.forEach(e => {

    // ---- MY SST ----
    if (e.jurisdiction === "MY" && e.taxes.SST) {
      const d = `${y}-${String(m).padStart(2,"0")}-28`;

      out.push({
        entity_id: e.id,
        jurisdiction: e.jurisdiction,
        tax_type: "SST",
        description: "SST filing",
        deadline: d,
        adjusted_deadline: adjust(d),
        priority: "HIGH",
        owner: e.owner,
        status: "OPEN"
      });
    }

    // ---- JP CIT ----
    if (e.jurisdiction === "JP" && e.taxes.CIT) {
      if (m === 5) {
        const d = `${y}-05-31`;

        out.push({
          entity_id: e.id,
          jurisdiction: e.jurisdiction,
          tax_type: "CIT",
          description: "Corporate tax filing",
          deadline: d,
          adjusted_deadline: adjust(d),
          priority: "MEDIUM",
          owner: e.owner,
          status: "OPEN"
        });
      }
    }

  });

  return out;
}

/* ─────────────────────────────────────────────
   SOURCE / TRUST MODEL (TOP 10 EXPANDED)
───────────────────────────────────────────── */

const TRUST_HIGH = [
  "gov", "oecd", "iras", "ato", "lhdn"
];

const TRUST_MEDIUM = [
  "deloitte","pwc","ey","kpmg",
  "bdo","rsm","grantthornton",
  "crowe","bakertilly","mazars","forvis"
];

function classifyTrust(source = "") {
  const s = source.toLowerCase();

  if (TRUST_HIGH.some(x => s.includes(x))) return "HIGH";
  if (TRUST_MEDIUM.some(x => s.includes(x))) return "MEDIUM";
  return "LOW";
}

/* ─────────────────────────────────────────────
   INTEL ENGINE
───────────────────────────────────────────── */

function scoreImpact(text, trust) {
  let score = 0;

  if (trust === "HIGH") score += 3;
  if (/pillar|qdmt|penalty|enforcement|mandatory/.test(text)) score += 3;
  if (/gst|vat|cit|wht|sst/.test(text)) score += 2;

  return score >= 6 ? "HIGH" :
         score >= 3 ? "MEDIUM" :
         "LOW";
}

function mapEntities(item) {
  return ENTITIES
    .filter(e => e.jurisdiction === item.jurisdiction)
    .map(e => e.id);
}

function actions(item) {
  if (/pillar/i.test(item.text)) {
    return ["Model ETR impact", "Check safe harbour"];
  }
  if (/sst|vat|gst/i.test(item.text)) {
    return ["Review indirect tax exposure"];
  }
  return ["Review relevance"];
}

/* ─────────────────────────────────────────────
   DATA FETCH (SIMPLIFIED — REPLACE LATER)
───────────────────────────────────────────── */

async function fetchNews() {
  // placeholder – replace with RSS later
  const raw = [
    {
      jurisdiction: "MY",
      title: "Malaysia SST enforcement update",
      text: "New SST enforcement rules and penalty regime introduced",
      source: "BDO"
    }
  ];

  return raw.map(n => {
    const trust = classifyTrust(n.source);
    const priority = scoreImpact(n.text, trust);

    return {
      ...n,
      trust,
      priority,
      linked_entities: mapEntities(n),
      recommended_actions: actions(n)
    };
  });
}

/* ─────────────────────────────────────────────
   HANDLER
───────────────────────────────────────────── */

module.exports = async function handler(req, res) {

  const now = new Date();

  const deadlines = genDeadlines(now);
  const news = await fetchNews();

  res.setHeader("Content-Type", "application/json");

  res.status(200).json({
    deadlines,
    news,
    meta: {
      fetched_at: now.toISOString(),
      entity_count: ENTITIES.length
    }
  });
};
