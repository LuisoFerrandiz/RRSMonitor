# Bitácora — Script Monitor RRS

> Registro de estudio y trabajo sobre el proyecto. Una entrada por sesión, la más reciente arriba.

---

## 2026-10-12 — ISSUES_TRELLO.md Fase B: tests de los 3 god nodes Trello (parcial)

- **Item 1 de `ISSUES_TRELLO.md` § Pendiente marcado `[x]` (parcial)** — `test/trello.test.js`
  nuevo (6 tests): `trelloAuthParams` (forma del `URLSearchParams`, sin leer valores
  reales), `trelloGetCard` (mock de `global.fetch`, caso ok y caso 404), `applyTrelloCycle`
  (camino `TRELLO_ENABLED=false`, que es el real en este `.env`, y camino sin estado
  previo — ambos puros, sin red). Se exportaron `trelloAuthParams`, `trelloGetCard`,
  `applyTrelloCycle` en `module.exports` de `index.js` (antes no exportadas). Ningún
  secreto real en el fichero de test (verificado con `grep`); Trello sigue
  `TRELLO_ENABLED=false`, no se tocó la implementación. 67/67 tests, 0 lint.
- **No cubierto todavía**: el resto de `trello*`/`apply*TrelloCycle` bajo el camino
  `TRELLO_ENABLED=true` (creación/actualización real de tarjetas) — exigiría mockear todo
  el flujo; queda para cuando Trello se reactive de verdad. El split a
  `src/trelloSync.js` (segundo item de `ISSUES_TRELLO.md`) sigue sin empezar.

---

## 2026-10-12 — Fase C completa: `index.js` dividido en `src/rrsScraping.js` (11/11 sub-fases)

- **Fase C cerrada** (ISSUES.md): las 11 sub-fases C0-C9b completadas, cada una en su propio
  commit, cada una verificada (`node --check` + `npm test` + `npm run lint` + 57 exports
  intactos en `index.js`) antes de pasar a la siguiente. Resultado: `src/rrsScraping.js`
  nuevo con todas las funciones puras de parsing/fingerprint/detección de cambios RRS
  (formato/tiempo, URLs RRS, time limit, questions, scoring inquiry, event documents,
  secciones tabulares genéricas, decisions/hearings). `index.js` se queda con
  `runMonitorCycle`/`main`, los helpers de red (`fetchHtml`, `fetchAllDecisionPages` — hacen
  fetch, no son parsing puro) y todo el bloque Trello (pendiente de su propio split en
  `ISSUES_TRELLO.md`, diferido hasta reactivar Trello).
- **Técnica usada en las 11 sub-fases:** mover el cuerpo de la función a
  `src/rrsScraping.js`, en `index.js` reemplazar la definición por
  `const { fn } = require("./src/rrsScraping")` con el mismo nombre local — ningún call site
  interno se tocó en todo el proceso.
- **C9a** añadió 18 tests nuevos (`test/decisions.test.js` + 2 fixtures) para el cluster
  Decisions/Hearings *antes* de moverlo en C9b (no había cobertura previa) — subió el total
  de 44 a 62 tests durante la Fase C.
- **Referencias cruzadas Trello documentadas en `ISSUES_TRELLO.md`** a medida que aparecían:
  `hearingTypeToLabelNames` (C3), `timeLimitCardTitle`/`timeLimitDescription` (C4),
  `questionRowKey` (C5), `scoringInquiryRowKey` (C6), `documentRowKey`/
  `eventDocumentCardTitle`/`eventDocumentCardDescription` (C7) — todas son funciones que
  ahora viven en `src/rrsScraping.js` pero el bloque Trello de `index.js` las llama
  directamente; cuando se haga el split `src/trelloSync.js` (ISSUES_TRELLO.md), ese módulo
  tendrá que importarlas desde `src/rrsScraping.js`.
- **Resultado final:** 62/62 tests, 0 warnings lint, `runMonitorCycle`/`main`/Telegram/Trello
  sin cambios de comportamiento (solo movimiento de código, ninguna lógica reescrita).

---

## 2026-10-12 — Fase C iniciada: split de `index.js` en sub-fases C0-C9b

- **`src/rrsScraping.js` nuevo** — Fase C (ISSUES.md) dividida en 11 sub-fases pequeñas,
  verificadas una a una (`node --check` + `npm test` + `npm run lint` + 57 exports intactos),
  en vez de un split monolítico de alto riesgo. Técnica: mover el cuerpo de la función, en
  `index.js` reemplazar la definición por `const { fn } = require("./src/rrsScraping")` con
  el mismo nombre local — ningún call site interno se toca.
- **C0** (scaffolding) y **C1** (`padTimePart`, `zonedOffsetRFC`, `formatReportTimestamp`,
  `normalize`, `dedupeRepeatedWordSpans`, `hearingCaseKey`, `migrateStringKeysByHearingCase`
  + constante `REPORT_TIME_ZONE`) completadas y verificadas. 44/44 tests, 0 warnings lint.
- **Pendiente:** C2-C9b (ver checklist en `ISSUES.md` Fase 3), cada una en su propio commit.

---

## 2026-10-12 — Fase B cerrada + separación de issues Trello en `ISSUES_TRELLO.md`

- **`ISSUES_TRELLO.md` nuevo:** se separaron todos los issues directamente relacionados con
  Trello (tests sin cobertura de `trello*`/`apply*TrelloCycle`, el split de `src/trelloSync.js`
  del refactor de `index.js`, y el secreto `TRELLO_KEY`/`TRELLO_TOKEN` en `.env` versionado) a
  un archivo aparte, marcado "no tocar hasta que Trello se reactive" — Trello está
  `TRELLO_ENABLED=false` y sin uso previsto. `ISSUES.md` queda solo con punteros de contexto.
- **Fase B cerrada** (su único item no-Trello): `index.js:2941` `RRS_SECTION_BY_ID` — confirmado
  dead code real (ningún `.get()` lo usa; `scrapeRrsTabularSections()` siempre itera
  `RRS_TABULAR_SECTIONS` linealmente, nunca por id) y borrado. 44/44 tests, 0 warnings lint.
- **Pendiente:** Fase C (split `index.js` en módulos, alto riesgo — requiere aprobación
  explícita) y todo `ISSUES_TRELLO.md` (diferido hasta reactivar Trello).

---

## 2026-10-12 — ISSUES.md generado con `/graphify` + Fase A resuelta (6/6, riesgo muy bajo)

- **Origen:** análisis `/graphify .` (grafo de conocimiento) + lint/test de esta sesión generó
  `ISSUES.md` (backlog faseado) y un plan de ejecución re-secuenciado por riesgo con variable
  de impacto en seguridad por item (`~/.claude/plans/no-haz-un-plan-elegant-yeti.md`).
- **Fase A cerrada** (6 items, riesgo muy bajo/sin impacto en seguridad):
  1. README.md: corregidas 4 referencias desactualizadas a `history.jsonl` → `checks.jsonl`.
  2. `eslint.config.js`: `ignoreRestSiblings: true` en `no-unused-vars` (elimina 4 falsos
     positivos en `src/api.js` por destructuring `{ password, passwordHash, ...rest }`).
  3. `index.js:803`: `catch (error)` en `loadState()` ahora loguea `error.message` en vez de
     silenciarlo.
  4. `test/index.test.js`: ampliado de 6 a 24 funciones puras cubiertas (migrate/derive/expand
     URL, hearingTypeToLabelNames, rowFingerprint, absolutizeRrsHref, detect*Changes de
     preguntas/scoring/documentos, schedule*, changedFields, generic*).
  5. `test/extractRrsGenericTable.test.js` + `test/fixtures/*.html` nuevos: cubren tolerancia a
     columnas reordenadas/`d-none` y fila "no results" con colspan.
  6. Investigados los 97 nodos "aislados" del grafo — confirmado que las 11 funciones de código
     con ≤1 conexión (`createSession`, `destroySession`, `logUserActivity`, `readBody` en
     `src/api.js`; 7 más en `data/viewer.html`) son falsos positivos del extractor AST de
     graphify (llamadas dentro de handlers `router`/bindings `onclick` que no resuelve), no
     código muerto real. Sin cambios de código.
- **Resultado:** 44/44 tests, 0 errores lint (1 warning `RRS_SECTION_BY_ID` sin usar, es Fase B
  — fuera de alcance, no tocado).
- **Pendiente:** Fase B (decidir destino de `RRS_SECTION_BY_ID`; tests con mock `fetch` para
  funciones Trello) y Fase C (split de `index.js` en módulos, alto riesgo) — ambas requieren
  aprobación explícita antes de empezar, según el plan.

---

## 2026-10-12 — Añadido test runner (`node:test`) y lint (`eslint.config.js`)

