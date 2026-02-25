/**
 * 测试八字计算算法
 * 运行：node --loader ts-node/esm test-bazi-algorithm.js
 * 或：npx tsx test-bazi-algorithm.ts
 */

const {
  calculateYearPillar,
  calculateMonthPillar,
  calculateDayPillar,
  calculateHourPillar,
  calculateWuxing,
} = require('./src/utils/baziCalculator.ts');

console.log('🧮 测试八字计算算法\n');
console.log('================================\n');

// 测试用例1: 1990年3月15日 10:30
console.log('📅 测试用例 1: 1990年3月15日 10:30\n');

const year = 1990;
const month = 3;
const day = 15;
const hour = 10;

const yearPillar = calculateYearPillar(year, month, day);
const monthPillar = calculateMonthPillar(year, month, day);
const dayPillar = calculateDayPillar(year, month, day);
const hourPillar = calculateHourPillar(year, month, day, hour);

console.log(`年柱: ${yearPillar.stem}${yearPillar.branch}`);
console.log(`月柱: ${monthPillar.stem}${monthPillar.branch}`);
console.log(`日柱: ${dayPillar.stem}${dayPillar.branch}`);
console.log(`时柱: ${hourPillar.stem}${hourPillar.branch}`);

const wuxing = calculateWuxing({
  yearStem: yearPillar.stem,
  yearBranch: yearPillar.branch,
  monthStem: monthPillar.stem,
  monthBranch: monthPillar.branch,
  dayStem: dayPillar.stem,
  dayBranch: dayPillar.branch,
  hourStem: hourPillar.stem,
  hourBranch: hourPillar.branch,
});

console.log('\n五行分布:');
console.log(`  金: ${wuxing.metal}`);
console.log(`  木: ${wuxing.wood}`);
console.log(`  水: ${wuxing.water}`);
console.log(`  火: ${wuxing.fire}`);
console.log(`  土: ${wuxing.earth}`);
console.log(`  旺: ${wuxing.dominant}`);
console.log(`  缺: ${wuxing.lacking.join('、') || '无'}`);

console.log('\n八字完整: ' +
  `${yearPillar.stem}${yearPillar.branch}年 ` +
  `${monthPillar.stem}${monthPillar.branch}月 ` +
  `${dayPillar.stem}${dayPillar.branch}日 ` +
  `${hourPillar.stem}${hourPillar.branch}时`);

// 测试用例2: 2000年1月1日 00:00 (跨年测试)
console.log('\n\n================================\n');
console.log('📅 测试用例 2: 2000年1月1日 00:00 (测试年柱跨年)\n');

const year2 = 2000;
const month2 = 1;
const day2 = 1;
const hour2 = 0;

const yearPillar2 = calculateYearPillar(year2, month2, day2);
const monthPillar2 = calculateMonthPillar(year2, month2, day2);
const dayPillar2 = calculateDayPillar(year2, month2, day2);
const hourPillar2 = calculateHourPillar(year2, month2, day2, hour2);

console.log(`年柱: ${yearPillar2.stem}${yearPillar2.branch} (应为己卯年,因为未到立春)`);
console.log(`月柱: ${monthPillar2.stem}${monthPillar2.branch}`);
console.log(`日柱: ${dayPillar2.stem}${dayPillar2.branch}`);
console.log(`时柱: ${hourPillar2.stem}${hourPillar2.branch}`);

console.log('\n✅ 算法测试完成！');
