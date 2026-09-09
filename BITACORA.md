# Bitácora — Script Monitor RRS

> Registro de estudio y trabajo sobre el proyecto. Una entrada por sesión, la más reciente arriba.

---

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

### Optimización de carga (solo plan, sin implementar)
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