- **Motivo:** proyecto sin tests ni lint, `index.js` con ~3800 líneas y ~131 funciones top-level,
  muchas puras (parseo, fingerprint, detección de cambios) pero no exportadas — imposible
  testearlas sin ejecutar el ciclo completo.
- **Cambio en `index.js`:** añadido `module.exports` (57 funciones puras/deterministas:
  `normalize`, `hearingCaseKey`, `detectTimeLimitChanges`, `extractRrsGenericTable`, etc. —
  no incluye las que llaman a Trello/red) al final del archivo, y envuelta la llamada a
  `main()` en `if (require.main === module)` para que `require("./index.js")` desde un test
  no dispare el scraping real. Mismo patrón que ya usaba `src/kanbanSync.js`.
- **Elegido `node:test` nativo** (no Jest/Vitest) para no meter bundler/transform — regla
  del proyecto "sin build steps". `npm test` → `node --test` → descubre `test/*.test.js`.
  Primer archivo: `test/index.test.js` (12 tests: `normalize`, `dedupeRepeatedWordSpans`,
  `hearingCaseKey`, `timeLimitRowKey`/`Fingerprint`, `detectTimeLimitChanges`).
- **Elegido ESLint flat config** (`eslint.config.js`) sin plugins TS/framework — solo
  `eslint:recommended` + globals de Node. `npm run lint` → 0 errores, 6 warnings (vars sin
  usar preexistentes en `index.js`/`src/api.js`, no tocadas — fuera de alcance de esta sesión).
  `eslint` queda solo en `devDependencies` (no toca "dependencias mínimas" de runtime).
- **Incidente durante la verificación:** al probar que `npm run once` seguía funcionando tras
  el cambio, ese comando ejecutó un ciclo real y disparó el reset automático preexistente por
  `RRS_EVENT_ID` 13730→15805 (lógica normal de "evento nuevo", no causada por este cambio).
  Vació `state.json`/`checks.jsonl`/`changes.jsonl` con backup en
  `data/backup_2026-10-12T09-07-52-362Z/`. `TELEGRAM_ENABLED=false` y `TRELLO_ENABLED=false`
  en ese momento → sin notificaciones ni tarjetas duplicadas. Lección para próxima vez:
  **no usar `npm run once`/`npm start` como smoke test** tras tocar `index.js` — usar
  `node --check` + `npm test` en su lugar (documentado en `CLAUDE.md`).
- **Pendiente:** cobertura de funciones Trello/HTTP (necesitan mocking de `fetch`); el resto
  de funciones puras no cubiertas por los 12 tests iniciales.

---

## 2026-09-12 — Time limit de RRS quedaba huérfano para siempre + fecha vacía

