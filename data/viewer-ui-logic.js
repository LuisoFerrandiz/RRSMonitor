/* Viewer UI - lógica base del dashboard RRS.
   Lee los .json/.jsonl que genera el scheduler directamente desde el
   directorio servido por nginx (data/). */

const state = {
  current: null,
  history: [],
  changes: [],
  lastScheduler: null,
};

async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

async function fetchLines(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return [];
  const text = await r.text();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((x) => x !== null);
}

/* Moldea una fila genérica de hearings/rows y otras listas.
   Cada fila suele tener {rowId, description, href, date}. */
function rowToObj(row) {
  return {
    id: row.rowId || row.id || "",
    desc: row.description || row.title || row.question || "",
    href: row.href || row.url || "#",
    date: row.date || row.published || row.created || "",
    extra: row,
  };
}

/* ---- Carga de datos ---- */
async function loadAll() {
  state.current = await fetchJSON("state.json");
  state.history = await fetchLines("history.jsonl");
  const runs = await fetchJSON("scheduler-last-run.json");
  state.lastScheduler = runs;
  await renderOverview();
  await renderDocuments();
  await renderHearings();
  await renderQuestions();
  await renderInquiries();
  await renderHistory();
  renderChangeLog(await fetchLines("changes.jsonl"));
  updateCounts();
}

function updateCounts() {
  const c = state.current || {};
  const set = (id, n) => {
    const el = document.getElementById(id);
    if (el) el.textContent = n;
  };
  set("count-doc", c.documentRowCount || 0);
  set("count-hear", c.decisionRowCount || 0);
  set("count-qa", c.questionRowCount || 0);
  set("count-inq", c.scoringInquiryRowCount || 0);
}

/* ---- Resumen ---- */
async function renderOverview() {
  const c = state.current || {};
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("ov-doc", c.documentRowCount || 0);
  set("ov-hear", c.decisionRowCount || 0);
  set("ov-qa", c.questionRowCount || 0);
  set("ov-inq", c.scoringInquiryRowCount || 0);
  set("ov-pen", c.penaltyRowCount || 0);
  set("ov-tl", c.timeLimitRowCount || 0);

  const lu = document.getElementById("lastUpdate");
  if (lu) lu.textContent = "Última actualización: " + (c.timestamp || "—");

  const si = document.getElementById("schedulerInfo");
  if (si) {
    if (state.lastScheduler && state.lastScheduler.lastRun) {
      si.textContent = "Última ejecución: " + state.lastScheduler.lastRun +
        (state.lastScheduler.durationMs
          ? " · duración " + (state.lastScheduler.durationMs / 1000).toFixed(1) + "s" : "");
    } else {
      si.textContent = "No hay registro de ejecución (scheduler-last-run.json).";
    }
  }
}

/* ---- Tablas genéricas ---- */
function fillTable(tbodyId, items) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = "<tr><td colspan='3' class='empty'>Sin datos.</td></tr>";
    return;
  }
  tbody.innerHTML = items
    .map((r) => {
      const o = rowToObj(r);
      return "<tr><td>" + (o.date || "—") + "</td><td>" + esc(o.desc) + "</td><td><a href='" +
        esc(o.href) + "' target='_blank' rel='noopener'>ver</a></td></tr>";
    })
    .join("");
}

function renderDocuments() {
  const rows = (state.current && state.current.documentRows) || [];
  fillTable("tbody-documents", rows);
}
function renderHearings() {
  const rows = (state.current && state.current.decisionRows) || [];
  fillTable("tbody-hearings", rows);
}
function renderQuestions() {
  const rows = (state.current && state.current.questionRows) || [];
  fillTable("tbody-questions", rows);
}
function renderInquiries() {
  const rows = (state.current && state.current.scoringInquiryRows) || [];
  fillTable("tbody-inquiries", rows);
}

function renderChangeLog(changes) {
  const container = document.getElementById("recentChanges");
  if (!container) return;
  const recent = changes.slice(-5).reverse();
  if (!recent.length) {
    container.innerHTML = "<div class='empty'>Sin cambios registrados.</div>";
    return;
  }
  container.innerHTML = recent
    .map((c) => {
      const when = new Date(c.timestamp).toLocaleString();
      const entries = [];
      const groups = [
        ["documentChanges", "Documentos"],
        ["changes", "Audiencias"],
        ["questionChanges", "Q&A"],
        ["scoringInquiryChanges", "Protestas"],
        ["penaltyChanges", "Penalties"],
      ];
      for (const [key, label] of groups) {
        const g = c[key];
        if (!g) continue;
        const adds = g.added ? g.added.length : 0;
        const mods = g.modified ? g.modified.length : 0;
        const rems = g.removed ? g.removed.length : 0;
        if (adds || mods || rems) {
          entries.push(
            label + " +" + adds + " ~" + mods + " -" + rems
          );
        }
      }
      return "<div class='mt'><span class='muted small'>" + esc(when) +
        "</span><div>" + (entries.length ? entries.map(esc).join(" · ") : "Sin cambios") + "</div></div>";
    })
    .join("");
}

async function renderHistory() {
  const tbody = document.getElementById("tbody-history");
  if (!tbody) return;
  const nInput = document.getElementById("histN");
  const n = nInput ? parseInt(nInput.value, 10) : 10;
  const slice = state.history.slice(-n).reverse();
  if (!slice.length) {
    tbody.innerHTML = "<tr><td colspan='7' class='empty'>Sin historial.</td></tr>";
    return;
  }
  tbody.innerHTML = slice
    .map((h) => {
      const t = new Date(h.timestamp).toLocaleString();
      return "<tr><td>" + esc(t) + "</td><td>" + (h.documentRowCount || 0) +
        "</td><td>" + (h.decisionRowCount || 0) + "</td><td>" + (h.questionRowCount || 0) +
        "</td><td>" + (h.scoringInquiryRowCount || 0) + "</td><td>" + (h.penaltyRowCount || 0) +
        "</td><td>" + (h.timeLimitRowCount || 0) + "</td></tr>";
    })
    .join("");
}

/* ---- Tabs ---- */
function initTabs() {
  const tabs = document.querySelectorAll("nav.tabs button");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const name = btn.dataset.tab;
      document.querySelectorAll("main .tab").forEach((t) => {
        t.classList.toggle("active", t.id === "tab-" + name);
      });
      if (name === "kanban" && window.KanbanBoard) KanbanBoard.init();
      if (name === "schedule" && window.ScheduleEditor) ScheduleEditor.init();
      if (name === "history") renderHistory();
    });
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  loadAll().catch((e) => console.error("Error cargando datos:", e));
});

document.getElementById("histReload") &&
  document.getElementById("histReload").addEventListener("click", renderHistory);
