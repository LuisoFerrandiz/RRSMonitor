"use strict";

const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  trelloAuthParams,
  trelloGetCard,
  applyTrelloCycle,
} = require("../index.js");

describe("trelloAuthParams", () => {
  test("devuelve URLSearchParams con key y token (no vacío por forma)", () => {
    const params = trelloAuthParams();
    assert.ok(params instanceof URLSearchParams);
    assert.equal(typeof params.get("key"), "string");
    assert.equal(typeof params.get("token"), "string");
  });
});

describe("trelloGetCard", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("respuesta ok -> devuelve el JSON parseado", async () => {
    global.fetch = async (url) => {
      assert.match(url, /^https:\/\/api\.trello\.com\/1\/cards\/card123\?/);
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ id: "card123", name: "Test", desc: "", idList: "l1", idBoard: "b1" }),
      };
    };
    const card = await trelloGetCard("card123");
    assert.equal(card.id, "card123");
    assert.equal(card.name, "Test");
  });

  test("respuesta no-ok -> lanza con status y body", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => "not found",
    });
    await assert.rejects(
      () => trelloGetCard("missing"),
      /Trello get card: 404 not found/
    );
  });
});

describe("applyTrelloCycle", () => {
  test("TRELLO_ENABLED=false (configuración actual) -> devuelve trelloCards previos sin tocar red", async () => {
    const previousState = {
      trelloCards: { "01": "cardA" },
      trelloSyncedFingerprintByCase: { "01": "fp1" },
    };
    const result = await applyTrelloCycle(
      previousState,
      [],
      { removed: [], modified: [], added: [] },
      {},
      {}
    );
    assert.deepEqual(result.trelloCards, { "1": "cardA" });
    assert.deepEqual(result.trelloSyncedFingerprintByCase, { "1": "fp1" });
  });

  test("sin estado previo -> devuelve objetos vacios", async () => {
    const result = await applyTrelloCycle(
      null,
      [],
      { removed: [], modified: [], added: [] },
      {},
      {}
    );
    assert.deepEqual(result.trelloCards, {});
    assert.deepEqual(result.trelloSyncedFingerprintByCase, {});
  });
});
