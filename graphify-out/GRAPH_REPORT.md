# Graph Report - Script_RRS  (2026-10-12)

## Corpus Check
- 5 files · ~60,006 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 596 nodes · 943 edges · 46 communities (27 shown, 19 thin omitted)
- Extraction: 87% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 115 edges (avg confidence: 0.82)
- Token cost: 0 input · 120,784 output

## Community Hubs (Navigation)
- RRS Scraping Pure Functions
- Fase C Split + Trello Cross-refs
- API Backend (src/api.js)
- Scheduler + Cleanup
- Bitacora: Fase C y backlog
- Fase 1 fixes + Trello row keys
- CLAUDE.md: reglas del proyecto
- index.js re-export stubs (rrsScraping)
- Bitacora: sesion 2026-10-12 (tests/lint/trello)
- package.json metadata
- ISSUES.md backlog y god nodes Trello
- index.js: ciclo monitor y estado
- Trello: creacion de tarjetas y custom fields
- Trello: documentos y scoring inquiry
- test/decisions.test.js
- data/viewer.html SPA dashboard
- test/extractRrsGenericTable.test.js
- Trello: questions sync
- Trello: labels de tarjeta
- test/trello.test.js
- Bitacora: sesion 2026-09-03
- Bitacora: history.jsonl retirado
- Trello: time limit cards
- Schedule helpers Trello
- Bitacora: Kanban Decided + perf
- Bitacora: backup 500 + kanban roles
- Bitacora: kanban updatedAt inmutable
- Sub-fase C6 Scoring Inquiry
- Bitacora: Log filtros
- Bitacora: Backup unico .html
- Fixtures decisions/hearings
- Fixtures retirements
- CLAUDE.md: comandos
- CLAUDE.md: data/ tracking
- CLAUDE.md: despliegue
- CLAUDE.md: .env fuente de verdad
- CLAUDE.md: regla vanilla JS
- CLAUDE.md: que es el proyecto
- CLAUDE.md: scheduler.js
- CLAUDE.md: advertencia smoke test
- RRS logo asset
- trelloSyncHearingTypeLabels (uso real)
- src/rrsScraping.js: RRS_ORIGIN
- Sub-fase C1 helpers
- Sub-fase C2 URL helpers
- Sub-fase C8 tabulares genericas

