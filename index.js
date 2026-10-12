const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const fs = require("fs/promises");
const fsSync = require("fs");
const cheerio = require("cheerio");
const { syncKanbanCards } = require("./src/kanbanSync");
// sub-fase C1 (Fase C): padTimePart/zonedOffsetRFC/formatReportTimestamp/normalize/
// dedupeRepeatedWordSpans/hearingCaseKey/migrateStringKeysByHearingCase movidas a
// src/rrsScraping.js — mismo nombre local, ningún call site interno cambia.
const {
  padTimePart,
  zonedOffsetRFC,
  formatReportTimestamp,
  normalize,
  dedupeRepeatedWordSpans,
  hearingCaseKey,
  migrateStringKeysByHearingCase,
  RRS_ORIGIN,
  deriveRrsEventIdFromUrl,
  expandRrsUrlTemplate,
  hearingTypeToLabelNames,
  rowFingerprint,
  absolutizeRrsHref,
} = require("./src/rrsScraping");

/** Rutas `./data` y `.env` respecto de `cwd` rompen cron en DSM si no hay `cd`. */
const resolvedDataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");

const rrsEventId =
  normalize(process.env.RRS_EVENT_ID) ||
  deriveRrsEventIdFromUrl(process.env.RRS_URL) ||
  deriveRrsEventIdFromUrl(process.env.RRS_DOCUMENTS_URL) ||
  deriveRrsEventIdFromUrl(process.env.RRS_DECISIONS_URL) ||
  deriveRrsEventIdFromUrl(process.env.RRS_SCORINGENQUIRIES_URL || "");
const rrsSchedulesFromId = rrsEventId
  ? `${RRS_ORIGIN}/schedules/${rrsEventId}/event`
  : "";
const rrsDocumentsFromId = rrsEventId
  ? `${RRS_ORIGIN}/documents/${rrsEventId}/event`
  : "";
const rrsDecisionsFromId = rrsEventId
  ? `${RRS_ORIGIN}/decisions/${rrsEventId}/event`
  : "";

const urlFromEnv = expandRrsUrlTemplate(process.env.RRS_URL, rrsEventId);
const documentsFromEnv = expandRrsUrlTemplate(process.env.RRS_DOCUMENTS_URL, rrsEventId);
const decisionsFromEnv = expandRrsUrlTemplate(process.env.RRS_DECISIONS_URL || "", rrsEventId);
const questionsFromEnv = expandRrsUrlTemplate(process.env.RRS_QUESTIONS_URL || "", rrsEventId);
const scoringEnquiriesFromEnv = expandRrsUrlTemplate(
  process.env.RRS_SCORINGENQUIRIES_URL || "",
  rrsEventId
);
const penaltyReportsFromEnv = expandRrsUrlTemplate(
  process.env.RRS_REPORTPENALTIES_URL || "",
  rrsEventId
);
const retirementsFromEnv = expandRrsUrlTemplate(
  process.env.RRS_RETIREMENTS_URL || "",
  rrsEventId
);
const onWaterPenaltiesFromEnv = expandRrsUrlTemplate(
  process.env.RRS_ONWATERPENALTIES_URL || "",
  rrsEventId
);
const crewChangesFromEnv = expandRrsUrlTemplate(
  process.env.RRS_CREWCHANGES_URL || "",
  rrsEventId
);
const equipmentSubstitutionsFromEnv = expandRrsUrlTemplate(
  process.env.RRS_EQUIPMENTSUBSTITUTIONS_URL || "",
  rrsEventId
);

const CONFIG = {
  eventId: rrsEventId || null,
  url: urlFromEnv || rrsSchedulesFromId,
  documentsUrl: documentsFromEnv || rrsDocumentsFromId,
  decisionsUrl: decisionsFromEnv || rrsDecisionsFromId,
  questionsUrl: questionsFromEnv || (rrsEventId ? `${RRS_ORIGIN}/questions/${rrsEventId}/event` : ""),
  scoringEnquiriesUrl:
    scoringEnquiriesFromEnv ||
    (rrsEventId ? `${RRS_ORIGIN}/scoring_inquiries/${rrsEventId}/event` : ""),
  intervalMs: Number(process.env.POLL_INTERVAL_MS || 60_000),
  dataDir: resolvedDataDir,
  stateFile: path.join(resolvedDataDir, "state.json"),
  // checks.jsonl: 1 línea diminuta por ciclo (SIEMPRE), con `timestamp`, `changed` y los
  // contadores por sección. Es la auditoría de "cada vez que el sistema ha mirado" y la
  // fuente de la pestaña Log del dashboard. Sustituye al antiguo history.jsonl (snapshots
  // completos con buffer/flush de 30 min).
  checksFile: path.join(resolvedDataDir, "checks.jsonl"),
  changesFile: path.join(resolvedDataDir, "changes.jsonl"),
  // kanban.json: tablero del dashboard. El monitor solo hace alta ADITIVA de tarjetas
  // para casos de RRS que aún no la tienen y marca las huérfanas (caso desaparecido).
  // Nunca modifica ni borra tarjetas existentes. Ver src/kanbanSync.js.
  kanbanFile: path.join(resolvedDataDir, "kanban.json"),
  telegramEnabled: process.env.TELEGRAM_ENABLED === "true",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  trelloEnabled: process.env.TRELLO_ENABLED === "true",
  trelloKey: process.env.TRELLO_KEY || "",
  trelloToken: process.env.TRELLO_TOKEN || "",
  trelloListId: process.env.TRELLO_LIST_ID || "",
  trelloScheduleListId: process.env.TRELLO_SCHEDULE_LIST_ID || "",
  trelloDecidedListId: process.env.TRELLO_DECIDED_LIST_ID || "",
  /** Lista "Time Limit" (Protest Time Limit(s) en la web) */
  trelloTimelimitListId: process.env.TRELLO_TIMELIMIT_LIST_ID || "",
  /** Lista TOA-Documents (Event Documents en la web RRS) */
  trelloToaDocumentsListId: process.env.TRELLO_TOA_DOCUMENTS_LIST_ID || "",
  trelloQuestionsListId: process.env.TRELLO_QUESTIONS_LIST_ID || "",
  penaltyReportsEnabled: process.env.REPORTPENALTIES === "true",
  penaltyReportsUrl: penaltyReportsFromEnv,
  retirementsEnabled: process.env.RETIREMENTS === "true",
  retirementsUrl: retirementsFromEnv,
  penaltiesEnabled: process.env.ONWATERPENALTIES === "true",
  onWaterPenaltiesUrl: onWaterPenaltiesFromEnv,
  crewSubstitutionsEnabled: process.env.CREWCHANGES === "true",
  crewChangesUrl: crewChangesFromEnv,
  equipmentSubstitutionsEnabled: process.env.EQUIPMENTSUBSTITUTIONS === "true",
  equipmentSubstitutionsUrl: equipmentSubstitutionsFromEnv,
  // Flags de secciones existentes (default ON para no romper comportamiento actual).
  documentsEnabled: process.env.DOCUMENTS !== "false",
  questionsEnabled: process.env.QUESTIONS !== "false",
  scoringEnquiriesEnabled: process.env.SCORINGENQUIRIES !== "false",
  decisionsEnabled: process.env.DECISIONS !== "false",
};

/** Identidad estable: fecha+clase mantienen la misma tarjeta aunque cambie hora/restante */
const TL_TIME_OUT_PREFIX = /^TIME\s+OUT\b/i;
const DELETE_DOC_PREFIX = /^DELETE\b/i;

const trelloCustomFieldsByBoard = new Map();
const trelloCustomFieldsWarnedBoards = new Set();
const trelloLabelsByBoard = new Map();
const trelloHearingLabelWarnedBoards = new Set();
const trelloDecidedLabelWarnedBoards = new Set();
const trelloDecisionFieldWarnedBoards = new Set();
const trelloFullDecisionCheckboxWarnedBoards = new Set();
let trelloDocumentSyncSkipLogged = false;

/** Custom field tipo checkbox en el tablero (nombre visible en Trello). */
const FULL_DECISION_CHECKBOX_LABEL_NAMES = [
  "Full Decision",
  "Full decision",
  "FullDecision",
  "Full decision file",
];

/** Nuevas tarjetas + traslados; time limits/documentos también suben con trelloUpdateCardNameDesc. */
const TRELLO_CARD_POS_TOP = "top";

/** Nombres de etiquetas en el tablero Trello (deben existir; "Other" no lleva etiqueta). */
const HEARING_TYPE_TRELLO_LABEL_NAMES = [
  "Protest",
  "International jury",
  "Request to Reopen",
  "Request for Redress",
  "Race Committee",
  "Technical Committee",
];

function extractTimeLimitRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  const table = $("table.table-warning").first();
  if (!table.length) {
    return rows;
  }
  table.find("tbody tr").each((__, tr) => {
    const cells = $(tr)
      .find("td")
      .map((___, td) => normalize($(td).text()))
      .get();
    if (cells.length !== 4) {
      return;
    }
    const row = {
      date: cells[0] || "",
      boatClass: cells[1] || "",
      limitTime: cells[2] || "",
      remaining: cells[3] || "",
    };
    if (!normalize(row.date) && !normalize(row.boatClass) && !normalize(row.limitTime)) {
      return;
    }
    rows.push(row);
  });
  return rows;
}

function timeLimitRowKey(row) {
  return [normalize(row.date), normalize(row.boatClass)].join("||");
}

// `remaining` es una cuenta atrás que RRS recalcula cada ciclo (cambia solo
// por el paso del tiempo) — no se incluye en la huella o cada scrape marcaría
// el time limit como "modified" aunque fecha/clase/hora límite no cambien.
function timeLimitFingerprint(row) {
  return [row.date, row.boatClass, row.limitTime].join("||");
}

function timeLimitCardTitle(row) {
  return [normalize(row.date), normalize(row.boatClass), normalize(row.limitTime)]
    .filter(Boolean)
    .join(" · ");
}

function summarizeTimeLimitRow(row) {
  return [
    `Date: ${row.date || "-"}`,
    `Class: ${row.boatClass || "-"}`,
    `Time limit: ${row.limitTime || "-"}`,
    `Remaining: ${row.remaining ? row.remaining : "-"}`,
  ].join("\n");
}

function timeLimitDescription(row) {
  const r = normalize(row.remaining);
  return r ? `Remaining: ${r}` : "";
}

function detectTimeLimitChanges(previousRows, currentRows) {
  const previousMap = new Map(previousRows.map((row) => [timeLimitRowKey(row), row]));
  const currentMap = new Map(currentRows.map((row) => [timeLimitRowKey(row), row]));

  const added = [];
  const modified = [];
  const removed = [];

  for (const [key, currentRow] of currentMap.entries()) {
    const prevRow = previousMap.get(key);
    if (!prevRow) {
      added.push(currentRow);
      continue;
    }

    if (timeLimitFingerprint(prevRow) !== timeLimitFingerprint(currentRow)) {
      modified.push({
        key,
        before: prevRow,
        after: currentRow,
      });
    }
  }

  for (const [key, prevRow] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      removed.push(prevRow);
    }
  }

  return { added, modified, removed };
}

/**
 * Celda "Type": texto del tipo (Protest, Request to Reopen, etc.) sin los enlaces del <ul>;
 * los <a href> bajo el tipo van solo a Trello como adjuntos, no al mensaje de Telegram.
 */
function extractHearingTypeCell($, $td) {
  const $clone = $td.clone();
  $clone.find("ul").remove();
  const type = dedupeRepeatedWordSpans($clone.text());
  const hearingLinks = [];
  const seenUrls = new Set();
  $td.find("a[href]").each((__, a) => {
    const href = normalize($(a).attr("href"));
    if (!href) {
      return;
    }
    const abs = absolutizeRrsHref(href);
    if (!abs || seenUrls.has(abs)) {
      return;
    }
    seenUrls.add(abs);
    const name = normalize($(a).text()) || "Adjunto";
    hearingLinks.push({ url: abs, name });
  });
  return { type, hearingLinks };
}

function extractEventDocumentRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("#document-table tr").each((__, tr) => {
    const $tr = $(tr);
    if ($tr.find("th").length) {
      return;
    }
    const idAttr = $tr.attr("id") || "";
    const idMatch = idAttr.match(/^document-row-(\d+)$/);
    if (!idMatch) {
      return;
    }
    const rowId = idMatch[1];
    const $cells = $tr.find("td");
    if ($cells.length < 2) {
      return;
    }
    const $first = $cells.first();
    const $a = $first.find("a").first();
    const hrefRaw = normalize($a.attr("href") || "");
    const description = normalize($a.length ? $a.text() : $first.text());
    const dateStr = normalize($cells.eq(1).text());
    if (!description && !hrefRaw) {
      return;
    }
    rows.push({
      rowId,
      description,
      href: absolutizeRrsHref(hrefRaw),
      date: dateStr,
    });
  });
  return rows;
}

function extractQuestionsRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table").each((_, table) => {
    const headerCells = $(table)
      .find("thead tr th")
      .map((__, th) => normalize($(th).text()).toLowerCase())
      .get();

    if (headerCells.includes("no.") && headerCells.includes("regarding")) {
      $(table)
        .find("tbody tr")
        .each((___, tr) => {
          const $tds = $(tr).find("td");
          if ($tds.length < 6) return;

          const no = normalize($tds.eq(0).text());
          const competitor = normalize($tds.eq(1).text());
          const forWhom = normalize($tds.eq(2).text());
          const regarding = normalize($tds.eq(3).text());
          const state = normalize($tds.eq(4).text());
          const answered = normalize($tds.eq(5).text());
          // Buscamos el link de PDF por el título o por el icono fa-file-pdf-o
          const $pdfLink = $tds.find('a[title*="PDF"], a:has(i.fa-file-pdf-o)');
          const pdfHref = normalize($pdfLink.attr("href"));

          if (!no) return;

          rows.push({
            no,
            competitor,
            forWhom,
            regarding,
            state,
            answered,
            pdfUrl: pdfHref ? absolutizeRrsHref(pdfHref) : "",
          });
        });
    }
  });
  return rows;
}

function questionRowKey(row) {
  return normalize(row.no);
}

function questionFingerprint(row) {
  return [
    row.no,
    row.competitor,
    row.forWhom,
    row.regarding,
    row.state,
    row.answered,
    row.pdfUrl,
  ].join("||");
}

function detectQuestionsChanges(previousRows, currentRows) {
  const previousMap = new Map(previousRows.map((row) => [questionRowKey(row), row]));
  const currentMap = new Map(currentRows.map((row) => [questionRowKey(row), row]));

  const added = [];
  const modified = [];
  const removed = [];

  for (const [key, currentRow] of currentMap.entries()) {
    const prevRow = previousMap.get(key);
    if (!prevRow) {
      added.push(currentRow);
      continue;
    }

    if (questionFingerprint(prevRow) !== questionFingerprint(currentRow)) {
      modified.push({
        key,
        before: prevRow,
        after: currentRow,
      });
    }
  }

  for (const [key, prevRow] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      removed.push(prevRow);
    }
  }

  return { added, modified, removed };
}

function extractScoringInquiryRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  const $table = $("#inquiry-scroller").first();
  if (!$table.length) {
    return rows;
  }

  const headerCells = $table
    .find("thead tr th")
    .map((__, th) => normalize($(th).text()).toLowerCase())
    .get();

  if (
    !headerCells.some((c) => c.includes("no.")) ||
    !headerCells.some((c) => c.includes("response"))
  ) {
    return rows;
  }

  $table.find("tbody tr").each((__, tr) => {
    const $tds = $(tr).find("td");
    if ($tds.length < 8) {
      return;
    }

    const no = normalize($tds.eq(0).text());
    if (!no) {
      return;
    }

    const $pdfLink = $tds.find('a[href*=".pdf"], a[title*="PDF"]');
    const pdfHref = normalize($pdfLink.attr("href"));

    rows.push({
      no,
      date: normalize($tds.eq(1).text()),
      course: normalize($tds.eq(2).text()),
      race: normalize($tds.eq(3).text()),
      competitor: normalize($tds.eq(4).text()),
      posted: normalize($tds.eq(5).text()),
      corrected: normalize($tds.eq(6).text()),
      response: normalize($tds.eq(7).text()),
      pdfUrl: pdfHref ? absolutizeRrsHref(pdfHref) : "",
    });
  });
  return rows;
}

function scoringInquiryRowKey(row) {
  return normalize(row.no);
}

function scoringInquiryFingerprint(row) {
  return [
    row.no,
    row.date,
    row.course,
    row.race,
    row.competitor,
    row.posted,
    row.corrected,
    row.response,
    row.pdfUrl,
  ].join("||");
}

function detectScoringInquiryChanges(previousRows, currentRows) {
  const previousMap = new Map(
    previousRows.map((row) => [scoringInquiryRowKey(row), row])
  );
  const currentMap = new Map(
    currentRows.map((row) => [scoringInquiryRowKey(row), row])
  );

  const added = [];
  const modified = [];
  const removed = [];

  for (const [key, currentRow] of currentMap.entries()) {
    const prevRow = previousMap.get(key);
    if (!prevRow) {
      added.push(currentRow);
      continue;
    }

    if (scoringInquiryFingerprint(prevRow) !== scoringInquiryFingerprint(currentRow)) {
      modified.push({
        key,
        before: prevRow,
        after: currentRow,
      });
    }
  }

  for (const [key, prevRow] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      removed.push(prevRow);
    }
  }

  return { added, modified, removed };
}

function documentRowKey(row) {
  return normalize(row.rowId);
}

function eventDocumentFingerprint(row) {
  return [row.description, row.href, row.date].join("||");
}

function eventDocumentCardTitle(row) {
  return [normalize(row.description), normalize(row.date)].filter(Boolean).join(" · ");
}

function eventDocumentCardDescription(row) {
  return normalize(row.href);
}

function summarizeDocumentRow(row) {
  return [
    `Titulo: ${row.description || "-"}`,
    `Fecha: ${row.date || "-"}`,
    `Enlace: ${row.href || "-"}`,
  ].join("\n");
}

function detectDocumentChanges(previousRows, currentRows) {
  const previousMap = new Map(previousRows.map((row) => [documentRowKey(row), row]));
  const currentMap = new Map(currentRows.map((row) => [documentRowKey(row), row]));

  const added = [];
  const modified = [];
  const removed = [];

  for (const [key, currentRow] of currentMap.entries()) {
    const prevRow = previousMap.get(key);
    if (!prevRow) {
      added.push(currentRow);
      continue;
    }

    if (eventDocumentFingerprint(prevRow) !== eventDocumentFingerprint(currentRow)) {
      modified.push({
        key,
        before: prevRow,
        after: currentRow,
      });
    }
  }

  for (const [key, prevRow] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      removed.push(prevRow);
    }
  }

  return { added, modified, removed };
}

async function ensureDataDir() {
  await fs.mkdir(CONFIG.dataDir, { recursive: true });
}

async function appendJsonLine(filePath, payload) {
  const line = `${JSON.stringify(payload)}\n`;
  await fs.appendFile(filePath, line, "utf8");
}

const PENDING_DECISION_TEXTS = new Set([
  "pending",
  "decision pending",
  "hearing pending",
]);

/** nº de decisiones "resueltas" (con texto y que no es un marcador de pendiente). */
function countDecidedDecisionRows(decisionRows) {
  return (decisionRows || []).filter((r) => {
    const t = String(r && r.text != null ? r.text : "").trim().toLowerCase();
    return t && !PENDING_DECISION_TEXTS.has(t);
  }).length;
}

/**
 * Registra en checks.jsonl una línea por ciclo (siempre). Formato plano con las mismas
 * claves `*RowCount` que consume el dashboard, más `changed`, `decidedDecisionRowCount` y
 * (en el primer ciclo del evento) `baseline`.
 */
async function appendCheck(snapshot, changed, isBaseline) {
  const check = {
    timestamp: snapshot.timestamp,
    changed: Boolean(changed),
    ...(isBaseline ? { baseline: true } : {}),
    rowCount: snapshot.rowCount || 0,
    decisionRowCount: snapshot.decisionRowCount || 0,
    decidedDecisionRowCount: countDecidedDecisionRows(snapshot.decisionRows),
    timeLimitRowCount: snapshot.timeLimitRowCount || 0,
    documentRowCount: snapshot.documentRowCount || 0,
    questionRowCount: snapshot.questionRowCount || 0,
    scoringInquiryRowCount: snapshot.scoringInquiryRowCount || 0,
    penaltyRowCount: snapshot.penaltyRowCount || 0,
    retirementRowCount: snapshot.retirementRowCount || 0,
    penaltyReportRowCount: snapshot.penaltyReportRowCount || 0,
    crewSubstitutionRowCount: snapshot.crewSubstitutionRowCount || 0,
    equipmentSubstitutionRowCount: snapshot.equipmentSubstitutionRowCount || 0,
  };
  await appendJsonLine(CONFIG.checksFile, check);
}

async function loadState() {
  try {
    const content = await fs.readFile(CONFIG.stateFile, "utf8");
    if (!content || !content.trim()) {
      return null;
    }
    return JSON.parse(content);
  } catch (error) {
    console.error("[loadState]", error.message);
    return null;
  }
}

async function saveState(state) {
  await fs.writeFile(CONFIG.stateFile, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Mantiene `data/kanban.json` al día tras cada ciclo: da de alta tarjetas para los
 * casos de RRS que aún no la tienen (con `updatedAt` = fecha del ciclo, inmutable) y
 * marca como huérfanas las de casos que ya no aparecen. Aditivo y no destructivo;
 * cualquier error se registra sin abortar el ciclo. Ver src/kanbanSync.js.
 */
async function syncKanbanFromSnapshot(snapshot) {
  try {
    let kanban = { cards: {} };
    try {
      const raw = await fs.readFile(CONFIG.kanbanFile, "utf8");
      const parsed = raw && raw.trim() ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && parsed.cards) kanban = parsed;
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.error(`[KANBAN] kanban.json ilegible (${e.message}); se parte de vacío.`);
      }
    }

    // syncKanbanCards(state, kanban, now); aquí el "state" es el snapshot del ciclo.
    const { cards, added, orphaned, restored, moved } = syncKanbanCards(
      snapshot,
      kanban,
      new Date().toISOString()
    );

    if (added.length || orphaned.length || restored.length || moved.length) {
      await fs.writeFile(
        CONFIG.kanbanFile,
        JSON.stringify({ cards }, null, 2),
        "utf8"
      );
      console.log(
        `[KANBAN] +${added.length} nueva(s), ${orphaned.length} huérfana(s), ${restored.length} recuperada(s), ${moved.length} movida(s) a decided.`
      );
    }
  } catch (error) {
    console.error(`[KANBAN] Sincronización omitida: ${error.message}`);
  }
}

/**
 * Reset completo al cambiar `RRS_EVENT_ID`: hace una copia de seguridad de
 * `state.json` / `checks.jsonl` / `changes.jsonl` en `data/backup_<fecha>/` y
 * luego los vacía, para que el evento nuevo arranque de cero (el ciclo actual
 * se registrará como línea base, sin cambios falsos). NO toca kanban, schedule,
 * monitor-config, users ni scheduler.log. Las tarjetas kanban del evento anterior
 * se conservan tal cual (syncKanbanCards no las marca huérfanas: distinto `eventId`).
 */
async function resetEventDataOnEventChange(oldId, newId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(CONFIG.dataDir, `backup_${stamp}`);
  const files = [CONFIG.stateFile, CONFIG.checksFile, CONFIG.changesFile];
  try {
    await fs.mkdir(backupDir, { recursive: true });
    for (const f of files) {
      try {
        await fs.copyFile(f, path.join(backupDir, path.basename(f)));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  } catch (e) {
    console.error(`[EVENT_CHANGE] No se pudo hacer copia de seguridad: ${e.message}`);
  }
  for (const f of files) {
    try {
      await fs.unlink(f);
    } catch (e) {
      if (e.code !== "ENOENT") console.error(`[EVENT_CHANGE] ${path.basename(f)}: ${e.message}`);
    }
  }
  console.log(
    `[EVENT_CHANGE] RRS_EVENT_ID ${oldId} -> ${newId}: reset completo. ` +
    `Copia en ${path.basename(backupDir)}; state.json / checks.jsonl / changes.jsonl vaciados.`
  );
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/** Extrae nombre y logo de la página de schedules (HTML de RRS). */
function scrapeEventInfo(html) {
  const $ = cheerio.load(html);
  const title =
    $("h3.mb-0").first().text().trim() ||
    $("figure.event-image img").first().attr("alt") ||
    "";
  let logoUrl =
    $("figure.event-image img").first().attr("src") || "";
  if (logoUrl && !/^https?:\/\//i.test(logoUrl)) {
    logoUrl = `${RRS_ORIGIN}${logoUrl}`;
  }
  const resultsUrl =
    $('a[title="Link to Results"]').first().attr("href") || "";
  return { eventTitle: title, eventLogoUrl: logoUrl, resultsUrl };
}

/** Guarda eventTitle, eventLogoUrl y resultsUrl en monitor-config.json. */
async function saveScrapedEventInfo({ eventTitle, eventLogoUrl, resultsUrl }) {
  const filePath = path.join(CONFIG.dataDir, "monitor-config.json");
  const existing = await readJsonSafe(filePath, {});
  const changed =
    existing.eventTitle !== eventTitle ||
    existing.eventLogoUrl !== eventLogoUrl ||
    existing.resultsUrl !== resultsUrl;
  if (!changed) return;
  const updated = {
    ...existing,
    eventTitle: eventTitle || existing.eventTitle || "",
    eventLogoUrl: eventLogoUrl || existing.eventLogoUrl || "",
    sailtiResultsUrl: resultsUrl || existing.sailtiResultsUrl || "",
  };
  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), "utf8");
  console.log(
    `[EVENT INFO] guardado: "${eventTitle}" | logo=${eventLogoUrl ? "si" : "no"} | sailtiResults=${resultsUrl || "sin"}`
  );
}

async function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function extractTableRows(html) {
  const $ = cheerio.load(html);
  const rows = [];

  const $tables = $("#schedule-scroller").length ? $("#schedule-scroller") : $("table");
  $tables.each((_, table) => {
    const headerCells = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((__, cell) => normalize($(cell).text()).toLowerCase())
      .get();

    const requiredHeaders = [
      "no.",
      "type",
      "race",
      "initiator",
      "respondent(s)",
      "schedule",
      "location",
    ];

    const isTargetTable = requiredHeaders.every((h) =>
      headerCells.some((cell) => cell.includes(h))
    );

    if (!isTargetTable) {
      return;
    }

    $(table)
      .find("tr")
      .slice(1)
      .each((__, tr) => {
        const $tds = $(tr).find("td");
        const cellTexts = $tds
          .map((___, td) => normalize($(td).text()))
          .get();

        if (!cellTexts.length) {
          return;
        }

        if (
          cellTexts.length === 1 &&
          normalize(cellTexts[0]).toLowerCase().includes("no hearings currently scheduled")
        ) {
          return;
        }

        if ($tds.length < 7) {
          return;
        }

        const typeCell = extractHearingTypeCell($, $tds.eq(1));

        const row = {
          no: normalize($tds.eq(0).text()) || "",
          type: typeCell.type,
          hearingLinks: typeCell.hearingLinks,
          race: dedupeRepeatedWordSpans($tds.eq(2).text()) || "",
          initiator: dedupeRepeatedWordSpans($tds.eq(3).text()) || "",
          respondents: dedupeRepeatedWordSpans($tds.eq(4).text()) || "",
          schedule: dedupeRepeatedWordSpans($tds.eq(5).text()) || "",
          location: normalize($tds.eq(6).text()) || "",
        };

        rows.push(row);
      });
  });

  return rows;
}

function linkTextIsFullDecision(linkText) {
  const n = normalize(linkText).toLowerCase().replace(/\.$/, "");
  return n === "full decision";
}

/**
 * Celda Decision: texto visible + enlace con texto "Full Decision" si existe.
 */
function extractDecisionCellDetail($, $td) {
  let fullDecisionUrl = "";
  $td.find("a[href]").each((__, a) => {
    if (fullDecisionUrl) {
      return;
    }
    if (!linkTextIsFullDecision($(a).text())) {
      return;
    }
    const href = normalize($(a).attr("href"));
    if (!href) {
      return;
    }
    fullDecisionUrl = absolutizeRrsHref(href);
  });
  const text = normalize($td.text()) || "";
  return { text, fullDecisionUrl };
}

/**
 * Hearing Decisions page: columns No. … Decision.
 * Returns Map(caseKey -> { text, fullDecisionUrl }). Last row wins if duplicates.
 */
/**
 * Convert relative URL to absolute URL
 */
function toAbsoluteUrl(url, baseOrigin = "https://www.racingrulesofsailing.org") {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/")) return baseOrigin + url;
  return baseOrigin + "/" + url;
}

/**
 * Fetch all pages of decisions (handles pagination).
 * Returns combined HTML from all pages.
 */
async function fetchAllDecisionPages(baseUrl) {
  if (!baseUrl) return "";

  let allHtml = "";
  let pageNum = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const pageUrl = baseUrl.includes("?")
      ? `${baseUrl}&page=${pageNum}`
      : `${baseUrl}?page=${pageNum}`;

    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);

      // Extract main content (table)
      const table = $("table").first();
      if (table.length === 0 && pageNum === 1) {
        return html; // Return original if no table found
      }
      allHtml += html;

      // Check if there's a next page
      const nextLink = $("a[rel='next'], a:contains('Next')").first();
      hasNextPage = nextLink.length > 0;
      pageNum++;
    } catch (error) {
      if (pageNum === 1) throw error; // Always throw error on first page
      console.warn(`[DECISIONS] Error fetching page ${pageNum}: ${error.message}`);
      break;
    }
  }

  return allHtml;
}

