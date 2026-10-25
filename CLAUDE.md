# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Monitor de `racingrulesofsailing.org` (RRS) para **un evento de vela concreto**. Descarga las páginas
del evento, las compara con el último estado en disco y, ante cambios, escribe histórico y opcionalmente
notifica por **Telegram** y sincroniza tarjetas en **Trello**. Node.js 18+ (usa `fetch`, `FormData`,
`Blob` nativos). Dependencias mínimas: `cheerio`, `dotenv`.

**Idiomas:**
- **Español** para todo lo interno: comentarios de código, mensajes de commit, `BITACORA.md`, docs
  del repo, logs de consola/servidor y la conversación de desarrollo.
- **Inglés** para toda la capa externa y el aplicativo: la UI del dashboard (`data/viewer.html` y demás
  `data/*.js` — textos, labels, botones, tabs, mensajes al usuario, `alert`/`toast`), los mensajes de
  notificación de Telegram, y cualquier cadena visible para el usuario final o de cara al exterior.

## Reglas del proyecto (obligatorias)

1. **Nunca modifiques `.env`** (crear, editar, sobrescribir, mover o borrar) sin permiso **explícito**
   del usuario para ese cambio concreto. Puedes leerlo y proponer cambios en texto, pero la edición la
   autoriza o la hace el usuario. Esto está reforzado con un `deny` en `.claude/settings.json`.
   `.env.example` sí se puede editar con normalidad.
2. **Solo HTML, CSS y JavaScript.** El frontend (`data/`) es HTML + CSS + JS de navegador **vanilla**:
   nada de React/Vue/Svelte, TypeScript, JSX, Tailwind ni build steps. El backend es **JavaScript de
   Node.js** con módulos nativos (`http`, `fs`, `crypto`, …); solo las dependencias ya presentes
   (`cheerio`, `dotenv`). No introduzcas otros lenguajes, transpiladores ni bundlers. Los scripts de
   automatización/despliegue en shell son la única excepción.

## Comandos

```bash
npm run once      # node index.js --once  → un solo ciclo de scraping y sale
npm start         # node index.js         → ciclo + bucle setInterval(POLL_INTERVAL_MS)
npm run schedule  # node scheduler.js     → UNA pasada según schedule.json y sale (pensado para cron)
npm test          # node --test           → unit tests (test/*.test.js) sobre funciones puras
npm run lint      # eslint .              → lint estático (eslint.config.js, flat config)
node --check index.js   # verificación de sintaxis
node src/api.js         # arranca la API HTTP en :3000 (PORT configurable)
```

**Test:** `node:test` nativo (cero dependencias nuevas en runtime — `eslint` solo va en
`devDependencies`). `index.js` exporta sus funciones puras de parseo/fingerprint/detección de
cambios (`normalize`, `hearingCaseKey`, `detectTimeLimitChanges`, etc. — ver bloque
`module.exports` al final del archivo) protegidas por `if (require.main === module)` alrededor
de la llamada a `main()`, así que `require("./index.js")` desde un test **no** dispara el ciclo
real (sin red, sin escritura en `data/`). `test/trello.test.js` cubre `trelloAuthParams`,
`trelloGetCard` (mock de `global.fetch`) y `applyTrelloCycle` (camino `TRELLO_ENABLED=false`,
el real en este `.env`) — el resto de `trello*`/`apply*TrelloCycle` bajo `ENABLED=true`
sigue sin cobertura (ver `ISSUES_TRELLO.md`).
**Importante:** no uses `npm run once`/`npm start` como "smoke test" tras tocar `index.js` —
ejecuta un ciclo real contra el evento configurado (red, posible reset de datos si
`RRS_EVENT_ID` cambió, Trello/Telegram si están `true`). Para verificar sin tocar producción:
`node --check index.js` + `npm test`. Solo corre un ciclo real si el cambio lo exige y el
usuario lo sabe.
**Lint:** ESLint flat config (`eslint.config.js`) sin plugins de framework — solo
`eslint:recommended` + globals de Node (`require`, `Buffer`, `URL`, `fetch`, …). Ignora
`data/viewer.html`/`data/index.html` (HTML, no JS puro).

