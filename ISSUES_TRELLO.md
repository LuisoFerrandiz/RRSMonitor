# Issues de Trello — Script Monitor RRS

> **Trello está deshabilitado (`TRELLO_ENABLED=false`) y sin uso previsto por ahora.**
> Este archivo agrupa, separado de `ISSUES.md`, todo lo relacionado con la integración
> Trello (tests, bugs, deuda técnica) para resolverlo **antes de reactivar Trello**, no
> antes. No tocar código Trello motivado por este archivo hasta que el usuario confirme
> que Trello se va a poner en marcha de nuevo.

---

## Pendiente — resolver antes de reactivar Trello

- [ ] **Funciones Trello sin cobertura de tests.** `trelloAuthParams`, `trelloGetCard`,
  `applyTrelloCycle` y el resto de `trello*`/`apply*TrelloCycle` en `index.js` no tienen
  ningún test — son 3 de los top-10 "god nodes" del grafo de conocimiento
  (`trelloAuthParams()` 21 edges, `applyTrelloCycle()` 12 edges, `trelloGetCard()` 12 edges),
  es decir, las funciones más conectadas/riesgosas de todo el archivo.
  Riesgo: Medio. Seguridad: Bajo — los tests deben usar `TRELLO_KEY`/`TRELLO_TOKEN`
  ficticios o mockeados, nunca credenciales reales de `.env`; revisar que ningún fixture
  de test quede con un token real antes de commitear.
  Enfoque: sobreescribir `global.fetch` (Node 18+ nativo) con un stub que devuelva
  respuestas Trello de ejemplo, sin tocar la implementación de `index.js`.

- [ ] **Extraer `src/trelloSync.js` de `index.js` (parte del split documentado en
  `ISSUES.md` Fase 3, pero solo la mitad Trello).** Todo lo que empieza por `trello*` o
  `apply*TrelloCycle` (`trelloAuthParams`, `trelloGetCard`, `trelloCreateCard`,
  `applyTrelloCycle`, `applyTimeLimitTrelloCycle`, `applyDocumentTrelloCycle`,
  `applyQuestionsTrelloCycle`, `applyScoringInquiriesTrelloCycle`, etc. — bloque grande,
  ~40% de `index.js`) a su propio módulo CommonJS. Riesgo: Alto (mismo motivo que el split
  general — muchas llamadas cruzadas). Seguridad: Ninguno directo. Hacerlo en último lugar,
  después del item de tests de arriba, para no refactorizar código sin red de seguridad, y
  solo si/cuando Trello se reactiva.

- [ ] **`.env` versionado históricamente con secretos reales de Trello (`TRELLO_KEY`/
  `TRELLO_TOKEN`) — rotar antes de publicar el repo.** Seguridad: Alto. Ya conocido, mismo
  criterio que el resto de seguridad conocida en `CLAUDE.md` § Seguridad: no tocar sin
  acuerdo explícito del usuario para ese cambio concreto. (El secreto equivalente de
  Telegram está en `ISSUES.md` Fase 4, no aquí — no es Trello.)

---

## Referencias cruzadas (código no-Trello que algo Trello depende de él)

- **`hearingTypeToLabelNames()`** vive ahora en `src/rrsScraping.js` (movida en sub-fase C3
  del split de `index.js`, `ISSUES.md` Fase 3). La usa `trelloSyncHearingTypeLabels()`
  (`index.js`, dentro del bloque Trello) junto con la constante `HEARING_TYPE_TRELLO_LABEL_NAMES`
  (sigue en `index.js`, **no tocada**) para decidir qué etiquetas poner en una tarjeta.
  Si se hace el split de `src/trelloSync.js` (item de arriba), `trelloSyncHearingTypeLabels`
  tendrá que importar `hearingTypeToLabelNames` desde `src/rrsScraping.js` igual que hace
  `index.js` hoy — no son funciones redundantes, es una dependencia real entre los dos módulos.

- **`timeLimitCardTitle()` y `timeLimitDescription()`** (movidas en sub-fase C4) las usa
  `trelloCreateTimeLimitCard()`/`trelloApplyTimeLimitRow()` (`index.js`, bloque Trello) para
  construir `name`/`desc` de la tarjeta. `summarizeTimeLimitRow()` (misma sub-fase) **no**
  tiene cruce con Trello — solo la usa `formatTelegramMessage()`. Mismo patrón que arriba:
  si se hace el split `src/trelloSync.js`, ese módulo importará `timeLimitCardTitle`/
  `timeLimitDescription` desde `src/rrsScraping.js`.

- **`questionRowKey()`** (movida en sub-fase C5) la llama directamente
  `applyQuestionsTrelloCycle()` (`index.js`, bloque Trello, 2 call sites) para emparejar
  filas con tarjetas Trello existentes — no solo la usa `detectQuestionsChanges` internamente.
  `questionFingerprint()`/`extractQuestionsRows()`/`detectQuestionsChanges()` (misma
  sub-fase) no tienen cruce con Trello, solo las usa el ciclo de scraping.

---

## Cómo usar este archivo

1. No empezar ningún item de aquí sin que el usuario confirme explícitamente que Trello
   se va a reactivar.
2. Cuando se reactive: resolver estos items **antes** de poner `TRELLO_ENABLED=true` en
   producción, no después.
3. Cualquier nuevo issue/bug de Trello descubierto en el futuro se añade aquí, no en
   `ISSUES.md`.
4. Marcar `[x]` al cerrar + entrada en `BITACORA.md`, mismo criterio que `ISSUES.md`.