## God Nodes (most connected - your core abstractions)
1. `normalize()` - 28 edges
2. `trelloAuthParams()` - 23 edges
3. `runMonitorCycle()` - 20 edges
4. `trelloGetCard()` - 14 edges
5. `main()` - 13 edges
6. `trelloAddCardAttachmentFromUrl()` - 10 edges
7. `trelloSyncQuestionLabels()` - 9 edges
8. `trelloUpdateQuestionCard()` - 9 edges
9. `trelloSyncScoringInquiryLabels()` - 9 edges
10. `applyTrelloCycle()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `trelloGetCard()` --shares_data_with--> `index.js (núcleo scraper/monitor, runMonitorCycle)`  [INFERRED]
  index.js → CLAUDE.md
- `Enlace Full Decision + custom field + PDF adjunto` --semantically_similar_to--> `trelloGetCard()`  [INFERRED] [semantically similar]
  README.md → ISSUES_TRELLO.md
- `README § 7 Trello — Event Documents (TOA-Documents)` --semantically_similar_to--> `eventDocumentCardTitle()`  [INFERRED] [semantically similar]
  README.md → ISSUES_TRELLO.md
- `README § 8 Trello — Q&A (Questions)` --semantically_similar_to--> `questionRowKey()`  [INFERRED] [semantically similar]
  README.md → ISSUES_TRELLO.md
- `README § 6 Trello — Protest Time Limit(s)` --semantically_similar_to--> `timeLimitCardTitle()`  [INFERRED] [semantically similar]
  README.md → ISSUES_TRELLO.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **ISSUES.md e ISSUES_TRELLO.md generados a partir del análisis /graphify y lint/test de la sesión** — issues_md, issues_trello_md, graph_report_md, concept_isolated_nodes [EXTRACTED 1.00]
- **Plan de optimización de carga del dashboard (Fases 1-3)** — bitacora_md_kanban_decided_sort_load_opt_phase1, bitacora_md_load_optimization_phase2, bitacora_md_load_optimization_phase3_cdn_removal [EXTRACTED 1.00]
- **Ciclo de vida de tarjetas kanban (creación, orfandad, fecha inmutable)** — bitacora_md_kanban_rrs_date_immutable, bitacora_md_timelimit_orphan_fix, bitacora_md_kanban_judges_roles_labels_fix [INFERRED 0.75]
- **Arquitectura de backup/restore en producción** — bitacora_md_backup_500_pending, bitacora_md_backup_html_restore, bitacora_md_backup_500_fix [INFERRED 0.85]
- **Documentación cruzada de la cobertura de tests Trello (3 archivos)** — claude_test_trello_coverage, issues_trello_test_coverage_item, bitacora_2026_10_12_trello_tests_fase_b, test_trello_test [EXTRACTED 0.95]
- **Fase C: split de index.js en src/rrsScraping.js** — bitacora_2026_10_12_fase_c_started, bitacora_2026_10_12_fase_c_complete, src_rrsscraping, claude_index_js, issues_trello_trellosync_extraction_item [EXTRACTED 0.90]
- **Funciones movidas a rrsScraping.js aún usadas por el bloque Trello de index.js** — issues_trello_hearingtypetolabelnames_ref, issues_trello_timelimitcardtitle_ref, issues_trello_questionrowkey_ref, issues_trello_scoringinquiryrowkey_ref, issues_trello_documentrowkey_ref, src_rrsscraping [EXTRACTED 0.90]

## Communities (46 total, 19 thin omitted)

### Community 0 - "RRS Scraping Pure Functions"
Cohesion: 0.03
Nodes (77): c_users_luiso_proyectos_script_rrs_src_kanbansync_synckanbancards, c_users_luiso_proyectos_script_rrs_src_rrsscraping_absolutizerrshref, c_users_luiso_proyectos_script_rrs_src_rrsscraping_builddecisionrowsfromstate, c_users_luiso_proyectos_script_rrs_src_rrsscraping_deduperepeatedwordspans, c_users_luiso_proyectos_script_rrs_src_rrsscraping_deriverrseventidfromurl, c_users_luiso_proyectos_script_rrs_src_rrsscraping_detectchanges, c_users_luiso_proyectos_script_rrs_src_rrsscraping_detectdocumentchanges, c_users_luiso_proyectos_script_rrs_src_rrsscraping_detectgenericrowchanges (+69 more)

### Community 1 - "Fase C Split + Trello Cross-refs"
Cohesion: 0.07
Nodes (55): 2026-10-12: Fase C completa — index.js dividido en src/rrsScraping.js (11/11 sub-fases), 2026-10-12: Fase C iniciada — split de index.js en sub-fases C0-C9b, RFC-3339, documentRowKey()/eventDocumentCardTitle()/eventDocumentCardDescription() — ref cruzada Trello, hearingTypeToLabelNames() — ref cruzada Trello, questionRowKey() — ref cruzada Trello, scoringInquiryRowKey() — ref cruzada Trello, timeLimitCardTitle()/timeLimitDescription() — ref cruzada Trello (+47 more)

### Community 2 - "API Backend (src/api.js)"
Cohesion: 0.05
Nodes (51): ref_crypto, ref_http, APP_DIR, archiveFileName(), buildArchiveHtml(), canManageUsers(), CHANGES_FILE, CHECKS_FILE (+43 more)

### Community 3 - "Scheduler + Cleanup"
Cohesion: 0.07
Nodes (43): fs, path, performCleanup(), reduceLines(), ref_child_process, ref_fs, ref_path, acquireLock() (+35 more)

### Community 4 - "Bitacora: Fase C y backlog"
Cohesion: 0.13
Nodes (29): Backup 500 resuelto en producción (sin SSH, solo Portainer), PENDIENTE: backup 500 en producción, sin desplegar, Backup: un único .html = visor offline + fuente de restauración, Cleanup de history.jsonl: 2x/día + mover líneas a cleanup-archive, Cleanup de history.jsonl: umbral bajado a 2 (solo primera), Fusión de pestañas Crew Substitutions + Equipment Substitutions, Dashboard polish: renderers para retirements y penaltyReports, Cirugía de datos del evento viejo + línea base en el Log (+21 more)

### Community 5 - "Fase 1 fixes + Trello row keys"
Cohesion: 0.08
Nodes (23): changes.jsonl, checks.jsonl, Commit 875785f (retirada de history.jsonl), Fase 1 — Correcciones rápidas, bajo riesgo, documentRowKey(), eventDocumentCardDescription(), eventDocumentCardTitle(), questionRowKey() (+15 more)

### Community 6 - "CLAUDE.md: reglas del proyecto"
Cohesion: 0.11
Nodes (26): cleanup.js (compacta scheduler.log), data/viewer.html (SPA monolítica autocontenida), Regla: Backup = único .html (visor offline + fuente de restore), Regla: BITACORA.md lleva registro por sesión, añadir entrada al terminar, Flags de sección .env ↔ CONFIG_FLAGS ↔ CONFIG_TOGGLE_DEFS, data/index.html (redirige a viewer.html), Regla: data/ trackeado parcialmente, cuidado con commits, docker/nginx.conf (estáticos + proxy /api/) (+18 more)

### Community 7 - "index.js re-export stubs (rrsScraping)"
Cohesion: 0.07
Nodes (26): index_absolutizerrshref, index_deduperepeatedwordspans, index_deriverrseventidfromurl, index_detectdocumentchanges, index_detectgenericrowchanges, index_detectquestionschanges, index_detectscoringinquirychanges, index_detecttimelimitchanges (+18 more)

### Community 8 - "Bitacora: sesion 2026-10-12 (tests/lint/trello)"
Cohesion: 0.13
Nodes (23): 2026-09-11: Tiempos límite manuales, junto a los de RRS, 2026-09-12: Time limit de RRS quedaba huérfano para siempre + fecha vacía, 2026-10-12: Fase B cerrada + separación de issues Trello en ISSUES_TRELLO.md, 2026-10-12: ISSUES.md generado con /graphify + Fase A resuelta (6/6), 2026-10-12: Añadido test runner (node:test) y lint (eslint.config.js), 2026-10-12: ISSUES_TRELLO.md Fase B — tests de los 3 god nodes Trello (parcial), Contexto de trabajo: BITACORA.md, Fase 1/2 completas, pendientes, src/api.js (API backend HTTP :3000) (+15 more)

### Community 9 - "package.json metadata"
Cohesion: 0.08
Nodes (23): author, dependencies, cheerio, dotenv, description, devDependencies, eslint, engines (+15 more)

### Community 10 - "ISSUES.md backlog y god nodes Trello"
Cohesion: 0.11
Nodes (20): 63 edges colapsados (artefacto del extractor, no bug), Enlace Full Decision + custom field + PDF adjunto, God nodes (funciones Trello más conectadas), 97 nodos aislados del grafo (falsos positivos del extractor AST), HEARING_TYPE_TRELLO_LABEL_NAMES, Fase 2 — Cobertura de tests, Fase 3 — Arquitectura / cohesión baja, Fase 4 — Seguridad (no tocar sin acuerdo) (+12 more)

### Community 11 - "index.js: ciclo monitor y estado"
Cohesion: 0.10
Nodes (21): appendCheck(), appendJsonLine(), changedFields(), countDecidedDecisionRows(), ensureDataDir(), fetchAllDecisionPages(), fetchHtml(), formatTelegramMessage() (+13 more)

### Community 12 - "Trello: creacion de tarjetas y custom fields"
Cohesion: 0.20
Nodes (18): index.js (núcleo scraper/monitor, runMonitorCycle), applyTrelloCycle(), handleRemovedRowTrello(), normalizeFieldLabel(), trelloAuthParams(), trelloCardDescriptionForRow(), trelloCardTitle(), trelloCreateCard() (+10 more)

### Community 13 - "Trello: documentos y scoring inquiry"
Cohesion: 0.22
Nodes (14): applyDocumentTrelloCycle(), applyScoringInquiriesTrelloCycle(), attachmentFilenameFromUrl(), handleRemovedDocumentTrello(), scoringInquiryCardDescription(), scoringInquiryCardTitle(), trelloAddCardAttachmentFromDownload(), trelloAddCardAttachmentFromUrl() (+6 more)

### Community 14 - "test/decisions.test.js"
Cohesion: 0.14
Nodes (12): index_builddecisionrowsfromstate, index_detectchanges, index_extractdecisionsdetailbycasekey, index_extracttablerows, index_linktextisfulldecision, index_summarizerow, index_toabsoluteurl, assert (+4 more)

### Community 15 - "data/viewer.html SPA dashboard"
Cohesion: 0.18
Nodes (7): authFetch(path, options), CONFIG_TOGGLE_DEFS (const), extractArchiveBundleFromHtml(text), mapCheckLineToLogRow(line), renderTable(), showArchiveModeUI(data), switchTab(tab)

### Community 16 - "test/extractRrsGenericTable.test.js"
Cohesion: 0.18
Nodes (9): index_extractrrsgenerictable, ref_node_fs, ref_node_path, assert, { extractRrsGenericTable }, fs, path, RETIREMENT_OPTS (+1 more)

### Community 17 - "Trello: questions sync"
Cohesion: 0.27
Nodes (10): applyQuestionsTrelloCycle(), questionCardDescription(), questionCardTitle(), trelloApplyRowToCard(), trelloCreateQuestionCard(), trelloMoveCardToList(), trelloSyncAmazingFields(), trelloSyncCardListForRow() (+2 more)

### Community 18 - "Trello: labels de tarjeta"
Cohesion: 0.51
Nodes (10): trelloAddCardLabel(), trelloAddDecidedLabel(), trelloFindLabelIdByNames(), trelloGetBoardLabels(), trelloGetCard(), trelloGetCardLabels(), trelloRemoveCardLabel(), trelloSyncHearingTypeLabels() (+2 more)

### Community 19 - "test/trello.test.js"
Cohesion: 0.33
Nodes (5): ref_node_assert, ref_node_test, assert, { test, describe, afterEach }, {
  trelloAuthParams,
  trelloGetCard,
  applyTrelloCycle,
}

### Community 20 - "Bitacora: sesion 2026-09-03"
Cohesion: 0.40
Nodes (5): 2026-09-03: Dashboard polish — renderers para retirements y penaltyReports, 2026-09-03: FASE 1 completada — scraping robusto de 5 secciones tabulares RRS, 2026-09-03: Estudio inicial del caso (solo lectura, sin cambios), 2026-09-10: Fusión de pestañas Crew Substitutions + Equipment Substitutions, 2026-09-10: Fusión de pestañas Penalty Reports + Retirements

### Community 21 - "Bitacora: history.jsonl retirado"
Cohesion: 0.50
Nodes (5): 2026-09-09: cleanup de history.jsonl 2x/día + mover líneas a cleanup-archive, 2026-09-09: cleanup de history.jsonl — umbral bajado a 2 (solo primera), 2026-09-10: Cirugía de datos del evento viejo + línea base en el Log, 2026-09-10: Reset automático al cambiar RRS_EVENT_ID + Log por defecto solo cambios, 2026-09-10: history.jsonl retirado → checks.jsonl + changes.jsonl

### Community 22 - "Trello: time limit cards"
Cohesion: 0.50
Nodes (5): applyTimeLimitTrelloCycle(), handleRemovedTimeLimitTrello(), trelloApplyTimeLimitRow(), trelloCreateTimeLimitCard(), trelloUpdateCardNameDesc()

### Community 23 - "Schedule helpers Trello"
Cohesion: 0.40
Nodes (5): formatScheduleForTrelloDescription(), scheduleHasClockTime(), scheduleIsPending(), scheduleUsesScheduleList(), trelloTargetListIdForActiveRow()

### Community 24 - "Bitacora: Kanban Decided + perf"
Cohesion: 0.50
Nodes (4): 2026-09-09: Kanban — botón de orden en la columna Decided + plan optimización carga, 2026-09-09: Kanban — ojo vista mínima a nivel de columna DECIDED, 2026-09-09: Optimización de carga Fase 2 (data/viewer.html), 2026-09-10: Fase 3 optimización — fuera Tailwind Play CDN + Font Awesome CDN

### Community 25 - "Bitacora: backup 500 + kanban roles"
Cohesion: 0.67
Nodes (3): 2026-09-10: PENDIENTE backup 500 en producción, sin desplegar, 2026-09-10: Kanban jueces/roles/labels no se guardaban (401 + contrato roto), 2026-09-11: Backup 500 resuelto en producción (sin SSH, solo Portainer)

### Community 26 - "Bitacora: kanban updatedAt inmutable"
Cohesion: 0.67
Nodes (3): 2026-09-10: Fecha de tarjeta kanban = fecha de descarga RRS (inmutable) + alta/orfandad servidor, 2026-09-10: Kanban — tarjetas nuevas de decided salen compactadas, Kanban: updatedAt inmutable, alta/orfandad en servidor

## Ambiguous Edges - Review These
- `Dashboard polish: renderers para retirements y penaltyReports` → `Kanban: botón de orden en columna Decided + plan de optimización de carga Fase 1`  [AMBIGUOUS]
  BITACORA.md · relation: conceptually_related_to
- `hearingTypeToLabelNames()` → `src/trelloSync.js (split planeado, diferido)`  [AMBIGUOUS]
  ISSUES_TRELLO.md · relation: references
- `summarizeTimeLimitRow()` → `README § 4 Telegram`  [AMBIGUOUS]
  ISSUES_TRELLO.md · relation: references

## Knowledge Gaps
- **140 isolated node(s):** `cheerio`, `RRS_TABULAR_SECTIONS`, `RFC-3339`, `APP_DIR`, `CHANGES_FILE` (+135 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 273 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Dashboard polish: renderers para retirements y penaltyReports` and `Kanban: botón de orden en columna Decided + plan de optimización de carga Fase 1`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `hearingTypeToLabelNames()` and `src/trelloSync.js (split planeado, diferido)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `summarizeTimeLimitRow()` and `README § 4 Telegram`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `Fase 2 — Cobertura de tests` connect `ISSUES.md backlog y god nodes Trello` to `test/extractRrsGenericTable.test.js`, `index.js re-export stubs (rrsScraping)`?**
  _High betweenness centrality (0.285) - this node is a cross-community bridge._
- **Why does `Regla: BITACORA.md lleva registro por sesión, añadir entrada al terminar` connect `CLAUDE.md: reglas del proyecto` to `Bitacora: Fase C y backlog`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `trelloAuthParams()` (e.g. with `index.js` and `index.js (núcleo scraper/monitor, runMonitorCycle)`) actually correct?**
  _`trelloAuthParams()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `trelloGetCard()` (e.g. with `index.js` and `index.js (núcleo scraper/monitor, runMonitorCycle)`) actually correct?**
  _`trelloGetCard()` has 2 INFERRED edges - model-reasoned connections that need verification._