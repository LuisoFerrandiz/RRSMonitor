"use strict";

/**
 * Alta aditiva de tarjetas kanban desde el estado scrapeado + marca de orfandad.
 *
 * `syncKanbanCards(state, kanban, nowIso)`:
 *   - NUNCA modifica una tarjeta existente (salvo poner/quitar la marca `orphaned`).
 *   - NUNCA borra tarjetas ni reordena nada.
 *   - Crea tarjetas para los casos de RRS que aún no la tienen. La fecha `updatedAt`
 *     se sella con el `timestamp` del ciclo de scraping y ya no vuelve a cambiar:
 *     representa "cuándo se bajó este caso de RRS".
 *   - Marca `orphaned:true` (+ `orphanedAt`) las tarjetas cuyo caso ha desaparecido
 *     de RRS, y limpia la marca si el caso reaparece. Las tarjetas de otro evento
 *     (`eventId` distinto al del estado actual) y los time limit manuales
 *     (`source:"manual"`) se dejan en paz; los time limit de RRS SÍ se orfanan
 *     si el time limit deja de estar publicado (el cliente los retira).
 *
 * Es la réplica en Node de la parte pura de `bootstrapKanbanFromDashboardState`
 * (`data/viewer.html`). Si cambias aquí las reglas de columna / `caseKey` / campos,
 * cámbialas también allí para que cliente y servidor produzcan la misma tarjeta.
 */

function caseKeyFromNo(no) {
  const raw = String(no == null ? "" : no);
  const m = raw.match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)) : raw;
}

function timeLimitKey(row) {
  const date = String(row && row.date != null ? row.date : "").trim();
  const boatClass = String(row && row.boatClass != null ? row.boatClass : "").trim();
  return `tl:${date}||${boatClass}`;
}

function labelIdsFromType(type) {
  const t = String(type || "").trim().toLowerCase();
  if (t === "protest") return ["protest"];
  if (t === "request to reopen") return ["request_to_reopen"];
  if (t === "request for redress") return ["request_for_redress"];
  return [];
}

function hearingColumnFromSchedule(schedule) {
  const s = String(schedule || "").trim();
  const pending = /\bpending\b/i.test(s);
  const hasTime = /\d{1,2}:\d{2}/.test(s);
  return !s || pending || !hasTime ? "hearing_request" : "schedule";
}

function cleanDecisionText(text) {
  return String(text || "")
    .replace(/~\s*more\s*~/gi, "")
    .replace(/\bfull\s+decision\.?\b/gi, "")
    .trim();
}

function buildHearingCard(row, updatedAt, eventId) {
  const schedule = String(row.schedule || "").trim();
  const links = row.hearingLinks || [];
  const link = links[0] || {};
  return {
    caseKey: caseKeyFromNo(row.no),
    caseNo: String(row.no || ""),
    column: hearingColumnFromSchedule(schedule),
    initiator: row.initiator || "",
    respondent: row.respondents || "",
    race: row.race || "",
    type: row.type || "",
    labelIds: labelIdsFromType(row.type),
    labelsManual: false,
    schedule,
    protestFormUrl: link.url || "",
    protestFormLabel: link.name || "Protest Form",
    decisionUrl: "",
    decisionText: "",
    notes: "",
    eventId: eventId || null,
    updatedAt,
  };
}

function buildDecisionCard(detail, existing, updatedAt, eventId) {
  const links = detail.hearingLinks || [];
  const link =
    links.find((l) => /protest|hearing\s*request/i.test(String(l.name || ""))) ||
    links[0] ||
    {};
  const decisionText = cleanDecisionText(detail.text);
  const decisionUrl = String(detail.fullDecisionUrl || "").trim();
  const base = existing || {};
  return {
    caseKey: caseKeyFromNo(detail.no),
    caseNo: String(detail.no || base.caseNo || ""),
    column: "decided",
    initiator: detail.initiator || base.initiator || "",
    respondent: detail.respondents || base.respondent || "",
    race: detail.race || base.race || "",
    type: detail.type || base.type || "",
    labelIds: base.labelIds || labelIdsFromType(detail.type || base.type),
    labelsManual: base.labelsManual != null ? base.labelsManual : false,
    schedule: base.schedule || "—",
    location: detail.location || base.location || "",
    protestFormUrl: link.url || base.protestFormUrl || "",
    protestFormLabel: link.name || base.protestFormLabel || "Protest Form",
    decisionUrl: decisionUrl || base.decisionUrl || "",
    decisionText: decisionText || base.decisionText || "",
    hearingLinks: detail.hearingLinks || base.hearingLinks || [],
    notes: base.notes || "",
    eventId: eventId || null,
    updatedAt,
  };
}