- **Bug real:** `syncKanbanCards` (`src/kanbanSync.js`) saltaba la orfandad para
  CUALQUIER tarjeta `cardType:"time_limit"` (comentario "los time limit caducan
  solos"), asumiendo que solo desaparecen por vencer fecha/hora. Pero si RRS deja
  de publicar un time limit ANTES de su hora límite (caso resuelto, etc.), la
  purga cliente (mira solo fecha/hora) nunca lo retira → tarjeta huérfana en el
  kanban para siempre. Reproducido: tarjeta visible en el tablero que ya no
  estaba en la página de RRS.
- **Fix:** solo se exime de orfandad a los time limit **manuales**
  (`source:"manual"` — no vienen de RRS). Los de RRS se marcan `orphaned:true`
  igual que cualquier otro caso cuando ya no están presentes.
  `kanbanTimeLimitCardsList` (cliente) ya no pinta tarjetas `orphaned`, y
  `kanbanPurgeExpiredTimeLimitCards` también las borra de `kanban.json` (antes
  solo borraba las vencidas por fecha/hora). Commit `d8ea052`.
- **Segundo bug relacionado:** esa misma tarjeta no tenía `date` (algunos time
  limit de RRS solo traen clase+hora, sin fecha) — vacío desde que se creó.
  `buildTimeLimitCard` ahora, si RRS no trae fecha, usa como fallback el día en
  que el scraper la vio por primera vez (derivado de `updatedAt`/stamp del
  ciclo). Solo aplica al crear la tarjeta — inmutable después, igual que el
  resto. Commit `927f2f2`.
- Verificado con test funcional en Node (`syncKanbanCards` simulado): tarjeta
  RRS se orfana al desaparecer del scrap; tarjeta manual no se toca; fecha vacía
  se rellena con el día del stamp.
- **Pendiente de desplegar**: toca `src/kanbanSync.js` (backend) → necesita
  restart del contenedor `rrs-scheduler` por Portainer (mismo procedimiento que
  el backup 500 y el fix de jueces/roles/labels).
- Además, retoques UX de esta sesión (todos solo `data/viewer.html`, sin
  redeploy): tarjetas de time limit al 65% del ancho original, botones de la
  barra kanban (Manual time limit / Manage Labels / Judges / Roles) con tono
  dorado a juego con el botón Kanban, quita etiquetas "Class:"/"Date:" de la
  tarjeta (deja el dato), hora en negrita, badge TIMEOUT en verde. Backup
  offline: la tarjeta Stages ya no pinta el horario de polling (no aplica sin
  conexión); quitado el override que forzaba 1-2 columnas en las tarjetas de
  stats del `.html` de archivo (ahora 3 columnas como en la web).

## 2026-09-11 (cont.) — Tiempos límite manuales, junto a los de RRS

- Nuevo botón "Manual time limit" en la pestaña Time Limit (junto al buscador),
  solo visible para admin (`canManageUsers()`). Abre el mismo `#kanbanDetailModal`
  de siempre en modo "nueva" con una tarjeta borrador `cardType:"time_limit"`.
- Clave `` `tl:manual:${Date.now()}` `` — nunca coincide con la clave de RRS
  (`tl:<date>||<boatClass>`), así que una manual y una de RRS con la misma fecha+
  clase **coexisten** como tarjetas separadas. Campo nuevo `source:"manual"`.
- `saveKanbanCardFromModal` valida fecha/hora con `kanbanParseDateKey`/
  `kanbanParseLimitTime` antes de crear — si no parsean, error inline y no guarda
  (si no, la purga automática del countdown la borraría en el siguiente render).
- Nuevo botón "Delete" en el pie del modal, solo para tarjetas `time_limit` con
  `source:"manual"` y solo admin — las de RRS no se borran a mano, solo expiran.
- `renderTimeLimitsTable()` fusiona `stateData.timeLimitRows` (RRS) con las
  tarjetas `time_limit`/`source:"manual"` de `kanbanData.cards`; las manuales
  llevan badge "Manual" y son clicables (admin) para editar; las de RRS igual que
  siempre, solo lectura.
- **Sin cambios en `index.js`, `src/kanbanSync.js` ni `src/api.js`** — todo vive
  en `data/viewer.html`, reutilizando `PUT /api/kanban` tal cual. No hace falta
  redeploy del contenedor, solo Syncthing + hard refresh.
- Verificado en navegador (API real + `DATA_DIR` temporal): crear manual con la
  misma fecha+clase que una tarjeta RRS existente → ambas coexisten en tabla y
  kanban; editar notas; borrar; validación rechaza fecha/hora no parseable sin
  cerrar el modal; botón y borrado ocultos sin sesión de admin. 0 errores de consola.

## 2026-09-11 — Backup 500 resuelto en producción (sin SSH, solo Portainer)

- El fichero `/app/src/api.js` dentro del contenedor **ya tenía el código nuevo**
  (Syncthing sí lo había replicado — no era problema de bind-mount). El proceso
  `node /app/src/api.js` (PID 9) llevaba corriendo desde antes del sync y tenía el
  código viejo en memoria: el restart previo del usuario no llegó a matar ese proceso.
- Diagnóstico vía consola de Portainer (Containers → `rrs-scheduler` → Console):
  `grep -c archiveFileName /app/src/api.js` → 2 (fichero al día); `ps aux` mostró el
  proceso arrancado antes del sync.
- **Fix**: Restart desde el botón de Portainer (no desde el shell). Verificado:
  `curl .../api/archive` → **401** (antes 500).
- **Confirmado también el fix de kanban** (jueces/roles/labels, `af177fe`): mismo
  procedimiento (`grep -c labelCatalog /app/src/api.js` → 7, restart por Portainer) →
  verificado en el dashboard real: asignar juez+rol, guardar, recargar → persiste.
  Ambos pendientes de despliegue quedan **cerrados**. Patrón para el futuro: el
  volumen `/app/src` es un bind-mount vivo (Syncthing), nunca hace falta rebuild de
  imagen — solo confirmar con `grep -c` y dar Restart en Portainer.

## 2026-09-10 (cont.) — Kanban: las tarjetas nuevas de "decided" salen compactadas

- UX, sin cambio de lógica ni de columnas. Nueva función `kanbanCardMinimal(card)`:
  si `minimalView` no está fijado como booleano, una tarjeta en la columna `decided`
  se renderiza compactada por defecto (como el ojo). Las tarjetas existentes ya llevan
  `minimalView` explícito, así que esto solo afecta a las que van llegando.
- Todos los puntos de render que leían `card.minimalView` (cara de la tarjeta, cabecera
  con el ojo, visibilidad de campos del modal, ojo masivo de la columna, toggles)
  pasan por el helper. El ojo alterna sobre el valor efectivo y a partir de ahí fija
  el booleano explícito.
- `data/kanban.json` local: las 9 tarjetas actuales quedan con `minimalView:false`
  (el usuario compacta a mano las que quiera). `kanban.json` no se versiona ni sincroniza.

## 2026-09-10 (cont.) — Kanban: los jueces/roles/labels no se guardaban (401 + contrato roto)

- **Síntoma**: al abrir una tarjeta se podían elegir jueces, pero no se guardaban ni
  aparecían en la tarjeta. Igual con los roles (chairman/scribe/observer…) y las labels.
- **Causa 1 — falta de auth**: `kanbanSaveData` (`PUT /api/kanban`) y los 6 POST/DELETE de
  los gestores de labels/judges/roles usaban `fetch()` pelado, sin cabecera
  `Authorization: Bearer`. El servidor exige `requireAuth` → **401** → no se guardaba nada
  (ni tarjetas, ni movimientos de columna desde el modal). Toda la persistencia del kanban
  pasa por `kanbanSaveData`.
- **Causa 2 — respuesta sin catálogo**: el cliente lee `data.judgeCatalog` /
  `data.roleCatalog` / `data.labelCatalog` tras un alta; el servidor devolvía solo
  `{ ok, judge|role|label }`. El catálogo en memoria no se refrescaba: el juez recién
  creado no salía en el desplegable hasta recargar la página.
- **Causa 3 — campos descartados**: `POST /api/kanban-roles` guardaba `{id, name}` y
  perdía `label` + `badgeStyle` (el cliente pinta `role.label`); `POST /api/kanban-labels`
  perdía `bg` (el cliente pinta `label.bg`).
- **Causa 4 — envoltorio GET**: `GET /api/kanban-{labels,judges,roles}` devolvían el store
  crudo; `kanbanFetch*Catalog` espera `{ <x>Catalog: {…} }`.
- **`src/api.js`**: los GET devuelven doble forma (items a nivel raíz + `<x>Catalog`); los
  POST persisten todos los campos del cliente y responden con el store completo; los DELETE
  también; los roles/labels del sistema (`system:true`) no se pueden borrar.
- **`data/viewer.html`**: los 7 `fetch` de escritura del kanban pasan a `authFetch`;
  `kanbanRefreshOpenDetailJudges()` tras crear/borrar juez.
- Verificado: roundtrip con API real (`DATA_DIR` temporal) + navegador con sesión iniciada
  — alta de juez/rol/label, asignación a tarjeta, guardado, recarga desde servidor y badge
  con nombre + rol. `PUT /api/kanban` sin token → 401. Las 9 tarjetas intactas.

## 2026-09-10 (cont.) — PENDIENTE: backup 500 en producción, sin desplegar

- Tras el commit `48ad7a5`, el dashboard sigue dando HTTP 500 al pulsar Backup.
- Probado vía Tailscale contra `http://100.108.112.9:8083/api/archive`:
  `{"ok":false,"error":"CONFIG is not defined"}` → **el contenedor `rrs-scheduler`
  corre `src/api.js` viejo** (el nuevo daría 401: `requireAuth` va antes de
  `buildArchiveHtml`). `GET /api/auth/status` responde 200: servidor vivo.
- El usuario reinició `rrs-scheduler` y el 500 persiste. Hipótesis: Syncthing no
  replicó `src/api.js`, o el contenedor usa código de la imagen y no un bind-mount
  del volumen sincronizado (haría falta rebuild/redeploy, no solo restart).
- Siguiente paso (SSH al host): `docker exec rrs-scheduler grep -c archiveFileName
  /app/src/api.js` y `grep -c archiveFileName <ruta_sync>/src/api.js`. Ver
  memoria `rrs-backup-500-deploy`.

## 2026-09-10 (cont.) — Backup: un único `.html` = visor offline + fuente de restauración

- **Problema**: había dos mecanismos descoordinados. `GET /api/archive` (HTML autocontenido)
  estaba **roto** (`CONFIG` inexistente en `src/api.js` → 500), era **público** y embebía
  `users.json` **con contraseñas en claro**. El "Export JSON" (cliente) era el único formato que
  aceptaba Restore, y su botón estaba oculto. El HTML se veía offline pero no se restauraba.
- **`src/api.js`**: `buildArchiveHtml()` — fuera el filtrado por flags (un backup es completo;
  además elimina el crash de `CONFIG`); `userCatalog` sin `password`/`passwordHash`; bundle
  `version:2` con `eventId`/`eventTitle`/`monitorConfig`/catálogos a nivel raíz; nombre
  `RRS_<eventId>_<fecha>.html`. `GET /api/archive` ahora **exige login**. `POST /api/restore`:
  copia previa en `data/backup_<epoch>/` (antes el `confirm` lo prometía y no lo hacía) y
  `kanban.json` recibe solo `{cards}` (no los catálogos que trae el archivo).
- **`data/viewer.html`**: modal Backup con 3 tarjetas (Backup file / Restore / New event); fuera
  "Export JSON" (`buildRestoreBundle`/`downloadRestoreBundle`/`linesToRaw` borradas). La descarga
  usa `authFetch` + blob (la ruta ya no admite navegación pelada). `importRestoreBundle` acepta
  `.html`: extrae `window.__RRS_ARCHIVE__` con regex y restaura solo datos del evento (el `.json`
  `rrs-restore-v1` antiguo sigue funcionando). `showArchiveModeUI`: la tarjeta Schedule y el botón
  Log dejan de ocultarse; el editor de Schedule se abre en **solo lectura** (`applyScheduleEditorReadonly`)
  cuando `isArchiveView()`. Bundle con `generatedAt` para el banner; `renderStages()` en la rama
  de archivo.
- Verificado con API real (`DATA_DIR` temporal): `/api/archive` 401 sin token / 200 con token,
  bundle `version:2` sin contraseñas, restore round-trip (backup creado, `state`/`checks`/
  `changes`/`schedule`/`kanban.cards` restaurados). Navegador (archivo servido por HTTP): modo
  archivo, Log poblado, Schedule read-only, 0 peticiones externas, 0 errores. Modo normal: modal
  con 3 tarjetas, funciones nuevas presentes.

## 2026-09-10 (cont.) — Fecha de tarjeta kanban = fecha de descarga de RRS (inmutable) + alta/orfandad desde el servidor

- **Problema**: `updatedAt` de una tarjeta kanban era un timestamp de acción de usuario — el
  "ojo" (vista mínima), mover de columna y guardar el modal lo re-sellaban, reordenando la
  columna "Decided". Además las tarjetas solo se materializaban una vez (bootstrap cliente con
  el tablero vacío); los casos nuevos de RRS no aparecían.
- **`updatedAt` ahora es la fecha de descarga de RRS y es inmutable**: se sella al crear la
  tarjeta (con el `timestamp` del ciclo) y **ninguna acción de UI la toca**. `data/viewer.html`:
  quitados los 3 `updatedAt: new Date()...` (`kanbanToggleCardMinimalView`, `kanbanMoveCard`,
  `saveKanbanCardFromModal` ×2); la opción de orden "Last modified" → **"By RRS date"**; el
  bootstrap cliente sella `updatedAt: stateData.timestamp` + `eventId`.
- **`src/kanbanSync.js`** (nuevo, Node vanilla): `syncKanbanCards(state, kanban, now)` — réplica
  de la parte pura del bootstrap. **Aditivo estricto**: crea tarjetas para casos de RRS que no
  la tienen; **nunca** modifica ni borra una existente. Marca `orphaned:true` (+ `orphanedAt`)
  las tarjetas cuyo caso ya no está en RRS y limpia la marca si reaparece. No orfana tarjetas de
  otro `eventId` (el kanban se conserva al cambiar de evento) ni las de time limit.
- **`index.js`**: `syncKanbanFromSnapshot(snapshot)` tras `saveState`; escribe `kanban.json` solo
  si hubo altas/huérfanas/recuperadas. Falla suave. **`src/api.js`**: `GET /api/kanban` corre la
  misma sync (cubre la ventana entre ciclos).
- **Orfandad en la UI**: tarjeta con borde discontinuo + opacidad + badge "Not in RRS"; sigue
  siendo arrastrable/editable.
- Verificado: `node --check` ×3, 7/7 tests unitarios de `syncKanbanCards`, `npm run once` real
  (`kanban.json` `{}` → 9 tarjetas de las 9 decisiones, `updatedAt` = timestamp del ciclo;
  segundo ciclo sin cambios). Navegador: toggle del ojo no cambia `updatedAt`, orden "By RRS
  date", badge de orfandad OK, sin errores de consola.

## 2026-09-10 (cont.) — Cirugía de datos del evento viejo + línea base en el Log

- **Cirugía** (manual, con backup en `data/backup_surgery_*`): se quitaron de `checks.jsonl`
  (99→2) y `changes.jsonl` (48→1) las líneas del evento anterior (Sardinia, mayo-junio) y la
  línea "sucia" del `2026-09-10T13:22:00` (el diff falso Sardinia→Maxi: `docs +21 −18`,
  `Q&A ~7 −12`). Quedó solo lo legítimo del evento 13730.
- Efecto colateral: Q&A / Scoring / Hearings son timelines de cambios sin *fallback* a
  `state.json` (solo Documents y Decisions lo tienen) → se quedaban vacías.
- **Solución: línea base** (commit `2a5f3be`):
  - `index.js`: `appendCheck(..., !previousState)` → escribe `baseline:true` en el primer
    ciclo del evento. Con el reset por cambio de `RRS_EVENT_ID`, cada evento nuevo arranca
    con fila BASELINE.
  - Inyectada a mano (una vez, desde `state.json`) una línea `baseline:true` en `checks.jsonl`
    y otra en `changes.jsonl` fechadas `13:22:00` con todo el inventario actual como "added"
    (retirement=0, apareció a las 13:45), sin `removed`.
  - `data/viewer.html`: la fila baseline se muestra como Origin "Baseline" + badge "BASELINE"
    (indigo); el filtro "Changes only" la incluye (`l.changed || l.baseline`).
- Verificado en navegador: Log "Changes only" = 2 filas (`13:45` CHANGED + `13:22` BASELINE);
  Q&A 7 filas, Scoring 1, Documents 21, Hearings 9 Decisions — todo desde la baseline. Sin
  errores de consola.

## 2026-09-10 (cont.) — Reset automático al cambiar `RRS_EVENT_ID` + Log por defecto solo cambios

- **Log por defecto = "Changes only"** (commit `86ceea8`): `#filterSource` arranca mostrando
  solo los ciclos con cambios; "All checks" (todas las revisiones de `checks.jsonl`) queda como
  opción secundaria. `getHistoryLogSource()` defaultea a `changes`.
- **Reset automático al cambiar de evento** (commit `4c44258`): el `snapshot` guarda ahora
  `eventId` en `state.json`. Al inicio de `runMonitorCycle`, si `previousState.eventId` existe
  y difiere del `CONFIG.eventId` configurado → `resetEventDataOnEventChange()`: copia
  `state.json` / `checks.jsonl` / `changes.jsonl` a `data/backup_<fecha>/` y los vacía; el
  ciclo pasa a línea base (`baseline:true`, sin "todo lo viejo borrado / todo lo nuevo
  añadido"). **NO toca** kanban, schedule, monitor-config, users, scheduler.log.
  - Solo dispara si el estado previo YA tenía `eventId`; un `state.json` viejo sin `eventId`
    no cuenta → se le estampa el id en el siguiente guardado y el reset actúa en cambios
    futuros. Decisión del usuario: NO resetear el estado actual (13730 venía de un salto
    sucio desde Sardinia); el "cambio falso" de ese salto se queda en el log.
  - Verificado en dir de datos aislado (`DATA_DIR=`): `99999 -> 13730` crea backup, vacía los
    3 archivos, el ciclo escribe 1 línea baseline en cada uno, kanban intacto. Y `npm run once`
    real: sin `[EVENT_CHANGE]` (no reset), `state.json` queda con `"eventId": "13730"`.

## 2026-09-10 (cont.) — `history.jsonl` retirado → `checks.jsonl` (auditoría) + `changes.jsonl`

- **Problema**: `history.jsonl` escribía un snapshot completo por ciclo (todos los arrays de
  filas + los mapas internos de Trello), ~8 KB/línea, con buffer y flush cada 30 min, y
  `cleanup.js` lo colapsaba a `cleanup-archive.jsonl`. 52+44 líneas = ~756 KB. El dashboard
  solo usaba de esas líneas los escalares `*RowCount`.
- **Nuevo modelo**:
  - `data/checks.jsonl` — 1 línea diminuta **cada ciclo, siempre** (`appendCheck` en
    `index.js`): `timestamp` + `changed` (bool) + contadores por sección +
    `decidedDecisionRowCount` (precalculado con la regla pending). ~290 B/línea. Es la fuente
    de la pestaña Log. Sin buffer. **gitignore** (llega al server por Syncthing).
  - `data/changes.jsonl` — sin cambios (delta compacto solo en ciclos con cambios).
  - `data/state.json` — sin cambios.
- **Retirado**: `history.jsonl`, `history.tmp.jsonl`, `history-last-flush.json`,
  `cleanup-archive.jsonl`; `appendHistoryBuffered`/`flushHistory` y `CONFIG.history*` de
  `index.js`; el bloque de history de `cleanup.js` (ahora solo compacta `scheduler.log`);
  `POST /api/force-flush-history` y el botón "Flush History" del modal Backup.
- **`data/viewer.html`**: `historyLines`→`checkLines`; fetch de `checks.jsonl` (uno, en vez de
  history + cleanup-archive); `mapHistoryLineToLogRow`→`mapCheckLineToLogRow` (lee
  `decidedDecisionRowCount` directo, añade `changed`); `renderHistoryTable` con filtro
  `all`/`changes`; `#filterSource` → `All checks` / `Only changes`; columna Status muestra
  `CHANGED` (ámbar) vs `OK`; `tableSortByTab` → `allChecks`/`changesOnly`; se eliminan
  `mapCleanupArchiveRow`/`mapCleanupArchiveToLogRow`/`cleanupArchiveEmptyMessage` y el estado
  `cleanupArchive*`. Archive export: `checksRaw` en vez de `historyRaw`/`cleanupArchiveRaw`.
- **`src/api.js`**: `HISTORY_FILE`→`CHECKS_FILE`, fuera `CLEANUP_ARCHIVE_FILE`; `buildArchive`
  → `checksRaw` (sin filtro por flags, que era no-op); `currentSnapshot`/`resetEventData`;
  `POST /api/restore` acepta `checksRaw`/`changesRaw` (antes leía `body.history`/`body.changes`,
  que no casaban con el bundle — bug preexistente, ahora arreglado).
- **`scheduler.js`**: `performCleanup(logPath)` (sin `historyPath`).
- **Migración**: `scripts/migrate-history-to-checks.js` — convierte `history.jsonl` +
  `cleanup-archive.jsonl` (96 snapshots) a `checks.jsonl`, marcando `changed:true` los
  timestamps presentes en `changes.jsonl` (45/96). Ejecutado sobre los datos reales.
- **Verificado**: `node --check` de los 4 backends + `vm.Script` de los 4 `<script>` de
  viewer.html; migración (96 líneas, formato OK); dashboard en navegador (Log renderiza desde
  `checks.jsonl`, Origin Check/Change, Status OK/CHANGED, filtro All checks / Only changes = 45,
  0 errores de consola).
- `git rm --cached data/history.jsonl data/history-last-flush.json`. `checks.jsonl` NO se
  commitea.

## 2026-09-10 (cont.) — Fusión de pestañas "Crew Substitutions" + "Equipment Substitutions"

- Mismo patrón que el merge Penalty/Retirement (`d341d73`). Solo `data/viewer.html`, sin backend.
- **Tarjeta 2**: una sola fila `Equip & Crew Substitution (N)` (N = nº crew subs + nº equip subs),
  icono `fa-users`. Se elimina `#equipment-substitutions-row` / `#stat-equipment-substitutions-line`.
  Se conserva el `tab` id `crewSubstitutions`, `#crew-substitutions-row` y
  `#stat-crew-substitutions-line`.
- **Renderer** `renderCrewSubmissionsTable()` reescrito: 7 columnas de crew, con dos cabeceras
  renombradas `PREVIOUS CREW → OLD` y `NEW CREW → NEW` (los `sortKey` internos `previousCrew`/
  `newCrew` no cambian). Filas de equipment normalizadas al shape de crew:
  `oldEquip→OLD`, `newEquip→NEW`, `status→STATUS`, `competitor=""` (`-`). Descarga:
  `equipment-<no>` vs `crew-<no>` por `_kind`. Empty: "No crew or equipment substitutions".
- **`renderEquipmentSubmissionsTable()` borrada**; quitado su dispatch en `renderTable()`.
- **Shim**: `switchTab('equipmentSubstitutions')` → `crewSubstitutions`.
- `firstEnabledDashboardTab` y `applyFeatureVisibility` (`__crewOrEquipment`), `updateStats`,
  `updateCardStyles` `lineMap`: dos entradas → una. Visible si `crewSubstitutionsEnabled` **o**
  `equipmentSubstitutionsEnabled`.
- **NO tocado**: `CONFIG_TOGGLE_DEFS` (siguen los dos toggles `CREWCHANGES` /
  `EQUIPMENTSUBSTITUTIONS`), columnas del Log ("Crew Subs" / "Equip Subs" separadas),
  `index.js`, `src/api.js`, `.env`.
- **Verificado en navegador** (servidor estático + Chrome, datos sembrados): label "(4)", sin
  `#equipment-substitutions-row`, 7 columnas con `OLD`/`NEW`, filas de equipment con `-` en
  COMPETITOR y `oldEquip`/`newEquip`/`status` en su sitio, orden por todas las columnas (mezcla
  crew+equip), búsqueda de texto de `newEquip` filtra la fila de equipment, escenarios de toggle
  (solo crew / solo equip / ambos off → fila oculta + redirect a `documents`), shim del id
  antiguo. 0 errores de consola. Los 4 bloques `<script>` parsean; `node --check` de
  `index.js`/`src/api.js` OK.

## 2026-09-10 (cont.) — Fase 3 optimización: fuera Tailwind Play CDN + Font Awesome CDN

- **Objetivo**: `data/viewer.html` cargaba `cdn.tailwindcss.com` (script ~300 KB que además
  **compila las clases en el navegador en cada arranque**) y `font-awesome/6.4.0/css/all.min.css`
  de cdnjs (+ webfonts). Dos peticiones externas y trabajo de CPU en cliente en cada carga.
- **Tailwind**: generado **una sola vez** el CSS mínimo con `tailwindcss@3.4.17` en modo
  `content` escaneando `viewer.html` (274 clases reales + valores arbitrarios `text-[9px]`,
  `max-w-[360px]`, etc.; sin `dark:`; breakpoints `sm/md/lg`). Resultado: **~18 KB** de CSS
  (incluye preflight) embebido inline en un `<style>` tras el bloque de estilos propio
  (mismo orden de cascada que tenía el CDN, que inyectaba al final del `<head>`).
- **Font Awesome**: subconjunto de **40 iconos solid** realmente usados, embebidos como
  **máscaras SVG** (`data:` URI en `--fa-svg` + `mask`/`-webkit-mask` sobre `currentColor`).
  ~31 KB inline. **Sin tocar el marcado**: los `<i class="fas fa-x">` siguen igual, incluido el
  dinámico `fa-chevron-${dir}` (chevron-up/down ambos incluidos). Aliases FA5→FA6 resueltos
  (`search`→magnifying-glass, `columns`→table-columns, `trash-alt`→trash-can,
  `question-circle`→circle-question, `users-cog`→users-gear, `external-link-alt`→up-right-from-square,
  `gear`, `right-to/from-bracket`). `.fa-spin` reimplementado con `@keyframes` + respeto a
  `prefers-reduced-motion`.
- **Verificado en navegador** (servidor estático + Chrome): layout intacto, los 33 iconos de la
  vista inicial con máscara aplicada, tabla Documents con cabeceras ordenables (chevron dinámico
  `^`/`▾` al ordenar por TYPE), buscador, botones Download. **0 errores de consola**. Únicas
  peticiones externas: la imagen del logo del evento (esperada). El dashboard ya funciona
  **sin internet**.
- **Regeneración** (si cambian clases/iconos): `npm i tailwindcss@3.4.17 @fortawesome/fontawesome-free@6.4.0`
  en un dir aparte; `tailwindcss -c <cfg con content=viewer.html> -i in.css -o out.css --minify`;
  para FA, mapear cada clase `fa-*` a su SVG solid canónico y embeberlo como `data:` URI de
  máscara. **No hay build step en el repo**: el CSS va ya resuelto dentro de `viewer.html`.

## 2026-09-09 (cont.) — Log: filtro de fuente revisado + rename de etiqueta

- **Revisión del filtro de la pestaña Log** (`#filterSource` en `data/viewer.html`): confirmado
  que funciona. `getHistoryLogSource()` → `renderHistoryTable()`:
  - `all` → `history.jsonl` + `cleanup-archive.jsonl` fusionados (sortTab `allHistory`).
  - `history` → solo `history.jsonl`.
  - `cleanup` → solo `cleanup-archive.jsonl` (sortTab `cleanupHistory`).
- **Integridad de datos verificada**: `history.jsonl` (52 líneas) y `cleanup-archive.jsonl`
  (44) 100% JSON válido, timestamps monótonos, mismo esquema. Las 44 líneas del archive
  tienen equivalente exacto (ignorando `timestamp`) en history → invariante de `cleanup.js` OK.
- **Repro limpio en navegador** (servidor estático sirviendo `data/`): los 3 modos renderizan
  (all=96, history=52, cleanup=44). La cadena parse→`mapCleanupArchiveToLogRow`→
  `renderUnifiedLogTable` es correcta. **No se pudo reproducir** el "no muestra nada".
- **Diagnóstico del "cleanup vacío"**: `dashboardFetch('cleanup-archive.jsonl')` cuando no da
  200 hace `r?.ok ? r.text() : ""` → `parseLines("")` → `[]` → "Empty cleanup archive" **sin
  error visible**. Causa probable: el `.jsonl` servido da 404 (no desplegado en esa máquina /
  Syncthing / nginx de ahí) o `viewer.html` cacheado anterior a `b256d6a`. Pendiente: el
  usuario debe abrir `…/cleanup-archive.jsonl` directo en el navegador que falla y reportar.
- **Cambio aplicado**: `data/viewer.html:615` etiqueta del `<option value="cleanup">` de
  "CleanUp History" → "Cleanup archive". `value` y nombre de fichero intactos. `All` y
  `History` sin cambios.

## 2026-09-10 (cont.) — Fusión de pestañas "Penalty Reports" + "Retirements"

Solo `data/viewer.html` (backend intacto). Ahora hay **una** entrada en la tarjeta 2,
`RET & Penalty Report (N)` (N = suma de ambos recuentos), que abre una sola pestaña.

- Tarjeta 2: eliminada `#retirements-row`; `#penalty-reports-row` relabelado.
- `renderPenaltyReportsTable()` reescrita: usa las 7 columnas de Penalty Reports y añade las
  filas de `retirementRows()` normalizadas (`type`→PENALTY TAKEN, `raceNo`→RACE, LEG y BOATS
  FOULED vacías `-`). Sin marca visual de origen. Empty state "No penalty reports or retirements".
- `renderRetirementssTable()` eliminada; quitada su rama en `renderTable()`.
- `switchTab()`: shim `if (tab === "retirements") tab = "penaltyReports"` (compat id viejo).
- `firstEnabledDashboardTab()` / `applyFeatureVisibility()`: una sola entrada, visible si
  `penaltyReportsEnabled || retirementsEnabled`; oculta y redirige solo si ambos off.
- `updateStats()`: label con recuento combinado.
- **Sin tocar**: `CONFIG_MAIN_TOGGLES` (siguen los 2 toggles → `REPORTPENALTIES`/`RETIREMENTS`),
  columnas del Log (siguen separadas), `index.js`, `src/api.js`.
- Verificado en navegador: label "(5)", 7 columnas, filas de retirement con type en PENALTY
  TAKEN y `-` en LEG/BOATS FOULED, ordenación asc/desc por todas las columnas, búsqueda "RET",
  toggles (PR off→solo retirements, RET off→solo PR, ambos off→fila oculta + redirect), compat
  `switchTab('retirements')`. 4 bloques `<script>` parsean. Sin errores de consola.

## 2026-09-10 — Log: distinguir "Cleanup archive vacío" de "no servido / 404"

- Depuración del bug pendiente "Cleanup archive no muestra nada". El path de render está
  **verificado OK** sobre datos reales: `parseLines` + `mapCleanupArchiveToLogRow` sobre el
  `data/cleanup-archive.jsonl` real (44 líneas) → 44 filas con `dateTime` y contadores correctos.
  El fallo del usuario NO está en el visor: su navegador recibe un no-200 para
  `cleanup-archive.jsonl` (fichero no desplegado/sincronizado, o `viewer.html` cacheado).
- Antes: si `dashboardFetch('cleanup-archive.jsonl')` no daba 200 → `r?.ok ? text : ""` →
  `parseLines("")` → `[]` → mensaje "Empty cleanup archive" **idéntico** al de archivo vacío real.
- Ahora: `loadFilesAutomatically` captura `{ok,status}` de esa descarga →
  `cleanupArchiveUnavailable` / `cleanupArchiveStatus`. `cleanupArchiveEmptyMessage()` muestra
  "Cleanup archive not available on the server (HTTP 404)" o "...could not be loaded (offline or
  network error)" en vez de "Empty cleanup archive". Archive view (HTML offline) resetea el flag.
- Verificado: 4 bloques `<script>` parsean; test de lógica de los 4 escenarios (presente /
  404 / vacío presente / offline). Falta comprobación en navegador (extensión Chrome
  desconectada esta sesión).

## 2026-09-09 (cont.) — Kanban: ojo "vista mínima" a nivel de columna DECIDED

- Botón "ojo" en la cabecera de la columna DECIDED (junto al control de orden), idéntico al de
  cada tarjeta. Un clic alterna `minimalView` de **todas** las tarjetas decididas a la vez.
- Semántica: si alguna está en vista completa → todas a vista mínima; si todas ya están mínimas
  → todas a completa. El icono (`fa-eye` / `fa-eye-slash`) y el título reflejan el estado.
- **No toca `updatedAt`** (a diferencia del ojo por tarjeta) → no reordena la columna en el
  modo "Last modified".
- `data/viewer.html`: `kanbanDecidedCardKeys()`, `kanbanRenderDecidedBulkEyeControl()`,
  `kanbanHandleDecidedBulkEyeClick()` (delegado en `#kanbanBoard`, registrado en
  `initKanbanBoardUi`), `kanbanToggleDecidedColumnMinimalView()` (calcada de
  `kanbanToggleCardMinimalView`, sin `updatedAt`, tolera 401 igual). Sin CSS nuevo.
- Verificado en navegador: ojo solo en DECIDED; alterna las 3 tarjetas; estado mixto → todas
  mínimas; orden intacto; persiste (server + poll); sin errores de consola. 4 bloques
  `<script>` parsean.

## 2026-09-09 (cont.) — cleanup de history.jsonl: umbral bajado a 2 (solo primera)

- A petición del usuario: el histórico real (96 líneas) nunca repetía el mismo snapshot 3 veces
  seguidas (racha máxima = 2), así que la regla de 3+ no movía nada.
- **`cleanup.js`**: `reduceLines` acepta 4º arg `opts = {minRun, keepLast}`. La sección de
  `history.jsonl` ahora usa `{minRun: 2, keepLast: false}` → colapsa rachas de **2+** líneas
  iguales dejando **solo la primera** y mueve el resto (verbatim, con su `timestamp`) a
  `cleanup-archive.jsonl`. La compactación de `scheduler.log` sigue con los defaults (3+,
  primera+última) — sin cambio.
- Ejecutado sobre datos reales: `data/history.jsonl` 96 → 52 líneas (44 movidas a
  `cleanup-archive.jsonl`). Integridad verificada: las 96 líneas originales están todas en
  history+archive. Test aislado: racha de 4 → mueve 3, par → mueve 1, idempotente.
- Instalado `jq` (`winget install jqlang.jq`) para los hooks del plugin `claude-code-warp`
  (causaban el spam `jq: command not found`). Requiere reiniciar el shell.

## 2026-09-09 (cont.) — Optimización de carga Fase 2 (`data/viewer.html`)

- **Poll condicional** en `loadFilesAutomatically` (modo servidor): sondeo ligero de `state.json`
  primero; si `sJson.timestamp === lastStateStamp` y ya hubo una carga completa
  (`dashboardLoadedOnce`), se salta la descarga+parseo de `history.jsonl`/`changes.jsonl` y el
  `renderTable()` del log — solo se refresca el kanban (puede cambiar desde otro cliente). El
  `state.json` sale del `Promise.all` (ya se pidió en el sondeo). Verificado: 3 polls extra con
  `state.json` sin cambios → 0 fetch de history/changes; al cambiar el stamp → recarga completa.
- **Debounce** de `searchInput` (`input`) a 180 ms (`filterSource` `change` sin debounce).
  Verificado: 5 inputs rápidos → 1 render.
- **Tope de render** en `renderUnifiedLogTable` (log history+cleanup fusionados): `LOG_RENDER_CAP
  = 500` filas + pie "Showing 500 of N rows — refine your search". Verificado con 700 filas.
- Sin errores de consola; kanban / botón de orden Decided / branding intactos.
- **Pendiente Fase 3**: quitar Tailwind Play CDN y Font Awesome (sprite SVG inline). Fase 1
  deploy (`docker-compose.yml`/`Dockerfile`/`deploy.sh`) sigue pendiente de datos del NAS.

## 2026-09-09 (cont.) — cleanup de history.jsonl: 2×/día + mover líneas a cleanup-archive

Antes: `cleanup.js` colapsaba rachas de 3+ líneas iguales (ignorando `timestamp`) pero **descartaba**
las del centro; corría 1×/día (gate `state.lastCleanupDate` UTC); `POST /api/force-cleanup` era
no-op (`node cleanup.js` sin entrypoint CLI).

- **`cleanup.js`**:
  - `reduceLines` acepta 3er arg `onRemove(line)` → se llama con cada línea del centro.
  - `performCleanup`: (1) `flushHistoryTmp()` vuelca `history.tmp.jsonl` a `history.jsonl` primero;
    (2) las líneas del centro se **añaden verbatim** (con su `timestamp` original, en orden) a
    `data/cleanup-archive.jsonl` — mismo formato que `history.jsonl`, sin envoltorio; (3) log
    `N -> M líneas (K movidas)`. Umbral sin cambios (`count >= 3`). `scheduler.log` igual.
  - Entrypoint CLI `if (require.main === module)` + `dotenv` → `node cleanup.js` funciona →
    `POST /api/force-cleanup` deja de ser no-op (sin tocar `api.js`).
- **`scheduler.js`**: gate `state.lastCleanupSlot` (`${dateKey}-${AM|PM}` con `minutesOfDay < 720`,
  hora `REPORT_TIME_ZONE`) → cleanup en la primera pasada tras las 00:00 y tras las 12:00.
  `lastCleanupDate` queda obsoleto.
- **`data/viewer.html`**: `mapCleanupArchiveRow` acepta líneas de snapshot puras (además del
  envoltorio legacy `{archivedAt,source,payload}`); `mapCleanupArchiveToLogRow` → origin "CleanUp".
- Verificado: test aislado de `performCleanup` (racha de 5 → mueve 3; racha de 3 → mueve 1;
  primera/última quedan; tmp volcado; idempotente ✓). Dashboard con `cleanup-archive.jsonl` de
  líneas puras → vistas "CleanUp History" y "All" renderizan contadores reales, sin errores.
  `node --check` de los 4 archivos JS + `vm.Script` de los 4 bloques de `viewer.html` ✓.
- Nota: la vista de log (botón `#stagesLogBtn`) es `auth-required`.

## 2026-09-09 — Kanban: botón de orden en la columna "Decided" + plan de optimización de carga

### Kanban "Decided" — control de orden (implementado)
`data/viewer.html`. La columna "Decided" ya ordenaba por `updatedAt` desc (`kanbanSortDecidedColumn`)
sin control de UI. Añadido un botón en su cabecera con menú de 3 opciones:
- **Last modified** (default, comportamiento previo), **Case no. ↓**, **Case no. ↑**.
- Estado en variable de módulo `kanbanDecidedSort`, persistido en `localStorage`
  (`rrs.kanban.decidedSort`) — **primer uso de localStorage en el archivo**; degradado seguro
  (try/catch → default) si está bloqueado.
- `kanbanDecidedComparator()` elige el comparador; se aplica en `kanbanCardsByColumn()`.
- Render: `kanbanRenderDecidedSortControl()`, insertado en la cabecera solo si
  `col.id === "decided" && !isCollapsed && cards.length > 1`.
- Interacción por delegación en `#kanbanBoard` (`kanbanHandleDecidedSortClick`), registrada una vez
  en `initKanbanBoardUi`; cierre global `kanbanCloseDecidedSortMenu` como el de labels.
- CSS `.kanban-decided-sort*` en el `<style>` inline.
- Verificado en navegador (servidor local sobre `data/`): las 3 opciones reordenan solo la columna
  Decided; persiste tras recarga; sobrevive al poll de 30 s; sin errores de consola. Los 4 bloques
  `<script>` pasan `new vm.Script`.

### Optimización de carga — Fase 1 parcial (viewer.html + nginx.conf)
Implementado (compose/Dockerfile/deploy.sh quedan pendientes de datos del NAS):
- **`docker/nginx.conf`**: `gzip on` (nivel 6, `gzip_types` con `application/javascript`,
  `application/json`, `application/x-ndjson`, `image/svg+xml`, …) — HTML y `.jsonl` comprimen
  ~85-90 %. Cache dividida: `*.json`/`*.jsonl` → `Cache-Control: no-cache` (revalida, 304 vacío);
  imágenes/fuentes → `public, max-age=2592000`; HTML → `no-cache`. `.jsonl` recibe
  `default_type application/x-ndjson`. `sendfile`/`tcp_nopush`/`tcp_nodelay`/`keepalive_timeout 65`.
  Sin validar con `nginx -t` (docker daemon parado) — hacerlo en el deploy.
- **`data/viewer.html`**: `dashboardFetch` usa `{ cache: 'no-cache' }` y se eliminó
  `?t=${Date.now()}` de **todos** los fetch (config, schedule, history/changes/cleanup/state,
  catálogos kanban). Verificado en navegador con servidor local que emite ETag: en la 2ª carga
  todos los `.json`/`.jsonl` responden **304** (transfer ~300 B vs 757 KB de `history.jsonl`).
- `<link rel="preconnect">` a los dos CDN (temporal, se quita en Fase 3).
- `applyEventBranding`: valida `eventLogoUrl` contra `^(https?://|/|./|data:image/)` — descarta el
  placeholder `'@ + $logo + @'` que deja el generador externo del boot config.

### Optimización de carga — resto del plan (sin implementar)
Plan en `~/.claude/plans/estudia-como-poder-optimizar-fluffy-feather.md`. Diagnóstico: cold load
≈1.08 MB sin comprimir + Tailwind Play CDN y Font Awesome render-blocking; `docker/nginx.conf` sin
gzip; poll de 30 s con `?t=Date.now()` que rompe toda revalidación; renders sin tope. Fases:
1) nginx gzip + cache dividida + deploy versionado + quitar `?t=`; 2) poll condicional + debounce
búsqueda + tope de filas; 3) quitar CDN (Font Awesome → sprite SVG inline, Tailwind → CSS plano en
el `<style>`); 4) opcionales. **`history.jsonl` queda fuera por decisión del usuario** (se hará después).