`scheduler.js` **no** es un daemon: ejecuta una pasada y termina. En producción se invoca desde cron
(DSM). Usa un lock (`data/monitor.lock`, stale a 30 min) y `data/scheduler-last-run.json` para respetar
la frecuencia de la regla activa. También dispara `cleanup.js` **dos veces al día** (primera pasada
tras las 00:00 y tras las 12:00, hora `REPORT_TIME_ZONE`; gate `state.lastCleanupSlot`).

`node cleanup.js` (entrypoint CLI) compacta **solo `scheduler.log`**: quita las líneas
"injected env" y colapsa rachas de 3+ mensajes `[SCHEDULER]` equivalentes (primera+última).
Lo usan el gate de `scheduler.js`, `POST /api/force-cleanup` y una tarea cron opcional a las
00:00/12:00. (Ya no toca `history.jsonl`: ese archivo se retiró en favor de `checks.jsonl`.)

## Arquitectura (3 capas)

1. **Scraper / monitor** — `index.js` (~3.400 líneas, núcleo), `scheduler.js`, `cleanup.js`.
   `runMonitorCycle()` (index.js:3322) es el ciclo completo: descarga HTML con `fetch` (User-Agent de
   Chrome real para evitar bloqueo), parsea con `cheerio`, compara contra `data/state.json`, escribe
   `data/checks.jsonl` (1 línea diminuta por ciclo SIEMPRE: `timestamp` + `changed` + contadores;
   `appendCheck`) y `data/changes.jsonl` (delta compacto, solo ciclos con cambios), luego Trello
   y Telegram. `checks.jsonl` es la fuente de la pestaña Log del dashboard; `changes.jsonl` de los
   timelines por sección. Tras `saveState`, `syncKanbanFromSnapshot` (usa `src/kanbanSync.js`)
   da de alta en `data/kanban.json` las tarjetas de casos de RRS que aún no la tienen y marca
   como huérfanas (`orphaned`) las de casos que han desaparecido — **aditivo**: nunca modifica
   ni borra tarjetas existentes.
2. **API backend** — `src/api.js`, servidor HTTP nativo Node en `:3000`. Auth por Bearer token en
   memoria (`sessions` Map, TTL 12 h). `router` es un objeto plano `'MÉTODO /api/ruta' → handler`
   (ver final del archivo); no hay framework de routing. Gestiona lo que necesita escritura segura:
   login/logout, config, kanban (+ labels/judges/roles), schedule, users, archive/reset/restore,
   force-cleanup.
3. **Dashboard web** — `data/viewer.html` (~270 KB), SPA **monolítica y autocontenida**: todo el
   HTML/CSS/JS va inline en ese único archivo. **Sin CDNs**: el CSS de Tailwind (subconjunto
   generado, ~18 KB con preflight) y los iconos de Font Awesome (40 solid como máscaras SVG
   `data:` URI) están embebidos en `<style>`; no carga ningún `.js`/`.css`/fuente externo.
   `data/index.html` solo redirige a `viewer.html`. Lee los `.json/.jsonl`
   **directamente** (servidos por nginx) y solo llama a `/api/*` para escritura/auth.

**Despliegue** — `docker/nginx.conf`: nginx sirve estáticos de `data/` y hace proxy `/api/` →
`http://rrs-scheduler:3000`. **No hay Dockerfile ni docker-compose en el repo todavía** aunque
`.env` y nginx asumen contenedores (`rrs-scheduler:3000`, rutas `/app/...`).

## Configuración: `.env` es la única fuente de verdad

