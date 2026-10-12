"use strict";

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
};
