# Issues y optimizaciones pendientes — Script Monitor RRS

> Backlog faseado, generado a partir del análisis con `/graphify .` (grafo de conocimiento,
> `graphify-out/GRAPH_REPORT.md`) + lint/test de la sesión 2026-10-12. Cada ítem incluye
> evidencia (archivo/línea o nodo del grafo) para que una sesión futura pueda resolverlo
> sin tener que redescubrir el contexto. Resolver una fase a la vez; marcar `[x]` al cerrar
> y añadir nota en `BITACORA.md` al terminar cada una (regla del proyecto).

---

## Fase 1 — Correcciones rápidas, bajo riesgo

- [x] **README.md desactualizado: sigue describiendo `history.jsonl` como archivo activo.**
  Confirmado por graphify como "Surprising Connection"/edge AMBIGUOUS: README.md dice que
  `history.jsonl` es el snapshot completo por ciclo, pero CLAUDE.md y BITACORA.md documentan
  que se retiró en favor de `checks.jsonl` + `changes.jsonl` (commit `875785f`). Actualizar
  la sección correspondiente de README.md.

- [x] **Ruido de ESLint: `no-unused-vars` en destructuring para excluir campos (falso positivo).**
  `src/api.js:312` y `src/api.js:673`: `const safe = users.users.map(({ password, passwordHash, ...rest }) => rest)`
  — el objetivo ES excluir esos campos del objeto resultante (nunca exponer contraseñas), no
  usarlos. ESLint los marca "never used" igualmente. Fix: añadir `ignoreRestSiblings: true`
  a la regla `no-unused-vars` en `eslint.config.js`.

- [ ] **`index.js:2941` — `RRS_SECTION_BY_ID` construido pero nunca usado.**
  `const RRS_SECTION_BY_ID = new Map(RRS_TABULAR_SECTIONS.map(...))` sin ningún `.get()`
  posterior en el archivo. Revisar si es código muerto (borrar) o si falta cablear su uso en
  `extractRrsGenericTable`/`genericRowKey` (actualmente iteran `RRS_TABULAR_SECTIONS`
  linealmente en vez de indexar por id).

- [x] **`index.js:803` — `catch (error)` sin usar en `loadState()`.**
  Resuelto: ahora loguea `console.error("[loadState]", error.message)` antes de devolver
  `null`, siguiendo el mismo patrón `[TAG]` del resto del archivo — ya no silencia errores
  reales de parseo de `state.json`.

---

## Fase 2 — Cobertura de tests

- [x] **Solo 6 de las 57 funciones exportadas en `index.js` tenían test — ampliado a 24.**
  `test/index.test.js` ahora cubre también `migrateStringKeysByHearingCase`,
  `deriveRrsEventIdFromUrl`, `expandRrsUrlTemplate`, `hearingTypeToLabelNames`,
  `rowFingerprint`, `absolutizeRrsHref`, `detectQuestionsChanges`,
  `detectScoringInquiryChanges`, `detectDocumentChanges`, `scheduleHasClockTime`/
  `scheduleIsPending`/`scheduleUsesScheduleList`, `changedFields`, `genericRowKey`/
  `genericRowFingerprint`/`detectGenericRowChanges`, `genericChangesEmpty`/
  `hasGenericChanges`. Más `test/extractRrsGenericTable.test.js` con fixtures HTML
  (reordenación de columnas, `d-none`, fila "no results"). 44 tests en total.

- [ ] **Funciones Trello/HTTP sin cobertura (`trelloAuthParams`, `trelloGetCard`,
  `applyTrelloCycle`, etc.) — son 3 de los top-10 "god nodes" del grafo** (`trelloAuthParams()`
  21 edges, `applyTrelloCycle()` 12 edges) **pero no están testeadas.** Necesitan mock de
  `fetch` global (Node 18+ trae `fetch` nativo — se puede sobreescribir `global.fetch` en el
  test con `node:test`'s `t.mock` o un stub manual). Evaluar si merece la pena antes de tocar
  esa lógica (son las funciones más conectadas = más riesgo si se rompen).

- [x] **Extraer `extractRrsGenericTable` + parsers de HTML a tests con fixtures.** — Ver item
  anterior: `test/extractRrsGenericTable.test.js` + `test/fixtures/*.html`.

---

## Fase 3 — Arquitectura / cohesión baja (más invasivo, discutir antes de tocar)

- [ ] **`index.js` (~3.800 líneas) tiene cohesión muy baja (0.056) y mezcla 3 responsabilidades
  en una sola "comunidad" del grafo:** scraping/parsing RRS, sync con Trello, y el ciclo del
  monitor (`runMonitorCycle`). El grafo sugiere la pregunta directamente: "¿debería
  `index.js` dividirse en módulos más pequeños?". Candidato a split en:
  `src/rrsScraping.js` (extract*/detect*/fingerprint), `src/trelloSync.js` (todo lo que empieza
  por `trello*`/`apply*TrelloCycle`), dejando `index.js` solo con `runMonitorCycle`/`main`.
  **No rompe la regla "solo HTML/CSS/JS vanilla"** — son módulos CommonJS nativos de Node, no
  un bundler. Mantener el mismo patrón `module.exports` + `require.main === module` ya
  establecido. Alto impacto en legibilidad, pero riesgo de romper referencias cruzadas si no
  se hace con cuidado (muchas funciones se llaman entre sí dentro del mismo archivo hoy).

- [x] **97 nodos "aislados" (≤1 conexión) en el grafo — investigado, sin código muerto real.**
  Mayoría son imports repetidos (`fs`, `path`, `cheerio` como nodo por archivo, ruido del
  grafo). De las 11 funciones de código con ≤1 conexión, las 4 de `src/api.js`
  (`createSession`, `destroySession`, `logUserActivity`, `readBody`) sí se usan — confirmado
  con `grep` — dentro de los handlers de `router`, pero el extractor AST no resuelve esas
  llamadas (falso positivo de la herramienta, no del código). Las 7 de `data/viewer.html`
  (`authFetch`, `renderHearingsTable`, etc.) probablemente igual: SPA de 270 KB con bindings
  `onclick`/`addEventListener` que el AST estático no sigue. Sin acción de código necesaria.

- [ ] **(Nota, no action item) 63 "edges colapsados" que reporta el chequeo de salud de
  graphify** son un artefacto del propio extractor AST al ver cada función listada dos veces
  (`contains` por definición + `indirect_call` por aparecer en el array `module.exports`) — no
  es un bug de `index.js`, es cómo graphify interpreta ese patrón. No investigar como si fuera
  un problema de código.

---

## Fase 4 — Seguridad (ya conocida, NO tocar sin acuerdo explícito del usuario)

Listado solo como referencia cruzada — ya documentado en `CLAUDE.md` § Seguridad, decisión
consciente, no reabrir sin hablarlo primero:

- `.env` versionado históricamente con secretos reales de Trello/Telegram (rotar antes de
  publicar el repo).
- `data/users.json` guarda contraseñas en claro a propósito (`verifyPassword` acepta claro o
  sha256).

---

## Cómo usar este archivo

Cada sesión futura que trabaje sobre este backlog:
1. Elegir la fase más temprana con items sin marcar.
2. Resolver **un item a la vez**, verificar con `npm test` + `npm run lint` (nunca
   `npm run once`/`npm start` como smoke test — ver CLAUDE.md).
3. Marcar `[x]` aquí y añadir entrada en `BITACORA.md`.
4. Si el fix cambia código no trivial, considerar relanzar `/graphify . --update` para
   mantener el grafo de conocimiento al día.
