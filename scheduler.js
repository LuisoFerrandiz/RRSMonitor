const path = require("path");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const { performCleanup } = require('./cleanup');

require("dotenv").config({ path: path.join(__dirname, ".env") });

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");

const TIME_ZONE = process.env.REPORT_TIME_ZONE || "Europe/Madrid";
const SCHEDULE_FILE = process.env.SCHEDULE_FILE
  ? path.resolve(process.env.SCHEDULE_FILE)
  : path.join(DATA_DIR, "schedule.json");

const LOCK_FILE = path.join(DATA_DIR, "monitor.lock");
const LAST_RUN_FILE = path.join(DATA_DIR, "scheduler-last-run.json");
const STALE_LOCK_MS = Number(process.env.SCHEDULER_STALE_LOCK_MS || 30 * 60 * 1000);

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getZonedParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  );
  const dateKey = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  return {
    weekday: parts.weekday,
    dateKey,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function normalizeScheduleDates(dates) {
  if (!Array.isArray(dates)) {
    return null;
  }
  return dates.map((d) => String(d || "").trim()).filter(Boolean);
}

function parseScheduleConfig(raw) {
  if (Array.isArray(raw)) {
    return [{ dates: null, windows: raw }];
  }
  if (raw && Array.isArray(raw.plans)) {
    return raw.plans
      .map((plan) => ({
        name: plan.name || null,
        dates: normalizeScheduleDates(plan.dates),
        windows: plan.windows || [],
      }))
      .filter((plan) => plan.windows.length);
  }
  if (raw && Array.isArray(raw.windows)) {
    return [
      {
        name: raw.name || null,
        dates: normalizeScheduleDates(raw.dates),
        windows: raw.windows,
      },
    ];
  }
  return null;
}

function pickActiveRuleForPlans(plans, weekday, dateKey, minutesOfDay) {
  for (const plan of plans) {
    const rule = pickActiveRule(
      plan.windows,
      weekday,
      dateKey,
      minutesOfDay,
      plan.dates
    );
    if (rule) {
      return { rule, planName: plan.name || null };
    }
  }
  return null;
}

function parseClockToMinutes(value) {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    throw new Error(`Hora invalida en schedule.json: "${value}" (usa HH:MM)`);
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 24 || mm > 59 || (hh === 24 && mm !== 0)) {
    throw new Error(`Hora fuera de rango en schedule.json: "${value}"`);
  }
  return hh * 60 + mm;
}

function normalizeDayToken(day) {
  const s = String(day || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  const idx = DAY_NAMES.findIndex((d) => d.toLowerCase() === lower);
  if (idx >= 0) return DAY_NAMES[idx];
  const shortMap = {
    sun: "Sunday",
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
  };
  return shortMap[lower.slice(0, 3)] || s;
}

function ruleMatchesNow(rule, weekday, dateKey, minutesOfDay, scheduleDates) {
  const ruleDates = normalizeScheduleDates(rule.dates);
  const activeDates = ruleDates || scheduleDates;
  if (activeDates && !activeDates.includes(dateKey)) {
    return false;
  }

  const days = (rule.days || []).map(normalizeDayToken);
  if (days.length && !days.includes(weekday)) {
    return false;
  }

  const start = parseClockToMinutes(rule.start);
  const end = parseClockToMinutes(rule.end);
  if (end > start) {
    return minutesOfDay >= start && minutesOfDay < end;
  }
  return minutesOfDay >= start || minutesOfDay < end;
}

function pickActiveRule(windows, weekday, dateKey, minutesOfDay, scheduleDates) {
  const matches = windows.filter((rule) =>
    ruleMatchesNow(rule, weekday, dateKey, minutesOfDay, scheduleDates)
  );
  if (!matches.length) {
    return null;
  }
  return matches.sort(
    (a, b) => Number(a.frequencyMinutes || 9999) - Number(b.frequencyMinutes || 9999)
  )[0];
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw || !raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function isLockActive() {
  try {
    const raw = await fs.readFile(LOCK_FILE, "utf8");
    if (!raw || !raw.trim()) {
      return false;
    }
    const lock = JSON.parse(raw);
    const age = Date.now() - Number(lock.startedAt || 0);
    if (age > STALE_LOCK_MS) {
      console.warn(`[SCHEDULER] Lock antiguo (${Math.round(age / 1000)}s); se elimina.`);
      await fs.unlink(LOCK_FILE);
      return false;
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function acquireLock() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    LOCK_FILE,
    JSON.stringify({ pid: process.pid, startedAt: Date.now() }, null, 2),
    "utf8"
  );
}

async function releaseLock() {
  try {
    await fs.unlink(LOCK_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function shouldRunNow(activeRule) {
  const frequencyMinutes = Number(activeRule.frequencyMinutes);
  if (!Number.isFinite(frequencyMinutes) || frequencyMinutes <= 0) {
    throw new Error(
      `Regla "${activeRule.name || "sin nombre"}": frequencyMinutes invalido`
    );
  }

  const lastRun = await readJson(LAST_RUN_FILE, null);
  if (!lastRun?.startedAt) {
    return true;
  }

  const elapsedMs = Date.now() - Number(lastRun.startedAt);
  return elapsedMs >= frequencyMinutes * 60 * 1000;
}

async function saveLastRun(activeRule) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    LAST_RUN_FILE,
    JSON.stringify(
      {
        startedAt: Date.now(),
        ruleName: activeRule.name || null,
        frequencyMinutes: activeRule.frequencyMinutes,
      },
      null,
      2
    ),
    "utf8"
  );
}

function runMonitorOnce() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "index.js"), "--once"], {
      cwd: __dirname,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`index.js --once termino con codigo ${code}`));
    });
  });
}

