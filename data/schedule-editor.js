/* Schedule editor - editor de horario de monitorización.
   Lee/edita state.json (scheduleConfig) y schedule.json. */

const ScheduleEditor = (() => {
  let working = null;

  async function init() {
    const response = await fetch("/api/schedule");
    const data = await response.json();
    if (data.ok && data.schedule) {
      working = JSON.parse(JSON.stringify(data.schedule));
    }
    render();
  }

  function render() {
    const root = document.getElementById("scheduleEditor");
    if (!root) return;
    if (!working || !working.plans || !working.plans.length) {
      root.innerHTML = "<div class='empty'>Sin planes configurados.</div>";
      return;
    }
    root.innerHTML = working.plans.map((plan, pi) => {
      const dates = (plan.dates || []).map((d) => "<code>" + esc(d) + "</code>").join(" ");
      const windows = (plan.windows || [])
        .map((w, wi) =>
          "<div class='row mt' data-wi='" + wi + "'>" +
          "<input value='" + esc(w.name || "") + "' placeholder='Nombre' data-f='name' class='win-name'>" +
          "<input type='time' value='" + esc(w.start || "09:00") + "' data-f='start'>" +
          "<span>a</span>" +
          "<input type='time' value='" + esc(w.end || "20:00") + "' data-f='end'>" +
          "<span class='muted small'>cada</span>" +
          "<input type='number' value='" + (w.frequencyMinutes || 60) + "' data-f='freq' style='width:80px'> min" +
          "<button class='btn ghost small' data-act='del-win'>✕</button>" +
          "</div>"
        )
        .join("");
      return (
        "<div class='panel' data-pi='" + pi + "'>" +
        "<div class='row'><h2 style='border:none;margin:0;padding:0;flex:1'>" + esc(plan.name || "Plan") + "</h2>" +
        "<button class='btn ghost' data-act='del-plan'>Eliminar</button></div>" +
        "<label>Fechas (ISO, separadas por espacios)</label>" +
        "<input value='" + ((plan.dates || []).join(" ")) + "' data-f='dates'>" +
        "<div class='mt'><strong>Ventanas de tiempo</strong></div>" +
        windows +
        "<button class='btn ghost mt' data-act='add-win'>+ Ventana</button>" +
        "</div>"
      );
    }).join("");
    wire();
  }

  function wire() {
    const root = document.getElementById("scheduleEditor");
    root.querySelectorAll("[data-f]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const p = root.querySelector(e.target.closest("[data-pi]") ? "[data-pi='" + e.target.closest("[data-pi]").dataset.pi + "']" : "");
        const plan = working.plans[e.target.closest("[data-pi]").dataset.pi];
        const wiEl = e.target.closest("[data-wi]");
        if (!plan) return;
        if (wiEl) {
          const wi = wiEl.dataset.wi;
          const w = plan.windows[wi];
          const f = e.target.dataset.f;
          if (w) {
            if (f === "name") w.name = e.target.value;
            if (f === "start") w.start = e.target.value;
            if (f === "end") w.end = e.target.value;
            if (f === "freq") w.frequencyMinutes = parseInt(e.target.value, 10) || 60;
          }
        } else {
          const pi = e.target.closest("[data-pi]").dataset.pi;
          const f = e.target.dataset.f;
          if (f === "dates") plan.dates = e.target.value.split(/\s+/).filter(Boolean);
          if (f === "name") plan.name = e.target.value;
        }
      });
    });

    root.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        const planEl = btn.closest("[data-pi]");
        if (!planEl) return;
        const pi = parseInt(planEl.dataset.pi, 10);
        if (act === "del-plan") {
          working.plans.splice(pi, 1);
        } else if (act === "add-win") {
          working.plans[pi].windows = working.plans[pi].windows || [];
          working.plans[pi].windows.push({ name: "Nueva ventana", start: "09:00", end: "20:00", frequencyMinutes: 60 });
        } else if (act === "del-win") {
          const wi = parseInt(btn.closest("[data-wi]").dataset.wi, 10);
          working.plans[pi].windows.splice(wi, 1);
        }
        render();
      });
    });
  }

  async function save() {
    const status = document.getElementById("scheduleSaveStatus");
    if (status) status.textContent = "Guardando…";
    let ok = true;
    try {
      const token = sessionStorage.getItem("rrsAuthToken");
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const r = await fetch("/api/schedule", {
        method: "POST",
        headers,
        body: JSON.stringify(working),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "Unknown error");
    } catch (e) {
      ok = false;
      console.error("Error guardando schedule:", e.message);
    }
    if (status) {
      status.textContent = ok
        ? "Guardado correctamente."
        : "Error al guardar. Verifica la consola.";
    }
    console.log("Schedule config guardado:", JSON.stringify(working, null, 2));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("scheduleAddPlan");
    if (btn) {
      btn.addEventListener("click", () => {
        if (!working) working = { plans: [] };
        working.plans.push({ name: "Nuevo plan", dates: [], windows: [{ name: "All day", start: "09:00", end: "20:00", frequencyMinutes: 60 }] });
        render();
      });
    }
    const sv = document.getElementById("scheduleSave");
    if (sv) sv.addEventListener("click", save);
  });

  return { init, save };
})();
