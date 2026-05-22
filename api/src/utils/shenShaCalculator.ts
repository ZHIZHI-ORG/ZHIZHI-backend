/**
 * 八字命盘神煞计算器
 *
 * 设计参考：
 *   - china-testing/bazi 的 datas.py + bazi.py
 *
 * 严格对齐开源实现的四类分组：
 *   - g_shens     : 按日主天干查，匹配四柱地支
 *   - year_shens  : 按年支查，匹配其他柱地支
 *   - day_shens   : 按日支查，匹配其他柱地支
 *   - month_shens : 按月支查，匹配四柱天干或地支
 */

// ============================================================
// 类型定义
// ============================================================

/** 四柱结构 */
export interface FourPillars {
  yearGan: string;   // 年干
  yearZhi: string;   // 年支
  monthGan: string;  // 月干
  monthZhi: string;  // 月支
  dayGan: string;    // 日干（日主）
  dayZhi: string;    // 日支
  timeGan: string;   // 时干
  timeZhi: string;   // 时支
}

/** 按柱位分组的神煞结果 */
export interface ShenShaResult {
  year: string[];   // 年柱神煞
  month: string[];  // 月柱神煞
  day: string[];    // 日柱神煞
  time: string[];   // 时柱神煞
}

// ============================================================
// 基础数据
// ============================================================

/** 十天干 */
const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];

/** 十二地支 */
const ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

// ============================================================
// 神煞查表数据
// ============================================================

/**
 * g_shens：按日主天干查，结果分配到四柱地支
 *
 * 格式：{ 神煞名: { 日干: [匹配地支列表] } }
 */
const G_SHENS: Record<string, Record<string, string[]>> = {

  /**
   * 天乙贵人
   * 口诀：甲戊庚牛羊，乙己鼠猴乡，丙丁猪鸡位，壬癸兔蛇藏，六辛逢马虎，此是贵人方
   */
  '天乙贵人': {
    '甲': ['丑','未'], '戊': ['丑','未'], '庚': ['丑','未'],
    '乙': ['子','申'], '己': ['子','申'],
    '丙': ['亥','酉'], '丁': ['亥','酉'],
    '壬': ['卯','巳'], '癸': ['卯','巳'],
    '辛': ['午','寅'],
  },

  /**
   * 文昌贵人
   * 严格对齐 china-testing/bazi/datas.py
   */
  '文昌贵人': {
    '甲': ['巳'], '乙': ['午'],
    '丙': ['申'], '丁': ['酉'],
    '戊': ['申'], '己': ['酉'],
    '庚': ['亥'], '辛': ['子'],
    '壬': ['寅'], '癸': ['丑'],
  },

  /**
   * 阳刃
   * 参考 china-testing/bazi/datas.py
   */
  '阳刃': {
    '甲': ['卯'], '乙': [],
    '丙': ['午'], '丁': [],
    '戊': ['午'], '己': [],
    '庚': ['酉'], '辛': [],
    '壬': ['子'], '癸': [],
  },

  /**
   * 红艳煞
   * 严格对齐 china-testing/bazi/datas.py
   */
  '红艳': {
    '甲': ['午'], '乙': ['午'],
    '丙': ['寅'], '丁': ['未'],
    '戊': ['辰'], '己': ['辰'],
    '庚': ['戌'], '辛': ['酉'],
    '壬': ['子'], '癸': ['申'],
  },
};

/**
 * year_shens：按年支查，结果分配到月/日/时柱地支
 *
 * 按开源实现，这一层只放以年支为基准的神煞。
 */
