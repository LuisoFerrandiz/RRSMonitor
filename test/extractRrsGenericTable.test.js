"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { extractRrsGenericTable } = require("../index.js");

const readFixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

const RETIREMENT_OPTS = {
  containerSelector: null,
  requiredHeaders: ["no.", "boat", "type"],
  fieldMap: {
    no: "no.",
    date: "date",
    boat: "boat",
    type: "type",
    raceNo: "race no.",
  },
};

describe("extractRrsGenericTable", () => {
  test("tolera columnas reordenadas y ocultas (d-none) - lee por texto de cabecera, no por posición", () => {
    const html = readFixture("retirements-reordered-columns.html");
    const result = extractRrsGenericTable(html, RETIREMENT_OPTS);
    assert.equal(result.isEmpty, false);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(result.rows[0], {
      no: "01.",
      date: "May 01",
      boat: "ESP 1",
      type: "DNF",
      raceNo: "R3",
    });
  });

  test("fila 'No results' con colspan -> sección vacía, sin filas", () => {
    const html = readFixture("retirements-empty.html");
    const result = extractRrsGenericTable(html, RETIREMENT_OPTS);
    assert.equal(result.isEmpty, true);
    assert.deepEqual(result.rows, []);
  });

  test("HTML sin tabla reconocible -> rows vacío, isEmpty false (no confundir con 'sección vacía confirmada')", () => {
    const result = extractRrsGenericTable("<html><body>nada aquí</body></html>", RETIREMENT_OPTS);
    assert.deepEqual(result, { rows: [], isEmpty: false, headers: [] });
  });
});