async function main() {
  const { weekday, dateKey, minutesOfDay } = getZonedParts();

  // Limpieza dos veces al día: primera pasada tras las 00:00 y tras las 12:00 (REPORT_TIME_ZONE).
  const STATE_FILE = path.join(DATA_DIR, "state.json");
  try {
    const state = await readJson(STATE_FILE, {});
    const slot = `${dateKey}-${minutesOfDay < 720 ? "AM" : "PM"}`; // 720 = 12:00
    if (state.lastCleanupSlot !== slot) {
      const historyPath = path.join(DATA_DIR, "history.jsonl");
      const logPath = path.join(DATA_DIR, "scheduler.log");
      await performCleanup(historyPath, logPath);
      state.lastCleanupSlot = slot;
      await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
    }
  } catch (error) {
    console.error("[SCHEDULER] Error durante la limpieza periódica:", error.message);
  }

  const plans = parseScheduleConfig(await readJson(SCHEDULE_FILE, null));
  if (!plans?.length) {
    console.error(`[SCHEDULER] ${SCHEDULE_FILE} vacio o invalido.`);
    process.exit(1);
  }

  const picked = pickActiveRuleForPlans(plans, weekday, dateKey, minutesOfDay);
  const activeRule = picked?.rule || null;
  if (!activeRule) {
    console.log(
      `[SCHEDULER] ${dateKey} ${weekday} ${pad2(Math.floor(minutesOfDay / 60))}:${pad2(
        minutesOfDay % 60
      )} (${TIME_ZONE}) -> fuera de ventana o fecha; no se ejecuta.`
    );
    return;
  }

  if (!(await shouldRunNow(activeRule))) {
    console.log(
      `[SCHEDULER] Regla "${activeRule.name}" activa; aun no toca (cada ${activeRule.frequencyMinutes} min).`
    );
    return;
  }

  if (await isLockActive()) {
    console.log("[SCHEDULER] Monitor en curso (lock activo); se omite esta pasada.");
    return;
  }

  await acquireLock();
  console.log(
    `[SCHEDULER] Ejecutando monitor -> plan "${picked.planName || "sin nombre"}", regla "${activeRule.name}" (cada ${activeRule.frequencyMinutes} min).`
  );

  try {
    await runMonitorOnce();
    await saveLastRun(activeRule);
    console.log("[SCHEDULER] Ciclo completado.");
  } finally {
    await releaseLock();
  }
}

main().catch(async (error) => {
  console.error("[SCHEDULER]", error.message);
  await releaseLock();
  process.exit(1);
});
