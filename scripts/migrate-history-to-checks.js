#!/usr/bin/env node
/**
 * Migración de un solo uso: history.jsonl (+ cleanup-archive.jsonl) -> checks.jsonl.
 *
 * El antiguo history.jsonl guardaba un snapshot completo por ciclo (~8 KB/línea). El nuevo
 * checks.jsonl guarda 1 línea diminuta por ciclo con `timestamp`, `changed` y los contadores.
 * Este script convierte los snapshots viejos para no perder el histórico visible en la
 * pestaña Log.
 *
 * Uso:  node scripts/migrate-history-to-checks.js [--force]
 * Lee de ./data, escribe ./data/checks.jsonl (no sobrescribe si ya existe salvo --force).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const CLEANUP_ARCHIVE_FILE = path.join(DATA_DIR, 'cleanup-archive.jsonl');
const CHANGES_FILE = path.join(DATA_DIR, 'changes.jsonl');
const CHECKS_FILE = path.join(DATA_DIR, 'checks.jsonl');

const PENDING_DECISION_TEXTS = new Set(['pending', 'decision pending', 'hearing pending']);

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function countDecided(decisionRows) {
  return (decisionRows || []).filter((r) => {
    const t = String(r && r.text != null ? r.text : '').trim().toLowerCase();
    return t && !PENDING_DECISION_TEXTS.has(t);
  }).length;
}

function toCheck(snapshot, changed) {
  return {
    timestamp: snapshot.timestamp,
    changed: Boolean(changed),
    rowCount: snapshot.rowCount || 0,
    decisionRowCount: snapshot.decisionRowCount || 0,
    decidedDecisionRowCount: countDecided(snapshot.decisionRows),
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
}

function main() {
  const force = process.argv.includes('--force');
  if (fs.existsSync(CHECKS_FILE) && !force) {
    console.error(`[MIGRATE] ${CHECKS_FILE} ya existe. Usa --force para sobrescribir.`);
    process.exit(1);
  }

  const snapshots = [...readJsonl(HISTORY_FILE), ...readJsonl(CLEANUP_ARCHIVE_FILE)]
    .filter((s) => s && s.timestamp);
  const changedStamps = new Set(readJsonl(CHANGES_FILE).map((c) => c.timestamp).filter(Boolean));

  // Dedupe por timestamp, orden ascendente.
  const byTs = new Map();
  for (const s of snapshots) if (!byTs.has(s.timestamp)) byTs.set(s.timestamp, s);
  const ordered = [...byTs.values()].sort((a, b) =>
    String(a.timestamp).localeCompare(String(b.timestamp)));

  const lines = ordered.map((s) => JSON.stringify(toCheck(s, changedStamps.has(s.timestamp))));
  fs.writeFileSync(CHECKS_FILE, lines.length ? lines.join('\n') + '\n' : '', 'utf8');

  const changedCount = ordered.filter((s) => changedStamps.has(s.timestamp)).length;
  console.log(
    `[MIGRATE] Entradas: history=${readJsonl(HISTORY_FILE).length} ` +
    `cleanup-archive=${readJsonl(CLEANUP_ARCHIVE_FILE).length} -> ` +
    `checks.jsonl=${lines.length} líneas (${changedCount} con changed:true).`
  );
  if (lines.length !== byTs.size) {
    console.error('[MIGRATE] AVISO: nº de líneas != nº de timestamps únicos.');
    process.exit(1);
  }
}

main();
