"use strict";

const API = "/api/tax-intel";

let state = { deadlines: [], news: [] };

async function init() {
  const res = await fetch(API);
  const data = await res.json();
  state = data;

  render();
}

// ---------- CORE FILTERS ----------

function isDueToday(d) {
  const today = new Date().toISOString().slice(0, 10);
  return d.adjusted_deadline <= today && d.status !== "DONE";
}

function isHighImpact(n) {
  return n.priority === "HIGH";
}

// ---------- RENDER ----------

function renderToday() {
  return state.deadlines
    .filter(isDueToday)
    .map(d => `
      <div class="card high">
        <div><b>${d.entity_id}</b> — ${d.description}</div>
        <div class="meta">
          Due: ${d.adjusted_deadline} | Owner: ${d.owner}
        </div>
      </div>
    `).join("");
}

function renderDeadlines() {
  return state.deadlines.map(d => `
    <div class="card ${d.priority.toLowerCase()}">
      <div><b>${d.entity_id}</b> — ${d.description}</div>
      <div class="meta">
        Stat: ${d.deadline} | Adj: ${d.adjusted_deadline}
      </div>
    </div>
  `).join("");
}

function renderIntel() {
  return state.news
    .filter(isHighImpact)
    .map(n => `
      <div class="card high">
        <div><b>${n.title}</b></div>
        <div class="meta">
          Entities: ${n.linked_entities.join(",")}
        </div>
        <div>${n.recommended_actions.join("; ")}</div>
      </div>
    `).join("");
}

function render() {
  document.getElementById("today").innerHTML = renderToday();
  document.getElementById("deadlines").innerHTML = renderDeadlines();
  document.getElementById("intel").innerHTML = renderIntel();
}

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", init);
``