function extractDecisionsDetailByCaseKey(html) {
  const $ = cheerio.load(html);
  const map = new Map();

  $("table").each((_, table) => {
    const headerCells = $(table)
      .find("tr")
      .first()
      .find("th,td")
      .map((__, cell) => normalize($(cell).text()).toLowerCase())
      .get();

    const noIdx = headerCells.findIndex((c) => c.includes("no."));
    const typeIdx = headerCells.findIndex((c) => c.includes("type"));
    const raceIdx = headerCells.findIndex((c) => c.includes("race"));
    const initiatorIdx = headerCells.findIndex((c) => c.includes("initiator"));
    const respondentIdx = headerCells.findIndex((c) => c.includes("respondent"));
    const decIdx = headerCells.findIndex((c) => c.includes("decision"));

    if (noIdx < 0 || decIdx < 0) {
      return;
    }

    $(table)
      .find("tr")
      .slice(1)
      .each((__, tr) => {
        const $tds = $(tr).find("td");
        if ($tds.length <= Math.max(noIdx, decIdx)) {
          return;
        }
        const rawNo = normalize($tds.eq(noIdx).text()) || "";
        if (!rawNo) {
          return;
        }
        if (/no\s+decisions?\s+found/i.test(rawNo)) {
          return;
        }
        const key = hearingCaseKey(rawNo);
        const $decTd = $tds.eq(decIdx);
        const { text, fullDecisionUrl } = extractDecisionCellDetail($, $decTd);

        // Extract additional fields
        const typeTd = typeIdx >= 0 ? $tds.eq(typeIdx) : null;
        const typeText = typeTd ? normalize(typeTd.text()) : "";

        // Extract ALL links from type cell
        const typeLinks = [];
        if (typeTd) {
          typeTd.find("a").each((_, link) => {
            const href = $(link).attr("href") || "";
            const linkText = $(link).text().trim();
            if (href) {
              typeLinks.push({
                text: linkText || "Link",
                href: toAbsoluteUrl(href)
              });
            }
          });
        }

        const race = raceIdx >= 0 ? normalize($tds.eq(raceIdx).text()) : "";
        const initiator = initiatorIdx >= 0 ? normalize($tds.eq(initiatorIdx).text()) : "";
        const respondents = respondentIdx >= 0 ? normalize($tds.eq(respondentIdx).text()) : "";

        // Extract ALL links from decision cell
        const decisionLinks = [];
        $decTd.find("a").each((_, link) => {
          const href = $(link).attr("href") || "";
          const linkText = $(link).text().trim();
          if (href && linkText !== "~more~") { // Skip ~more~ links
            decisionLinks.push({
              text: linkText || "Link",
              href: toAbsoluteUrl(href)
            });
          }
        });

        map.set(key, {
          text,
          fullDecisionUrl: fullDecisionUrl || "",
          type: typeText,
          typeLinks,
          race,
          initiator,
          respondents,
          decisionLinks,
        });
      });
  });

  return map;
}

/**
 * Construye las filas de decisiones (kanban interno) cruzando el mapa de
 * decisiones (caseKey -> {text, fullDecisionUrl}) con las filas del calendario.
 * Falls back a previousRows para casos decididos que ya no están en el calendario.
 */
function buildDecisionRowsFromState(decisionsMap, currentRows, previousRows) {
  if (!decisionsMap || decisionsMap.size === 0) {
    return [];
  }
  const byKey = (rows) => {
    const m = new Map();
    for (const row of rows || []) {
      const k = hearingCaseKey(row.no);
      if (!m.has(k)) {
        m.set(k, row);
      }
    }
    return m;
  };
  const cur = byKey(currentRows);
  const prev = byKey(previousRows);

  const out = [];
  for (const [caseKey, detail] of decisionsMap.entries()) {
    const row = cur.get(caseKey) || prev.get(caseKey) || {};
    // Combine all links from type and decision cells
    const allLinks = [...(detail.typeLinks || []), ...(detail.decisionLinks || [])];
    const hearingLinks = allLinks.length > 0 ? allLinks : row.hearingLinks || [];

    out.push({
      no: String(row.no || caseKey),
      type: detail.type || row.type || "",
      hearingLinks,
      race: detail.race || row.race || "",
      initiator: detail.initiator || row.initiator || "",
      respondents: detail.respondents || row.respondents || "",
      schedule: row.schedule || "",
      location: row.location || "",
      text: detail.text || "",
      fullDecisionUrl: detail.fullDecisionUrl || "",
    });
  }
  // Orden estable: las decisiones más recientes (todas válidas)
  return out;
}

function detectChanges(previousRows, currentRows) {
  const previousMap = new Map(
    previousRows.map((row) => [hearingCaseKey(row.no), row])
  );
  const currentMap = new Map(
    currentRows.map((row) => [hearingCaseKey(row.no), row])
  );

  const added = [];
  const modified = [];
  const removed = [];

  for (const [caseKey, currentRow] of currentMap.entries()) {
    const prevRow = previousMap.get(caseKey);
    if (!prevRow) {
      added.push(currentRow);
      continue;
    }

    if (rowFingerprint(prevRow) !== rowFingerprint(currentRow)) {
      modified.push({
        no: caseKey,
        before: prevRow,
        after: currentRow,
      });
    }
  }

  for (const [caseKey, prevRow] of previousMap.entries()) {
    if (!currentMap.has(caseKey)) {
      removed.push(prevRow);
    }
  }

  return { added, modified, removed };
}

function summarizeRow(row) {
  return [
    `No: ${row.no || "-"}`,
    `Type: ${row.type || "-"}`,
    `Race: ${row.race || "-"}`,
    `Initiator: ${row.initiator || "-"}`,
    `Respondent(s): ${row.respondents || "-"}`,
    `Schedule: ${row.schedule || "-"}`,
    `Location: ${row.location || "-"}`,
  ].join("\n");
}

function trelloCardTitle(row) {
  const n = normalize(row.no);
  return n ? `Case ${n}` : "Case";
}

function trelloCardDescriptionForRow(row, _fieldIds, options) {
  const n = normalize(row.no);
  const opts = options || {};
  const lines = [
    `Case: ${n || "-"}`,
    `Initiator: ${normalize(row.initiator) || "-"}`,
    `Respondent: ${normalize(row.respondents) || "-"}`,
    `Race: ${normalize(row.race) || "-"}`,
    `Type: ${normalize(row.type) || "-"}`,
    `Schedule: ${formatScheduleForTrelloDescription(row.schedule)}`,
    `Location: ${normalize(row.location) || "-"}`,
  ];
  const decision = opts.decision != null ? normalize(String(opts.decision)) : "";
  if (decision) {
    lines.push(`Decision: ${decision}`);
  }
  return lines.join("\n");
}

