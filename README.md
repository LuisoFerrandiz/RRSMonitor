# Script monitor RRS (Node.js 18)

Monitor del sitio **Racing Rules of Sailing** para un evento concreto. Un único proceso (`index.js`) descarga las páginas configuradas, compara con el último estado guardado en disco y opcionalmente sincroniza **Trello** y avisa por **Telegram**.

---

## 1. Qué observa el script

| Origen | Variable `.env` | Contenido |
|--------|-----------------|------------|
| Calendario de audiencias | `RRS_URL` (o derivada de `RRS_EVENT_ID`) | Tabla *Hearing Schedule*: `No.`, `Type`, `Race`, `Initiator`, `Respondent(s)`, `Schedule`, `Location`. Enlaces bajo *Type* se tratan aparte para Trello. |
| Misma página schedule | (misma URL) | **Protest Time Limit(s)** — tabla `table.table-warning`: fecha, clase, tiempo límite, *Remaining*. |
| Documentos del evento | `RRS_DOCUMENTS_URL` | Tabla *Event Documents* (`#document-table`): enlaces, descripción, fecha. |
| Decisiones publicadas | `RRS_DECISIONS_URL` | Tabla *Hearing Decisions*: columna *No.*, columna *Decision* (texto y, si existe, enlace con texto **Full Decision**). |
| Consultas (Q&A) | `RRS_QUESTIONS_URL` | Tabla de preguntas: `No.`, `Competitor`, `For`, `Regarding`, `State`, `Answered`. |

Puedes usar solo `RRS_EVENT_ID` y plantillas con `{id_evento}` en las URLs; el script resuelve IDs y rutas `schedules` / `documents` / `decisions` / `questions`.

Ejemplo de URL de calendario:

- https://www.racingrulesofsailing.org/schedules/13476/event

---

## 2. Ciclo de trabajo (cada `POLL_INTERVAL_MS`)

1. Descarga la página de **schedule** y extrae audiencias + time limits.
2. Si hay `RRS_DOCUMENTS_URL`, descarga **documents** y calcula altas / bajas / cambios.
3. Si hay `RRS_DECISIONS_URL` y Trello está activo con credenciales, descarga **decisions** una vez por ciclo (texto por caso, enlace *Full Decision* si aplica).
4. Si hay `RRS_QUESTIONS_URL`, descarga **questions** y sincroniza con Trello y Telegram.
5. Compara audiencias, time limits, documentos y preguntas con `state.json` anterior.
6. Opcional: actualiza **Trello** (audiencias, listas derivadas, time limits, documentos TOA, decisiones / Full Decision, Q&A).
7. Escribe **histórico** y, si hubo cambios y no es la primera corrida, **Telegram** (no se notifica la línea base inicial).

---

## 3. Archivos de salida (`DATA_DIR`, por defecto `data/` junto a `index.js`)

