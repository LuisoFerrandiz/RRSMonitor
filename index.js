require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** Algunas celdas RRS concatenan dos veces el mismo texto en el DOM. */
function dedupeRepeatedWordSpans(value) {
  const t = normalize(value);
  if (!t) return t;
  const parts = t.split(/\s+/);
  const n = parts.length;
  if (n >= 2 && n % 2 === 0) {
    const half = n / 2;
    const a = parts.slice(0, half).join(" ");
    const b = parts.slice(half).join(" ");
    if (a === b) return a;
  }
  const mid = Math.floor(t.length / 2);
  if (
    mid >= 1 &&
    t.slice(mid, mid + 1) === " " &&
    t.slice(0, mid) === t.slice(mid + 1)
  ) {
    return normalize(t.slice(0, mid));
  }
  return t;
}

/**
 * Clave estable para trelloCards / diff (evita "01." vs "01" vs "1").
 */
function hearingCaseKey(rawNo) {
  const s = normalize(rawNo);
  const m = s.match(/(\d+)/);
  if (!m) {
    return s;
  }
  return String(parseInt(m[1], 10));
}

function migrateStringKeysByHearingCase(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) {
    out[hearingCaseKey(k)] = v;
  }
  return out;
}

const RRS_ORIGIN = "https://www.racingrulesofsailing.org";

const RRS_URL_PLACEHOLDER = /\{id_evento\}|\[id_evento\]/;

function deriveRrsEventIdFromUrl(url) {
  const u = normalize(url);
  if (!u || RRS_URL_PLACEHOLDER.test(u)) {
    return "";
  }
  const m = u.match(/\/(?:schedules|documents|decisions)\/(\d+)\/event\b/);
  return m ? m[1] : "";
}

function expandRrsUrlTemplate(template, eventId) {
  const t = normalize(template);
  const id = normalize(eventId);
  if (!t) {
    return "";
  }
  const out = t.replaceAll("{id_evento}", id).replaceAll("[id_evento]", id);
  if (RRS_URL_PLACEHOLDER.test(out)) {
    return "";
  }
  return out;
}

const rrsEventId =
  normalize(process.env.RRS_EVENT_ID) ||
  deriveRrsEventIdFromUrl(process.env.RRS_URL) ||
  deriveRrsEventIdFromUrl(process.env.RRS_DOCUMENTS_URL) ||
  deriveRrsEventIdFromUrl(process.env.RRS_DECISIONS_URL);
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

const CONFIG = {
  eventId: rrsEventId || null,
  url: urlFromEnv || rrsSchedulesFromId,
  documentsUrl: documentsFromEnv || rrsDocumentsFromId,
  decisionsUrl: decisionsFromEnv || rrsDecisionsFromId,
  intervalMs: Number(process.env.POLL_INTERVAL_MS || 60_000),
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  stateFile: path.resolve(process.env.DATA_DIR || "./data", "state.json"),
  historyFile: path.resolve(process.env.DATA_DIR || "./data", "history.jsonl"),
  changesFile: path.resolve(process.env.DATA_DIR || "./data", "changes.jsonl"),
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
};

/** Identidad estable: fecha+clase mantienen la misma tarjeta aunque cambie hora/restante */
const TL_TIME_OUT_PREFIX = /^TIME\s+OUT\b/i;
const DELETE_DOC_PREFIX = /^DELETE\b/i;

const trelloCustomFieldsByBoard = new Map();
const trelloCustomFieldsWarnedBoards = new Set();
const trelloLabelsByBoard = new Map();
const trelloHearingLabelWarnedBoards = new Set();
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
  "Protest by PC",
  "Protest by RC",
  "Protest by TC",
  "Request to Reopen",
  "Request for Redress",
];

function hearingTypeToLabelName(type) {
  const t = normalize(type).toLowerCase();
  if (t === "protest") {
    return "Protest";
  }
  if (t === "protest by pc") {
    return "Protest by PC";
  }
  if (t === "protest by rc") {
    return "Protest by RC";
  }
  if (t === "protest by tc") {
    return "Protest by TC";
  }
  if (t === "request to reopen") {
    return "Request to Reopen";
  }
  if (t === "request for redress") {
    return "Request for Redress";
  }
  return null;
}