const YEAR_SHENS: Record<string, Record<string, string[]>> = {
  /**
   * 孤辰
   * 口诀：寅卯辰孤在巳，巳午未孤在申，申酉戌孤在亥，亥子丑孤在寅
   */
  '孤辰': {
    '寅': ['巳'], '卯': ['巳'], '辰': ['巳'],
    '巳': ['申'], '午': ['申'], '未': ['申'],
    '申': ['亥'], '酉': ['亥'], '戌': ['亥'],
    '亥': ['寅'], '子': ['寅'], '丑': ['寅'],
  },

  /**
   * 寡宿
   * 口诀：寅卯辰寡在丑，巳午未寡在辰，申酉戌寡在未，亥子丑寡在戌
   */
  '寡宿': {
    '寅': ['丑'], '卯': ['丑'], '辰': ['丑'],
    '巳': ['辰'], '午': ['辰'], '未': ['辰'],
    '申': ['未'], '酉': ['未'], '戌': ['未'],
    '亥': ['戌'], '子': ['戌'], '丑': ['戌'],
  },

  /**
   * 大耗
   * 按当前 repo 与常见术数整理的复合口径，保留双支写法。
   * 例如子年取巳、未；当前产品不再拆分为“大耗 / 岁墓”等独立标签。
   */
  '大耗': {
    '子': ['巳', '未'], '丑': ['午', '申'],
    '寅': ['未', '酉'], '卯': ['申', '戌'],
    '辰': ['酉', '亥'], '巳': ['戌', '子'],
    '午': ['亥', '丑'], '未': ['子', '寅'],
    '申': ['丑', '卯'], '酉': ['寅', '辰'],
    '戌': ['卯', '巳'], '亥': ['辰', '午'],
  },

};

/**
 * day_shens：按日支查，结果分配到年/月/时柱地支
 *
 * 按开源实现，桃花/驿马/亡神/劫煞/华盖/将星都应落在这一层。
 */
const DAY_SHENS: Record<string, Record<string, string[]>> = {

  '将星': {
    '子': ['子'], '丑': ['酉'], '寅': ['午'], '卯': ['卯'],
    '辰': ['子'], '巳': ['酉'], '午': ['午'], '未': ['卯'],
    '申': ['子'], '酉': ['酉'], '戌': ['午'], '亥': ['卯'],
  },

  '华盖': {
    '子': ['辰'], '丑': ['丑'], '寅': ['戌'], '卯': ['未'],
    '辰': ['辰'], '巳': ['丑'], '午': ['戌'], '未': ['未'],
    '申': ['辰'], '酉': ['丑'], '戌': ['戌'], '亥': ['未'],
  },

  '驿马': {
    '子': ['寅'], '丑': ['亥'], '寅': ['申'], '卯': ['巳'],
    '辰': ['寅'], '巳': ['亥'], '午': ['申'], '未': ['巳'],
    '申': ['寅'], '酉': ['亥'], '戌': ['申'], '亥': ['巳'],
  },

  '劫煞': {
    '子': ['巳'], '丑': ['寅'], '寅': ['亥'], '卯': ['申'],
    '辰': ['巳'], '巳': ['寅'], '午': ['亥'], '未': ['申'],
    '申': ['巳'], '酉': ['寅'], '戌': ['亥'], '亥': ['申'],
  },

  '亡神': {
    '子': ['亥'], '丑': ['申'], '寅': ['巳'], '卯': ['寅'],
    '辰': ['亥'], '巳': ['申'], '午': ['巳'], '未': ['寅'],
    '申': ['亥'], '酉': ['申'], '戌': ['巳'], '亥': ['寅'],
  },

  '桃花': {
    '子': ['酉'], '丑': ['午'], '寅': ['卯'], '卯': ['子'],
    '辰': ['酉'], '巳': ['午'], '午': ['卯'], '未': ['子'],
    '申': ['酉'], '酉': ['午'], '戌': ['卯'], '亥': ['子'],
  },

};

/**
 * month_shens：按月支查，结果分配到四柱天干或地支
 */
