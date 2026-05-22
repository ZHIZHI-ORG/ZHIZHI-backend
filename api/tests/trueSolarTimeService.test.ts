import assert from 'assert';
import { normalizeBirthTimeForBazi } from '../src/services/trueSolarTimeService';

function testUrumqiCrossesPreviousDay() {
  const result = normalizeBirthTimeForBazi({
    year: 1995,
    month: 11,
    day: 5,
    hour: 0,
    minute: 10,
    timezone: 'Asia/Shanghai',
    latitude: 43.8256,
    longitude: 87.6168,
  });

  assert.strictEqual(result.timeBasis, 'true_solar_time');
  assert.strictEqual(result.corrected.year, 1995);
  assert.strictEqual(result.corrected.month, 11);
  assert.strictEqual(result.corrected.day, 4);
  assert.strictEqual(result.crossedDayBoundary, true);
  assert(result.correctionMinutes < -100);
}

function testBeijingStaysSameHourAroundNoon() {
  const result = normalizeBirthTimeForBazi({
    year: 1995,
    month: 11,
    day: 5,
    hour: 12,
    minute: 0,
    timezone: 'Asia/Shanghai',
    latitude: 39.9042,
    longitude: 116.4074,
  });

  assert.strictEqual(result.timeBasis, 'true_solar_time');
  assert.strictEqual(result.corrected.day, 5);
  assert(Math.abs(result.correctionMinutes) <= 15);
  assert.strictEqual(result.crossedDayBoundary, false);
}

function testFallsBackToStandardTimeWithoutCoordinates() {
  const result = normalizeBirthTimeForBazi({
    year: 1995,
    month: 11,
    day: 5,
    hour: 22,
    minute: 30,
    timezone: 'Asia/Shanghai',
  });

  assert.strictEqual(result.timeBasis, 'standard_time');
  assert.deepStrictEqual(result.corrected, {
    year: 1995,
    month: 11,
    day: 5,
    hour: 22,
    minute: 30,
  });
  assert.strictEqual(result.correctionMinutes, 0);
}

testUrumqiCrossesPreviousDay();
testBeijingStaysSameHourAroundNoon();
testFallsBackToStandardTimeWithoutCoordinates();

console.log('trueSolarTimeService.test.ts passed');