- **Timestamps** en `state.json`, `history.jsonl`, `changes.jsonl`, consola y Telegram usan la zona **`Europe/Madrid`** (CET/CEST con offset `+01:00` / `+02:00` en el string). Opcional: define `REPORT_TIME_ZONE` en `.env` con cualquier [zona IANA](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

- **`state.json`** — Último snapshot: `rows`, `timeLimitRows`, `documentRows`, `questionRows`, mapas `trelloCards`, `trelloTimeLimitCards`, `trelloDocumentCards`, `trelloQuestionCards`, `hearingAttachmentUrlsByCase`, `fullDecisionSyncedByCase`, etc.
- **`history.jsonl`** — Una línea JSON por ciclo (snapshots completos).
- **`changes.jsonl`** — Solo ciclos con cambios: `changes` (audiencias), `timeLimitChanges`, `documentChanges`, `questionChanges`.

**Cambiar carpeta o vaciar datos**

- **Otra carpeta:** en `.env` define `DATA_DIR` (ruta relativa o absoluta), reinicia el proceso; el script crea la carpeta si no existe y escribe `state.json`, `history.jsonl` y `changes.jsonl` ahí.
- **Borrar o vaciar:** si falta `state.json` o no se puede leer, el script actúa como **primer arranque** (sin estado previo). Los `.jsonl` se **crean de nuevo** al añadir la primera línea.
- **Telegram:** en ese “primer” ciclo **no** manda mensaje aunque haya muchos cambios respecto al vacío (misma lógica que la instalación nueva).
- **Trello:** sin `trelloCards` en estado, el script **creará tarjetas nuevas** para los casos que vea. Si en el tablero siguen tarjetas viejas, puedes tener **duplicados**; en ese caso conviene tablero/listas limpias, u otro `DATA_DIR` con estado coherente, o no borrar `state.json` hasta alinear Trello.

---

## 4. Telegram

- `TELEGRAM_ENABLED=true`, más `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.
- **Primera ejecución**: no envía mensajes (solo guarda estado base).
- Los enlaces bajo *Type* en RRS **no** se incluyen en el texto de Telegram; sí pueden ir como adjuntos en Trello.

---

## 5. Trello — audiencias (mapa `trelloCards`)

### Listas

- **`TRELLO_LIST_ID`**: lista base (p. ej. *Hearing Request*).
- **`TRELLO_SCHEDULE_LIST_ID`**: si el *Schedule* de la fila tiene hora tipo `HH:MM` y no está en *Pending*/vacío, la tarjeta se coloca aquí.
- **`TRELLO_DECIDED_LIST_ID`**: cuando el caso **desaparece** del calendario RRS, la tarjeta se mueve aquí (y se enriquece la descripción; ver abajo).

### Nombre de tarjeta

- `Case <número>` (número normalizado para la clave interna del mismo caso).

### Descripción de la tarjeta (formato acordado)

Líneas fijas en este orden:

1. `Case: …`
2. `Initiator: …`
3. `Respondent: …` (contenido de *Respondent(s)* en RRS)
4. `Race: …`
5. `Type: …`
6. `Schedule: …` — si el texto viene como en la web (`May 01 - 19:20`), se muestra como **`DD/MM HH:MM`** cuando el patrón es reconocible; si no, texto original; *Pending* se deja como está.
7. `Location: …`

Los campos de texto en Trello (*Initiator*, *Respondent*, *Race*, *Type*, *Schedule*, etc.) se siguen sincronizando por API si existen en el tablero; **la descripción lleva siempre el bloque completo** arriba.

### Etiquetas por tipo (soporte multi-etiqueta)

El script gestiona las siguientes etiquetas según el campo `Type` de RRS:

- `Protest` -> Etiqueta: **Protest**
- `Protest by PC` -> Etiquetas: **Protest** + **International jury**
- `Protest by RC` -> Etiquetas: **Protest** + **Race Committee**
- `Protest by TC` -> Etiquetas: **Protest** + **Technical Committee**
- `Request to Reopen` -> Etiqueta: **Request to Reopen**
- `Request for Redress` -> Etiqueta: **Request for Redress**

*Nota: Las etiquetas deben existir en el tablero con esos nombres exactos.*

### Adjuntos bajo *Type*

- Los `href` de la celda *Type* en RRS se añaden como adjuntos por URL en la tarjeta; el estado evita duplicar la misma URL.

### Al mover a **Decided**

- La descripción se **regenera** con el mismo bloque de caso y, si la página *Hearing Decisions* aporta texto para ese número de caso, una línea **`Decision: …`** antes del pie.
- Pie fijo: `--- Caso eliminado del calendario RRS · movido a Decided`.
- Custom field de texto **`DECISION`** (nombre flexible: *Decision* / *Decisions*): se rellena con el texto de la columna *Decision* en RRS cuando hay datos cargados desde `RRS_DECISIONS_URL`.
- Etiqueta de tipo se alinea con *Other* (elimina las etiquetas de tipo anteriores).

### Hearing Decisions y enlace **Full Decision**

Cuando en la celda *Decision* hay un enlace cuyo texto visible es exactamente **`Full Decision`** (tras normalizar espacios):

1. Se busca un custom field tipo **casilla** cuyo nombre case-insensitive coincida con uno de: *Full Decision*, *Full decision*, *FullDecision*, *Full decision file*.
2. Se envía a Trello `checked: "true"` en ese campo.
3. Se adjunta el archivo: primero como adjunto por **URL**; si falla, se **descarga** el recurso (mismo `User-Agent` que el monitor) y se sube a Trello en **multipart**.
4. En `state.json`, `fullDecisionSyncedByCase` guarda la URL por clave de caso para no repetir la subida mientras la URL no cambie y el adjunto ya esté en la tarjeta.

Esto se aplica a **todas** las tarjetas de audiencia que sigan mapeadas en `trelloCards`, y también **antes** de mover a *Decided* cuando un caso cae del schedule.

---

## 6. Trello — Protest Time Limit(s)

- Lista: `TRELLO_TIMELIMIT_LIST_ID`.
- Título: `fecha · clase · hora límite`; descripción breve con *Remaining* si existe.
- Si la fila **desaparece** de la web: la tarjeta se renombra con prefijo `TIME OUT` (sin duplicar el prefijo).

---

## 7. Trello — Event Documents (TOA-Documents)

- Lista: `TRELLO_TOA_DOCUMENTS_LIST_ID`.
- Sincroniza filas del `#document-table` con tarjetas (título/desc con enlace).
- Si un documento deja de existir en la web: prefijo `DELETE` en el nombre de la tarjeta.

---

## 8. Trello — Q&A (Questions)

- Lista: `TRELLO_QUESTIONS_LIST_ID`.
- Título: `Q&A <no> <regarding>`.
- Descripción: Detalles de la pregunta (Competitor, For, Regarding, State, Answered).
- **Etiquetas automáticas**:
    - Si el campo `For` incluye "Race Committee" -> Etiqueta: **Race Committee**.
    - Si el campo `For` incluye "Technical Committee" -> Etiqueta: **Technical Committee**.
    - Si la columna `Answered` tiene contenido (fecha) -> Etiqueta: **Answered**.
- Sincroniza campos personalizados (Competitor -> Initiator, For -> Respondent) y adjunta el PDF de la pregunta si existe.

---

## 9. Configuración rápida

1. `cp .env.example .env` (o equivalente en Windows).
2. Rellenar al menos `RRS_EVENT_ID` o URLs finales sin placeholders.
3. Opcional: Telegram, Trello (todas las listas y tokens que uses en producción).

## 10. Ejecución

```bash
npm run once    # un ciclo
npm start       # bucle según POLL_INTERVAL_MS
```

## 11. Requisitos

- Node.js 18+ (`fetch`, `FormData`, `Blob` para adjuntos subidos).

---

## Guías para el futuro

### 1. ¿Qué hacer si quiero cambiar la URL que el script sigue?

- Las URLs **no están en el código**; salen del archivo **`.env`** cada vez que arrancas el script.
- Abre **`.env`** y cambia el evento, por ejemplo: `RRS_EVENT_ID=XXXXX` (el número que ves en la URL del evento en la web RRS).
- Guarda el archivo y **reinicia** el monitor (`npm start` o el servicio que uses). No hace falta editar `index.js`.
- Si **cambias de evento** y ya tenías histórico y tarjetas en Trello enlazadas en `state.json`, **haz una copia de seguridad** de la carpeta `data` (o al menos de `state.json`, `history.jsonl` y `changes.jsonl`). Así evitas pérdida de datos y puedes arrancar limpio en el nuevo evento sin mezclar mapas de tarjetas viejos con casos nuevos.

---

### 2. ¿Qué hacer si quiero cambiar el envío del bot de Telegram?

El script usa la API: `https://api.telegram.org/bot<TOKEN>/sendMessage`. **No hace falta tocar código**, solo **`.env`**.

**Secuencia habitual**

**1. Crear el bot con BotFather**

- En Telegram, abre el chat con **[@BotFather](https://t.me/BotFather)** (cuenta oficial verificada).
- Envía **`/newbot`**.
- Elige el **nombre visible** del bot (el que verán los usuarios).
- Elige el **username** del bot: debe terminar en **`bot`** (ej. `MiMonitorRRS_bot`) y estar libre.
- Si todo va bien, BotFather responde con un **mensaje de éxito** y ya incluye el token (paso 2).

**2. Obtener el token**

- **Al crear** el bot, BotFather envía algo como: `Use this token to access the HTTP API:` y una línea larga (`123456789:ABCdef...`). Esa cadena es **`TELEGRAM_BOT_TOKEN`**.
- **Si lo perdiste:** en BotFather usa **`/mybots`** → elige tu bot → **API Token** (o **Revoke** si quieres uno nuevo; el anterior deja de valer).
- **No** subas el token a git ni lo compartas; vive solo en **`.env`** (y fuera de capturas).

**3. Obtener el ID del chat (`TELEGRAM_CHAT_ID`)**

- El script envía mensajes a **un** chat concreto: tú solo, o un **grupo** (ID negativo).

**Chat contigo (privado)**

- Abre en Telegram el bot que acabas de crear (enlace del estilo `t.me/TuBot`) y pulsa **Iniciar** / envía **`/start`**. Así el bot puede recibir updates de tu usuario.
- En el navegador abre esta URL sustituyendo **`<TOKEN>`** por tu token (sin espacios ni `<>`):

  `https://api.telegram.org/bot<TOKEN>/getUpdates`

- En la respuesta JSON busca `"chat":{"id": ...`. El número **`id`** (ej. `123456789`) es tu **`TELEGRAM_CHAT_ID`**.  
  Si la lista `"result"` está vacía, vuelve a enviar **/start** al bot y recarga la URL.

**Grupo**

- Añade el **bot al grupo** (como miembro). Opcional: dale permiso de enviar mensajes si tu grupo lo restringe.
- Escribe **cualquier mensaje** en el grupo (o `/start` si el bot lo usa).
- Abre de nuevo `https://api.telegram.org/bot<TOKEN>/getUpdates` y busca `"chat":{"id":-100xxxxxxxxxx}`. Los grupos/supergrupos suelen tener **ID negativo**; copia ese número **con el signo** para **`TELEGRAM_CHAT_ID`**.

**4. Dejarlo en `.env` y arrancar**

- **`TELEGRAM_BOT_TOKEN`**: el token del paso 2.
- **`TELEGRAM_CHAT_ID`**: el número del paso 3 (sin comillas).
- **`TELEGRAM_ENABLED`**: debe ser exactamente **`true`** (minúsculas) para que envíe.
- **Guarda** `.env` y **reinicia** el monitor.

**Comportamiento que conviene recordar**

- La **primera corrida** sin `state.json` previo **no** manda Telegram (solo línea base); los avisos empiezan cuando ya hay estado y hay cambios.
- Si solo cambias token o chat, no hace falta modificar `index.js`.

---

### 3. Tablero Trello nuevo (cuenta nueva): listas, Key, Token e IDs

El script **no usa el nombre del tablero** en `.env`: solo **Key**, **Token** e **IDs de lista**. Los nombres de lista son para ti; puedes usar otros, siempre que en `.env` pongas el **id** correcto de cada una.

**1. Crear en el tablero estas listas (nombres sugeridos)**

Crea **seis listas** y úsalas así en `.env` (una entrada por lista):

- **`TRELLO_LIST_ID`**  
  - **Tarjetas:** audiencias **sin** hora tipo `HH:MM` en *Schedule*, o *Pending* / vacío. Aquí se **crean** las tarjetas nuevas por defecto.

- **`TRELLO_SCHEDULE_LIST_ID`**  
  - **Tarjetas:** la misma audiencia cuando en RRS el *Schedule* ya lleva **hora** (`19:20`, etc.).

- **`TRELLO_DECIDED_LIST_ID`**  
  - **Tarjetas:** cuando el caso **desaparece** del calendario RRS; el script mueve la tarjeta aquí y puede rellenar decisión / adjunto *Full Decision*.

- **`TRELLO_TIMELIMIT_LIST_ID`**  
  - **Tarjetas:** filas de **Protest Time Limit(s)** de la página RRS.

- **`TRELLO_TOA_DOCUMENTS_LIST_ID`**  
  - **Tarjetas:** filas de **Event Documents** en RRS.

- **`TRELLO_QUESTIONS_LIST_ID`**  
  - **Tarjetas:** filas de la tabla de preguntas (Q&A).

**Custom fields (texto)**

- **Initiator**, **Respondent**, **Race**, **Type**, **Schedule**, **Decision**.

**Etiquetas (labels) en el tablero**

Deben existir **con estos textos** (el script los busca por nombre).

1. `Protest`
2. `International jury`
3. `Request to Reopen`
4. `Request for Redress`
5. `Race Committee`
6. `Technical Committee`
7. `Answered`

---

## Resumen de evolución documentada (estudio)

- Descripción Trello **sin** línea duplicada `No:`; bloque **Case + Initiator + Respondent + Race + Type + Schedule (DD/MM HH:MM) + Location**.
- Casos a **Decided**: descripción con **Decision** en texto + custom field **DECISION** + pie de baja del calendario.
- **`RRS_DECISIONS_URL`**: en cada ciclo con Trello, lectura de decisiones; enlace **Full Decision** → casilla personalizada + PDF adjunto + estado **`fullDecisionSyncedByCase`**.
- **Mapeo multi-etiqueta**: "Protest by PC" ahora pone *Protest* + *International jury*, etc.
- **Sincronización Q&A**: Nueva lista para preguntas con etiquetas automáticas por comité y estado de respuesta (*Answered*).
