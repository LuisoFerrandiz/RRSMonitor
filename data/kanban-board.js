/* Kanban board - tablero de protestas/scoring inquiries.
   Lee kanban.json, kanban-judges.json y kanban-labels.json. */

const KanbanBoard = (() => {
  const COLUMNS = ["Backlog", "To Do", "In Progress", "Done", "Closed"];
  let data = null;
  let judges = [];
  let labels = [];

  async function load() {
    const [kb, j, l] = await Promise.all([
      fetchJSON("kanban.json"),
      fetchJSON("kanban-judges.json"),
      fetchJSON("kanban-labels.json"),
    ]);
    data = kb && kb.cards ? kb : { cards: {} };
    judges = (j && j.judges) || [];
    labels = (l && l.labels) || [];
  }

  async function init() {
    await load();
    render();
  }

  function render() {
    const board = document.getElementById("kanbanBoard");
    if (!board) return;
    const cards = Object.values(data.cards || {});
    board.innerHTML = COLUMNS.map((col) => {
      const list = cards.filter((c) => (c.column || "Backlog") === col);
      const inner = list.length
        ? list.map(cardHtml).join("")
        : "<div class='empty' style='padding:12px'>Vacío</div>";
      return (
        "<div class='kanban-col' data-col='" + col + "'>" +
        "<h3>" + col + " <span class='kcount'>" + list.length + "</span></h3>" +
        inner + "</div>"
      );
    }).join("");
  }

  function cardHtml(c) {
    const ll = (c.labels || [])
      .map((id) => {
        const L = labels.find((x) => x.id === id);
        if (!L) return "";
        const style = "background:" + (L.bg || "#ccc") + ";color:" + (L.color || "#000") + ";";
        return "<span class='klabel' style='" + style + "'>" + esc(L.name || id) + "</span>";
      })
      .join("");
    const jname = c.judge
      ? (judges.find((x) => x.id === c.judge) || {}).name || c.judge
      : "";
    return (
      "<div class='kanban-card' data-id='" + c.id + "' style='cursor:pointer'>" +
      "<h4>" + esc(c.title || "Sin título") + "</h4>" +
      (jname ? "<div class='kmeta'>Juez: " + esc(jname) + "</div>" : "") +
      (c.notes ? "<div class='kmeta'>" + esc(c.notes) + "</div>" : "") +
      (ll ? "<div class='labels'>" + ll + "</div>" : "") +
      "</div>"
    );
  }

  function openAdd() {
    openModal(null);
  }

  function openModal(id) {
    const existing = id ? data.cards[id] : null;
    document.getElementById("cardModalTitle").textContent = existing ? "Editar tarjeta" : "Nueva tarjeta";
    document.getElementById("cardTitle").value = (existing && existing.title) || "";
    document.getElementById("cardNotes").value = (existing && existing.notes) || "";

    const colSel = document.getElementById("cardColumn");
    colSel.innerHTML = COLUMNS.map((c) =>
      "<option value='" + c + "'" + ((existing && existing.column === c) ? " selected" : "") + ">" + c + "</option>"
    ).join("");

    const judgeSel = document.getElementById("cardJudge");
    judgeSel.innerHTML = "<option value=''>— sin juez —</option>" +
      judges.map((j) =>
        "<option value='" + j.id + "'" + (existing && existing.judge === j.id ? " selected" : "") + ">" + esc(j.name) + "</option>"
      ).join("");

    const labelsWrap = document.getElementById("cardLabels");
    labelsWrap.innerHTML = labels.map((L) => {
      const checked = existing && (existing.labels || []).includes(L.id);
      return (
        "<label class='row' style='justify-content:flex-start'><input type='checkbox' value='" +
        L.id + "'" + (checked ? " checked" : "") + "> " + esc(L.name) + "</label>"
      );
    }).join("");

    const del = document.getElementById("cardDelete");
    del.style.display = existing ? "inline-block" : "none";
    del.onclick = () => { delete data.cards[id]; save(); closeModal(); };

    document.getElementById("cardModal").dataset.id = id || "";
    document.getElementById("modalBackdrop").classList.add("open");
  }

  function saveCurrent() {
    const id = document.getElementById("cardModal").dataset.id;
    const title = document.getElementById("cardTitle").value.trim();
    if (!title) { alert("El título es obligatorio."); return; }
    const labelsSel = Array.from(document.querySelectorAll("#cardLabels input:checked")).map((i) => i.value);
    const payload = {
      title,
      column: document.getElementById("cardColumn").value,
      judge: document.getElementById("cardJudge").value || null,
      notes: document.getElementById("cardNotes").value.trim(),
      labels: labelsSel,
      updatedAt: new Date().toISOString(),
    };
    if (id && data.cards[id]) {
      data.cards[id] = Object.assign(Object.assign({}, data.cards[id]), payload);
    } else {
      const nid = "card_" + Date.now();
      payload.id = nid;
      payload.createdAt = new Date().toISOString();
      data.cards[nid] = payload;
    }
    closeModal();
    save();
  }

  async function save() {
    try {
      const r = await fetch("kanban.json", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: data.cards }, null, 2),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      render();
    } catch (e) {
      console.error("No se pudo guardar kanban.json:", e);
      alert("No se pudo guardar en el servidor (el dashboard es de solo lectura mediante nginx).");
    }
  }

  function closeModal() {
    document.getElementById("modalBackdrop").classList.remove("open");
  }

  function wire() {
    const add = document.getElementById("kanbanAdd");
    if (add) add.addEventListener("click", openAdd);
    const reload = document.getElementById("kanbanReload");
    if (reload) reload.addEventListener("click", init);
    const backdrop = document.getElementById("modalBackdrop");
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.getElementById("cardCancel").addEventListener("click", closeModal);
    document.getElementById("cardSave").addEventListener("click", saveCurrent);
    document.body.addEventListener("click", (e) => {
      const card = e.target.closest(".kanban-card");
      if (card && data && data.cards[card.dataset.id]) openModal(card.dataset.id);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    init();
  });

  return { init, openAdd, render };
})();