---

## 2026-09-03 T~— Dashboard polish: renderers para retirements y penaltyReports

### Resumen
Finalizada la integración del dashboard: stat counters y table renderers ahora consumen los arrays separados del estado
(retirementRows, penaltyReportRows, onWaterPenaltyRows, crewSubstitutionRows, equipmentSubstitutionRows)
en lugar del modelo previo (penaltyRows combinado filtrado por source).

### Cambios en `data/viewer.html`

1. **Helper functions (línea ~1775):**
   - `retirementRows()`: devuelve `stateData.retirementRows || []`
   - `penaltyReportRows()`: devuelve `stateData.penaltyReportRows || []`

2. **`updateStats()` (línea ~2869-2876):**
   - On-water penalties: `(stateData.onWaterPenaltyRows || stateData.penaltyRows || []).length` (fallback para compatibilidad)
   - Penalty Reports: `(stateData.penaltyReportRows || []).length`
   - Retirements: `(stateData.retirementRows || []).length` (solo visible si `retirementCount > 0` o feature enabled)
   - Crew Subs: `(stateData.crewSubstitutionRows || []).length`
   - Equipment Subs: `(stateData.equipmentSubstitutionRows || []).length`

3. **`renderPenaltyReportsTable()` (~línea 3287):** Reemplazado completamente
   - Cambio: De filtrar `penaltyRows` por `source === "penalty_reports"` a usar `penaltyReportRows()`
   - Columnas: No. · Date · Race · Leg · Boat · Boats Fouled · Penalty Taken (alineadas con RRS HTML real)
   - PDF link: `row.actionsPdfUrl`

