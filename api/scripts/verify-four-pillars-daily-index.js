const fs = require('fs');
const path = require('path');
const {
  buildEightChar,
  parseArgs,
} = require('./ganzhi-index-utils');

const DEFAULT_FILE = path.resolve(__dirname, '../generated/four-pillars-daily-index-1900-2030.json');

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const GANZHI = Array.from({ length: 60 }, (_, index) => `${STEMS[index % 10]}${BRANCHES[index % 12]}`);

function parseDateNumber(value) {
  return {
    year: Math.floor(value / 10000),
    month: Math.floor((value % 10000) / 100),
    day: value % 100,
  };
}

function hourStem(dayStem, hourBranch) {
  const startStemByDayStem = {
    甲: 0,
    己: 0,
    乙: 2,
    庚: 2,
    丙: 4,
    辛: 4,
    丁: 6,
    壬: 6,
    戊: 8,
    癸: 8,
  };
  return STEMS[(startStemByDayStem[dayStem] + BRANCHES.indexOf(hourBranch)) % STEMS.length];
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    file: DEFAULT_FILE,
    sampleLimit: '500',
  });
  const file = path.resolve(process.cwd(), args.file);
  const sampleLimit = Number(args.sampleLimit || 500);

  if (!fs.existsSync(file)) {
    throw new Error(`Four-pillars daily index file not found: ${file}`);
  }

  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = payload.items || [];
  const errors = [];

  for (const tuple of items.slice(0, sampleLimit)) {
    const [dateValue, yearIndex, monthIndex, dayIndex] = tuple;
    const parts = parseDateNumber(dateValue);
    const eightChar = buildEightChar(parts, 12, 0, payload.sect || 1);

    if (GANZHI[yearIndex] !== eightChar.yearGanZhi) {
      errors.push(`Year mismatch for ${dateValue}: ${GANZHI[yearIndex]} vs ${eightChar.yearGanZhi}`);
    }
    if (GANZHI[monthIndex] !== eightChar.monthGanZhi) {
      errors.push(`Month mismatch for ${dateValue}: ${GANZHI[monthIndex]} vs ${eightChar.monthGanZhi}`);
    }
    if (GANZHI[dayIndex] !== eightChar.dayGanZhi) {
      errors.push(`Day mismatch for ${dateValue}: ${GANZHI[dayIndex]} vs ${eightChar.dayGanZhi}`);
    }
  }

  const known = items.filter((tuple) => {
    const [, yearIndex, monthIndex, dayIndex] = tuple;
    const dayGanZhi = GANZHI[dayIndex];
    return GANZHI[yearIndex] === '乙亥' &&
      GANZHI[monthIndex] === '丙戌' &&
      dayGanZhi === '庚子' &&
      hourStem(dayGanZhi[0], '亥') === '丁';
  });

  console.log(
    JSON.stringify(
      {
        file,
        itemCount: items.length,
        checked: Math.min(sampleLimit, items.length),
        knownKey: '乙亥丙戌庚子丁亥',
        knownDates: known.slice(0, 10).map((tuple) => tuple[0]),
        errors,
      },
      null,
      2,
    ),
  );

  if (!known.some((tuple) => tuple[0] === 19951105)) {
    errors.push('Known date 19951105 missing for 乙亥丙戌庚子丁亥.');
  }
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main();
