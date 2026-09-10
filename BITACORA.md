# Bitácora — Script Monitor RRS

> Registro de estudio y trabajo sobre el proyecto. Una entrada por sesión, la más reciente arriba.

---

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