async function trelloGetListBoardId(listId) {
  const url = `https://api.trello.com/1/lists/${encodeURIComponent(
    listId
  )}?fields=idBoard&${trelloAuthParams().toString()}`;
  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello get list board: ${response.status} ${bodyText}`);
  }
  const data = JSON.parse(bodyText);
  return data.idBoard || null;
}

async function trelloResolveAmazingFieldIds(boardId) {
  const fields = await trelloGetBoardCustomFields(boardId);
  return {
    initiatorFieldId: trelloFindFieldIdByNames(fields, ["initiator", "intiator"]),
    respondentFieldId: trelloFindFieldIdByNames(fields, [
      "respondent",
      "respondents",
      "respondant",
      "respondent(s)",
    ]),
    raceFieldId: trelloFindFieldIdByNames(fields, ["race"]),
    typeFieldId: trelloFindFieldIdByNames(fields, ["type"]),
    scheduleFieldId: trelloFindFieldIdByNames(fields, ["schedule"]),
  };
}

/** Schedule RRS suele incluir hora tipo "May 01 - 19:20" */
function scheduleHasClockTime(schedule) {
  return /\d{1,2}:\d{2}/.test(normalize(schedule));
}

function scheduleIsPending(schedule) {
  const s = normalize(schedule).toLowerCase();
  return /\bpending\b/.test(s) || /\bpendiente\b/.test(s);
}

/** Solo va a lista Schedule con hora; sin hora, Pending o vacío → Hearing Request */
function scheduleUsesScheduleList(schedule) {
  if (!normalize(schedule) || scheduleIsPending(schedule)) {
    return false;
  }
  return scheduleHasClockTime(schedule);
}

/** Descripción Trello: horario tipo RRS "May 01 - 19:20" → "01/05 19:20" */
function formatScheduleForTrelloDescription(schedule) {
  const s = normalize(schedule);
  if (!s) return "-";
  if (scheduleIsPending(schedule)) return s;

  const monthMap = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  let m = s.match(/^([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2}:\d{2})\b/);
  if (m) {
    const monKey = m[1].toLowerCase();
    const mo = monthMap[monKey] ?? monthMap[monKey.slice(0, 3)];
    if (mo !== undefined) {
      const day = String(parseInt(m[2], 10)).padStart(2, "0");
      const month = String(mo + 1).padStart(2, "0");
      return `${day}/${month} ${m[3]}`;
    }
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\s*[-–—]\s*(\d{1,2}:\d{2})\b/);
  if (m) {
    const day = String(parseInt(m[1], 10)).padStart(2, "0");
    const month = String(parseInt(m[2], 10)).padStart(2, "0");
    return `${day}/${month} ${m[3]}`;
  }

  m = s.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})\b/);
  if (m) {
    const day = String(parseInt(m[1], 10)).padStart(2, "0");
    const month = String(parseInt(m[2], 10)).padStart(2, "0");
    return `${day}/${month} ${m[3]}`;
  }

  return s;
}

function trelloAuthParams() {
  const params = new URLSearchParams();
  params.set("key", CONFIG.trelloKey);
  params.set("token", CONFIG.trelloToken);
  return params;
}

async function trelloGetCardAttachmentUrls(cardId) {
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}/attachments?${trelloAuthParams().toString()}`;
  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello list attachments: ${response.status} ${bodyText}`);
  }
  const list = JSON.parse(bodyText);
  const set = new Set();
  for (const att of list) {
    const u = normalize(att.url);
    if (u) {
      set.add(u);
    }
  }
  return set;
}

async function trelloAddCardAttachmentFromUrl(cardId, remoteUrl, displayName) {
  const params = trelloAuthParams();
  params.set("url", remoteUrl);
  const name = normalize(displayName);
  if (name) {
    params.set("name", name.slice(0, 256));
  }
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}/attachments?${params.toString()}`;
  const response = await fetch(url, { method: "POST" });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello add attachment: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

function attachmentFilenameFromUrl(fileUrl, contentDispositionHeader) {
  const cd = normalize(contentDispositionHeader);
  const m = cd.match(/filename\*=UTF-8''([^;\s]+)|filename="([^"]+)"|filename=([^;\s]+)/i);
  if (m) {
    const raw = decodeURIComponent(m[1] || m[2] || m[3] || "");
    const base = path.basename(raw.replace(/^["']|["']$/g, ""));
    if (base) {
      return base;
    }
  }
  try {
    const u = new URL(fileUrl);
    const base = path.basename(u.pathname);
    if (base && base !== "/" && base !== ".") {
      return base;
    }
  } catch {
    /* ignore */
  }
  return "Full-Decision.pdf";
}

async function trelloAddCardAttachmentFromDownload(cardId, sourceUrl, displayName) {
  const response = await fetch(sourceUrl, {
    headers: {
      "User-Agent": "RRS-Monitor/1.0 (+Node.js 18)",
      Accept: "*/*",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Descarga Full Decision HTTP ${response.status}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  const mime = normalize(response.headers.get("content-type")) || "application/octet-stream";
  const fname =
    normalize(displayName) ||
    attachmentFilenameFromUrl(sourceUrl, response.headers.get("content-disposition")) ||
    "Full-Decision.pdf";
  const safeName = fname.replace(/[/\\?%*:|"<>"]/g, "_").slice(0, 256);

  const form = new FormData();
  form.append("key", CONFIG.trelloKey);
  form.append("token", CONFIG.trelloToken);
  form.append("name", safeName);
  const blob = new Blob([buf], { type: mime || "application/octet-stream" });
  form.append("file", blob, safeName);

  const url = `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/attachments`;
  const res = await fetch(url, { method: "POST", body: form });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Trello upload attachment: ${res.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

/** Enlaces bajo "Type" en schedules → adjuntos en la tarjeta (no van al texto de Telegram). */
async function trelloSyncHearingLinkAttachments(
  cardId,
  row,
  hearingAttachmentUrlsByCase
) {
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !cardId) {
    return;
  }
  const links = row.hearingLinks || [];
  const caseKey = hearingCaseKey(row.no);
  if (!links.length) {
    if (hearingAttachmentUrlsByCase && caseKey in hearingAttachmentUrlsByCase) {
      delete hearingAttachmentUrlsByCase[caseKey];
    }
    return;
  }

  const targetUrls = links.map((l) => normalize(l.url)).filter(Boolean);
  const recorded = new Set();
  for (const u of hearingAttachmentUrlsByCase[caseKey] || []) {
    if (targetUrls.includes(u)) {
      recorded.add(u);
    }
  }

  let onCard;
  try {
    onCard = await trelloGetCardAttachmentUrls(cardId);
  } catch (error) {
    console.warn(`[TRELLO] Caso ${row.no}: no pude leer adjuntos:`, error.message);
    onCard = new Set();
  }
  for (const u of onCard) {
    if (targetUrls.includes(u)) {
      recorded.add(u);
    }
  }

  for (const link of links) {
    const u = normalize(link.url);
    if (!u || recorded.has(u)) {
      continue;
    }
    try {
      await trelloAddCardAttachmentFromUrl(cardId, u, link.name);
      recorded.add(u);
      console.log(`[TRELLO] Caso ${row.no}: adjunto enlazado`);
    } catch (error) {
      console.error(`[TRELLO] Caso ${row.no} adjunto:`, error.message);
    }
  }
  hearingAttachmentUrlsByCase[caseKey] = [...recorded];
}

function trelloFindLabelIdByNames(labels, desiredName) {
  const want = normalizeFieldLabel(desiredName);
  const found = labels.find((label) => normalizeFieldLabel(label.name) === want);
  return found?.id || null;
}

async function trelloGetBoardLabels(boardId) {
  if (trelloLabelsByBoard.has(boardId)) {
    return trelloLabelsByBoard.get(boardId);
  }
  const url = `https://api.trello.com/1/boards/${encodeURIComponent(
    boardId
  )}/labels?${trelloAuthParams().toString()}`;
  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello board labels: ${response.status} ${bodyText}`);
  }
  const labels = JSON.parse(bodyText);
  trelloLabelsByBoard.set(boardId, labels);
  return labels;
}

async function trelloGetCardLabels(cardId) {
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}/labels?${trelloAuthParams().toString()}`;
  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello card labels: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

async function trelloAddCardLabel(cardId, labelId) {
  const params = trelloAuthParams();
  params.set("value", labelId);
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}/idLabels?${params.toString()}`;
  const response = await fetch(url, { method: "POST" });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello add label: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

async function trelloRemoveCardLabel(cardId, labelId) {
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}/idLabels/${encodeURIComponent(labelId)}?${trelloAuthParams().toString()}`;
  const response = await fetch(url, { method: "DELETE" });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello remove label: ${response.status} ${bodyText}`);
  }
}

const DECIDED_TRELLO_LABEL_NAME = "Decided";

async function trelloAddDecidedLabel(cardId, caseNoForLog) {
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !cardId) {
    return;
  }
  try {
    const card = await trelloGetCard(cardId);
    if (!card.idBoard) {
      return;
    }
    const boardLabels = await trelloGetBoardLabels(card.idBoard);
    const decidedLabelId = trelloFindLabelIdByNames(
      boardLabels,
      DECIDED_TRELLO_LABEL_NAME
    );
    if (!decidedLabelId) {
      if (!trelloDecidedLabelWarnedBoards.has(card.idBoard)) {
        console.warn(
          `[WARN] Etiqueta "${DECIDED_TRELLO_LABEL_NAME}" no encontrada en Trello; créala en el tablero.`
        );
        trelloDecidedLabelWarnedBoards.add(card.idBoard);
      }
      return;
    }
    const onCard = await trelloGetCardLabels(cardId);
    if (onCard.some((l) => l.id === decidedLabelId)) {
      return;
    }
    await trelloAddCardLabel(cardId, decidedLabelId);
    const label = caseNoForLog != null ? ` caso ${caseNoForLog}` : "";
    console.log(`[TRELLO]${label}: etiqueta "${DECIDED_TRELLO_LABEL_NAME}" añadida`);
  } catch (error) {
    console.error(
      `[TRELLO] Etiqueta ${DECIDED_TRELLO_LABEL_NAME} (caso ${caseNoForLog}):`,
      error.message
    );
  }
}

async function trelloSyncHearingTypeLabels(cardId, row) {
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !cardId) {
    return;
  }
  try {
    const card = await trelloGetCard(cardId);
    if (!card.idBoard) {
      return;
    }
    const boardLabels = await trelloGetBoardLabels(card.idBoard);
    const hearingTypeLabelIds = HEARING_TYPE_TRELLO_LABEL_NAMES.map((n) =>
      trelloFindLabelIdByNames(boardLabels, n)
    ).filter(Boolean);

    const missingNames = HEARING_TYPE_TRELLO_LABEL_NAMES.filter(
      (n) => !trelloFindLabelIdByNames(boardLabels, n)
    );
    if (
      missingNames.length &&
      !trelloHearingLabelWarnedBoards.has(card.idBoard)
    ) {
      console.warn(
        `[WARN] Etiquetas de tipo no encontradas en Trello (crear con estos nombres): ${missingNames.join(", ")}`
      );
      trelloHearingLabelWarnedBoards.add(card.idBoard);
    }

    const wantNames = hearingTypeToLabelNames(row.type);
    const wantIds = new Set(
      wantNames
        .map((n) => trelloFindLabelIdByNames(boardLabels, n))
        .filter(Boolean)
    );

    let onCard;
    try {
      onCard = await trelloGetCardLabels(cardId);
    } catch (e) {
      console.warn(`[TRELLO] Caso ${row.no}: no pude leer etiquetas:`, e.message);
      return;
    }
    const onCardIds = new Set(onCard.map((l) => l.id));

    for (const lid of hearingTypeLabelIds) {
      const shouldHave = wantIds.has(lid);
      const has = onCardIds.has(lid);
      if (shouldHave && !has) {
        await trelloAddCardLabel(cardId, lid);
      } else if (!shouldHave && has) {
        await trelloRemoveCardLabel(cardId, lid);
      }
    }
  } catch (error) {
    console.error(`[TRELLO] Caso ${row.no} etiquetas por tipo:`, error.message);
  }
}

function normalizeFieldLabel(value) {
  return normalize(value).toLowerCase().replace(/[^\w]/g, "");
}

async function trelloCreateCard(row) {
  let fieldIdsForDesc = null;
  try {
    const boardId = await trelloGetListBoardId(CONFIG.trelloListId);
    if (boardId) fieldIdsForDesc = await trelloResolveAmazingFieldIds(boardId);
  } catch (error) {
    console.warn(`[TRELLO] No pude resolver tablero/campos al crear (${row.no}):`, error.message);
  }

  const url = `https://api.trello.com/1/cards?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idList: CONFIG.trelloListId,
      name: trelloCardTitle(row),
      desc: trelloCardDescriptionForRow(row, fieldIdsForDesc),
      pos: TRELLO_CARD_POS_TOP,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello create card: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

async function trelloUpdateCard(cardId, row) {
  let fieldIdsForDesc = null;
  try {
    const card = await trelloGetCard(cardId);
    if (card.idBoard) fieldIdsForDesc = await trelloResolveAmazingFieldIds(card.idBoard);
  } catch (error) {
    console.warn(`[TRELLO] No pude resolver campos al actualizar (${row.no}):`, error.message);
  }

  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: trelloCardTitle(row),
      desc: trelloCardDescriptionForRow(row, fieldIdsForDesc),
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello update card: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

async function trelloGetCard(cardId) {
  const q = new URLSearchParams();
  q.set("fields", "name,desc,idList,idBoard");
  q.set("key", CONFIG.trelloKey);
  q.set("token", CONFIG.trelloToken);
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}?${q.toString()}`;
  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello get card: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

async function trelloGetBoardCustomFields(boardId) {
  if (trelloCustomFieldsByBoard.has(boardId)) {
    return trelloCustomFieldsByBoard.get(boardId);
  }
  const url = `https://api.trello.com/1/boards/${encodeURIComponent(
    boardId
  )}/customFields?${trelloAuthParams().toString()}`;
  const response = await fetch(url);
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello board custom fields: ${response.status} ${bodyText}`);
  }
  const fields = JSON.parse(bodyText);
  trelloCustomFieldsByBoard.set(boardId, fields);
  return fields;
}

function trelloFindFieldIdByNames(fields, desiredNames) {
  const desired = desiredNames.map((name) => normalizeFieldLabel(name));
  const found = fields.find((field) =>
    desired.includes(normalizeFieldLabel(field.name))
  );
  return found?.id || null;
}

function trelloFindCheckboxFieldIdByNames(fields, desiredNames) {
  const desired = new Set(desiredNames.map((name) => normalizeFieldLabel(name)));
  const found = fields.find(
    (field) =>
      field.type === "checkbox" && desired.has(normalizeFieldLabel(field.name))
  );
  return found?.id || null;
}

async function trelloSetCardTextCustomField(cardId, customFieldId, value) {
  const normalizedValue = normalize(value);
  if (!normalizedValue) {
    const clearUrl = `https://api.trello.com/1/cards/${encodeURIComponent(
      cardId
    )}/customField/${encodeURIComponent(customFieldId)}/item?${trelloAuthParams().toString()}`;
    const clearResponse = await fetch(clearUrl, { method: "DELETE" });
    const clearText = await clearResponse.text();
    if (!clearResponse.ok) {
      throw new Error(`Trello clear custom field: ${clearResponse.status} ${clearText}`);
    }
    return;
  }

  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}/customField/${encodeURIComponent(customFieldId)}/item?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      value: { text: normalizedValue },
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello set custom field: ${response.status} ${bodyText}`);
  }
}

async function trelloSyncAmazingFields(cardId, row) {
  try {
    const card = await trelloGetCard(cardId);
    if (!card.idBoard) {
      return;
    }
    const ids = await trelloResolveAmazingFieldIds(card.idBoard);
    const missing = [];
    if (!ids.initiatorFieldId) missing.push("Initiator");
    if (!ids.respondentFieldId) missing.push("Respondent");
    if (!ids.raceFieldId) missing.push("Race");
    if (!ids.typeFieldId) missing.push("Type");
    if (!ids.scheduleFieldId) missing.push("Schedule");
    if (missing.length && !trelloCustomFieldsWarnedBoards.has(card.idBoard)) {
      console.warn(`[WARN] No encuentro estos custom fields en Trello: ${missing.join(", ")}`);
      trelloCustomFieldsWarnedBoards.add(card.idBoard);
    }

    if (ids.initiatorFieldId) {
      await trelloSetCardTextCustomField(cardId, ids.initiatorFieldId, row.initiator);
    }
    if (ids.respondentFieldId) {
      await trelloSetCardTextCustomField(cardId, ids.respondentFieldId, row.respondents);
    }
    if (ids.raceFieldId) {
      await trelloSetCardTextCustomField(cardId, ids.raceFieldId, row.race);
    }
    if (ids.typeFieldId) {
      await trelloSetCardTextCustomField(cardId, ids.typeFieldId, row.type);
    }
    if (ids.scheduleFieldId) {
      await trelloSetCardTextCustomField(cardId, ids.scheduleFieldId, row.schedule);
    }
  } catch (error) {
    console.error(`[TRELLO] Caso ${row.no} al sincronizar custom fields:`, error.message);
  }
}

/** Text custom field named DECISION (match is case- and punctuation-insensitive). */
async function trelloSyncDecisionCustomField(cardId, value, caseNoForLog) {
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !cardId) {
    return;
  }
  try {
    const card = await trelloGetCard(cardId);
    if (!card.idBoard) {
      return;
    }
    const fields = await trelloGetBoardCustomFields(card.idBoard);
    const decisionFieldId = trelloFindFieldIdByNames(fields, [
      "decision",
      "decisions",
    ]);
    if (!decisionFieldId) {
      if (!trelloDecisionFieldWarnedBoards.has(card.idBoard)) {
        console.warn(
          '[WARN] Trello: no "DECISION" text custom field on board; skipped RRS decision copy.'
        );
        trelloDecisionFieldWarnedBoards.add(card.idBoard);
      }
      return;
    }
    await trelloSetCardTextCustomField(cardId, decisionFieldId, value);
    const label = caseNoForLog != null ? ` caso ${caseNoForLog}` : "";
    console.log(`[TRELLO]${label}: custom field DECISION updated from RRS Hearing Decisions`);
  } catch (error) {
    console.error(`[TRELLO] DECISION custom field:`, error.message);
  }
}

async function trelloSyncFullDecisionCheckbox(cardId, caseNoForLog) {
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !cardId) {
    return;
  }
  try {
    const card = await trelloGetCard(cardId);
    if (!card.idBoard) {
      return;
    }
    const fields = await trelloGetBoardCustomFields(card.idBoard);
    const fieldId = trelloFindCheckboxFieldIdByNames(
      fields,
      FULL_DECISION_CHECKBOX_LABEL_NAMES
    );
    if (!fieldId) {
      if (!trelloFullDecisionCheckboxWarnedBoards.has(card.idBoard)) {
        console.warn(
          '[WARN] Trello: no hay custom field tipo casilla con nombre tipo "Full Decision"; se omite marcar casilla.'
        );
        trelloFullDecisionCheckboxWarnedBoards.add(card.idBoard);
      }
      return;
    }
    const url = `https://api.trello.com/1/cards/${encodeURIComponent(
      cardId
    )}/customField/${encodeURIComponent(fieldId)}/item?${trelloAuthParams().toString()}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: { checked: "true" },
      }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${bodyText}`);
    }
  } catch (error) {
    console.error(
      `[TRELLO] Full Decision checkbox (caso ${caseNoForLog}):`,
      error.message
    );
  }
}

async function trelloTryAttachFullDecisionFile(
  cardId,
  fileUrl,
  caseKey,
  caseNoForLog,
  fullDecisionSyncedByCase
) {
  if (!fullDecisionSyncedByCase || !fileUrl) {
    return;
  }
  let onCard;
  try {
    onCard = await trelloGetCardAttachmentUrls(cardId);
  } catch (error) {
    console.warn(`[TRELLO] Caso ${caseNoForLog}: adjuntos:`, error.message);
    onCard = new Set();
  }
  if (onCard.has(fileUrl)) {
    fullDecisionSyncedByCase[caseKey] = fileUrl;
    return;
  }
  if (fullDecisionSyncedByCase[caseKey] === fileUrl) {
    return;
  }

  const displayName = attachmentFilenameFromUrl(fileUrl, "");

  try {
    await trelloAddCardAttachmentFromUrl(cardId, fileUrl, displayName || "Full Decision");
  } catch (e1) {
    try {
      await trelloAddCardAttachmentFromDownload(
        cardId,
        fileUrl,
        displayName || "Full Decision"
      );
    } catch (e2) {
      console.error(
        `[TRELLO] Caso ${caseNoForLog} Full Decision adjunto:`,
        e1.message,
        "|",
        e2.message
      );
      return;
    }
  }
  fullDecisionSyncedByCase[caseKey] = fileUrl;
  console.log(`[TRELLO] Caso ${caseNoForLog}: adjunto Full Decision`);
}

async function trelloSyncFullDecisionLinkForCard(
  cardId,
  caseKey,
  decisionsDetailMap,
  fullDecisionSyncedByCase,
  caseNoForLog
) {
  if (!decisionsDetailMap || !cardId || !fullDecisionSyncedByCase) {
    return;
  }
  const detail = decisionsDetailMap.get(caseKey);
  const fileUrl = detail?.fullDecisionUrl ? normalize(detail.fullDecisionUrl) : "";
  if (!fileUrl) {
    return;
  }
  await trelloSyncFullDecisionCheckbox(cardId, caseNoForLog);
  await trelloTryAttachFullDecisionFile(
    cardId,
    fileUrl,
    caseKey,
    caseNoForLog,
    fullDecisionSyncedByCase
  );
}

async function trelloMoveCardToList(cardId, listId, desc) {
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}?${trelloAuthParams().toString()}`;
  const payload = { idList: listId, pos: TRELLO_CARD_POS_TOP };
  if (desc !== undefined) {
    payload.desc = desc;
  }
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello move card: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

/** Time limits y document TOA (únicos usos): nombre/desc + al inicio de la lista en cada PUT. */
async function trelloUpdateCardNameDesc(cardId, name, desc) {
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}?${trelloAuthParams().toString()}`;
  const payload = { pos: TRELLO_CARD_POS_TOP };
  if (name !== undefined) payload.name = name;
  if (desc !== undefined) payload.desc = desc;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello update card: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

function trelloTargetListIdForActiveRow(row) {
  if (CONFIG.trelloScheduleListId && scheduleUsesScheduleList(row.schedule)) {
    return CONFIG.trelloScheduleListId;
  }
  return CONFIG.trelloListId;
}

async function trelloSyncCardListForRow(cardId, row) {
  if (!CONFIG.trelloScheduleListId) {
    return;
  }
  const targetListId = trelloTargetListIdForActiveRow(row);
  try {
    const card = await trelloGetCard(cardId);
    if (card.idList === targetListId) {
      return;
    }
    await trelloMoveCardToList(cardId, targetListId);
    console.log(`[TRELLO] Caso ${row.no}: columna Trello según Schedule`);
  } catch (error) {
    console.error(`[TRELLO] Caso ${row.no} al sincronizar lista:`, error.message);
  }
}

async function trelloApplyRowToCard(cardId, row, hearingAttachmentUrlsByCase) {
  await trelloUpdateCard(cardId, row);
  await trelloSyncAmazingFields(cardId, row);
  await trelloSyncHearingTypeLabels(cardId, row);
  await trelloSyncCardListForRow(cardId, row);
  await trelloSyncHearingLinkAttachments(cardId, row, hearingAttachmentUrlsByCase);
}

async function handleRemovedRowTrello(
  cardId,
  row,
  decisionsDetailMap,
  fullDecisionSyncedByCase
) {
  const caseKey = hearingCaseKey(row.no);
  let decisionText = "";
  if (decisionsDetailMap) {
    const d = decisionsDetailMap.get(caseKey);
    if (d) {
      decisionText = d.text || "";
    }
  }

  await trelloSyncFullDecisionLinkForCard(
    cardId,
    caseKey,
    decisionsDetailMap,
    fullDecisionSyncedByCase,
    row.no
  );

  const bodyDesc = trelloCardDescriptionForRow(row, null, {
    decision: decisionText || undefined,
  });
  const appendix = "\n\n---\nCaso eliminado del calendario RRS";

  try {
    const newDesc = `${bodyDesc.trim()}${appendix}`;
    await trelloUpdateCardNameDesc(cardId, undefined, newDesc);
    await trelloAddDecidedLabel(cardId, row.no);
    if (decisionsDetailMap !== null && decisionsDetailMap !== undefined) {
      await trelloSyncDecisionCustomField(
        cardId,
        decisionText == null ? "" : String(decisionText),
        row.no
      );
    }
    console.log(
      `[TRELLO] Caso ${row.no}: tarjeta actualizada (permanece en su lista; etiqueta Decided)`
    );
  } catch (error) {
    console.error(`[TRELLO] Caso ${row.no} al cerrar en Trello:`, error.message);
  }
}

async function trelloCreateTimeLimitCard(row) {
  const url = `https://api.trello.com/1/cards?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idList: CONFIG.trelloTimelimitListId,
      name: timeLimitCardTitle(row),
      desc: timeLimitDescription(row),
      pos: TRELLO_CARD_POS_TOP,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello create time-limit card: ${response.status} ${bodyText}`);
  }
  return JSON.parse(bodyText);
}

async function trelloApplyTimeLimitRow(cardId, row) {
  await trelloUpdateCardNameDesc(
    cardId,
    timeLimitCardTitle(row),
    timeLimitDescription(row)
  );
}

async function handleRemovedTimeLimitTrello(cardId, row) {
  const baseTitle = timeLimitCardTitle(row);
  try {
    const current = await trelloGetCard(cardId);
    const nm = normalize(current.name);
    const nextTitle = TL_TIME_OUT_PREFIX.test(nm) ? current.name : `TIME OUT ${baseTitle}`;
    await trelloUpdateCardNameDesc(cardId, nextTitle, timeLimitDescription(row));
    console.log(`[TRELLO] Time limit retirado de la web (${timeLimitRowKey(row)}): ${nextTitle}`);
  } catch (error) {
    console.error(`[TRELLO] Time limit ${timeLimitRowKey(row)} al marcar TIME OUT:`, error.message);
  }
}

async function applyTimeLimitTrelloCycle(previousState, currentRows, changes) {
  if (!CONFIG.trelloEnabled) {
    return { ...(previousState?.trelloTimeLimitCards || {}) };
  }
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !CONFIG.trelloTimelimitListId) {
    return { ...(previousState?.trelloTimeLimitCards || {}) };
  }

  const trelloTimeLimitCards = { ...(previousState?.trelloTimeLimitCards || {}) };

  for (const row of changes.removed) {
    const k = timeLimitRowKey(row);
    const cardId = trelloTimeLimitCards[k];
    if (cardId) {
      await handleRemovedTimeLimitTrello(cardId, row);
    }
    delete trelloTimeLimitCards[k];
  }

  for (const item of changes.modified) {
    const cardId = trelloTimeLimitCards[item.key];
    if (!cardId) {
      continue;
    }
    try {
      await trelloApplyTimeLimitRow(cardId, item.after);
      console.log(`[TRELLO] Time limit actualizado (${item.key})`);
    } catch (error) {
      console.error(`[TRELLO] Actualizar time limit ${item.key}:`, error.message);
    }
  }

  for (const row of currentRows) {
    const k = timeLimitRowKey(row);
    if (trelloTimeLimitCards[k]) {
      continue;
    }
    try {
      const card = await trelloCreateTimeLimitCard(row);
      trelloTimeLimitCards[k] = card.id;
      console.log(`[TRELLO] Time limit nueva tarjeta ${k} -> ${card.id}`);
    } catch (error) {
      console.error(`[TRELLO] Crear time limit ${k}:`, error.message);
    }
  }

  return trelloTimeLimitCards;
}

async function trelloCreateDocumentCard(row) {
  const url = `https://api.trello.com/1/cards?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idList: CONFIG.trelloToaDocumentsListId,
      name: eventDocumentCardTitle(row),
      desc: eventDocumentCardDescription(row),
      pos: TRELLO_CARD_POS_TOP,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello create document card: ${response.status} ${bodyText}`);
  }
  const card = JSON.parse(bodyText);
  if (row.href) {
    try {
      await trelloAddCardAttachmentFromUrl(card.id, row.href, "Documento");
    } catch (e) {
      console.error(`[TRELLO] Error adjuntando archivo a documento ${row.rowId}:`, e.message);
    }
  }
  return card;
}

async function trelloApplyDocumentRow(cardId, row) {
  await trelloUpdateCardNameDesc(
    cardId,
    eventDocumentCardTitle(row),
    eventDocumentCardDescription(row)
  );
  if (row.href) {
    try {
      const attachments = await trelloGetCardAttachmentUrls(cardId);
      if (!attachments.has(row.href)) {
        await trelloAddCardAttachmentFromUrl(cardId, row.href, "Documento");
      }
    } catch (e) {
      console.error(`[TRELLO] Error sincronizando archivo en documento ${row.rowId}:`, e.message);
    }
  }
}

function questionCardTitle(row) {
  const n = normalize(row.no);
  const reg = normalize(row.regarding);
  return [`Q&A ${n}`, reg].filter(Boolean).join(" ");
}

function questionCardDescription(row) {
  return [
    `No: ${row.no || "-"}`,
    `Competitor: ${row.competitor || "-"}`,
    `For: ${row.forWhom || "-"}`,
    `Regarding: ${row.regarding || "-"}`,
    `State: ${row.state || "-"}`,
    `Answered?: ${row.answered || "-"}`,
  ].join("\n");
}

async function trelloCreateQuestionCard(row) {
  const url = `https://api.trello.com/1/cards?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idList: CONFIG.trelloQuestionsListId,
      name: questionCardTitle(row),
      desc: questionCardDescription(row),
      pos: TRELLO_CARD_POS_TOP,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello create question card: ${response.status} ${bodyText}`);
  }
  const card = JSON.parse(bodyText);

  // Sincronizar campos personalizados (Competitor -> Initiator, For -> Respondent)
  try {
    await trelloSyncAmazingFields(card.id, {
      initiator: row.competitor,
      respondents: row.forWhom,
    });
  } catch (e) {
    console.error(`[TRELLO] Error sincronizando campos en Q&A ${row.no}:`, e.message);
  }

  if (row.pdfUrl) {
    try {
      await trelloAddCardAttachmentFromUrl(card.id, row.pdfUrl, "Question PDF");
    } catch (e) {
      console.error(`[TRELLO] Error adjuntando PDF a Q&A ${row.no}:`, e.message);
    }
  }
  await trelloSyncQuestionLabels(card.id, row);
  return card;
}

async function trelloSyncQuestionLabels(cardId, row) {
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !cardId) return;
  try {
    const card = await trelloGetCard(cardId);
    if (!card.idBoard) return;
    const boardLabels = await trelloGetBoardLabels(card.idBoard);

    const qLabelNames = ["Race Committee", "Technical Committee", "Answered"];
    const qLabelIds = qLabelNames
      .map((n) => trelloFindLabelIdByNames(boardLabels, n))
      .filter(Boolean);

    const wantIds = new Set();
    const forText = normalize(row.forWhom).toLowerCase();
    if (forText.includes("race committee")) {
      const id = trelloFindLabelIdByNames(boardLabels, "Race Committee");
      if (id) wantIds.add(id);
    }
    if (forText.includes("technical committee")) {
      const id = trelloFindLabelIdByNames(boardLabels, "Technical Committee");
      if (id) wantIds.add(id);
    }

    // Si hay contenido en la columna 'Answered' (normalmente una fecha), ponemos la etiqueta
    if (normalize(row.answered)) {
      const id = trelloFindLabelIdByNames(boardLabels, "Answered");
      if (id) wantIds.add(id);
    }

    const onCard = await trelloGetCardLabels(cardId);
    const onCardIds = new Set(onCard.map((l) => l.id));

    for (const lid of qLabelIds) {
      const shouldHave = wantIds.has(lid);
      const has = onCardIds.has(lid);
      if (shouldHave && !has) await trelloAddCardLabel(cardId, lid);
      else if (!shouldHave && has) await trelloRemoveCardLabel(cardId, lid);
    }
  } catch (error) {
    console.error(`[TRELLO] Q&A ${row.no} etiquetas por 'for':`, error.message);
  }
}

async function trelloUpdateQuestionCard(cardId, row) {
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: questionCardTitle(row),
      desc: questionCardDescription(row),
      pos: TRELLO_CARD_POS_TOP,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello update question card: ${response.status} ${bodyText}`);
  }

  // Sincronizar campos personalizados (Competitor -> Initiator, For -> Respondent)
  try {
    await trelloSyncAmazingFields(cardId, {
      initiator: row.competitor,
      respondents: row.forWhom,
    });
  } catch (e) {
    console.error(`[TRELLO] Error sincronizando campos en Q&A ${row.no}:`, e.message);
  }

  if (row.pdfUrl) {
    try {
      const attachments = await trelloGetCardAttachmentUrls(cardId);
      if (!attachments.has(row.pdfUrl)) {
        await trelloAddCardAttachmentFromUrl(cardId, row.pdfUrl, "Question PDF");
      }
    } catch (e) {
      console.error(`[TRELLO] Error sincronizando PDF en Q&A ${row.no}:`, e.message);
    }
  }
  await trelloSyncQuestionLabels(cardId, row);
}

