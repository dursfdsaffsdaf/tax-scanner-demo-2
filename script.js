const API_URL = "/api/tax-intel";

let allData = {};
let currentView = "action";
let currentJurisdiction = "ALL";

const jurisdictions = [
  "ALL",
  "AU",
  "IN",
  "ID",
  "VN",
  "JP",
  "SG",
  "MY"
];

async function init() {
  const res = await fetch(API_URL);
  allData = await res.json();

  renderFilters();
  renderView();

  document
    .getElementById("actionBtn")
    .addEventListener("click", () => {
      currentView = "action";

      setActiveViewButton();
      renderView();
    });

  document
    .getElementById("intelBtn")
    .addEventListener("click", () => {
      currentView = "intel";

      setActiveViewButton();
      renderView();
    });
}

function setActiveViewButton() {
  document
    .getElementById("actionBtn")
    .classList.remove("active");

  document
    .getElementById("intelBtn")
    .classList.remove("active");

  if (currentView === "action") {
    document
      .getElementById("actionBtn")
      .classList.add("active");
  } else {
    document
      .getElementById("intelBtn")
      .classList.add("active");
  }
}

function renderFilters() {
  const container =
    document.getElementById("jurisdictionFilters");

  container.innerHTML = "";

  jurisdictions.forEach(j => {
    const btn = document.createElement("button");

    btn.textContent = j;

    if (j === currentJurisdiction) {
      btn.classList.add("active");
    }

    btn.onclick = () => {
      currentJurisdiction = j;

      renderFilters();
      renderView();
    };

    container.appendChild(btn);
  });
}

function renderView() {
  if (currentView === "action") {
    renderActionBoard();
  } else {
    renderIntelligenceFeed();
  }
}

function filterByJurisdiction(items) {
  if (currentJurisdiction === "ALL") {
    return items;
  }

  return items.filter(
    item => item.jurisdiction === currentJurisdiction
  );
}

function renderActionBoard() {
  const content =
    document.getElementById("content");

  const deadlines =
    filterByJurisdiction(allData.deadlines || []);

  const today = new Date();

  const urgent = [];
  const imminent = [];
  const scheduled = [];

  deadlines.forEach(item => {
    const due =
      new Date(item.deadline);

    const diffDays =
      Math.ceil(
        (due - today) / (1000 * 60 * 60 * 24)
      );

    if (diffDays <= 7) {
      urgent.push(item);
    } else if (diffDays <= 30) {
      imminent.push(item);
    } else {
      scheduled.push(item);
    }
  });

  content.innerHTML = `
    ${renderDeadlineSection(
      "🔴 URGENT (≤ 7 Days)",
      urgent,
      "urgent"
    )}

    ${renderDeadlineSection(
      "🟠 IMMINENT (8 - 30 Days)",
      imminent,
      "imminent"
    )}

    ${renderDeadlineSection(
      "🟢 SCHEDULED (> 30 Days)",
      scheduled,
      "scheduled"
    )}
  `;
}

function renderDeadlineSection(
  title,
  items,
  cssClass
) {
  items.sort(
    (a, b) =>
      new Date(a.deadline) -
      new Date(b.deadline)
  );

  return `
    <div>
      <h2 class="section-title">
        ${title}
      </h2>

      ${
        items.length === 0
          ? "<p>No items.</p>"
          : items.map(item => `
            <div class="card ${cssClass}">
              <div class="badges">
                <div class="badge">
                  ${item.jurisdiction}
                </div>

                <div class="badge">
                  ${item.tax_type}
                </div>
              </div>

              <div class="date">
                ${item.deadline}
              </div>

              <div>
                ${item.description}
              </div>

              <p>
                ${item.notes || ""}
              </p>
            </div>
          `).join("")
      }
    </div>
  `;
}

function renderIntelligenceFeed() {
  const content =
    document.getElementById("content");

  let news =
    filterByJurisdiction(allData.news || []);

  const cutoff =
    new Date();

  cutoff.setDate(cutoff.getDate() - 60);

  news = news.filter(item => {
    const date =
      new Date(item.date);

    return date >= cutoff;
  });

  news.sort((a, b) => {
    return (
      new Date(b.date) -
      new Date(a.date)
    );
  });

  const grouped = {};

  news.forEach(item => {
    if (!grouped[item.jurisdiction]) {
      grouped[item.jurisdiction] = [];
    }

    grouped[item.jurisdiction].push(item);
  });

  content.innerHTML = Object.keys(grouped)
    .map(country => `
      <div class="country-group">

        <h2 class="section-title">
          ${country}
        </h2>

        ${grouped[country]
          .map(item => `
            <div class="card">

              <div class="priority">
                ${item.priority || "MEDIUM"}
              </div>

              <div class="badges">

                <div class="badge">
                  ${item.tags?.join(", ") || "OTHER"}
                </div>

              </div>

              <div class="date">
                ${item.date}
              </div>

              <div>
                ${item.title}
              </div>

              <p>
                ${item.summary || ""}
              </p>

              <a
                class="news-link"
                href="${item.url}"
                target="_blank"
              >
                Read Article
              </a>

            </div>
          `).join("")}

      </div>
    `).join("");
}

init();
