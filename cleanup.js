const fs = require('fs/promises');

/**
 * Reduce líneas repetidas manteniendo solo la primera y la última de un bloque.
 * @param {string[]} lines - Array de líneas a procesar
 * @param {Function} getComparisonKey - Función para extraer la parte comparable de la línea
 * @returns {string[]} Líneas procesadas
 */
function reduceLines(lines, getComparisonKey) {
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
    } else {
      for (let k = i; k < j; k++) result.push(lines[k]);
    }
    i = j;
  }
  return result;
}

async function performCleanup(historyPath, logPath) {
  console.log('[CLEANUP] Iniciando limpieza diaria...');

  // --- 1. Limpiar history.jsonl ---
  try {
    const historyData = await fs.readFile(historyPath, 'utf8');
    const hLines = historyData.split('\n').filter(l => l.trim());
    const cleanHLines = reduceLines(hLines, (line) => {
      try {
        const obj = JSON.parse(line);
        delete obj.timestamp; // Ignoramos el tiempo para comparar
        return JSON.stringify(obj);
      } catch (e) { return line; }
    });
    await fs.writeFile(historyPath, cleanHLines.join('\n') + '\n', 'utf8');
    console.log(`[CLEANUP] history.jsonl: ${hLines.length} -> ${cleanHLines.length} líneas.`);
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
