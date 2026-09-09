const fs = require('fs/promises');
const path = require('path');

/**
 * Reduce líneas repetidas manteniendo solo la primera y la última de un bloque.
 * @param {string[]} lines - Array de líneas a procesar
 * @param {Function} getComparisonKey - Función para extraer la parte comparable de la línea
 * @param {Function} [onRemove] - Se llama con cada línea del centro que se descarta de un bloque
 * @returns {string[]} Líneas procesadas
 */
function reduceLines(lines, getComparisonKey, onRemove) {
  if (lines.length < 3) return lines;
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const currentKey = getComparisonKey(lines[i]);
    let j = i + 1;
    while (j < lines.length && getComparisonKey(lines[j]) === currentKey) {
      j++;
    }
    const count = j - i;
    if (count >= 3) {
      result.push(lines[i]);     // Mantenemos la primera
      result.push(lines[j - 1]); // Mantenemos la última
      // Las del centro se quitan; si hay callback, se le entregan en orden.
      if (onRemove) {
        for (let k = i + 1; k < j - 1; k++) onRemove(lines[k]);
      }
    } else {
      for (let k = i; k < j; k++) result.push(lines[k]);
    }
    i = j;
  }
  return result;
}

/**
 * Vuelca a history.jsonl las líneas que index.js dejó pendientes en history.tmp.jsonl,
 * para que el cleanup también las tenga en cuenta. Réplica mínima de flushHistory().
 */
async function flushHistoryTmp(historyPath) {
  const tmpPath = path.join(path.dirname(historyPath), 'history.tmp.jsonl');
  try {
    const content = await fs.readFile(tmpPath, 'utf8');
    if (content && content.trim()) {
      await fs.appendFile(historyPath, content.endsWith('\n') ? content : content + '\n', 'utf8');
    }
    await fs.unlink(tmpPath);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[CLEANUP] Error al volcar history.tmp.jsonl: ${e.message}`);
    }
  }
}

async function performCleanup(historyPath, logPath) {
  console.log('[CLEANUP] Iniciando limpieza...');

  // --- 1. Limpiar history.jsonl ---
  // Regla: si la misma línea (ignorando `timestamp`) se repite 3+ veces seguidas,
  // dejamos solo la primera y la última y movemos las del centro a cleanup-archive.jsonl
  // (mismo formato que history.jsonl: la línea de snapshot verbatim, con su timestamp).
  try {
    await flushHistoryTmp(historyPath);

    const cleanupArchivePath = path.join(path.dirname(historyPath), 'cleanup-archive.jsonl');
    const historyData = await fs.readFile(historyPath, 'utf8');
    const hLines = historyData.split('\n').filter(l => l.trim());

    const movedLines = [];
    const cleanHLines = reduceLines(
      hLines,
      (line) => {
        try {
          const obj = JSON.parse(line);
          delete obj.timestamp; // Ignoramos el tiempo para comparar
          return JSON.stringify(obj);
        } catch (e) { return line; }
      },
      (line) => movedLines.push(line)
    );

    if (movedLines.length) {
      await fs.appendFile(cleanupArchivePath, movedLines.join('\n') + '\n', 'utf8');
    }
    await fs.writeFile(historyPath, cleanHLines.join('\n') + '\n', 'utf8');
    console.log(
      `[CLEANUP] history.jsonl: ${hLines.length} -> ${cleanHLines.length} líneas ` +
      `(${movedLines.length} movidas a cleanup-archive.jsonl).`
    );
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[CLEANUP] Error en history.jsonl: ${e.message}`);
    }
  }

  // --- 2. Limpiar scheduler.log ---
  try {
    const logData = await fs.readFile(logPath, 'utf8');
    let lLines = logData.split('\n').filter(l => l.trim());

    // Eliminar todas las líneas de "injected env"
    lLines = lLines.filter(line => !line.includes('◇ injected env'));

    const cleanLLines = reduceLines(lLines, (line) => {
      // Ignorar la fecha/hora en mensajes [SCHEDULER]
      // Ejemplo: "[SCHEDULER] 2026-05-27 Wednesday 10:00 (Europe/Madrid) -> fuera de ventana"
      // se convierte en "fuera de ventana"
      return line.replace(/\[SCHEDULER\].*? -> /, '').trim();
    });
    await fs.writeFile(logPath, cleanLLines.join('\n') + '\n', 'utf8');
    console.log(`[CLEANUP] scheduler.log: ${lLines.length} -> ${cleanLLines.length} líneas.`);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[CLEANUP] Error en scheduler.log: ${e.message}`);
    }
  }
}

module.exports = { performCleanup };

// Entrypoint CLI: `node cleanup.js` (lo usa POST /api/force-cleanup y una tarea DSM a las 00/12).
// Ejecuta siempre; el gate de franja horaria vive solo en scheduler.js.
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'data');
  performCleanup(path.join(dataDir, 'history.jsonl'), path.join(dataDir, 'scheduler.log'))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[CLEANUP]', e.message);
      process.exit(1);
    });
}