Todo sale de `.env` en cada arranque; **las URLs no están en el código**. Para cambiar de evento basta
`RRS_EVENT_ID=XXXXX` (el `{id_evento}` se sustituye en Node — nunca uses `[corchetes]`, bash los expande
como glob) y reiniciar. `.env.example` es la plantilla.

- **Flags de sección** (`DOCUMENTS`, `DECISIONS`, `QUESTIONS`, `SCORINGENQUIRIES`, `CREWCHANGES`,
  `ONWATERPENALTIES`, `REPORTPENALTIES`, `RETIREMENTS`, `SAILTIRESULTS`, `EQUIPMENTSUBSTITUTIONS`,
  `TRACKING`): controlan qué se scrapea. El puente `.env` ↔ dashboard es
  `src/api.js` → `CONFIG_FLAGS` (envKey ↔ cfgKey) + `normalizeConfig` (resuelve URLs desde templates)
  + `data/viewer.html` → `CONFIG_TOGGLE_DEFS`. Al añadir una sección hay que tocar los **tres** sitios.
- **`TELEGRAM_ENABLED` / `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`**, **`TRELLO_ENABLED` / `TRELLO_KEY`
  / `TRELLO_TOKEN` / `TRELLO_*_LIST_ID`**. `TELEGRAM_ENABLED` debe ser exactamente `true` (minúsculas).
- `data/monitor-config.json` es un **derivado** que `src/api.js` reconstruye desde `.env` +
  el scrap de título/logo/URL de resultados del evento. No editarlo a mano como fuente.
- `data/schedule.json` (planes de frecuencia de polling por fecha/franja horaria) lo consume
  `scheduler.js` y lo edita el dashboard vía `/api/schedule`.
- Timestamps (`state.json`, `checks.jsonl`, `changes.jsonl`, consola, Telegram) en `Europe/Madrid`;
  override con `REPORT_TIME_ZONE` (cualquier zona IANA).

## Comportamiento a recordar

- **Primer arranque** (sin `state.json` legible): se fija la línea base y **no** se manda Telegram ni,
  en la práctica, se generan cambios ruidosos. Los avisos empiezan en el siguiente ciclo con cambios.
  Borrar `state.json` = tratar el evento como nuevo (riesgo de tarjetas Trello duplicadas).
- **Cambios en las secciones tabulares** (retirements, penalty reports, on-water penalties, crew subs,
  equipment subs) se registran en `changes.jsonl` pero **NO disparan Telegram** (decisión de diseño
  de la Fase 1). Solo audiencias / time limits / documentos / Q&A notifican.
- Scraping robusto vía `extractRrsGenericTable` + registro declarativo `RRS_TABULAR_SECTIONS`: dirigido
  por cabeceras, tolera reordenación de columnas, columnas `d-none` y `404` (se trata como sección vacía,
  log informativo, no `console.error`). Una sección deshabilitada **conserva** las filas previas del estado.
- **Kanban**: la fecha de una tarjeta (`updatedAt`) es la de descarga de RRS y es **inmutable** —
  se sella al crear la tarjeta y ninguna acción de UI (ver/minimizar, mover de columna, editar el
  modal) la cambia. La columna "Decided" ordena por esa fecha ("By RRS date"). El alta de tarjetas
  nuevas y la marca de orfandad las hace el servidor (`src/kanbanSync.js`, desde `index.js` en cada
  ciclo y desde `GET /api/kanban`); el bootstrap cliente de `viewer.html` solo cubre el tablero vacío.
