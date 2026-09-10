const fs = require('fs/promises');
const path = require('path');

/**
 * Reduce rachas de líneas consecutivas iguales.
 * @param {string[]} lines - Array de líneas a procesar
 * @param {Function} getComparisonKey - Función para extraer la parte comparable de la línea
 * @param {Function} [onRemove] - Se llama con cada línea descartada de una racha, en orden
 * @param {{minRun?: number, keepLast?: boolean}} [opts] - minRun: tamaño mínimo de racha
 *   para colapsar (por defecto 3); keepLast: si además de la primera se conserva la última
 *   de la racha (por defecto true).
 * @returns {string[]} Líneas procesadas
 */
function reduceLines(lines, getComparisonKey, onRemove, opts) {
  const minRun = (opts && opts.minRun) || 3;
  const keepLast = !opts || opts.keepLast !== false;
  if (lines.length < minRun) return lines;
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const currentKey = getComparisonKey(lines[i]);
    let j = i + 1;
    while (j < lines.length && getComparisonKey(lines[j]) === currentKey) {
      j++;
    }
    const count = j - i;
    if (count >= minRun) {
      result.push(lines[i]); // Mantenemos la primera
      const lastIdx = keepLast ? j - 1 : i;
      if (keepLast && j - 1 !== i) {
        result.push(lines[j - 1]); // Mantenemos la última
      }
      // El resto se quita; si hay callback, se le entregan en orden.
      if (onRemove) {
        for (let k = i + 1; k < j; k++) {
          if (k !== lastIdx) onRemove(lines[k]);
        }
      }
    } else {
      for (let k = i; k < j; k++) result.push(lines[k]);
    }
    i = j;
  }
  return result;
}

/**
 * Compacta `scheduler.log`: quita las líneas de "injected env" y colapsa rachas de 3+
 * mensajes [SCHEDULER] equivalentes (ignorando la fecha/hora) dejando primera+última.
 *
 * `history.jsonl` ya no existe (lo sustituyó `checks.jsonl`, 1 línea diminuta por ciclo
 * sin buffer), así que el cleanup solo se ocupa del log del scheduler.
 */
async function performCleanup(logPath) {
  console.log('[CLEANUP] Iniciando limpieza...');

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

// Entrypoint CLI: `node cleanup.js` (lo usa POST /api/force-cleanup y una tarea cron a las 00/12).
// Ejecuta siempre; el gate de franja horaria vive solo en scheduler.js.
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'data');
  performCleanup(path.join(dataDir, 'scheduler.log'))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('[CLEANUP]', e.message);
      process.exit(1);
    });
}