async function applyQuestionsTrelloCycle(previousState, currentRows, changes) {
  if (!CONFIG.trelloEnabled || !CONFIG.trelloQuestionsListId) {
    return { ...(previousState?.trelloQuestionCards || {}) };
  }

  const trelloQuestionCards = { ...(previousState?.trelloQuestionCards || {}) };

  for (const row of changes.removed) {
    const k = questionRowKey(row);
    delete trelloQuestionCards[k];
  }

  for (const item of changes.modified) {
    const cardId = trelloQuestionCards[item.key];
    if (!cardId) continue;
    try {
      await trelloUpdateQuestionCard(cardId, item.after);
      console.log(`[TRELLO] Q&A actualizado (${item.key})`);
    } catch (error) {
      console.error(`[TRELLO] Actualizar Q&A ${item.key}:`, error.message);
    }
  }

  for (const row of currentRows) {
    const k = questionRowKey(row);
    if (trelloQuestionCards[k]) continue;
    try {
      const card = await trelloCreateQuestionCard(row);
      trelloQuestionCards[k] = card.id;
      console.log(`[TRELLO] Q&A nueva tarjeta ${k} -> ${card.id}`);
    } catch (error) {
      console.error(`[TRELLO] Crear Q&A ${k}:`, error.message);
    }
  }

  return trelloQuestionCards;
}

function scoringInquiryCardTitle(row) {
  return `Scoring Enquiry nº ${normalize(row.no)}`;
}

function scoringInquiryCardDescription(row) {
  return [
    `Date: ${row.date || "-"}`,
    `Course: ${row.course || "-"}`,
    `Race: ${row.race || "-"}`,
    `Competitor: ${row.competitor || "-"}`,
    `Posted: ${row.posted || "-"}`,
    `Corrected: ${row.corrected || "-"}`,
    `Response: ${row.response || "-"}`,
  ].join("\n");
}

async function trelloSyncScoringInquiryLabels(cardId, row) {
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !cardId) return;
  try {
    const card = await trelloGetCard(cardId);
    if (!card.idBoard) return;
    const boardLabels = await trelloGetBoardLabels(card.idBoard);
    const answeredId = trelloFindLabelIdByNames(boardLabels, "Answered");
    if (!answeredId) return;

    const wantAnswered = Boolean(normalize(row.response));
    const onCard = await trelloGetCardLabels(cardId);
    const hasAnswered = onCard.some((l) => l.id === answeredId);

    if (wantAnswered && !hasAnswered) {
      await trelloAddCardLabel(cardId, answeredId);
    } else if (!wantAnswered && hasAnswered) {
      await trelloRemoveCardLabel(cardId, answeredId);
    }
  } catch (error) {
    console.error(`[TRELLO] Scoring Enquiry ${row.no} etiqueta Answered:`, error.message);
  }
}

async function trelloCreateScoringInquiryCard(row) {
  const url = `https://api.trello.com/1/cards?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idList: CONFIG.trelloQuestionsListId,
      name: scoringInquiryCardTitle(row),
      desc: scoringInquiryCardDescription(row),
      pos: TRELLO_CARD_POS_TOP,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello create scoring enquiry card: ${response.status} ${bodyText}`);
  }
  const card = JSON.parse(bodyText);

  if (row.pdfUrl) {
    try {
      await trelloAddCardAttachmentFromUrl(card.id, row.pdfUrl, "Scoring Enquiry PDF");
    } catch (e) {
      console.error(`[TRELLO] Error adjuntando PDF a Scoring Enquiry ${row.no}:`, e.message);
    }
  }
  await trelloSyncScoringInquiryLabels(card.id, row);
  return card;
}

async function trelloUpdateScoringInquiryCard(cardId, row) {
  const url = `https://api.trello.com/1/cards/${encodeURIComponent(
    cardId
  )}?${trelloAuthParams().toString()}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: scoringInquiryCardTitle(row),
      desc: scoringInquiryCardDescription(row),
      pos: TRELLO_CARD_POS_TOP,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Trello update scoring enquiry card: ${response.status} ${bodyText}`);
  }

  if (row.pdfUrl) {
    try {
      const attachments = await trelloGetCardAttachmentUrls(cardId);
      if (!attachments.has(row.pdfUrl)) {
        await trelloAddCardAttachmentFromUrl(cardId, row.pdfUrl, "Scoring Enquiry PDF");
      }
    } catch (e) {
      console.error(`[TRELLO] Error sincronizando PDF en Scoring Enquiry ${row.no}:`, e.message);
    }
  }
  await trelloSyncScoringInquiryLabels(cardId, row);
}

