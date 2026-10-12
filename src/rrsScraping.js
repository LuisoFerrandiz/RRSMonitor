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
};