function rowFingerprint(row) {
  const linkKey = (row.hearingLinks || [])
    .map((l) => normalize(l.url))
    .filter(Boolean)
    .sort()
    .join("|");
  return [
    hearingCaseKey(row.no),
    row.type,
    row.race,
    row.initiator,
    row.respondents,
    row.schedule,
    row.location,
    linkKey,
  ].join("||");
}

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

function timeLimitFingerprint(row) {
  return [row.date, row.boatClass, row.limitTime, row.remaining].join("||");
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

function absolutizeRrsHref(href) {
  const h = normalize(href);
  if (!h) {
    return "";
  }
  try {
    return new URL(h, `${RRS_ORIGIN}/`).href;
  } catch {
    return h;
  }
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

async function loadState() {
  try {
    const content = await fs.readFile(CONFIG.stateFile, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

async function saveState(state) {
  await fs.writeFile(CONFIG.stateFile, JSON.stringify(state, null, 2), "utf8");
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "RRS-Monitor/1.0 (+Node.js 18)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
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
        map.set(key, {
          text,
          fullDecisionUrl: fullDecisionUrl || "",
        });
      });
  });

  return map;
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

    const wantName = hearingTypeToLabelName(row.type);
    const wantId = wantName ? trelloFindLabelIdByNames(boardLabels, wantName) : null;

    let onCard;
    try {
      onCard = await trelloGetCardLabels(cardId);
    } catch (e) {
      console.warn(`[TRELLO] Caso ${row.no}: no pude leer etiquetas:`, e.message);
      return;
    }
    const onCardIds = new Set(onCard.map((l) => l.id));

    for (const lid of hearingTypeLabelIds) {
      const shouldHave = Boolean(wantId && lid === wantId);
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
  const decidedId = CONFIG.trelloDecidedListId;
  if (!decidedId) {
    console.warn(
      `[TRELLO] Caso ${row.no} fuera de la web pero falta TRELLO_DECIDED_LIST_ID; no se mueve la tarjeta.`
    );
    return;
  }

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
  const appendix = "\n\n---\nCaso eliminado del calendario RRS · movido a Decided";

  try {
    const newDesc = `${bodyDesc.trim()}${appendix}`;
    await trelloMoveCardToList(cardId, decidedId, newDesc);
    await trelloSyncHearingTypeLabels(cardId, { no: row.no, type: "Other" });
    if (decisionsDetailMap !== null && decisionsDetailMap !== undefined) {
      await trelloSyncDecisionCustomField(
        cardId,
        decisionText == null ? "" : String(decisionText),
        row.no
      );
    }
    console.log(`[TRELLO] Caso ${row.no}: tarjeta movida a Decided`);
  } catch (error) {
    console.error(`[TRELLO] Caso ${row.no} al mover a Decided:`, error.message);
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
  return JSON.parse(bodyText);
}

async function trelloApplyDocumentRow(cardId, row) {
  await trelloUpdateCardNameDesc(
    cardId,
    eventDocumentCardTitle(row),
    eventDocumentCardDescription(row)
  );
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
  if (!CONFIG.trelloDecidedListId) {
    console.warn(
      "[WARN] Falta TRELLO_DECIDED_LIST_ID: al borrarse un caso de la web no se moverá la tarjeta a Decided."
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

async function applyTrelloCycle(
  previousState,
  currentRows,
  changes,
  hearingAttachmentUrlsByCase,
  fullDecisionSyncedByCase
) {
  if (!CONFIG.trelloEnabled) {
    return migrateStringKeysByHearingCase(previousState?.trelloCards || {});
  }
  if (!CONFIG.trelloKey || !CONFIG.trelloToken || !CONFIG.trelloListId) {
    return migrateStringKeysByHearingCase(previousState?.trelloCards || {});
  }

  const trelloCards = migrateStringKeysByHearingCase(previousState?.trelloCards || {});
  const urlsByCase = hearingAttachmentUrlsByCase || {};
  const fdSynced = fullDecisionSyncedByCase || {};

  let decisionsDetailMap = null;
  if (normalize(CONFIG.decisionsUrl)) {
    try {
      const decHtml = await fetchHtml(CONFIG.decisionsUrl);
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
        `[TRELLO] Caso ${row.no} retirado de la web pero no hay tarjeta en trelloCards (clave ${k}); no se mueve a Decided.`
      );
    }
    delete trelloCards[k];
  }

  for (const item of changes.modified) {
    const cardId = trelloCards[item.no];
    if (!cardId) {
      continue;
    }
    try {
      await trelloApplyRowToCard(cardId, item.after, urlsByCase);
      console.log(`[TRELLO] Tarjeta actualizada para caso ${item.no}`);
    } catch (error) {
      console.error(`[TRELLO] Actualizar caso ${item.no}:`, error.message);
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
      await trelloSyncAmazingFields(card.id, row);
      await trelloSyncHearingTypeLabels(card.id, row);
      await trelloSyncCardListForRow(card.id, row);
      await trelloSyncHearingLinkAttachments(card.id, row, urlsByCase);
    } catch (error) {
      console.error(`[TRELLO] Crear caso ${row.no}:`, error.message);
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

  return trelloCards;
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

function formatTelegramMessage(changes, timeLimitChanges, documentChanges, timestamp) {
  const lines = [`RRS cambios detectados`, `Fecha: ${timestamp}`, ""];

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

async function runMonitorCycle() {
  const timestamp = new Date().toISOString();
  const html = await fetchHtml(CONFIG.url);
  const currentRows = extractTableRows(html);
  const currentTimeLimits = extractTimeLimitRows(html);

  const previousState = await loadState();
  const previousRows = previousState?.rows || [];
  const previousTimeLimits = previousState?.timeLimitRows || [];
  const previousDocumentRows = previousState?.documentRows || [];

  let documentRowsForState = previousDocumentRows;
  let documentChanges = { added: [], modified: [], removed: [] };
  if (normalize(CONFIG.documentsUrl)) {
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

  const changes = detectChanges(previousRows, currentRows);
  const timeLimitChanges = detectTimeLimitChanges(previousTimeLimits, currentTimeLimits);

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
  const hasChanges = hasHearingChanges || hasTimeLimitChanges || hasDocumentChanges;

  let trelloCards = migrateStringKeysByHearingCase(previousState?.trelloCards || {});
  if (
    CONFIG.trelloEnabled &&
    CONFIG.trelloKey &&
    CONFIG.trelloToken &&
    CONFIG.trelloListId
  ) {
    trelloCards = await applyTrelloCycle(
      previousState,
      currentRows,
      changes,
      hearingAttachmentUrlsByCase,
      fullDecisionSyncedByCase
    );
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

  const snapshot = {
    timestamp,
    rowCount: currentRows.length,
    rows: currentRows,
    timeLimitRowCount: currentTimeLimits.length,
    timeLimitRows: currentTimeLimits,
    documentRowCount: documentRowsForState.length,
    documentRows: documentRowsForState,
    trelloCards,
    trelloTimeLimitCards,
    trelloDocumentCards,
    hearingAttachmentUrlsByCase,
    fullDecisionSyncedByCase,
  };

  await appendJsonLine(CONFIG.historyFile, snapshot);

  if (!previousState) {
    console.log(
      `[INIT] Estado inicial: ${currentRows.length} audiencias, ${currentTimeLimits.length} time limit(s), ${documentRowsForState.length} documento(s) evento.`
    );
  }

  if (hasChanges) {
    const event = {
      timestamp,
      changes,
      timeLimitChanges,
      documentChanges,
      currentRowCount: currentRows.length,
      currentTimeLimitCount: currentTimeLimits.length,
      currentDocumentCount: documentRowsForState.length,
      ...(previousState ? {} : { baseline: true }),
    };

    await appendJsonLine(CONFIG.changesFile, event);
    console.log(
      `[CHANGES] Audiencias +${changes.added.length} ~${changes.modified.length} -${changes.removed.length} | TimeLimit +${timeLimitChanges.added.length} ~${timeLimitChanges.modified.length} -${timeLimitChanges.removed.length} | Docs +${documentChanges.added.length} ~${documentChanges.modified.length} -${documentChanges.removed.length}`
    );

    if (previousState) {
      const message = formatTelegramMessage(
        changes,
        timeLimitChanges,
        documentChanges,
        timestamp
      );
      try {
        await sendTelegramNotification(message);
      } catch (error) {
        console.error("[TELEGRAM]", error.message);
      }
    }
  } else if (previousState) {
    console.log(
      `[NO_CHANGES] ${timestamp} (${currentRows.length} audiencias, ${currentTimeLimits.length} time limit(s), ${documentRowsForState.length} documento(s))`
    );
  }

  await saveState(snapshot);
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

main().catch((error) => {
  console.error("[FATAL]", error.message);
  process.exit(1);
});