async function applyScoringInquiriesTrelloCycle(previousState, currentRows, changes) {
  if (!CONFIG.trelloEnabled || !CONFIG.trelloQuestionsListId) {
    return { ...(previousState?.trelloScoringInquiryCards || {}) };
  }

  const trelloScoringInquiryCards = { ...(previousState?.trelloScoringInquiryCards || {}) };

  for (const row of changes.removed) {
    const k = scoringInquiryRowKey(row);
    delete trelloScoringInquiryCards[k];
  }

  for (const item of changes.modified) {
    const cardId = trelloScoringInquiryCards[item.key];
    if (!cardId) continue;
    try {
      await trelloUpdateScoringInquiryCard(cardId, item.after);
      console.log(`[TRELLO] Scoring Enquiry actualizado (${item.key})`);
    } catch (error) {
      console.error(`[TRELLO] Actualizar Scoring Enquiry ${item.key}:`, error.message);
    }
  }

  for (const row of currentRows) {
    const k = scoringInquiryRowKey(row);
    if (trelloScoringInquiryCards[k]) continue;
    try {
      const card = await trelloCreateScoringInquiryCard(row);
      trelloScoringInquiryCards[k] = card.id;
      console.log(`[TRELLO] Scoring Enquiry nueva tarjeta ${k} -> ${card.id}`);
    } catch (error) {
      console.error(`[TRELLO] Crear Scoring Enquiry ${k}:`, error.message);
    }
  }

  return trelloScoringInquiryCards;
}

async function handleRemovedDocumentTrello(cardId, row) {
  const baseTitle = eventDocumentCardTitle(row);
  try {
    const current = await trelloGetCard(cardId);
    const nm = normalize(current.name);
    const nextTitle = DELETE_DOC_PREFIX.test(nm) ? current.name : `DELETE ${baseTitle}`;
    await trelloUpdateCardNameDesc(
      cardId,
      nextTitle,
      eventDocumentCardDescription(row)
    );
    console.log(`[TRELLO] Documento retirado de la web (${documentRowKey(row)}): ${nextTitle}`);
  } catch (error) {
    console.error(
      `[TRELLO] Documento ${documentRowKey(row)} al marcar DELETE:`,
      error.message
    );
  }
}

async function applyDocumentTrelloCycle(previousState, currentRows, changes) {
  if (!CONFIG.trelloEnabled) {
    return { ...(previousState?.trelloDocumentCards || {}) };
  }
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !CONFIG.trelloToaDocumentsListId) {
    if (!trelloDocumentSyncSkipLogged) {
      trelloDocumentSyncSkipLogged = true;
      console.warn(
        "[WARN] Trello documentos TOA: falta TRELLO_TOA_DOCUMENTS_LIST_ID o TRELLO_KEY/TOKEN; no se crean ni actualizan tarjetas de Event Documents."
      );
    }
    return { ...(previousState?.trelloDocumentCards || {}) };
  }

  const trelloDocumentCards = { ...(previousState?.trelloDocumentCards || {}) };

  if (
    currentRows.length > 0 &&
    Object.keys(trelloDocumentCards).length === 0
  ) {
    console.log(
      `[TRELLO] Documentos TOA: primera sincronización — ${currentRows.length} documento(s) en la web (incluye los ya publicados antes de arrancar el monitor).`
    );
  }

  for (const row of changes.removed) {
    const k = documentRowKey(row);
    const cardId = trelloDocumentCards[k];
    if (cardId) {
      await handleRemovedDocumentTrello(cardId, row);
    }
    delete trelloDocumentCards[k];
  }

  for (const item of changes.modified) {
    const cardId = trelloDocumentCards[item.key];
    if (!cardId) {
      continue;
    }
    try {
      await trelloApplyDocumentRow(cardId, item.after);
      console.log(`[TRELLO] Documento TOA actualizado (${item.key})`);
    } catch (error) {
      console.error(`[TRELLO] Actualizar documento ${item.key}:`, error.message);
    }
  }

  for (const row of currentRows) {
    const k = documentRowKey(row);
    if (trelloDocumentCards[k]) {
      continue;
    }
    try {
      const card = await trelloCreateDocumentCard(row);
      trelloDocumentCards[k] = card.id;
      console.log(`[TRELLO] Documento TOA nueva tarjeta ${k} -> ${card.id}`);
    } catch (error) {
      console.error(`[TRELLO] Crear documento ${k}:`, error.message);
    }
  }

  return trelloDocumentCards;
}

function validateTrelloConfig() {
  if (!CONFIG.trelloEnabled) {
    return;
  }
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !CONFIG.trelloListId) {
    console.warn(
      "[WARN] TRELLO_ENABLED pero faltan TRELLO_KEY, TRELLO_TOKEN o TRELLO_LIST_ID."
    );
  }
  if (!CONFIG.trelloScheduleListId) {
    console.warn(
      "[WARN] Falta TRELLO_SCHEDULE_LIST_ID: no se podrá mover a Schedule cuando haya hora."
    );
  }
  if (!CONFIG.trelloTimelimitListId) {
    console.warn(
      "[WARN] Falta TRELLO_TIMELIMIT_LIST_ID: no se crearán tarjetas de Protest Time Limit(s)."
    );
  }
  if (!CONFIG.trelloToaDocumentsListId) {
    console.warn(
      "[WARN] Falta TRELLO_TOA_DOCUMENTS_LIST_ID: no se sincronizarán Event Documents con TOA-Documents."
    );
  }
}

// ─── Tablas RRS genéricas (Retirements / Penalty Reports / On-water Penalties /
//     Crew Substitutions / Equipment Substitutions) ──────────────────────────
//
// Estructura verificada por HTTP (eventos 13730 / 13725). Todas comparten el
// mismo patrón: <table> con <thead><th> y una fila de estado vacío
// <tr><td colspan='N'>No … Found</td></tr>. El parser es dirigido por cabeceras
// para tolerar reordenación de columnas y columnas ocultas (`d-none`).

const RRS_EMPTY_ROW_RE = /\bno\b.*\b(found|encontrad\w*)\b/i;

/**
 * Parser de tabla RRS dirigido por cabeceras.
 * @param {string} html
 * @param {{ containerSelector?: string, requiredHeaders: string[], fieldMap: Record<string,string> }} opts
 * @returns {{ rows: object[], isEmpty: boolean, headers: string[] }}
 */
function extractRrsGenericTable(html, opts) {
  const { containerSelector, requiredHeaders = [], fieldMap = {} } = opts || {};
  const $ = cheerio.load(html);

  const headerText = ($th) => normalize($th.text()).toLowerCase();

  let $table = null;
  if (containerSelector) {
    const $candidate = $(containerSelector).first();
    if ($candidate.length && $candidate.is("table")) {
      $table = $candidate;
    } else if ($candidate.length) {
      $table = $candidate.find("table").first();
    }
  }
  if (!$table || !$table.length) {
    // Descubrir la tabla por sus cabeceras (igual que extractQuestionsRows).
    $("table").each((_, table) => {
      if ($table && $table.length) return;
      const heads = $(table)
        .find("thead th")
        .map((__, th) => headerText($(th)))
        .get();
      const ok = requiredHeaders.every((h) =>
        heads.some((head) => head === h || head.includes(h))
      );
      if (ok) {
        $table = $(table);
      }
    });
  }
  if (!$table || !$table.length) {
    return { rows: [], isEmpty: false, headers: [] };
  }

  const headers = $table
    .find("thead th")
    .map((__, th) => headerText($(th)))
    .get();
  const colIndexFor = (wanted) => {
    const w = String(wanted || "").toLowerCase();
    let idx = headers.findIndex((h) => h === w);
    if (idx < 0) idx = headers.findIndex((h) => h.includes(w) || w.includes(h));
    return idx;
  };

  const fieldCols = Object.fromEntries(
    Object.entries(fieldMap).map(([key, header]) => [key, colIndexFor(header)])
  );

  const rows = [];
  let isEmpty = false;
  $table.find("tbody tr").each((__, tr) => {
    const $tds = $(tr).find("td");
    if (!$tds.length) return;

    const joined = normalize($(tr).text());
    if ($tds.length === 1 || RRS_EMPTY_ROW_RE.test(joined)) {
      if (RRS_EMPTY_ROW_RE.test(joined) || !joined) isEmpty = true;
      return;
    }

    const cellText = (i) =>
      i >= 0 && i < $tds.length ? dedupeRepeatedWordSpans($tds.eq(i).text()) : "";

    const row = {};
    for (const [key, idx] of Object.entries(fieldCols)) {
      row[key] = cellText(idx);
    }

    const $pdf = $(tr).find('a[href$=".pdf"], a[href*=".pdf?"]').first();
    const pdfHref = normalize($pdf.attr("href"));
    if (pdfHref) row.actionsPdfUrl = absolutizeRrsHref(pdfHref);

    const hasAny = Object.values(row).some((v) => v);
    if (hasAny) rows.push(row);
  });

  return { rows, isEmpty, headers };
}

/** Registro declarativo de secciones tabulares RRS. */
const RRS_TABULAR_SECTIONS = [
  {
    id: "retirement",
    label: "Retirements",
    urlKey: "retirementsUrl",
    enabledKey: "retirementsEnabled",
    logTag: "RETIREMENTS",
    containerSelector: null,
    requiredHeaders: ["no.", "boat", "type"],
    fieldMap: {
      no: "no.",
      date: "date",
      boat: "boat",
      type: "type",
      raceNo: "race no.",
    },
  },
  {
    id: "penaltyReport",
    label: "Penalty Reports",
    urlKey: "penaltyReportsUrl",
    enabledKey: "penaltyReportsEnabled",
    logTag: "PENALTY_REPORTS",
    containerSelector: null,
    requiredHeaders: ["no.", "boats fouled", "penalty taken"],
    fieldMap: {
      no: "no.",
      date: "date",
      race: "race",
      leg: "leg",
      boat: "boat",
      boatsFouled: "boats fouled",
      penaltyTaken: "penalty taken",
    },
  },
  {
    id: "onWaterPenalty",
    label: "On-water Penalties",
    urlKey: "onWaterPenaltiesUrl",
    enabledKey: "penaltiesEnabled",
    logTag: "PENALTIES_ONWATER",
    containerSelector: "#penalty-scroller",
    requiredHeaders: ["class", "penalty", "rule"],
    fieldMap: {
      class: "class",
      nat: "nat.",
      sailNo: "sail no.",
      penalty: "penalty",
      date: "date",
      race: "race",
      leg: "leg",
      rule: "rule",
      response: "response",
      jury: "jury",
      judges: "judges",
    },
  },
  {
    id: "crewSubstitution",
    label: "Crew Substitutions",
    urlKey: "crewChangesUrl",
    enabledKey: "crewSubstitutionsEnabled",
    logTag: "CREW_SUBSTITUTIONS",
    containerSelector: "#substitution-scroller",
    requiredHeaders: ["no.", "boat", "new crew"],
    fieldMap: {
      no: "no.",
      boat: "boat",
      date: "date",
      previousCrew: "previous crew",
      newCrew: "new crew",
      status: "status",
    },
  },
  {
    id: "equipmentSubstitution",
    label: "Equipment Substitutions",
    urlKey: "equipmentSubstitutionsUrl",
    enabledKey: "equipmentSubstitutionsEnabled",
    logTag: "EQUIPMENT_SUBSTITUTIONS",
    containerSelector: "#substitution-scroller",
    requiredHeaders: ["no.", "old equip.", "new equip."],
    fieldMap: {
      no: "no.",
      boat: "boat",
      date: "date",
      oldEquip: "old equip.",
      newEquip: "new equip.",
      status: "status",
    },
  },
];

function genericRowKey(section, row) {
  const no = normalize(row.no);
  if (no) return no;
  return Object.keys(section.fieldMap)
    .map((key) => normalize(row[key]))
    .join("||");
}

function genericRowFingerprint(section, row) {
  return Object.keys(section.fieldMap)
    .map((key) => normalize(row[key]))
    .concat(normalize(row.actionsPdfUrl))
    .join("||");
}

function detectGenericRowChanges(section, previousRows, currentRows) {
  const prevMap = new Map(
    (previousRows || []).map((row) => [genericRowKey(section, row), row])
  );
  const curMap = new Map(
    (currentRows || []).map((row) => [genericRowKey(section, row), row])
  );

  const added = [];
  const modified = [];
  const removed = [];

  for (const [key, currentRow] of curMap.entries()) {
    const prevRow = prevMap.get(key);
    if (!prevRow) {
      added.push(currentRow);
      continue;
    }
    if (
      genericRowFingerprint(section, prevRow) !==
      genericRowFingerprint(section, currentRow)
    ) {
      modified.push({ key, before: prevRow, after: currentRow });
    }
  }
  for (const [key, prevRow] of prevMap.entries()) {
    if (!curMap.has(key)) removed.push(prevRow);
  }

  return { added, modified, removed };
}

function genericChangesEmpty() {
  return { added: [], modified: [], removed: [] };
}

function hasGenericChanges(changes) {
  return (
    (changes?.added?.length || 0) +
      (changes?.modified?.length || 0) +
      (changes?.removed?.length || 0) >
    0
  );
}

/**
 * Scrapea todas las secciones tabulares habilitadas en CONFIG.
 * 404 → sección vacía (algunos eventos no tienen ese módulo), sin console.error.
 * Devuelve { rowsById, changesById, anyChanges }.
 */
async function scrapeRrsTabularSections(previousState) {
  const rowsById = {};
  const changesById = {};
  let anyChanges = false;

  for (const section of RRS_TABULAR_SECTIONS) {
    const previousRows = previousState?.[`${section.id}Rows`] || [];
    const url = normalize(CONFIG[section.urlKey]);

    if (!CONFIG[section.enabledKey] || !url) {
      rowsById[section.id] = previousRows;
      changesById[section.id] = genericChangesEmpty();
      continue;
    }

    try {
      const html = await fetchHtml(url);
      const { rows } = extractRrsGenericTable(html, {
        containerSelector: section.containerSelector,
        requiredHeaders: section.requiredHeaders,
        fieldMap: section.fieldMap,
      });
      const changes = detectGenericRowChanges(section, previousRows, rows);
      rowsById[section.id] = rows;
      changesById[section.id] = changes;
      if (hasGenericChanges(changes)) anyChanges = true;
    } catch (error) {
      const notFound = /\b404\b/.test(error.message || "");
      if (notFound) {
        console.log(
          `[${section.logTag}] 404 en ${url}; se trata como sección vacía.`
        );
        const changes = detectGenericRowChanges(section, previousRows, []);
        rowsById[section.id] = [];
        changesById[section.id] = changes;
        if (hasGenericChanges(changes)) anyChanges = true;
      } else {
        console.error(`[${section.logTag}]`, error.message);
        rowsById[section.id] = previousRows;
        changesById[section.id] = genericChangesEmpty();
      }
    }
  }

  return { rowsById, changesById, anyChanges };
}