const MONTH_SHENS: Record<string, Record<string, string[]>> = {
  '天德': {
    '子': ['巳'], '丑': ['庚'], '寅': ['丁'], '卯': ['申'],
    '辰': ['壬'], '巳': ['辛'], '午': ['亥'], '未': ['甲'],
    '申': ['癸'], '酉': ['寅'], '戌': ['丙'], '亥': ['乙'],
  },
  '月德': {
    '子': ['壬'], '丑': ['庚'], '寅': ['丙'], '卯': ['甲'],
    '辰': ['壬'], '巳': ['庚'], '午': ['丙'], '未': ['甲'],
    '申': ['壬'], '酉': ['庚'], '戌': ['丙'], '亥': ['甲'],
  },
};

// ============================================================
// 核心计算函数
// ============================================================

/**
 * 计算八字命盘神煞，按柱位分组返回
 *
 * 逻辑参考 bazi.py 的 get_shens / 神煞计算部分：
 *   1. 遍历 g_shens，用日主天干查，四柱地支依次匹配
 *   2. 遍历 year_shens，用年支查，月/日/时柱地支匹配
 *   3. 遍历 day_shens，用日支查，年/月/时柱地支匹配
 *   4. 遍历 month_shens，用月支查，四柱匹配
 *
 * @param pillars - 四柱天干地支
 * @returns 按柱位分组的神煞列表
 */
export function calculateShenSha(pillars: FourPillars): ShenShaResult {
  const result: ShenShaResult = {
    year: [],
    month: [],
    day: [],
    time: [],
  };

  const { yearGan, yearZhi, monthGan, monthZhi, dayGan, dayZhi, timeGan, timeZhi } = pillars;

  // 四柱地支数组，方便遍历
  const zhis = [yearZhi, monthZhi, dayZhi, timeZhi];
  const pillarKeys: (keyof ShenShaResult)[] = ['year', 'month', 'day', 'time'];

  // ── 1. g_shens：按日主天干查，匹配四柱地支 ──────────────────
  for (const [shenName, ganMap] of Object.entries(G_SHENS)) {
    const matchZhis = ganMap[dayGan] || [];
    zhis.forEach((zhi, i) => {
      if (matchZhis.includes(zhi)) {
        result[pillarKeys[i]].push(shenName);
      }
    });
  }

  // ── 2. year_shens：按年支查，匹配月/日/时柱地支 ─────────────
  // 注意：年柱本身不参与匹配（神煞挂在被命中的柱上）
  for (const [shenName, zhiMap] of Object.entries(YEAR_SHENS)) {
    const matchZhis = zhiMap[yearZhi] || [];
    // 从月柱（index=1）开始匹配
    [monthZhi, dayZhi, timeZhi].forEach((zhi, i) => {
      if (matchZhis.includes(zhi)) {
        result[pillarKeys[i + 1]].push(shenName);
      }
    });
  }

  // ── 3. day_shens：按日支查，匹配年/月/时柱地支 ──────────────
  // 注意：日柱本身不参与匹配
  for (const [shenName, zhiMap] of Object.entries(DAY_SHENS)) {
    const matchZhis = zhiMap[dayZhi] || [];
    // 年/月/时柱（index 0,1,3）
    [yearZhi, monthZhi, timeZhi].forEach((zhi, i) => {
      if (matchZhis.includes(zhi)) {
        const pillar = i === 0 ? 'year' : i === 1 ? 'month' : 'time';
        result[pillar].push(shenName);
      }
    });
  }

  // ── 4. month_shens：按月支查，匹配四柱 ──────────────────────
  for (const [shenName, zhiMap] of Object.entries(MONTH_SHENS)) {
    const matchList = zhiMap[monthZhi] || [];
    zhis.forEach((zhi, i) => {
      if (matchList.includes(zhi)) {
        result[pillarKeys[i]].push(shenName);
      }
    });
    // 也匹配天干
    [yearGan, monthGan, dayGan, timeGan].forEach((gan, i) => {
      if (matchList.includes(gan)) {
        result[pillarKeys[i]].push(shenName);
      }
    });
  }

  // 去重（同一柱可能被多条规则命中）
  result.year = [...new Set(result.year)];
  result.month = [...new Set(result.month)];
  result.day = [...new Set(result.day)];
  result.time = [...new Set(result.time)];

  return result;
}
