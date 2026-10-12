"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalize,
  dedupeRepeatedWordSpans,
  hearingCaseKey,
  timeLimitRowKey,
  timeLimitFingerprint,
  detectTimeLimitChanges,
} = require("../index.js");

describe("normalize", () => {
  test("colapsa espacios múltiples y recorta bordes", () => {
    assert.equal(normalize("  hola   mundo  "), "hola mundo");
  });

  test("null/undefined -> cadena vacía", () => {
    assert.equal(normalize(null), "");
    assert.equal(normalize(undefined), "");
  });
});

describe("dedupeRepeatedWordSpans", () => {
  test("texto duplicado por palabras se reduce a la mitad", () => {
    assert.equal(dedupeRepeatedWordSpans("Protest Protest"), "Protest");
  });

  test("texto sin duplicación queda igual", () => {
    assert.equal(dedupeRepeatedWordSpans("Protest 12"), "Protest 12");
  });
});

describe("hearingCaseKey", () => {
  test("extrae el número y normaliza ceros a la izquierda", () => {
    assert.equal(hearingCaseKey("01."), "1");
    assert.equal(hearingCaseKey("01"), "1");
    assert.equal(hearingCaseKey("1"), "1");
  });

  test("sin número, devuelve el texto normalizado", () => {
    assert.equal(hearingCaseKey("TBD"), "TBD");
  });
});

describe("timeLimitRowKey / timeLimitFingerprint", () => {
  test("la clave no incluye limitTime ni remaining (identidad por fecha+clase)", () => {
    const row = { date: "2026-10-12", boatClass: "ILCA 7", limitTime: "18:00", remaining: "2h" };
    assert.equal(timeLimitRowKey(row), "2026-10-12||ILCA 7");
  });

  test("la huella cambia si cambia limitTime, no si solo cambia remaining", () => {
    const base = { date: "2026-10-12", boatClass: "ILCA 7", limitTime: "18:00", remaining: "2h" };
    const sameLimitDifferentRemaining = { ...base, remaining: "1h" };
    const differentLimit = { ...base, limitTime: "19:00" };
    assert.equal(timeLimitFingerprint(base), timeLimitFingerprint(sameLimitDifferentRemaining));
    assert.notEqual(timeLimitFingerprint(base), timeLimitFingerprint(differentLimit));
  });
});

describe("detectTimeLimitChanges", () => {
  const row = (date, boatClass, limitTime, remaining) => ({ date, boatClass, limitTime, remaining });

  test("fila nueva se marca como added", () => {
    const result = detectTimeLimitChanges([], [row("2026-10-12", "ILCA 7", "18:00", "2h")]);
    assert.equal(result.added.length, 1);
    assert.equal(result.modified.length, 0);
    assert.equal(result.removed.length, 0);
  });

  test("solo cambia remaining -> no se reporta como modified", () => {
    const previous = [row("2026-10-12", "ILCA 7", "18:00", "2h")];
    const current = [row("2026-10-12", "ILCA 7", "18:00", "1h")];
    const result = detectTimeLimitChanges(previous, current);
    assert.equal(result.modified.length, 0);
  });

  test("cambia limitTime -> se reporta como modified", () => {
    const previous = [row("2026-10-12", "ILCA 7", "18:00", "2h")];
    const current = [row("2026-10-12", "ILCA 7", "19:00", "2h")];
    const result = detectTimeLimitChanges(previous, current);
    assert.equal(result.modified.length, 1);
  });

  test("fila ausente en current se marca como removed", () => {
    const previous = [row("2026-10-12", "ILCA 7", "18:00", "2h")];
    const result = detectTimeLimitChanges(previous, []);
    assert.equal(result.removed.length, 1);
  });
});