async function applyTrelloCycle(
  previousState,
  currentRows,
  changes,
  hearingAttachmentUrlsByCase,
  fullDecisionSyncedByCase
) {
  if (!CONFIG.trelloEnabled) {
    return {
      trelloCards: migrateStringKeysByHearingCase(previousState?.trelloCards || {}),
      trelloSyncedFingerprintByCase: migrateStringKeysByHearingCase(
        previousState?.trelloSyncedFingerprintByCase || {}
      ),
    };
  }
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !CONFIG.trelloListId) {
    return {
      trelloCards: migrateStringKeysByHearingCase(previousState?.trelloCards || {}),
      trelloSyncedFingerprintByCase: migrateStringKeysByHearingCase(
        previousState?.trelloSyncedFingerprintByCase || {}
      ),
    };
  }

  const trelloCards = migrateStringKeysByHearingCase(previousState?.trelloCards || {});
  const trelloSyncedFingerprintByCase = migrateStringKeysByHearingCase(
    previousState?.trelloSyncedFingerprintByCase || {}
  );
  const urlsByCase = hearingAttachmentUrlsByCase || {};
  const fdSynced = fullDecisionSyncedByCase || {};

  let decisionsDetailMap = null;
  if (normalize(CONFIG.decisionsUrl)) {
    try {
      const decHtml = await fetchAllDecisionPages(CONFIG.decisionsUrl);
      decisionsDetailMap = extractDecisionsDetailByCaseKey(decHtml);
    } catch (error) {
      console.warn(`[DECISIONS] ${error.message}`);
    }
  }

  for (const row of changes.removed) {
    const k = hearingCaseKey(row.no);
    const cardId = trelloCards[k];
    if (cardId) {
      await handleRemovedRowTrello(cardId, row, decisionsDetailMap, fdSynced);
    } else {
      console.warn(
        `[TRELLO] Caso ${row.no} retirado de la web pero no hay tarjeta en trelloCards (clave ${k}); no se actualiza en Trello.`
      );
    }
    delete trelloCards[k];
    delete trelloSyncedFingerprintByCase[k];
  }

  const modifiedCaseKeys = new Set(
    (changes.modified || []).map((item) =>
      hearingCaseKey(item.after?.no || item.before?.no)
    )
  );

  for (const item of changes.modified) {
    const k = hearingCaseKey(item.after?.no || item.before?.no);
    if (!trelloCards[k]) {
      console.warn(
        `[TRELLO] Caso ${item.after?.no || item.before?.no} modificado en RRS pero sin tarjeta (clave ${k}); se creará si sigue en la web.`
      );
    }
  }

  for (const row of currentRows) {
    const k = hearingCaseKey(row.no);
    if (trelloCards[k]) {
      continue;
    }
    try {
      const card = await trelloCreateCard(row);
      trelloCards[k] = card.id;
      console.log(`[TRELLO] Tarjeta creada para caso ${row.no} -> ${card.id}`);
    } catch (error) {
      console.error(`[TRELLO] Crear caso ${row.no}:`, error.message);
    }
  }

  for (const row of currentRows) {
    const k = hearingCaseKey(row.no);
    const cardId = trelloCards[k];
    if (!cardId) {
      continue;
    }
    const fp = rowFingerprint(row);
    const needsSync =
      modifiedCaseKeys.has(k) || trelloSyncedFingerprintByCase[k] !== fp;
    if (!needsSync) {
      continue;
    }
    try {
      await trelloApplyRowToCard(cardId, row, urlsByCase);
      trelloSyncedFingerprintByCase[k] = fp;
      if (modifiedCaseKeys.has(k)) {
        console.log(`[TRELLO] Tarjeta actualizada para caso ${row.no}`);
      } else {
        console.log(
          `[TRELLO] Tarjeta resincronizada para caso ${row.no} (estado RRS y Trello desalineados)`
        );
      }
    } catch (error) {
      console.error(`[TRELLO] Sincronizar caso ${row.no}:`, error.message);
    }
  }

  if (decisionsDetailMap) {
    for (const [caseKey, cardId] of Object.entries(trelloCards)) {
      if (!cardId) {
        continue;
      }
      await trelloSyncFullDecisionLinkForCard(
        cardId,
        caseKey,
        decisionsDetailMap,
        fdSynced,
        caseKey
      );
    }
  }

  return { trelloCards, trelloSyncedFingerprintByCase };
}

function changedFields(before, after) {
  const fields = [
    "no",
    "type",
    "race",
    "initiator",
    "respondents",
    "schedule",
    "location",
  ];
  return fields
    .filter((field) => normalize(before[field]) !== normalize(after[field]))
    .map((field) => `${field}: "${before[field] || "-"}" -> "${after[field] || "-"}"`);
}

function formatTelegramMessage(
  changes,
  timeLimitChanges,
  documentChanges,
  questionChanges,
  timestamp,
  baseline
) {
  const isBaseline = Boolean(baseline);
  const header = isBaseline ? "RRS inicio del sistema" : "RRS cambios detectados";
  const lines = [header, `Fecha: ${timestamp}`, ""];

  const tl = timeLimitChanges || {
    added: [],
    modified: [],
    removed: [],
  };

  const doc = documentChanges || {
    added: [],
    modified: [],
    removed: [],
  };

  const q = questionChanges || {
    added: [],
    modified: [],
    removed: [],
  };

  if (changes.added.length) {
    lines.push(`Audiencias nuevas: ${changes.added.length}`);
    changes.added.slice(0, 5).forEach((row) => {
      lines.push(summarizeRow(row));
      lines.push("");
    });
    if (changes.added.length > 5) {
      lines.push(`... y ${changes.added.length - 5} más`);
    }
    lines.push("");
  }

  if (changes.modified.length) {
    lines.push(`Audiencias modificadas: ${changes.modified.length}`);
    changes.modified.slice(0, 3).forEach((item) => {
      const caseLabel = normalize(item.after.no || item.before.no) || "?";
      lines.push(`Caso ${caseLabel}:`);
      const fieldChanges = changedFields(item.before, item.after);
      if (!fieldChanges.length) {
        lines.push(
          "  (Sin cambios en las columnas listadas; revisar adjuntos Type en RRS/Trello si aplica.)"
        );
      } else {
        fieldChanges.forEach((entry) => lines.push(`  - ${entry}`));
      }
      lines.push("");
      lines.push("Estado actual:");
      lines.push(summarizeRow(item.after));
      lines.push("");
    });
    if (changes.modified.length > 3) {
      lines.push(`... y ${changes.modified.length - 3} modificaciones más`);
    }
    lines.push("");
  }

  if (changes.removed.length) {
    lines.push(`Audiencias eliminadas: ${changes.removed.length}`);
    changes.removed.slice(0, 5).forEach((row) => {
      lines.push(summarizeRow(row));
      lines.push("");
    });
    if (changes.removed.length > 5) {
      lines.push(`... y ${changes.removed.length - 5} más`);
    }
    lines.push("");
  }

  if (tl.added.length || tl.modified.length || tl.removed.length) {
    lines.push("--- Protest Time Limit(s)");
    if (tl.added.length) {
      lines.push(`Nuevos: ${tl.added.length}`);
      tl.added.forEach((row) => {
        lines.push(summarizeTimeLimitRow(row));
        lines.push("");
      });
    }
    if (tl.modified.length) {
      lines.push(`Modificados: ${tl.modified.length}`);
      tl.modified.slice(0, 3).forEach((item) => {
        lines.push("Antes:");
        lines.push(summarizeTimeLimitRow(item.before));
        lines.push("");
        lines.push("Despues:");
        lines.push(summarizeTimeLimitRow(item.after));
        lines.push("");
      });
      if (tl.modified.length > 3) {
        lines.push(`... y ${tl.modified.length - 3} más`);
      }
      lines.push("");
    }
    if (tl.removed.length) {
      lines.push(`Retirados de la web (TIME OUT en Trello): ${tl.removed.length}`);
      tl.removed.slice(0, 5).forEach((row) => {
        lines.push(summarizeTimeLimitRow(row));
        lines.push("");
      });
    }
  }

  if (doc.added.length || doc.modified.length || doc.removed.length) {
    lines.push("--- Event Documents");
    if (doc.added.length) {
      lines.push(`Documentos nuevos: ${doc.added.length}`);
      doc.added.forEach((row) => {
        lines.push(summarizeDocumentRow(row));
        lines.push("");
      });
    }
    if (doc.modified.length) {
      lines.push(`Documentos modificados: ${doc.modified.length}`);
      doc.modified.slice(0, 3).forEach((item) => {
        lines.push("Antes:");
        lines.push(summarizeDocumentRow(item.before));
        lines.push("");
        lines.push("Despues:");
        lines.push(summarizeDocumentRow(item.after));
        lines.push("");
      });
      if (doc.modified.length > 3) {
        lines.push(`... y ${doc.modified.length - 3} más`);
      }
      lines.push("");
    }
    if (doc.removed.length) {
      lines.push(`Documentos eliminados (DELETE en Trello): ${doc.removed.length}`);
      doc.removed.slice(0, 5).forEach((row) => {
        lines.push(summarizeDocumentRow(row));
        lines.push("");
      });
    }
  }

  if (q.added.length || q.modified.length || q.removed.length) {
    lines.push("--- Q&A (Questions)");
    if (q.added.length) {
      lines.push(`Nuevas preguntas: ${q.added.length}`);
      q.added.slice(0, 5).forEach((row) => {
        lines.push(`No: ${row.no} - ${row.regarding}`);
        lines.push("");
      });
    }
    if (q.modified.length) {
      lines.push(`Preguntas modificadas: ${q.modified.length}`);
      q.modified.slice(0, 3).forEach((item) => {
        lines.push(`No: ${item.after.no}`);
        lines.push(`Estado: ${item.before.state} -> ${item.after.state}`);
        lines.push(`Respondida: ${item.before.answered || "No"} -> ${item.after.answered || "No"}`);
        lines.push("");
      });
    }
  }

  return lines.join("\n");
}

async function sendTelegramNotification(message) {
  if (!CONFIG.telegramEnabled) {
    return;
  }

  if (!CONFIG.telegramBotToken || !CONFIG.telegramChatId) {
    console.warn("[WARN] Telegram activado pero faltan TELEGRAM_BOT_TOKEN/CHAT_ID.");
    return;
  }

  const endpoint = `https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CONFIG.telegramChatId,
      text: message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram error: ${response.status} ${body}`);
  }
}

function reloadConfig() {
  // Re-read .env file and update process.env and CONFIG
  const ENV_FILE = path.join(__dirname, '.env');
  const envContent = fsSync.readFileSync(ENV_FILE, 'utf8');
  const envLines = envContent.split('\n');
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key) process.env[key] = valueParts.join('=');
  }

  const newEventId = process.env.RRS_EVENT_ID || null;
  if (newEventId !== CONFIG.eventId) {
    CONFIG.eventId = newEventId;
    CONFIG.url = process.env.RRS_URL || `${RRS_ORIGIN}/schedules/${newEventId}/event`;
    CONFIG.documentsUrl = process.env.RRS_DOCUMENTS_URL || `${RRS_ORIGIN}/documents/${newEventId}/event`;
    CONFIG.decisionsUrl = process.env.RRS_DECISIONS_URL || `${RRS_ORIGIN}/decisions/${newEventId}/event`;
    CONFIG.questionsUrl = process.env.RRS_QUESTIONS_URL || `${RRS_ORIGIN}/questions/${newEventId}/event`;
    CONFIG.scoringEnquiriesUrl = process.env.RRS_SCORINGENQUIRIES_URL || `${RRS_ORIGIN}/scoring_inquiries/${newEventId}/event`;
  }
}