// `updatedAt` es el timestamp del ciclo (`formatReportTimestamp`, index.js),
// ya en la zona de REPORT_TIME_ZONE con offset: los primeros 10 caracteres
// son la fecha local del día de scraping, sin duplicar lógica de zona horaria.
function dateKeyFromStamp(stamp) {
  const s = String(stamp || "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}

function buildTimeLimitCard(row, updatedAt, eventId) {
  return {
    cardType: "time_limit",
    caseKey: timeLimitKey(row),
    caseNo: "",
    column: "time_limit",
    // Si RRS no publica fecha para este time limit, se usa el día en que el
    // scraper lo vio por primera vez (solo al crear la tarjeta; inmutable
    // después, igual que el resto de fechas de tarjeta).
    date: String(row.date || "").trim() || dateKeyFromStamp(updatedAt),
    boatClass: String(row.boatClass || "").trim(),
    limitTime: String(row.limitTime || "").trim(),
    timedOut: false,
    notes: "",
    eventId: eventId || null,
    updatedAt,
  };
}

/**
 * @param {object} state    snapshot de `state.json` (necesita `rows`, `decisionRows`,
 *                          `timeLimitRows`, `timestamp`, `eventId`).
 * @param {object} kanban   contenido de `kanban.json` (`{ cards: {} }`).
 * @param {string} nowIso   ISO string del momento actual (para `orphanedAt`).
 * @returns {{cards: object, added: string[], orphaned: string[], restored: string[]}}
 */
function syncKanbanCards(state, kanban, nowIso) {
  const added = [];
  const orphaned = [];
  const restored = [];

  const now = nowIso || new Date().toISOString();
  const rows = (state && Array.isArray(state.rows) && state.rows) || [];
  const decisionRows =
    (state && Array.isArray(state.decisionRows) && state.decisionRows) || [];
  const timeLimitRows =
    (state && Array.isArray(state.timeLimitRows) && state.timeLimitRows) || [];
  const stamp = (state && state.timestamp) || now;
  const eventId = (state && state.eventId) || null;

  // Copia superficial del store; no se muta el original.
  const cards = {};
  const src = (kanban && kanban.cards) || {};
  for (const k of Object.keys(src)) cards[k] = src[k];

  // Sin estado RRS legible: no se crea nada y no se marca orfandad
  // (evita orfanar todo el tablero por un state.json vacío o ausente).
  if (!rows.length && !decisionRows.length && !timeLimitRows.length) {
    return { cards, added, orphaned, restored };
  }

  const presentKeys = new Set();

  const desiredHearing = new Map();
  for (const row of rows) {
    const key = caseKeyFromNo(row.no);
    presentKeys.add(key);
    desiredHearing.set(key, buildHearingCard(row, stamp, eventId));
  }

  const desiredDecision = new Map();
  for (const detail of decisionRows) {
    const key = caseKeyFromNo(detail.no);
    presentKeys.add(key);
    // "Hearing Pending" sigue siendo un caso vivo pero no va a DECIDED.
    if (/\bhearing\s*pending\b/i.test(String(detail.text || ""))) continue;
    const decisionText = cleanDecisionText(detail.text);
    const decisionUrl = String(detail.fullDecisionUrl || "").trim();
    if (!decisionText && !decisionUrl) continue;
    const existing = cards[key] || desiredHearing.get(key) || null;
    desiredDecision.set(key, buildDecisionCard(detail, existing, stamp, eventId));
  }

  // Creación aditiva: la decisión gana sobre el hearing-request si ambos son nuevos.
  for (const [key, card] of desiredDecision) {
    if (!cards[key]) {
      cards[key] = card;
      added.push(key);
    }
  }
  for (const [key, card] of desiredHearing) {
    if (!cards[key]) {
      cards[key] = card;
      added.push(key);
    }
  }
  for (const row of timeLimitRows) {
    const key = timeLimitKey(row);
    presentKeys.add(key);
    if (!cards[key]) {
      cards[key] = buildTimeLimitCard(row, stamp, eventId);
      added.push(key);
    }
  }

  // Orfandad: tarjetas cuyo caso ya no aparece en RRS.
  for (const key of Object.keys(cards)) {
    const card = cards[key];
    if (!card || typeof card !== "object") continue;
    // Los time limit manuales caducan solos (purga cliente por fecha/hora);
    // los de RRS también se orfanan si RRS deja de publicarlos (p.ej. caso
    // resuelto antes de llegar al límite).
    if (card.cardType === "time_limit" && card.source === "manual") continue;
    // No tocar tarjetas de otro evento (el kanban se conserva al cambiar de evento).
    if (card.eventId && eventId && card.eventId !== eventId) continue;
    const present = presentKeys.has(key);
    if (!present && !card.orphaned) {
      cards[key] = { ...card, orphaned: true, orphanedAt: now };
      orphaned.push(key);
    } else if (present && card.orphaned) {
      const next = { ...card };
      delete next.orphaned;
      delete next.orphanedAt;
      cards[key] = next;
      restored.push(key);
    }
  }

  return { cards, added, orphaned, restored };
}

module.exports = {
  syncKanbanCards,
  caseKeyFromNo,
  timeLimitKey,
  hearingColumnFromSchedule,
};
