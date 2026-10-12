"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  toAbsoluteUrl,
  linkTextIsFullDecision,
  extractTableRows,
  extractDecisionsDetailByCaseKey,
  buildDecisionRowsFromState,
  detectChanges,
  summarizeRow,
} = require("../index.js");

const readFixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("toAbsoluteUrl", () => {
  test("URL ya absoluta se mantiene", () => {
    assert.equal(toAbsoluteUrl("https://other.com/x.pdf"), "https://other.com/x.pdf");
  });

  test("ruta con / inicial se antepone al origin", () => {
    assert.equal(
      toAbsoluteUrl("/documents/15805/x.pdf"),
      "https://www.racingrulesofsailing.org/documents/15805/x.pdf"
    );
  });

  test("ruta sin / inicial también se resuelve", () => {
    assert.equal(
      toAbsoluteUrl("documents/15805/x.pdf"),
      "https://www.racingrulesofsailing.org/documents/15805/x.pdf"
    );
  });

  test("vacío -> cadena vacía", () => {
    assert.equal(toAbsoluteUrl(""), "");
  });
});

describe("linkTextIsFullDecision", () => {
  test("reconoce 'Full Decision' sin distinguir mayúsculas ni punto final", () => {
    assert.equal(linkTextIsFullDecision("Full Decision"), true);
    assert.equal(linkTextIsFullDecision("full decision."), true);
    assert.equal(linkTextIsFullDecision("  FULL DECISION  "), true);
  });

  test("otro texto de enlace -> false", () => {
    assert.equal(linkTextIsFullDecision("Protest form"), false);
  });
});

describe("extractTableRows", () => {
  test("extrae fila de audiencia con enlaces de tipo y campos normalizados", () => {
    const html = readFixture("hearings-schedule.html");
    const rows = extractTableRows(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].no, "01.");
    assert.equal(rows[0].type, "Protest");
    assert.equal(rows[0].race, "R3");
    assert.equal(rows[0].initiator, "GER 1");
    assert.equal(rows[0].respondents, "ESP 2");
    assert.equal(rows[0].location, "Room A");
    assert.equal(rows[0].hearingLinks.length, 1);
    assert.equal(
      rows[0].hearingLinks[0].url,
      "https://www.racingrulesofsailing.org/documents/15805/protest-01.pdf"
    );
  });

  test("HTML sin tabla de audiencias reconocible -> sin filas", () => {
    assert.deepEqual(extractTableRows("<html><body>nada</body></html>"), []);
  });
});

describe("extractDecisionsDetailByCaseKey", () => {
  test("detecta Full Decision link y lo absolutiza", () => {
    const html = readFixture("decisions.html");
    const map = extractDecisionsDetailByCaseKey(html);
    const detail = map.get("1");
    assert.ok(detail);
    assert.equal(
      detail.fullDecisionUrl,
      "https://www.racingrulesofsailing.org/documents/15805/full-decision-01.pdf"
    );
    assert.equal(detail.race, "R3");
  });

  test("fila sin Full Decision link -> fullDecisionUrl vacío", () => {
    const html = readFixture("decisions.html");
    const map = extractDecisionsDetailByCaseKey(html);
    const detail = map.get("2");
    assert.ok(detail);
    assert.equal(detail.fullDecisionUrl, "");
  });
});

describe("buildDecisionRowsFromState", () => {
  test("cruza decisionsMap con currentRows por hearingCaseKey", () => {
    const decisionsMap = new Map([
      ["1", { text: "Upheld", fullDecisionUrl: "https://x/full.pdf", type: "", typeLinks: [], race: "", initiator: "", respondents: "", decisionLinks: [] }],
    ]);
    const currentRows = [{ no: "01.", type: "Protest", race: "R3", initiator: "GER 1", respondents: "ESP 2", schedule: "", location: "" }];
    const result = buildDecisionRowsFromState(decisionsMap, currentRows, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "Upheld");
    assert.equal(result[0].type, "Protest");
  });

  test("decisionsMap vacío -> sin filas", () => {
    assert.deepEqual(buildDecisionRowsFromState(new Map(), [], []), []);
  });

  test("caso decidido que ya no está en currentRows cae a previousRows", () => {
    const decisionsMap = new Map([["1", { text: "Upheld", fullDecisionUrl: "", type: "", typeLinks: [], race: "", initiator: "", respondents: "", decisionLinks: [] }]]);
    const previousRows = [{ no: "01.", type: "Protest", race: "R3", initiator: "GER 1", respondents: "ESP 2", schedule: "May 01", location: "Room A" }];
    const result = buildDecisionRowsFromState(decisionsMap, [], previousRows);
    assert.equal(result.length, 1);
    assert.equal(result[0].location, "Room A");
  });
});

describe("detectChanges", () => {
  const row = (no, race) => ({ no, type: "Protest", race, initiator: "GER 1", respondents: "ESP 2", schedule: "", location: "", hearingLinks: [] });

  test("fila nueva -> added", () => {
    const result = detectChanges([], [row("01.", "R3")]);
    assert.equal(result.added.length, 1);
  });

  test("cambia un campo -> modified", () => {
    const previous = [row("01.", "R3")];
    const current = [row("01.", "R4")];
    const result = detectChanges(previous, current);
    assert.equal(result.modified.length, 1);
  });

  test("fila ausente -> removed", () => {
    const previous = [row("01.", "R3")];
    const result = detectChanges(previous, []);
    assert.equal(result.removed.length, 1);
  });
});

describe("summarizeRow", () => {
  test("formatea los campos principales de la fila", () => {
    const row = { no: "01.", type: "Protest", race: "R3", initiator: "GER 1", respondents: "ESP 2", schedule: "May 01 - 19:20", location: "Room A" };
    const summary = summarizeRow(row);
    assert.match(summary, /No: 01\./);
    assert.match(summary, /Type: Protest/);
    assert.match(summary, /Location: Room A/);
  });

  test("campos ausentes se muestran como '-'", () => {
    const summary = summarizeRow({});
    assert.match(summary, /No: -/);
  });
});