4. **`renderRetirementssTable()` (nueva, ~línea 3357):**
   - Columnas: No. · Date · Boat · Type · Race No.
   - Datos: desde `retirementRows()`
   - Sorting: `no` y `raceNo` como números

5. **`switchTab()` (~línea 3025):** Añadida línea faltante
   - `else if (currentTab === 'retirements') renderRetirementssTable();`
   - Se ejecuta cuando usuario hace click en pestaña de retirements

### Verificación
- Sintaxis: `node --check index.js` ✓ (no hay cambios en index.js, solo viewer.html)
- HTML elements existen: `#stat-retirements-line`, `#stat-penalty-reports-line` (líneas 522, 526)
- Tab definitions existen: `firstEnabledDashboardTab` incluye retirements (línea 1516)
- Feature visibility: `applyFeatureVisibility` incluye mapping `retirementsEnabled → retirements-row` (línea 1531)

### Resultado
Dashboard completamente alineado con nueva arquitectura de arrays separados. Las tablas se renderizan dinámicamente
cuando se hace click en los tabs, y los stat counters se actualizan con `updateStats()` en cada carga.

---

## 2026-09-03 T19:00+ — FASE 1 completada: Scraping robusto de 5 secciones tabulares RRS

### Resumen del trabajo (Sesión 2, Fase 1)