- **Tiempos límite manuales**: además de los que scrapea RRS (`state.timeLimitRows`),
  un admin puede crear tiempos límite manuales desde la pestaña Time Limit (botón
  "Manual time limit", solo visible con `canManageUsers()`). Viven como tarjetas
  kanban normales (`cardType:"time_limit"`, `source:"manual"`, clave
  `tl:manual:<ts>` — nunca choca con la clave `tl:<date>||<boatClass>` de RRS, así
  que una manual y una de RRS con la misma fecha+clase **coexisten**). Reciben el
  mismo tratamiento que las de RRS: cuenta atrás, y al expirar se sella
  `expiredAt` (una vez, inmutable) en vez de borrarse — `kanbanPurgeExpiredTimeLimitCards`/
  `kanbanRemoveExpiredTimeLimitCard` ya **no eliminan** la tarjeta, porque es el
  único registro que existe para los manuales (si se borra, también desaparece del
  listado de la pestaña Time Limit, no solo de la franja principal). La franja
  principal (`kanbanTimeLimitCardsList`) sigue ocultándolas por `kanbanIsTimeLimitActive`
  sin necesidad de borrado. La pestaña Time Limit muestra el historial completo
  (`setAt` = `card.updatedAt`, `removedAt` = `card.orphanedAt || card.expiredAt`),
  tanto para manuales como para las de RRS (que ya se orfanaban con `orphanedAt`
  desde `src/kanbanSync.js`, nunca se borraban del backend). Por eso se valida
  fecha/hora parseables antes de guardar un manual. Editables y borrables solo por
  admin (botón Delete en el modal); las de RRS no se borran a mano, solo expiran/se
  orfanan. `syncKanbanCards` sigue sin tocar los manuales (aditivo, nunca los
  orfana) — sin cambios en `index.js` ni `src/api.js`, todo vive en
  `data/viewer.html`.
- **Backup**: un único `.html` (`GET /api/archive`, **requiere login**) = copia de `viewer.html` +
  `<script>window.__RRS_ARCHIVE__ = {...}</script>` (bundle sin filtrar por flags, usuarios **sin
  contraseñas**). Sirve como visor offline (pestañas de datos + kanban + Log + Schedule, todo en
  solo lectura) **y** como fuente de `POST /api/restore` (el botón Restore extrae el bundle del
  `.html`). Restore = solo datos del evento (`state.json` / `checks.jsonl` / `changes.jsonl` /
  tarjetas kanban / `schedule.json`) y hace copia previa en `data/backup_<epoch>/`. `buildArchiveHtml`
  vivía roto por una `CONFIG` inexistente en `src/api.js` — se quitó el filtrado por flags.

## `data/` está trackeado parcialmente — cuidado con los commits

`.gitignore` excluye `data/*.jsonl`, `data/kanban.json`, `data/users.json`, `data/monitor-config.json`,
`data/backup_*/` y varios más, pero **`data/viewer.html` y `data/index.html` sí se versionan** desde la
misma carpeta que los datos mutables. Al commitear revisa que no se cuelan artefactos de runtime
(`state.json`, `checks.jsonl`, `changes.jsonl`, logs). `checks.jsonl` (auditoría de cada revisión)
llega al servidor por Syncthing, no por git. Nota: `node_modules/` y `.env` siguen trackeados pese a
estar en `.gitignore` (se añadieron antes de las reglas); no los "re-añadas". `data/state.json` y
`data/changes.jsonl` también quedaron trackeados de antes.

## Seguridad (estado actual, conocido)

- `.env` versionado histórico contiene `TRELLO_KEY`/`TRELLO_TOKEN`/`TELEGRAM_*` reales; `.env` está en
  `.gitignore` pero el historial puede tenerlos — rotar antes de publicar el repo.
- `data/users.json` guarda contraseñas de admin en claro; `src/api.js` guarda las de usuarios nuevos
  en claro a propósito (`verifyPassword` acepta claro o sha256). No es un bug a "arreglar" sin hablarlo.

## Contexto de trabajo

`BITACORA.md` lleva el registro por sesión (más reciente arriba) — **añade una entrada al terminar
trabajo relevante**. Fase 1 (scraping) y Fase 2 (menú Configuration) están completas; pendientes:
Dockerfile/compose, Telegram/Trello para secciones tabulares, resolver `.sync-conflict-*.env` de Syncthing.
