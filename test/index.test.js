"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalize,
  dedupeRepeatedWordSpans,
  hearingCaseKey,
  migrateStringKeysByHearingCase,
  deriveRrsEventIdFromUrl,
  expandRrsUrlTemplate,
  hearingTypeToLabelNames,
  rowFingerprint,
  timeLimitRowKey,
  timeLimitFingerprint,
  detectTimeLimitChanges,
  absolutizeRrsHref,
  questionRowKey,
  detectQuestionsChanges,
  scoringInquiryRowKey,
  detectScoringInquiryChanges,
  documentRowKey,
  detectDocumentChanges,
  scheduleHasClockTime,
  scheduleIsPending,
  scheduleUsesScheduleList,
  changedFields,
  genericRowKey,
  genericRowFingerprint,
  detectGenericRowChanges,
  genericChangesEmpty,
  hasGenericChanges,
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

describe("migrateStringKeysByHearingCase", () => {
  test("normaliza claves de un mapa aplicando hearingCaseKey", () => {
    const result = migrateStringKeysByHearingCase({ "01.": "a", "2": "b" });
    assert.deepEqual(result, { "1": "a", "2": "b" });
  });

  test("mapa vacío o null -> objeto vacío", () => {
    assert.deepEqual(migrateStringKeysByHearingCase(null), {});
    assert.deepEqual(migrateStringKeysByHearingCase({}), {});
  });
});

describe("deriveRrsEventIdFromUrl", () => {
  test("extrae el id numérico de una URL RRS real", () => {
    assert.equal(
      deriveRrsEventIdFromUrl("https://www.racingrulesofsailing.org/schedules/15805/event"),
      "15805"
    );
  });

  test("placeholder [id_evento]/{id_evento} -> cadena vacía", () => {
    assert.equal(deriveRrsEventIdFromUrl("https://x/schedules/{id_evento}/event"), "");
    assert.equal(deriveRrsEventIdFromUrl("https://x/schedules/[id_evento]/event"), "");
  });

  test("URL sin patrón reconocido -> cadena vacía", () => {
    assert.equal(deriveRrsEventIdFromUrl("https://example.com/foo"), "");
  });
});

describe("expandRrsUrlTemplate", () => {
  test("sustituye {id_evento} y [id_evento] por el id dado", () => {
    assert.equal(
      expandRrsUrlTemplate("https://x/schedules/{id_evento}/event", "15805"),
      "https://x/schedules/15805/event"
    );
    assert.equal(
      expandRrsUrlTemplate("https://x/schedules/[id_evento]/event", "15805"),
      "https://x/schedules/15805/event"
    );
  });

  test("id vacío solo deja el placeholder sustituido por nada (no relanza el guard)", () => {
    assert.equal(
      expandRrsUrlTemplate("https://x/schedules/{id_evento}/event", ""),
      "https://x/schedules//event"
    );
  });

  test("placeholder que sobrevive la sustitución (id literal con llaves) -> cadena vacía", () => {
    assert.equal(
      expandRrsUrlTemplate("https://x/schedules/{id_evento}/event", "{id_evento}"),
      ""
    );
  });

  test("template vacío -> cadena vacía", () => {
    assert.equal(expandRrsUrlTemplate("", "15805"), "");
  });
});

describe("hearingTypeToLabelNames", () => {
  test("mapea tipos conocidos a sus etiquetas Trello", () => {
    assert.deepEqual(hearingTypeToLabelNames("Protest"), ["Protest"]);
    assert.deepEqual(hearingTypeToLabelNames("Protest by RC"), ["Protest", "Race Committee"]);
    assert.deepEqual(hearingTypeToLabelNames("Request to Reopen"), ["Request to Reopen"]);
  });

  test("tipo desconocido -> sin etiquetas", () => {
    assert.deepEqual(hearingTypeToLabelNames("Other"), []);
  });
});

describe("rowFingerprint", () => {
  test("mismos campos + mismos links (en cualquier orden) -> misma huella", () => {
    const base = {
      no: "01.",
      type: "Protest",
      race: "R3",
      initiator: "GER 1",
      respondents: "ESP 2",
      schedule: "May 01 - 19:20",
      location: "Room A",
      hearingLinks: [{ url: "https://x/b.pdf" }, { url: "https://x/a.pdf" }],
    };
    const reordered = { ...base, hearingLinks: [...base.hearingLinks].reverse() };
    assert.equal(rowFingerprint(base), rowFingerprint(reordered));
  });

  test("cambia un link -> cambia la huella", () => {
    const base = { no: "1", hearingLinks: [{ url: "https://x/a.pdf" }] };
    const changed = { no: "1", hearingLinks: [{ url: "https://x/b.pdf" }] };
    assert.notEqual(rowFingerprint(base), rowFingerprint(changed));
  });
});

