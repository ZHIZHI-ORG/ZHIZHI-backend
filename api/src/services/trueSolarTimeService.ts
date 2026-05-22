/**
 * 真太阳时标准化服务
 *
 * 数据流：
 *   前端出生地经纬度 + 出生地钟表时间
 *        ↓
 *   经度修正 + 均时差修正
 *        ↓
 *   校准后的年月日时分
 *        ↓
 *   交给 lunar-javascript 排盘
 *
 * 说明：
 *   经度决定当地太阳过中天的早晚；均时差修正地球椭圆轨道造成的太阳时偏差。
 *   纬度当前不参与真太阳时分钟修正，但作为地点事实保存，便于校验和后续扩展。
 */

export interface BirthTimeForSolarCorrection {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
  longitude?: number;
  latitude?: number;
}

export interface NormalizedBirthTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface TrueSolarTimeResult {
  timeBasis: 'standard_time' | 'true_solar_time';
  original: NormalizedBirthTime & { timezone: string };
  corrected: NormalizedBirthTime;
  longitude?: number;
  latitude?: number;
  timezone: string;
  timezoneOffsetHours: number;
  standardMeridian: number;
  equationOfTimeMinutes: number;
  longitudeCorrectionMinutes: number;
  correctionMinutes: number;
  crossedHourBoundary: boolean;
  crossedDayBoundary: boolean;
}

export function normalizeBirthTimeForBazi(input: BirthTimeForSolarCorrection): TrueSolarTimeResult {
  const timezone = input.timezone || 'Asia/Shanghai';
  const original: NormalizedBirthTime & { timezone: string } = {
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour,
    minute: input.minute,
    timezone,
  };

  if (input.longitude === undefined || input.latitude === undefined) {
    return {
      timeBasis: 'standard_time',
      original,
      corrected: {
        year: input.year,
        month: input.month,
        day: input.day,
        hour: input.hour,
        minute: input.minute,
      },
      timezone,
      timezoneOffsetHours: getTimezoneOffsetHours(timezone, input.year, input.month, input.day),
      standardMeridian: getTimezoneOffsetHours(timezone, input.year, input.month, input.day) * 15,
      equationOfTimeMinutes: 0,
      longitudeCorrectionMinutes: 0,
      correctionMinutes: 0,
      crossedHourBoundary: false,
      crossedDayBoundary: false,
    };
  }

  const timezoneOffsetHours = getTimezoneOffsetHours(timezone, input.year, input.month, input.day);
  const standardMeridian = timezoneOffsetHours * 15;
  const equationOfTimeMinutes = calculateEquationOfTimeMinutes(input.year, input.month, input.day);
  const longitudeCorrectionMinutes = 4 * (input.longitude - standardMeridian);
  const correctionMinutes = Math.round(equationOfTimeMinutes + longitudeCorrectionMinutes);
  const corrected = addMinutesToLocalBirthTime(input, correctionMinutes);

  return {
    timeBasis: 'true_solar_time',
    original,
    corrected,
    longitude: input.longitude,
    latitude: input.latitude,
    timezone,
    timezoneOffsetHours,
    standardMeridian,
    equationOfTimeMinutes: roundToTwo(equationOfTimeMinutes),
    longitudeCorrectionMinutes: roundToTwo(longitudeCorrectionMinutes),
    correctionMinutes,
    crossedHourBoundary: corrected.hour !== input.hour || corrected.day !== input.day,
    crossedDayBoundary: corrected.year !== input.year || corrected.month !== input.month || corrected.day !== input.day,
  };
}

/**
 * NOAA 常用近似公式：返回均时差分钟数。
 * 对八字时柱边界判断已经足够，误差远小于用户出生时间记录误差。
 */
export function calculateEquationOfTimeMinutes(year: number, month: number, day: number): number {
  const date = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(Date.UTC(year, 0, 1));
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
  const gamma = (2 * Math.PI / (isLeapYear(year) ? 366 : 365)) * (dayOfYear - 1);

  return 229.18 * (
    0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );
}

function addMinutesToLocalBirthTime(input: BirthTimeForSolarCorrection, minutes: number): NormalizedBirthTime {
  const utcDate = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0));
  utcDate.setUTCMinutes(utcDate.getUTCMinutes() + minutes);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
    hour: utcDate.getUTCHours(),
    minute: utcDate.getUTCMinutes(),
  };
}

function getTimezoneOffsetHours(timezone: string, year: number, month: number, day: number): number {
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  });
  const timeZonePart = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
  const match = timeZonePart?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    return 8;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * (hours + minutes / 60);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}
