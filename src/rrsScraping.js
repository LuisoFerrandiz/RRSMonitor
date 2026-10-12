"use strict";

const cheerio = require("cheerio");

/**
 * Scraping/parsing/detección de cambios de RRS, extraído de index.js (ISSUES.md Fase C,
 * sub-fases C0-C9). Se va llenando función a función; index.js las usa vía
 * `const { fn } = require("./src/rrsScraping")` con el mismo nombre local de siempre.
 */

/** Zona IANA para `timestamp` en JSON / consola / Telegram (RFC3339 con offset CET/CEST). */
const REPORT_TIME_ZONE = process.env.REPORT_TIME_ZONE || "Europe/Madrid";

function padTimePart(value) {
  return String(value ?? "").padStart(2, "0");
}

function zonedOffsetRFC(instant, timeZone) {
  try {
    const part =
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        timeZoneName: "longOffset",
      })
        .formatToParts(instant)
        .find((x) => x.type === "timeZoneName")?.value || "";
    const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
    if (!m) return "";
    const sign = m[1];
    const hh = padTimePart(parseInt(m[2], 10));
    const mm = padTimePart(parseInt(m[3] ?? "0", 10));
    return `${sign}${hh}:${mm}`;
  } catch {
    return "";
  }
}

function formatReportTimestamp(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const tz = REPORT_TIME_ZONE;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      fractionalSecondDigits: 3,
    });
  } catch {
    return d.toISOString();
  }
  const fields = {};
  for (const { type, value } of formatter.formatToParts(d)) {
    if (type !== "literal") fields[type] = value;
  }
  const { year, month, day, hour, minute, second, fractionalSecond } = fields;
  if (!year) {
    return d.toISOString();
  }
  let fracMs = fractionalSecond || "000";
  if (/^\d+$/.test(fracMs)) {
    fracMs = fracMs.length > 3 ? fracMs.slice(0, 3) : fracMs.padEnd(3, "0");
  } else {
    fracMs = "000";
  }
  const body = `${year}-${padTimePart(month)}-${padTimePart(day)}T${padTimePart(hour)}:${padTimePart(minute)}:${padTimePart(second)}.${fracMs}`;
  const off = zonedOffsetRFC(d, tz);
  return off ? `${body}${off}` : `${body} [${tz}]`;
}

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
  const m = u.match(
    /\/(?:schedules|documents|decisions|questions|scoring_inquiries)\/(\d+)\/event\b/
  );
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

function hearingTypeToLabelNames(type) {
  const t = normalize(type).toLowerCase();
  if (t === "protest") {
    return ["Protest"];
  }
  if (t === "protest by pc") {
    return ["Protest", "International jury"];
  }
  if (t === "protest by rc") {
    return ["Protest", "Race Committee"];
  }
  if (t === "protest by tc") {
    return ["Protest", "Technical Committee"];
  }
  if (t === "request to reopen") {
    return ["Request to Reopen"];
  }
  if (t === "request for redress") {
    return ["Request for Redress"];
  }
  return [];
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
 * Convert relative URL to absolute URL
 */
function toAbsoluteUrl(url, baseOrigin = "https://www.racingrulesofsailing.org") {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/")) return baseOrigin + url;
  return baseOrigin + "/" + url;
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

module.exports = {
  padTimePart,
  zonedOffsetRFC,
  formatReportTimestamp,
  normalize,
  dedupeRepeatedWordSpans,
  hearingCaseKey,
  migrateStringKeysByHearingCase,
  RRS_ORIGIN,
  RRS_URL_PLACEHOLDER,
  deriveRrsEventIdFromUrl,
  expandRrsUrlTemplate,
  hearingTypeToLabelNames,
  rowFingerprint,
  absolutizeRrsHref,
  extractTimeLimitRows,
  timeLimitRowKey,
  timeLimitFingerprint,
  timeLimitCardTitle,
  summarizeTimeLimitRow,
  timeLimitDescription,
  detectTimeLimitChanges,
  extractQuestionsRows,
  questionRowKey,
  questionFingerprint,
  detectQuestionsChanges,
  extractScoringInquiryRows,
  scoringInquiryRowKey,
  scoringInquiryFingerprint,
  detectScoringInquiryChanges,
  extractHearingTypeCell,
  extractEventDocumentRows,
  documentRowKey,
  eventDocumentFingerprint,
  eventDocumentCardTitle,
  eventDocumentCardDescription,
  summarizeDocumentRow,
  detectDocumentChanges,
  RRS_EMPTY_ROW_RE,
  extractRrsGenericTable,
  RRS_TABULAR_SECTIONS,
  genericRowKey,
  genericRowFingerprint,
  detectGenericRowChanges,
  genericChangesEmpty,
  hasGenericChanges,
  extractTableRows,
  linkTextIsFullDecision,
  extractDecisionCellDetail,
  toAbsoluteUrl,
  extractDecisionsDetailByCaseKey,
  buildDecisionRowsFromState,
  detectChanges,
  summarizeRow,
};