**Objetivo:** Reemplazar el parser incorrecto e incompleto (`parsePenaltyTable`) con un scraper robusto
y dirigido por cabeceras que contemple las 5 secciones tabulares (retirements, penalty reports,
on-water penalties, crew substitutions, equipment substitutions) bajo un modelo único de estado.

**Implementado:**

1. **Parser genérico `extractRrsGenericTable`:**
   - Carga HTML con cheerio, detecta `<table>` por cabeceras (requiredHeaders) o selector (#penalty-scroller, etc.).
   - Mapea campos salida → cabecera esperada; construye índice de columnas.
   - Detecta fila de estado vacío por regex `/no .*(found|encontrad\w*)/i` (tolera `colspan` incorrecto).
   - Normaliza y deduplica texto; absolutiza URLs de PDF.
   - Devuelve `{ rows: [], isEmpty: bool, headers: [] }`.

2. **Registro declarativo `RRS_TABULAR_SECTIONS`:**
   - Un objeto por sección: `id`, `label`, `urlKey` (del CONFIG), `enabledKey` (del CONFIG), `logTag`, `containerSelector`, `requiredHeaders`, `fieldMap`.
   - Permite distintas cabeceras reales en cada página pero config clara y testeable.

3. **Función `scrapeRrsTabularSections`:**
   - Itera sobre todas las secciones.
   - Si NO habilitada (`CONFIG[enabledKey]` = false) o URL vacía → conserva rows previas.
   - Haz `fetchHtml` → `extractRrsGenericTable` → `detectGenericRowChanges` (similar a Q&A).
   - **404 → log informativo ("404 en URL; se trata como sección vacía")**, no `console.error`. 
   - Devuelve `{ rowsById, changesById, anyChanges }`.

4. **Integración en `runMonitorCycle`:**
   - Reemplazado el bloque `if (CONFIG.penaltyReportsEnabled && ...) → parsePenaltyTable` con una sola llamada a `scrapeRrsTabularSections`.
   - Snapshot incluye: `retirementRows`/`retirementRowCount`, `penaltyReportRows`/`penaltyReportRowCount`,
     `onWaterPenaltyRows`/`onWaterPenaltyRowCount`, `crewSubstitutionRows`/`crewSubstitutionRowCount`,
     `equipmentSubstitutionRows`/`equipmentSubstitutionRowCount`.
   - Alias de compatibilidad: `penaltyRows = onWaterPenaltyRows` (la pestaña "penalties" actual del dashboard lo espera).
   - **Cambios en secciones tabulares se registran en `changes.jsonl` pero NO disparan Telegram** (decisión Fase 1).
   - `[CHANGES]` log incluye resumen de todas las secciones.
   - `[NO_CHANGES]` log lista todos los contadores.

5. **Configuración (CONFIG):**
   - Nuevas URLs derivadas: `crewChangesUrl`, `equipmentSubstitutionsUrl` desde `.env`.
   - Nuevos flags: `crewSubstitutionsEnabled`, `equipmentSubstitutionsEnabled`.

6. **Logs de arranque:**
   - 6 nuevas líneas `[START]` (penalty reports, retirements, on-water penalties, crew subs, equipment subs).

### Verificación

- **Unitario:** Parser test-parsers.js vs 5 fixtures (retirements con 1 fila, resto vacío) → ✓ 5/5.
- **Ciclo real:** `npm run once` evento 13730 → ✓ sin errores, detecCambios en docs/questions/scoring.
- **Estado:** `state.json` tiene todos los 5 arrays + contadores nuevos; conteos = 0 para evento 13730 (tablas vacías ahora).
- **Regresión:** Segundo ciclo → `[NO_CHANGES]` con todos los contadores incluida tabular.
- **Sintaxis:** `node --check index.js` ✓.

### Cambios de archivo

- **`index.js`**: +800 líneas (parser genérico + registro + función de scraping + snapshot + logs).
- **No modificado:** `.env`, `src/api.js`, `data/viewer.html` (están listos para Fase 2).

### Próximos pasos (Fase 2)

Menú Configuration: alinear los toggles (`.env` → `src/api.js:writeEnv` → dashboard) para que de verdad
controlen qué se scrapea. Revisar si `viewer.html` necesita pestañas/renderers nuevos para las secciones.

---

## 2026-09-03 — Estudio inicial del caso (solo lectura, sin cambios)

### Objetivo de la sesión
Entender el proyecto en su estado actual sin modificar nada. Dejar bitácora y memoria para futuras sesiones.

### Qué es el proyecto
Monitor del sitio **Racing Rules of Sailing** (`racingrulesofsailing.org`) para un evento de vela concreto.
Descarga páginas del evento, las compara con el último estado en disco y, si hay cambios, sincroniza
**Trello** y avisa por **Telegram**. Node.js 18+, dependencias mínimas (`cheerio`, `dotenv`).

### Arquitectura actual (3 capas)

| Capa | Archivos | Rol |
|------|----------|-----|
| **Monitor / scraper** | `index.js` (~3.260 líneas), `scheduler.js`, `cleanup.js` | Núcleo histórico. Descarga HTML, parsea tablas con cheerio, detecta cambios, escribe `data/*.json(l)`, sincroniza Trello, notifica Telegram. |
| **API backend** | `src/api.js` (~766 líneas) | Servidor HTTP nativo Node en `:3000`. Auth por sesión (Bearer token, TTL 12 h), config, kanban, schedule, users, backup (archive/reset/restore), force-cleanup. |
| **Dashboard web** | `data/viewer.html` (~260 KB), `data/viewer-ui-logic.js`, `data/kanban-board.js`, `data/schedule-editor.js`, `data/styles.css`, `data/index.html` (redirige a viewer) | SPA servida por nginx. Lee los `.json/.jsonl` directamente y llama a `/api/*` para lo que requiere escritura/auth. |
| **Despliegue** | `docker/nginx.conf` | nginx sirve estáticos de `data/` y hace proxy de `/api/` a `http://rrs-scheduler:3000`. **No hay Dockerfile ni docker-compose en el repo todavía.** |

### Flujo del monitor (`runMonitorCycle`, cada `POLL_INTERVAL_MS` o vía `scheduler.js`)
1. Descarga **schedule** → audiencias (`extractTableRows`) + Protest Time Limits (`extractTimeLimitRows`).
2. Scrap de nombre/logo del evento y URL externa de resultados → `data/monitor-config.json` (`scrapeEventInfo`, añadido en el diff sin commitear).
3. Si procede: **documents**, **decisions**, **questions**, **scoring inquiries**, y (nuevo, sin commitear) **penalty reports / retirements / on-water penalties**.
4. `detectChanges*` compara con `state.json` previo.
5. Opcional: Trello (`applyTrelloCycle` y ciclos hermanos por tipo de tabla).
6. Escribe histórico (`history.jsonl` con buffer/flush cada 30 min, `changes.jsonl` solo ciclos con cambios) y, si hubo cambios y no es la primera corrida, Telegram.

### Configuración
- **`.env`** es la fuente única de verdad para `RRS_EVENT_ID`, flags de secciones (`DOCUMENTS`, `QUESTIONS`, `SCORINGENQUIRIES`, `CREWCHANGES`, `ONWATERPENALTIES`, `REPORTPENALTIES`, `RETIREMENTS`, `SAILTIRESULTS`, `EQUIPMENTSUBSTITUTIONS`, `TRELLO_*`, `TELEGRAM_*`) y plantillas de URL con `{id_evento}`.
- `data/monitor-config.json` es un derivado que `src/api.js` reconstruye desde el `.env` (`normalizeConfig`), más el resultado del scrap (título, logo, resultados).
- `schedule.json` (raíz) / `data/schedule.json`: planes de frecuencia de polling por fecha y franja horaria que consume `scheduler.js`.
- Timestamps en zona `Europe/Madrid` (configurable con `REPORT_TIME_ZONE`).

### Estado de git al empezar
- Rama `master` (existe también `main` local y `origin/master`).
- Último commit: `ead4e0b feat: implement scoring inquiries monitoring and daily cleanup system`.
- **Modificado sin commitear:** `.env`, `index.js`.
- **Sin trackear (toda la capa web + API + docker + utilidades):** `src/`, `docker/`, `data/*.js`, `data/viewer.html`, `data/index.html`, `data/styles.css`, `data/monitor-config.json`, `data/users.json`, `data/kanban-roles.json`, `data/rrs-logo.png`, `check-state.js`, `fetch-test.js`, `.vscode/`.
- Conflictos de sincronización de Syncthing presentes: `.sync-conflict-*.env` (4), `~syncthing~*.tmp` (2).

### Cambios sin commitear en `index.js` (diff)
- Nuevas secciones: **penalty reports**, **retirements**, **on-water penalties** (`parsePenaltyTable`, config `penalty*/retirements*/onWater*`, ramas en `runMonitorCycle`, campos `penaltyRows`/`penaltyRowCount` en el snapshot).
- `scrapeEventInfo` + `saveScrapedEventInfo`: extrae `h3.mb-0` (título), `figure.event-image img` (logo) y `a[title="Link to Results"]` → escribe `data/monitor-config.json`.
- `buildDecisionRowsFromState`: cruza el mapa de decisiones con filas del calendario para alimentar un kanban interno (`decisionRows`).
- `fetchHtml`: User-Agent cambiado de `RRS-Monitor/1.0` a un UA de Chrome real + `Accept-Language` (probablemente para evitar bloqueo del sitio).

### Cambios sin commitear en `.env`
- `RRS_EVENT_ID`: `13725` → `13730` (evento actual: **Maxi Yacht Rolex Cup**, según `monitor-config.json`). El `.env.example` aún apunta a `13476`.
- Añadidas todas las secciones nuevas con sus flags y URLs. Activas ahora: `DOCUMENTS=true`, `QUESTIONS=true`, `RETIREMENTS=true`. Resto en `false`.
- `TRELLO_ENABLED` pasado a `false`.
- Añadido `SCHEDULE_FILE=/app/data/schedule.json` (ruta de contenedor).
- **Ojo:** el `.env` versionado contiene `TRELLO_KEY`, `TRELLO_TOKEN` y `TELEGRAM_*` reales; `.gitignore` ya excluye `.env` pero el historial podría contenerlo — revisar antes de publicar el repo.

### Observaciones / riesgos detectados (no corregidos)
1. **Secretos en el árbol de trabajo** (`.env`, y credenciales de admin en claro en `data/users.json`: `luiso` / `Calpe0141`). `src/api.js` guarda contraseñas de usuario en claro deliberadamente (`user.password = password`).
2. **`data/` está trackeado parcialmente** y contiene datos de ejecución (`state.json`, `history.jsonl` de 756 KB, `history_archivo.jsonl`, `history.tmp.jsonl`). Mezcla código servido por nginx con datos mutables del monitor en la misma carpeta.
3. **Sin Dockerfile/compose** pese a que `nginx.conf` y el `.env` asumen contenedores (`rrs-scheduler:3000`, `/app/data`).
4. `parsePenaltyTable` usa `$("table tbody tr", html)` pasando `html` como contexto a cheerio — patrón inusual, conviene verificar que selecciona lo esperado.
5. `data/scheduler.log` con fecha jul-2026 (`Jul 24`), desalineado con el resto de artefactos (jun-2026) — posible resto viejo.
6. Ramas `main` y `master` divergen; `main` parece la inicial (`fbb6910 Initial commit`). Confirmar cuál es la buena.
7. `check-state.js` y `fetch-test.js` son scripts de depuración ad-hoc con rutas `/app/...` hardcodeadas.

### No se ha ejecutado nada. No se ha modificado ningún archivo del proyecto (salvo la creación de esta bitácora).

### Próximos pasos sugeridos (para decidir con el usuario)
- Definir qué entra en el próximo commit (¿toda la capa web de golpe o por partes?).
- Añadir `data/*.json*` de datos de runtime a `.gitignore` o separar `public/` de `data/`.
- Crear `Dockerfile` + `docker-compose.yml` que faltan.
- Rotar credenciales expuestas si el repo va a compartirse.
- Resolver los `.sync-conflict-*.env`.
