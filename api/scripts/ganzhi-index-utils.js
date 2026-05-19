const { Solar } = require('lunar-javascript');

const CALENDAR_TIMEZONE = 'Asia/Shanghai';

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

function buildEightChar(parts, hour = 12, minute = 0, sect = 1) {
  const solar = Solar.fromYmdHms(parts.year, parts.month, parts.day, hour, minute, 0);
  const lunar = solar.getLunar();
  const bazi = lunar.getEightChar();
  bazi.setSect(sect);

  return {
    solar,
    lunar,
    bazi,
    yearGanZhi: bazi.getYear(),
    monthGanZhi: bazi.getMonth(),
    dayGanZhi: bazi.getDay(),
    hourGanZhi: bazi.getTime(),
  };
}

function parseArgs(argv, defaults = {}) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];

    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = value;
    i += 1;
  }

  return {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(args).filter(([, value]) => value !== undefined),
    ),
  };
}

module.exports = {
  CALENDAR_TIMEZONE,
  Solar,
  buildEightChar,
  compareDateParts,
  formatDate,
  nextDate,
  parseArgs,
  parseDateString,
};
