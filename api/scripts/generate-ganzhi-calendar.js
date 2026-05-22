const fs = require('fs');
const path = require('path');
const { Solar } = require('lunar-javascript');

const DEFAULT_START = '2025-01-01';
const DEFAULT_END = '2030-12-31';
const DEFAULT_OUTPUT = path.resolve(__dirname, '../generated/ganzhi-calendar-2025-2030.json');
const DEFAULT_LITE_OUTPUT = path.resolve(__dirname, '../generated/ganzhi-calendar-2025-2030-lite.json');
const CALENDAR_TIMEZONE = 'Asia/Shanghai';

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];

    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = value;
    i += 1;
  }

  return {
    start: args.start || DEFAULT_START,
    end: args.end || DEFAULT_END,
    output: args.output ? path.resolve(process.cwd(), args.output) : DEFAULT_OUTPUT,
  };
}

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD.`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function compareDateParts(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function nextDate(parts) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  next.setUTCDate(next.getUTCDate() + 1);

  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function formatDate(parts) {
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildCalendarEntry(parts) {
  const solar = Solar.fromYmdHms(parts.year, parts.month, parts.day, 12, 0, 0);
  const lunar = solar.getLunar();

  const yearGanZhi = lunar.getYearInGanZhi();
  const monthGanZhi = lunar.getMonthInGanZhi();
  const dayGanZhi = lunar.getDayInGanZhi();
  const jieQi = lunar.getJieQi() || null;
  const lunarMonth = `${lunar.getMonthInChinese()}月`;
  const lunarDay = lunar.getDayInChinese();

  return {
    date: formatDate(parts),
    yearGanZhi,
    monthGanZhi,
    dayGanZhi,
    ganZhiLabel: `${yearGanZhi}年${monthGanZhi}月${dayGanZhi}日`,
    lunar: lunar.toString(),
    lunarMonth,
    lunarDay,
    jieQi,
  };
}

function toLiteEntry(entry) {
  return {
    date: entry.date,
    yearGanZhi: entry.yearGanZhi,
    monthGanZhi: entry.monthGanZhi,
    dayGanZhi: entry.dayGanZhi,
    ganZhiLabel: entry.ganZhiLabel,
  };
}

function generateCalendar(start, end) {
  const entries = [];
  let cursor = start;

  while (compareDateParts(cursor, end) <= 0) {
    entries.push(buildCalendarEntry(cursor));
    cursor = nextDate(cursor);
  }

  return entries;
}

function main() {
  const { start, end, output } = parseArgs(process.argv.slice(2));
  const startDate = parseDateString(start);
  const endDate = parseDateString(end);

  if (compareDateParts(startDate, endDate) > 0) {
    throw new Error(`Start date ${start} must be before end date ${end}.`);
  }

  const items = generateCalendar(startDate, endDate);
  const payload = {
    version: '1.0.0',
    timezone: CALENDAR_TIMEZONE,
    generatedAt: new Date().toISOString(),
    range: {
      start,
      end,
      totalDays: items.length,
    },
    items,
  };
  const litePayload = {
    version: '1.0.0-lite',
    timezone: CALENDAR_TIMEZONE,
    generatedAt: payload.generatedAt,
    range: payload.range,
    items: items.map(toLiteEntry),
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  fs.writeFileSync(DEFAULT_LITE_OUTPUT, JSON.stringify(litePayload, null, 2) + '\n', 'utf8');

  console.log(
    JSON.stringify(
      {
        output,
        liteOutput: DEFAULT_LITE_OUTPUT,
        totalDays: items.length,
        first: items[0],
        last: items[items.length - 1],
      },
      null,
      2,
    ),
  );
}

main();
