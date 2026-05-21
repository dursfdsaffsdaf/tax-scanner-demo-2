"use strict";

const API = "/api/tax-intel";

let state = {};
let params = {
  th: 3,
  legal: 3,
  tax: 2,
  hc: 6,
  mc: 3,
  j: ""
};

/* ───────────────────── */

async function load(){
  const query = new URLSearchParams(params).toString();
  const res = await fetch(API+"?"+query);
  state = await res.json();
  render();
}

/* ─────────────────────
   CONTROLS
───────────────────── */

function controls(){
  return `
    <div>
      Country:
      <select onchange="setJ(this.value)">
        <option value="">ALL</option>
        <option value="MY">MY</option>
        <option value="JP">JP</option>
      </select>

      High Cutoff:
      <input type="number" value="${params.hc}"
        onchange="setParam('hc',this.value)" />

      Legal Weight:
      <input type="number" value="${params.legal}"
        onchange="setParam('legal',this.value)" />
    </div>
  `;
}

function setParam(k,v){
  params[k]=v;
  load();
}

function setJ(v){
  params.j=v;
  load();
}

/* ───────────────────── */

function render(){
  document.getElementById("controls").innerHTML = controls();

  document.getElementById("deadlines").innerHTML =
    state.deadlines.map(d=>`
      <div>
        ${d.entity_id} — ${d.description}
      </div>
    `).join("");

  document.getElementById("intel").innerHTML =
    state.news.map(n=>`
      <div>
        <b>${n.title}</b> (${n.priority})
        <div>${n.linked_entities.join(",")}</div>
      </div>
    `).join("");
}

/* ───────────────────── */
document.addEventListener("DOMContentLoaded", load);
``