async function runMonitorCycle() {
  reloadConfig();
  const timestamp = formatReportTimestamp();
  console.log(`[CYCLE] ${timestamp}`);
  const html = await fetchHtml(CONFIG.url);
  const currentRows = extractTableRows(html);
  const currentTimeLimits = extractTimeLimitRows(html);

  // Scraping del nombre y logo de la regata (y URL externa de Results).
  const scraped = scrapeEventInfo(html);
  if (scraped.eventTitle || scraped.eventLogoUrl || scraped.resultsUrl) {
    try {
      await saveScrapedEventInfo(scraped);
    } catch (error) {
      console.error("[EVENT INFO]", error.message);
    }
  }

  let previousState = await loadState();
  // Si el estado guardado es de OTRO evento (cambió RRS_EVENT_ID), reset completo:
  // se vacían state/checks/changes (con copia de seguridad) y este ciclo pasa a ser
  // la línea base del evento nuevo. Solo se dispara si el estado previo TENÍA un
  // eventId guardado y es distinto (un state antiguo sin eventId no cuenta).
  if (previousState && previousState.eventId && previousState.eventId !== CONFIG.eventId) {
    await resetEventDataOnEventChange(previousState.eventId, CONFIG.eventId || "sin id");
    previousState = null;
  }
  const previousRows = previousState?.rows || [];
  const previousTimeLimits = previousState?.timeLimitRows || [];
  const previousDocumentRows = previousState?.documentRows || [];
  const previousQuestionRows = previousState?.questionRows || [];
  const previousScoringInquiryRows = previousState?.scoringInquiryRows || [];

  let documentRowsForState = previousDocumentRows;
  let documentChanges = { added: [], modified: [], removed: [] };
  if (CONFIG.documentsEnabled && normalize(CONFIG.documentsUrl)) {
    try {
      const docHtml = await fetchHtml(CONFIG.documentsUrl);
      const currentDocumentRows = extractEventDocumentRows(docHtml);
      documentRowsForState = currentDocumentRows;
      documentChanges = detectDocumentChanges(previousDocumentRows, currentDocumentRows);
    } catch (error) {
      console.error("[DOCS]", error.message);
      documentRowsForState = previousDocumentRows;
      documentChanges = { added: [], modified: [], removed: [] };
    }
  }

  let questionRowsForState = previousQuestionRows;
  let questionChanges = { added: [], modified: [], removed: [] };
  if (CONFIG.questionsEnabled && normalize(CONFIG.questionsUrl)) {
    try {
      const qHtml = await fetchHtml(CONFIG.questionsUrl);
      const currentQuestionRows = extractQuestionsRows(qHtml);
      questionRowsForState = currentQuestionRows;
      questionChanges = detectQuestionsChanges(previousQuestionRows, currentQuestionRows);
    } catch (error) {
      console.error("[QUESTIONS]", error.message);
      questionRowsForState = previousQuestionRows;
      questionChanges = { added: [], modified: [], removed: [] };
    }
  }

  let scoringInquiryRowsForState = previousScoringInquiryRows;
  let scoringInquiryChanges = { added: [], modified: [], removed: [] };
  if (CONFIG.scoringEnquiriesEnabled && normalize(CONFIG.scoringEnquiriesUrl)) {
    try {
      const siHtml = await fetchHtml(CONFIG.scoringEnquiriesUrl);
      const currentScoringInquiryRows = extractScoringInquiryRows(siHtml);
      scoringInquiryRowsForState = currentScoringInquiryRows;
      scoringInquiryChanges = detectScoringInquiryChanges(
        previousScoringInquiryRows,
        currentScoringInquiryRows
      );
    } catch (error) {
      console.error("[SCORING_INQUIRIES]", error.message);
      scoringInquiryRowsForState = previousScoringInquiryRows;
      scoringInquiryChanges = { added: [], modified: [], removed: [] };
    }
  }

  const changes = detectChanges(previousRows, currentRows);
  const timeLimitChanges = detectTimeLimitChanges(previousTimeLimits, currentTimeLimits);

  let decisionRowsForState = previousState?.decisionRows || [];
  if (CONFIG.decisionsEnabled && normalize(CONFIG.decisionsUrl)) {
    try {
      const decHtml = await fetchHtml(CONFIG.decisionsUrl);
      const decisionsDetailMap = extractDecisionsDetailByCaseKey(decHtml);
      decisionRowsForState = buildDecisionRowsFromState(
        decisionsDetailMap,
        currentRows,
        previousRows
      );
    } catch (error) {
      console.error("[DECISIONS]", error.message);
      decisionRowsForState = previousState?.decisionRows || [];
    }
  }

  // Secciones tabulares RRS (retirements, penalty reports, on-water penalties,
  // crew substitutions, equipment substitutions). Solo scraping + estado +
  // dashboard: no disparan Telegram ni Trello.
  const tabular = await scrapeRrsTabularSections(previousState);

  const hearingAttachmentUrlsByCase = migrateStringKeysByHearingCase(
    previousState?.hearingAttachmentUrlsByCase || {}
  );
  const fullDecisionSyncedByCase = migrateStringKeysByHearingCase(
    previousState?.fullDecisionSyncedByCase || {}
  );
  for (const row of changes.removed) {
    delete hearingAttachmentUrlsByCase[hearingCaseKey(row.no)];
    delete fullDecisionSyncedByCase[hearingCaseKey(row.no)];
  }

  const hasHearingChanges =
    changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.removed.length > 0;
  const hasTimeLimitChanges =
    timeLimitChanges.added.length > 0 ||
    timeLimitChanges.modified.length > 0 ||
    timeLimitChanges.removed.length > 0;
  const hasDocumentChanges =
    documentChanges.added.length > 0 ||
    documentChanges.modified.length > 0 ||
    documentChanges.removed.length > 0;
  const hasQuestionChanges =
    questionChanges.added.length > 0 ||
    questionChanges.modified.length > 0 ||
    questionChanges.removed.length > 0;
  const hasScoringInquiryChanges =
    scoringInquiryChanges.added.length > 0 ||
    scoringInquiryChanges.modified.length > 0 ||
    scoringInquiryChanges.removed.length > 0;
  const hasChanges =
    hasHearingChanges ||
    hasTimeLimitChanges ||
    hasDocumentChanges ||
    hasQuestionChanges ||
    hasScoringInquiryChanges;

  // Cambios en las secciones tabulares: se registran en changes.jsonl pero
  // NO disparan Telegram.
  const hasTabularChanges = tabular.anyChanges;
  const shouldRecordChanges = hasChanges || hasTabularChanges;

  let trelloCards = migrateStringKeysByHearingCase(previousState?.trelloCards || {});
  let trelloSyncedFingerprintByCase = migrateStringKeysByHearingCase(
    previousState?.trelloSyncedFingerprintByCase || {}
  );
  if (
    CONFIG.trelloEnabled &&
    CONFIG.trelloKey &&
    CONFIG.trelloToken &&
    CONFIG.trelloListId
  ) {
    const trelloResult = await applyTrelloCycle(
      previousState,
      currentRows,
      changes,
      hearingAttachmentUrlsByCase,
      fullDecisionSyncedByCase
    );
    trelloCards = trelloResult.trelloCards;
    trelloSyncedFingerprintByCase = trelloResult.trelloSyncedFingerprintByCase;
  }

  let trelloTimeLimitCards = { ...(previousState?.trelloTimeLimitCards || {}) };
  if (CONFIG.trelloEnabled && CONFIG.trelloKey && CONFIG.trelloToken) {
    trelloTimeLimitCards = await applyTimeLimitTrelloCycle(
      previousState,
      currentTimeLimits,
      timeLimitChanges
    );
  }

  let trelloDocumentCards = { ...(previousState?.trelloDocumentCards || {}) };
  if (CONFIG.trelloEnabled && CONFIG.trelloKey && CONFIG.trelloToken) {
    trelloDocumentCards = await applyDocumentTrelloCycle(
      previousState,
      documentRowsForState,
      documentChanges
    );
  }

  let trelloQuestionCards = { ...(previousState?.trelloQuestionCards || {}) };
  if (CONFIG.trelloEnabled && CONFIG.trelloKey && CONFIG.trelloToken) {
    trelloQuestionCards = await applyQuestionsTrelloCycle(
      previousState,
      questionRowsForState,
      questionChanges
    );
  }

  let trelloScoringInquiryCards = { ...(previousState?.trelloScoringInquiryCards || {}) };
  if (CONFIG.trelloEnabled && CONFIG.trelloKey && CONFIG.trelloToken) {
    trelloScoringInquiryCards = await applyScoringInquiriesTrelloCycle(
      previousState,
      scoringInquiryRowsForState,
      scoringInquiryChanges
    );
  }

  const snapshot = {
    timestamp,
    eventId: CONFIG.eventId || null,
    decisionRowCount: decisionRowsForState.length,
    decisionRows: decisionRowsForState,
    rowCount: currentRows.length,
    rows: currentRows,
    timeLimitRowCount: currentTimeLimits.length,
    timeLimitRows: currentTimeLimits,
    documentRowCount: documentRowsForState.length,
    documentRows: documentRowsForState,
    questionRowCount: questionRowsForState.length,
    questionRows: questionRowsForState,
    scoringInquiryRowCount: scoringInquiryRowsForState.length,
    scoringInquiryRows: scoringInquiryRowsForState,
    // Secciones tabulares RRS: un array + su contador por sección.
    retirementRowCount: tabular.rowsById.retirement.length,
    retirementRows: tabular.rowsById.retirement,
    penaltyReportRowCount: tabular.rowsById.penaltyReport.length,
    penaltyReportRows: tabular.rowsById.penaltyReport,
    onWaterPenaltyRowCount: tabular.rowsById.onWaterPenalty.length,
    onWaterPenaltyRows: tabular.rowsById.onWaterPenalty,
    crewSubstitutionRowCount: tabular.rowsById.crewSubstitution.length,
    crewSubstitutionRows: tabular.rowsById.crewSubstitution,
    equipmentSubstitutionRowCount: tabular.rowsById.equipmentSubstitution.length,
    equipmentSubstitutionRows: tabular.rowsById.equipmentSubstitution,
    // Alias de compatibilidad con el dashboard actual (pestaña "penalties").
    penaltyRowCount: tabular.rowsById.onWaterPenalty.length,
    penaltyRows: tabular.rowsById.onWaterPenalty,
    trelloCards,
    trelloSyncedFingerprintByCase,
    trelloTimeLimitCards,
    trelloDocumentCards,
    trelloQuestionCards,
    trelloScoringInquiryCards,
    hearingAttachmentUrlsByCase,
    fullDecisionSyncedByCase,
  };

  await appendCheck(snapshot, shouldRecordChanges, !previousState);

  if (!previousState) {
    console.log(
      `[INIT] Estado inicial: ${currentRows.length} audiencias, ${currentTimeLimits.length} time limit(s), ${documentRowsForState.length} documento(s), ${questionRowsForState.length} preguntas, ${scoringInquiryRowsForState.length} scoring enquiries.`
    );
  }

  const tabularChangeSummary = RRS_TABULAR_SECTIONS.map((section) => {
    const c = tabular.changesById[section.id];
    return `${section.id} +${c.added.length} ~${c.modified.length} -${c.removed.length}`;
  }).join(" | ");

  if (shouldRecordChanges) {
    const event = {
      timestamp,
      changes,
      timeLimitChanges,
      documentChanges,
      questionChanges,
      scoringInquiryChanges,
      retirementChanges: tabular.changesById.retirement,
      penaltyReportChanges: tabular.changesById.penaltyReport,
      onWaterPenaltyChanges: tabular.changesById.onWaterPenalty,
      crewSubstitutionChanges: tabular.changesById.crewSubstitution,
      equipmentSubstitutionChanges: tabular.changesById.equipmentSubstitution,
      currentRowCount: currentRows.length,
      currentTimeLimitCount: currentTimeLimits.length,
      currentDocumentCount: documentRowsForState.length,
      currentQuestionCount: questionRowsForState.length,
      currentScoringInquiryCount: scoringInquiryRowsForState.length,
      currentRetirementCount: tabular.rowsById.retirement.length,
      currentPenaltyReportCount: tabular.rowsById.penaltyReport.length,
      currentOnWaterPenaltyCount: tabular.rowsById.onWaterPenalty.length,
      currentCrewSubstitutionCount: tabular.rowsById.crewSubstitution.length,
      currentEquipmentSubstitutionCount:
        tabular.rowsById.equipmentSubstitution.length,
      ...(previousState ? {} : { baseline: true }),
    };

    await appendJsonLine(CONFIG.changesFile, event);
    console.log(
      `[CHANGES] Audiencias +${changes.added.length} ~${changes.modified.length} -${changes.removed.length} | TimeLimit +${timeLimitChanges.added.length} ~${timeLimitChanges.modified.length} -${timeLimitChanges.removed.length} | Docs +${documentChanges.added.length} ~${documentChanges.modified.length} -${documentChanges.removed.length} | Questions +${questionChanges.added.length} ~${questionChanges.modified.length} -${questionChanges.removed.length} | Scoring +${scoringInquiryChanges.added.length} ~${scoringInquiryChanges.modified.length} -${scoringInquiryChanges.removed.length} | ${tabularChangeSummary}`
    );

    if (hasChanges) {
      const message = formatTelegramMessage(
        changes,
        timeLimitChanges,
        documentChanges,
        questionChanges,
        timestamp,
        !previousState
      );
      try {
        await sendTelegramNotification(message);
      } catch (error) {
        console.error("[TELEGRAM]", error.message);
      }
    }
  } else if (previousState) {
    console.log(
      `[NO_CHANGES] ${timestamp} (${currentRows.length} audiencias, ${currentTimeLimits.length} time limit(s), ${documentRowsForState.length} documento(s), ${questionRowsForState.length} preguntas, ${scoringInquiryRowsForState.length} scoring enquiries, ${tabular.rowsById.retirement.length} retirements, ${tabular.rowsById.penaltyReport.length} penalty reports, ${tabular.rowsById.onWaterPenalty.length} on-water penalties, ${tabular.rowsById.crewSubstitution.length} crew subs, ${tabular.rowsById.equipmentSubstitution.length} equipment subs)`
    );
  }

  await saveState(snapshot);
  await syncKanbanFromSnapshot(snapshot);
}

async function main() {
  if (!CONFIG.url) {
    throw new Error(
      "Falta RRS_EVENT_ID (o URLs finales sin {id_evento}/[id_evento]) para armar RRS_URL en .env."
    );
  }

  validateTrelloConfig();

  await ensureDataDir();

  const runOnce = process.argv.includes("--once");
  console.log(`[START] Monitor RRS -> ${CONFIG.url}`);
  if (CONFIG.documentsUrl) {
    console.log(`[START] Documentos RRS -> ${CONFIG.documentsUrl}`);
  }
  if (CONFIG.decisionsUrl) {
    console.log(`[START] Hearing Decisions RRS -> ${CONFIG.decisionsUrl}`);
  }
  if (CONFIG.questionsUrl) {
    console.log(`[START] Q&A Questions RRS -> ${CONFIG.questionsUrl}`);
  }
  if (CONFIG.scoringEnquiriesUrl) {
    console.log(`[START] Scoring Inquiries RRS -> ${CONFIG.scoringEnquiriesUrl}`);
  }
  if (CONFIG.penaltyReportsUrl) {
    console.log(`[START] Penalty Reports RRS -> ${CONFIG.penaltyReportsUrl}`);
  }
  if (CONFIG.retirementsUrl) {
    console.log(`[START] Retirements RRS -> ${CONFIG.retirementsUrl}`);
  }
  if (CONFIG.onWaterPenaltiesUrl) {
    console.log(`[START] On-water Penalties RRS -> ${CONFIG.onWaterPenaltiesUrl}`);
  }
  if (CONFIG.crewChangesUrl) {
    console.log(`[START] Crew Substitutions RRS -> ${CONFIG.crewChangesUrl}`);
  }
  if (CONFIG.equipmentSubstitutionsUrl) {
    console.log(
      `[START] Equipment Substitutions RRS -> ${CONFIG.equipmentSubstitutionsUrl}`
    );
  }

  const execute = async () => {
    try {
      await runMonitorCycle();
    } catch (error) {
      console.error("[ERROR]", error.message);
    }
  };

  await execute();

  if (runOnce) {
    return;
  }

  console.log(`[LOOP] Revisando cada ${CONFIG.intervalMs / 1000} segundos.`);
  setInterval(execute, CONFIG.intervalMs);
}

/** Exporta funciones puras para `node:test` sin disparar `main()` al hacer `require()`. */
module.exports = {
  padTimePart,
  zonedOffsetRFC,
  formatReportTimestamp,
  normalize,
  dedupeRepeatedWordSpans,
  hearingCaseKey,
  migrateStringKeysByHearingCase,
  deriveRrsEventIdFromUrl,
  expandRrsUrlTemplate,
  hearingTypeToLabelNames,
  rowFingerprint,
  extractTimeLimitRows,
  timeLimitRowKey,
  timeLimitFingerprint,
  timeLimitCardTitle,
  summarizeTimeLimitRow,
  timeLimitDescription,
  detectTimeLimitChanges,
  absolutizeRrsHref,
  extractEventDocumentRows,
  extractQuestionsRows,
  questionRowKey,
  questionFingerprint,
  detectQuestionsChanges,
  extractScoringInquiryRows,
  scoringInquiryRowKey,
  scoringInquiryFingerprint,
  detectScoringInquiryChanges,
  documentRowKey,
  eventDocumentFingerprint,
  eventDocumentCardTitle,
  eventDocumentCardDescription,
  summarizeDocumentRow,
  detectDocumentChanges,
  countDecidedDecisionRows,
  scrapeEventInfo,
  extractTableRows,
  linkTextIsFullDecision,
  toAbsoluteUrl,
  extractDecisionsDetailByCaseKey,
  buildDecisionRowsFromState,
  detectChanges,
  summarizeRow,
  trelloCardTitle,
  scheduleHasClockTime,
  scheduleIsPending,
  scheduleUsesScheduleList,
  formatScheduleForTrelloDescription,
  normalizeFieldLabel,
  extractRrsGenericTable,
  genericRowKey,
  genericRowFingerprint,
  detectGenericRowChanges,
  genericChangesEmpty,
  hasGenericChanges,
  changedFields,
  formatTelegramMessage,
};

if (require.main === module) {
  main().catch((error) => {
    console.error("[FATAL]", error.message);
    process.exit(1);
  });
}