describe("absolutizeRrsHref", () => {
  test("href relativo se resuelve contra RRS_ORIGIN", () => {
    assert.equal(
      absolutizeRrsHref("/documents/15805/foo.pdf"),
      "https://www.racingrulesofsailing.org/documents/15805/foo.pdf"
    );
  });

  test("href ya absoluto se mantiene", () => {
    assert.equal(absolutizeRrsHref("https://other.com/x.pdf"), "https://other.com/x.pdf");
  });

  test("vacío -> cadena vacía", () => {
    assert.equal(absolutizeRrsHref(""), "");
  });
});

describe("detectQuestionsChanges", () => {
  const row = (no, state) => ({ no, competitor: "GER 1", state, answered: "", pdfUrl: "" });

  test("usa questionRowKey/questionFingerprint para detectar altas y modificaciones", () => {
    const previous = [row("1", "Open")];
    const current = [row("1", "Answered"), row("2", "Open")];
    const result = detectQuestionsChanges(previous, current);
    assert.equal(result.added.length, 1);
    assert.equal(result.modified.length, 1);
    assert.equal(questionRowKey(row("1", "x")), "1");
  });
});

describe("detectScoringInquiryChanges", () => {
  test("detecta altas, bajas y modificaciones vía scoringInquiryFingerprint", () => {
    const row = (no, response) => ({ no, date: "", course: "", race: "", competitor: "", posted: "", corrected: "", response, pdfUrl: "" });
    const previous = [row("1", "Pending")];
    const current = [row("2", "Pending")];
    const result = detectScoringInquiryChanges(previous, current);
    assert.equal(result.added.length, 1);
    assert.equal(result.removed.length, 1);
    assert.equal(scoringInquiryRowKey(row("1", "x")), "1");
  });
});

describe("detectDocumentChanges", () => {
  test("detecta altas/bajas vía documentRowKey/eventDocumentFingerprint", () => {
    const row = (rowId, description) => ({ rowId, description, href: "", date: "" });
    const previous = [row("1", "Doc A")];
    const current = [row("1", "Doc A (rev)")];
    const result = detectDocumentChanges(previous, current);
    assert.equal(result.modified.length, 1);
    assert.equal(documentRowKey(row("1", "x")), "1");
  });
});

describe("scheduleHasClockTime / scheduleIsPending / scheduleUsesScheduleList", () => {
  test("detecta hora tipo HH:MM en el schedule", () => {
    assert.equal(scheduleHasClockTime("May 01 - 19:20"), true);
    assert.equal(scheduleHasClockTime("Pending"), false);
  });

  test("detecta Pending/Pendiente sin distinguir mayúsculas", () => {
    assert.equal(scheduleIsPending("PENDING"), true);
    assert.equal(scheduleIsPending("pendiente"), true);
    assert.equal(scheduleIsPending("May 01 - 19:20"), false);
  });

  test("solo usa lista Schedule si hay hora y no está pending", () => {
    assert.equal(scheduleUsesScheduleList("May 01 - 19:20"), true);
    assert.equal(scheduleUsesScheduleList("Pending"), false);
    assert.equal(scheduleUsesScheduleList(""), false);
  });
});

describe("changedFields", () => {
  test("lista solo los campos que cambiaron, antes/después", () => {
    const before = { no: "1", type: "Protest", race: "R3", initiator: "A", respondents: "B", schedule: "", location: "" };
    const after = { ...before, race: "R4" };
    const result = changedFields(before, after);
    assert.equal(result.length, 1);
    assert.match(result[0], /^race: "R3" -> "R4"$/);
  });

  test("sin cambios -> lista vacía", () => {
    const row = { no: "1", type: "Protest", race: "R3", initiator: "A", respondents: "B", schedule: "", location: "" };
    assert.deepEqual(changedFields(row, { ...row }), []);
  });
});

describe("genericRowKey / genericRowFingerprint / detectGenericRowChanges", () => {
  const section = { fieldMap: { boat: "boat", crew: "crew" } };
  const row = (no, boat, crew) => ({ no, boat, crew, actionsPdfUrl: "" });

  test("usa row.no como clave cuando existe", () => {
    assert.equal(genericRowKey(section, row("1", "ESP 1", "A")), "1");
  });

  test("sin row.no, compone la clave desde fieldMap", () => {
    assert.equal(genericRowKey(section, row("", "ESP 1", "A")), "ESP 1||A");
  });

  test("detecta altas/bajas/modificaciones genéricas", () => {
    const previous = [row("1", "ESP 1", "A")];
    const current = [row("1", "ESP 1", "B")];
    const result = detectGenericRowChanges(section, previous, current);
    assert.equal(result.modified.length, 1);
    assert.notEqual(
      genericRowFingerprint(section, previous[0]),
      genericRowFingerprint(section, current[0])
    );
  });
});

describe("genericChangesEmpty / hasGenericChanges", () => {
  test("genericChangesEmpty devuelve las tres listas vacías", () => {
    assert.deepEqual(genericChangesEmpty(), { added: [], modified: [], removed: [] });
  });

  test("hasGenericChanges detecta cambios en cualquiera de las tres listas", () => {
    assert.equal(hasGenericChanges(genericChangesEmpty()), false);
    assert.equal(hasGenericChanges({ added: [1], modified: [], removed: [] }), true);
    assert.equal(hasGenericChanges(undefined), false);
  });
});
