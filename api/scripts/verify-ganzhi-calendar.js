const fs = require('fs');
const path = require('path');
const { Solar } = require('lunar-javascript');

const FILE_PATH = path.resolve(__dirname, '../generated/ganzhi-calendar-2025-2030.json');
const EDGE_DATES = [
  '2025-01-01',
  '2025-02-02',
  '2025-02-03',
  '2025-02-04',
  '2025-03-04',
  '2025-03-05',
  '2025-03-06',
  '2026-02-03',
  '2026-02-04',
  '2026-02-05',
  '2030-12-31',
];

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    throw new Error(`Invalid date format: ${dateString}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function expectedEntry(dateString) {
  const parts = parseDateString(dateString);
  const solar = Solar.fromYmdHms(parts.year, parts.month, parts.day, 12, 0, 0);
  const lunar = solar.getLunar();

  return {
    date: dateString,
    yearGanZhi: lunar.getYearInGanZhi(),
    monthGanZhi: lunar.getMonthInGanZhi(),
    dayGanZhi: lunar.getDayInGanZhi(),
    ganZhiLabel: `${lunar.getYearInGanZhi()}年${lunar.getMonthInGanZhi()}月${lunar.getDayInGanZhi()}日`,
    lunar: lunar.toString(),
    lunarMonth: `${lunar.getMonthInChinese()}月`,
    lunarDay: lunar.getDayInChinese(),
    jieQi: lunar.getJieQi() || null,
  };
}

function dayDiff(a, b) {
  const timeA = Date.UTC(a.year, a.month - 1, a.day);
  const timeB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((timeB - timeA) / (24 * 60 * 60 * 1000));
}

function main() {
  if (!fs.existsSync(FILE_PATH)) {
    throw new Error(`Calendar file not found: ${FILE_PATH}`);
  }

  const payload = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  const items = payload.items || [];
  const errors = [];

  if (payload.range?.totalDays !== items.length) {
    errors.push(`range.totalDays=${payload.range?.totalDays} but actual items=${items.length}`);
  }

  for (let i = 1; i < items.length; i += 1) {
    const prev = parseDateString(items[i - 1].date);
    const curr = parseDateString(items[i].date);
    if (dayDiff(prev, curr) !== 1) {
      errors.push(`Date continuity broken: ${items[i - 1].date} -> ${items[i].date}`);
      break;
    }
  }

  const edgeChecks = EDGE_DATES.map((date) => {
    const actual = items.find((item) => item.date === date);
    const expected = expectedEntry(date);

    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    if (!matches) {
      errors.push(`Mismatch on ${date}`);
    }

    return {
      date,
      matches,
      actual: actual ? {
        ganZhiLabel: actual.ganZhiLabel,
        lunar: actual.lunar,
        jieQi: actual.jieQi,
      } : null,
    };
  });

  const jieQiEntries = items.filter((item) => item.jieQi);

  console.log(
    JSON.stringify(
      {
        file: FILE_PATH,
        totalDays: items.length,
        jieQiCount: jieQiEntries.length,
        firstJieQi: jieQiEntries.slice(0, 5).map((item) => ({
          date: item.date,
          jieQi: item.jieQi,
          monthGanZhi: item.monthGanZhi,
        })),
        edgeChecks,
        errors,
      },
      null,
      2,
    ),
  );

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
