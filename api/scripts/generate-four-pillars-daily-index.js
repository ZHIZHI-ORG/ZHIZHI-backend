const fs = require('fs');
const path = require('path');
const {
  CALENDAR_TIMEZONE,
  buildEightChar,
  compareDateParts,
  formatDate,
  nextDate,
  parseArgs,
  parseDateString,
} = require('./ganzhi-index-utils');

const DEFAULT_START = '1900-01-01';
const DEFAULT_END = '2030-12-31';
const DEFAULT_OUTPUT = path.resolve(__dirname, '../generated/four-pillars-daily-index-1900-2030.json');
const DEFAULT_SECT = 1;

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const GANZHI = Array.from({ length: 60 }, (_, index) => `${STEMS[index % 10]}${BRANCHES[index % 12]}`);

function dateNumber(parts) {
  return parts.year * 10000 + parts.month * 100 + parts.day;
}

function ganzhiIndex(value) {
  const index = GANZHI.indexOf(value);
  if (index === -1) {
    throw new Error(`Unsupported Ganzhi value: ${value}`);
  }
  return index;
}

function generateDailyIndex(start, end, sect) {
  const items = [];
  let cursor = start;

  while (compareDateParts(cursor, end) <= 0) {
    const eightChar = buildEightChar(cursor, 12, 0, sect);
    items.push([
      dateNumber(cursor),
      ganzhiIndex(eightChar.yearGanZhi),
      ganzhiIndex(eightChar.monthGanZhi),
      ganzhiIndex(eightChar.dayGanZhi),
    ]);
    cursor = nextDate(cursor);
  }

  return items;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    start: DEFAULT_START,
    end: DEFAULT_END,
    output: DEFAULT_OUTPUT,
    sect: String(DEFAULT_SECT),
  });

  const startDate = parseDateString(args.start);
  const endDate = parseDateString(args.end);
  const output = path.resolve(process.cwd(), args.output);
  const sect = Number(args.sect || DEFAULT_SECT);

  if (compareDateParts(startDate, endDate) > 0) {
    throw new Error(`Start date ${args.start} must be before end date ${args.end}.`);
  }
  if (![1, 2].includes(sect)) {
    throw new Error(`Unsupported sect: ${args.sect}. Expected 1 or 2.`);
  }

  const items = generateDailyIndex(startDate, endDate, sect);
  const payload = {
    version: '1.0.0',
    type: 'four-pillars-daily-index',
    timezone: CALENDAR_TIMEZONE,
    sect,
    ganzhiCycleStart: '甲子',
    tupleSchema: ['date_yyyymmdd', 'year_ganzhi_index', 'month_ganzhi_index', 'day_ganzhi_index'],
    generatedAt: new Date().toISOString(),
    range: {
      start: args.start,
      end: args.end,
      totalDays: items.length,
    },
    items,
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(payload) + '\n', 'utf8');

  console.log(
    JSON.stringify(
      {
        output,
        range: payload.range,
        itemCount: payload.items.length,
        firstDate: formatDate(startDate),
        lastDate: formatDate(endDate),
      },
      null,
      2,
    ),
  );
}

main();
