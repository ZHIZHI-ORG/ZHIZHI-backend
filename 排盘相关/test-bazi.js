// 八字排盘测试脚本
// 使用代码中的核心逻辑计算八字排盘

const { Solar, Lunar, LunarUtil, EightChar } = require('lunar-javascript');

// 配置信息（从代码中提取）
const CHANG_SHENG_OFFSET = {甲:1,丙:10,戊:10,庚:7,壬:4,乙:6,丁:9,己:9,辛:0,癸:3};
const SHI_SHEN_ZHI = {
  甲子:"正印",甲丑:"正财",甲寅:"比肩",甲卯:"劫财",甲辰:"偏财",甲巳:"食神",甲午:"伤官",甲未:"正财",甲申:"七杀",甲酉:"正官",甲戌:"偏财",甲亥:"偏印",
  乙子:"偏印",乙丑:"偏财",乙寅:"劫财",乙卯:"比肩",乙辰:"正财",乙巳:"伤官",乙午:"食神",乙未:"偏财",乙申:"正官",乙酉:"七杀",乙戌:"正财",乙亥:"正印",
  丙子:"正官",丙丑:"伤官",丙寅:"偏印",丙卯:"正印",丙辰:"食神",丙巳:"比肩",丙午:"劫财",丙未:"伤官",丙申:"偏财",丙酉:"正财",丙戌:"食神",丙亥:"七杀",
  丁子:"七杀",丁丑:"食神",丁寅:"正印",丁卯:"偏印",丁辰:"伤官",丁巳:"劫财",丁午:"比肩",丁未:"食神",丁申:"正财",丁酉:"偏财",丁戌:"伤官",丁亥:"正官",
  戊子:"正财",戊丑:"劫财",戊寅:"七杀",戊卯:"正官",戊辰:"比肩",戊巳:"偏印",戊午:"正印",戊未:"劫财",戊申:"食神",戊酉:"伤官",戊戌:"比肩",戊亥:"偏财",
  己子:"偏财",己丑:"比肩",己寅:"正官",己卯:"七杀",己辰:"劫财",己巳:"正印",己午:"偏印",己未:"比肩",己申:"伤官",己酉:"食神",己戌:"劫财",己亥:"正财",
  庚子:"伤官",庚丑:"正印",庚寅:"偏财",庚卯:"正财",庚辰:"偏印",庚巳:"七杀",庚午:"正官",庚未:"正印",庚申:"比肩",庚酉:"劫财",庚戌:"偏印",庚亥:"食神",
  辛子:"食神",辛丑:"偏印",辛寅:"正财",辛卯:"偏财",辛辰:"正印",辛巳:"正官",辛午:"七杀",辛未:"偏印",辛申:"劫财",辛酉:"比肩",辛戌:"正印",辛亥:"伤官",
  壬子:"劫财",壬丑:"正官",壬寅:"食神",壬卯:"伤官",壬辰:"七杀",壬巳:"偏财",壬午:"正财",壬未:"正官",壬申:"偏印",壬酉:"正印",壬戌:"七杀",壬亥:"比肩",
  癸子:"比肩",癸丑:"七杀",癸寅:"伤官",癸卯:"食神",癸辰:"正官",癸巳:"正财",癸午:"偏财",癸未:"七杀",癸申:"正印",癸酉:"偏印",癸戌:"正官",癸亥:"劫财"
};
const SHI_SHEN_SIMPLIFIE = {正印:"印",正官:"官",劫财:"劫",伤官:"伤",正财:"财",七杀:"杀",偏印:"枭",比肩:"比",食神:"食",偏财:"才"};

// 获取十神关系
function getRelation(dayGan, label) {
  if (LunarUtil.GAN.includes(label)) {
    return LunarUtil.SHI_SHEN_GAN[dayGan + label];
  } else if (LunarUtil.ZHI.includes(label)) {
    return SHI_SHEN_ZHI[dayGan + label];
  }
  return "";
}

// 获取长生十二宫
function getChangSheng(top, topIndex, bottomIndex) {
  const offset = CHANG_SHENG_OFFSET[top];
  if (offset === undefined) return "";
  let index = offset + (topIndex % 2 === 0 ? bottomIndex : -bottomIndex);
  if (index >= 12) {
    index -= 12;
  }
  if (index < 0) {
    index += 12;
  }
  return EightChar.CHANG_SHENG[index];
}

// 主函数：计算八字排盘
function calculateBazi(birthDateTime, gender, sect = 1) {
  // 1. 转换为Solar对象
  const solar = Solar.fromDate(new Date(birthDateTime));
  console.log('公历日期:', solar.toYmdHms());
  
  // 2. 转换为农历
  const lunar = solar.getLunar();
  console.log('农历日期:', lunar.toString());
  
  // 3. 获取八字
  const bazi = lunar.getEightChar();
  
  // 4. 获取四柱天干地支
  const pillars = {
    year: {
      gan: bazi.getYearGan(),
      zhi: bazi.getYearZhi(),
      ganIndex: LunarUtil.GAN.indexOf(bazi.getYearGan()),
      zhiIndex: LunarUtil.ZHI.indexOf(bazi.getYearZhi())
    },
    month: {
      gan: bazi.getMonthGan(),
      zhi: bazi.getMonthZhi(),
      ganIndex: LunarUtil.GAN.indexOf(bazi.getMonthGan()),
      zhiIndex: LunarUtil.ZHI.indexOf(bazi.getMonthZhi())
    },
    day: {
      gan: bazi.getDayGan(),
      zhi: bazi.getDayZhi(),
      ganIndex: bazi.getDayGanIndex(),
      zhiIndex: bazi.getDayZhiIndex()
    },
    time: {
      gan: bazi.getTimeGan(),
      zhi: bazi.getTimeZhi(),
      ganIndex: LunarUtil.GAN.indexOf(bazi.getTimeGan()),
      zhiIndex: LunarUtil.ZHI.indexOf(bazi.getTimeZhi())
    }
  };
  
  const dayGan = pillars.day.gan;
  
  console.log('\n========== 八字排盘 ==========');
  console.log('年柱:', pillars.year.gan + pillars.year.zhi);
  console.log('月柱:', pillars.month.gan + pillars.month.zhi);
  console.log('日柱:', pillars.day.gan + pillars.day.zhi);
  console.log('时柱:', pillars.time.gan + pillars.time.zhi);
  
  // 5. 计算藏干
  console.log('\n========== 藏干信息 ==========');
  const hideGan = {};
  for (const [key, pillar] of Object.entries(pillars)) {
    const zhiHideGan = LunarUtil.ZHI_HIDE_GAN[pillar.zhi] || [];
    hideGan[key] = zhiHideGan;
    console.log(`${key}柱(${pillar.zhi})藏干:`, zhiHideGan.join(' '));
  }
  
  // 6. 计算十神（主星）
  console.log('\n========== 十神（主星） ==========');
  const shishen = {};
  for (const [key, pillar] of Object.entries(pillars)) {
    const ganRelation = getRelation(dayGan, pillar.gan);
    const zhiRelation = getRelation(dayGan, pillar.zhi);
    shishen[key] = {
      gan: ganRelation,
      zhi: zhiRelation
    };
    console.log(`${key}柱:`, `${pillar.gan}(${SHI_SHEN_SIMPLIFIE[ganRelation] || ganRelation}) ${pillar.zhi}(${SHI_SHEN_SIMPLIFIE[zhiRelation] || zhiRelation})`);
  }
  
  // 7. 计算藏干十神
  console.log('\n========== 藏干十神 ==========');
  for (const [key, hideGans] of Object.entries(hideGan)) {
    if (hideGans.length > 0) {
      const relations = hideGans.map(gan => {
        const relation = getRelation(dayGan, gan);
        return `${gan}${SHI_SHEN_SIMPLIFIE[relation] || relation}`;
      });
      console.log(`${key}柱藏干:`, relations.join(' '));
    }
  }
  
  // 8. 计算星运（长生十二宫）
  console.log('\n========== 星运（长生十二宫） ==========');
  const trend = {};
  for (const [key, pillar] of Object.entries(pillars)) {
    const changSheng = getChangSheng(dayGan, pillars.day.ganIndex, pillar.zhiIndex);
    trend[key] = changSheng;
    console.log(`${key}柱:`, changSheng);
  }
  
  // 9. 计算自坐
  console.log('\n========== 自坐 ==========');
  const selfsit = {};
  for (const [key, pillar] of Object.entries(pillars)) {
    const changSheng = getChangSheng(pillar.gan, pillar.ganIndex, pillar.zhiIndex);
    selfsit[key] = changSheng;
    console.log(`${key}柱:`, changSheng);
  }
  
  // 10. 计算空亡
  console.log('\n========== 空亡 ==========');
  const empty = {};
  for (const [key, pillar] of Object.entries(pillars)) {
    const ganZhi = pillar.gan + pillar.zhi;
    const xunIndex = LunarUtil.getXunIndex(ganZhi);
    const xunKong = LunarUtil.XUN_KONG[xunIndex] || '';
    empty[key] = xunKong;
    console.log(`${key}柱:`, xunKong);
  }
  
  // 11. 计算纳音
  console.log('\n========== 纳音 ==========');
  const nayin = {};
  for (const [key, pillar] of Object.entries(pillars)) {
    const ganZhi = pillar.gan + pillar.zhi;
    const nayinValue = LunarUtil.NAYIN[ganZhi] || '';
    nayin[key] = nayinValue;
    console.log(`${key}柱:`, nayinValue);
  }
  
  // 12. 计算大运
  console.log('\n========== 大运 ==========');
  const yun = bazi.getYun(gender, sect);
  const daYun = yun.getDaYun();
  if (daYun.length > 0) {
    console.log('起运年龄:', daYun[0].getStartAge(), '岁');
    console.log('起运时间:', yun.getStartSolar().toYmd());
  }
  
  const dayunList = [];
  for (let i = 0; i < Math.min(10, daYun.length); i++) {
    const item = daYun[i];
    const pillar = item.getGanZhi() || '童限';
    const startYear = item.getStartYear();
    const startAge = item.getStartAge();
    const endYear = item.getEndYear();
    const endAge = item.getEndAge();
    dayunList.push({
      pillar,
      startYear,
      endYear,
      startAge,
      endAge,
      shishen: pillar === '童限' ? '童限' : (getRelation(dayGan, pillar[0]) + ' ' + getRelation(dayGan, pillar[1]))
    });
    console.log(`大运${i+1}: ${pillar} (${startYear}-${endYear}年, ${startAge}-${endAge}岁)`);
  }
  
  // 13. 计算流年（当前大运的流年）
  if (daYun.length > 0) {
    console.log('\n========== 流年（当前大运） ==========');
    const currentDaYun = daYun[0];
    const liuNian = currentDaYun.getLiuNian();
    console.log('当前大运:', currentDaYun.getGanZhi());
    for (let i = 0; i < Math.min(5, liuNian.length); i++) {
      const item = liuNian[i];
      const pillar = item.getGanZhi();
      const year = item.getYear();
      const age = item.getAge();
      console.log(`流年${i+1}: ${pillar} (${year}年, ${age}岁)`);
    }
  }
  
  // 14. 计算流月（当前流年的流月）
  if (daYun.length > 0) {
    const currentDaYun = daYun[0];
    const liuNian = currentDaYun.getLiuNian();
    if (liuNian.length > 0) {
      console.log('\n========== 流月（当前流年） ==========');
      const currentLiuNian = liuNian[0];
      const liuYue = currentLiuNian.getLiuYue();
      const jieqi = currentLiuNian.getLunar().getJieQiTable();
      const map = ['立春', '惊蛰', '清明', '立夏', '芒种', '小暑', '立秋', '白露', '寒露', '立冬', '大雪', 'XIAO_HAN'];
      
      console.log('当前流年:', currentLiuNian.getGanZhi(), `(${currentLiuNian.getYear()}年)`);
      for (let i = 0; i < Math.min(6, liuYue.length); i++) {
        const item = liuYue[i];
        const pillar = item.getGanZhi();
        const jieqiName = i === 11 ? '小寒' : map[i];
        console.log(`流月${i+1}: ${pillar} (${jieqiName})`);
      }
    }
  }
  
  // 15. 神煞（使用lunar-javascript库计算，按四柱分组）
  console.log('\n========== 神煞信息 ==========');
  const gods = {
    year: [],
    month: [],
    day: [],
    time: []
  };
  
  try {
    // 年柱神煞
    console.log('年柱神煞:');
    const yearYangGuiDesc = lunar.getPositionYangGuiDesc();
    const yearYinGuiDesc = lunar.getPositionYinGuiDesc();
    if (yearYangGuiDesc) {
      const display = `天乙贵人(阳贵-${yearYangGuiDesc})`;
      console.log('  ' + display);
      gods.year.push(display);
    }
    if (yearYinGuiDesc) {
      const display = `天乙贵人(阴贵-${yearYinGuiDesc})`;
      console.log('  ' + display);
      gods.year.push(display);
    }
    const yearSha = lunar.getSha();
    if (yearSha) {
      const display = `年煞(${yearSha})`;
      console.log('  ' + display);
      gods.year.push(display);
    }
    
    // 月柱神煞（通常较少，这里可以添加月相关的神煞）
    console.log('月柱神煞:');
    // 月柱神煞通常需要特殊计算，这里暂时为空
    
    // 日柱神煞
    console.log('日柱神煞:');
    const dayYangGuiDesc = lunar.getDayPositionYangGuiDesc();
    const dayYinGuiDesc = lunar.getDayPositionYinGuiDesc();
    if (dayYangGuiDesc) {
      const display = `天乙贵人(阳贵-${dayYangGuiDesc})`;
      console.log('  ' + display);
      gods.day.push(display);
    }
    if (dayYinGuiDesc) {
      const display = `天乙贵人(阴贵-${dayYinGuiDesc})`;
      console.log('  ' + display);
      gods.day.push(display);
    }
    const daySha = lunar.getDaySha();
    if (daySha) {
      const display = `日煞(${daySha})`;
      console.log('  ' + display);
      gods.day.push(display);
    }
    const dayTianShen = lunar.getDayTianShen();
    const dayTianShenType = lunar.getDayTianShenType();
    const dayTianShenLuck = lunar.getDayTianShenLuck();
    if (dayTianShen) {
      const display = `${dayTianShen}(${dayTianShenType}-${dayTianShenLuck})`;
      console.log('  ' + display);
      gods.day.push(display);
    }
    const dayJiShen = lunar.getDayJiShen();
    if (dayJiShen && Array.isArray(dayJiShen) && dayJiShen.length > 0) {
      console.log('  吉神:', dayJiShen.join('、'));
      gods.day.push(...dayJiShen);
    }
    const dayXiongSha = lunar.getDayXiongSha();
    if (dayXiongSha && Array.isArray(dayXiongSha) && dayXiongSha.length > 0) {
      console.log('  凶煞:', dayXiongSha.join('、'));
      gods.day.push(...dayXiongSha);
    }
    
    // 时柱神煞
    console.log('时柱神煞:');
    const timeYangGuiDesc = lunar.getTimePositionYangGuiDesc();
    const timeYinGuiDesc = lunar.getTimePositionYinGuiDesc();
    if (timeYangGuiDesc) {
      const display = `天乙贵人(阳贵-${timeYangGuiDesc})`;
      console.log('  ' + display);
      gods.time.push(display);
    }
    if (timeYinGuiDesc) {
      const display = `天乙贵人(阴贵-${timeYinGuiDesc})`;
      console.log('  ' + display);
      gods.time.push(display);
    }
    const timeSha = lunar.getTimeSha();
    if (timeSha) {
      const display = `时煞(${timeSha})`;
      console.log('  ' + display);
      gods.time.push(display);
    }
    const timeTianShen = lunar.getTimeTianShen();
    const timeTianShenType = lunar.getTimeTianShenType();
    const timeTianShenLuck = lunar.getTimeTianShenLuck();
    if (timeTianShen) {
      const display = `${timeTianShen}(${timeTianShenType}-${timeTianShenLuck})`;
      console.log('  ' + display);
      gods.time.push(display);
    }
    
    // 支星（通常按地支计算，可以分配到对应的柱）
    const zhiXing = lunar.getZhiXing();
    if (zhiXing && Array.isArray(zhiXing) && zhiXing.length > 0) {
      console.log('支星:', zhiXing.join('、'));
      // 支星可以添加到日柱或时柱，这里添加到日柱
      gods.day.push(...zhiXing.map(s => `支星:${s}`));
    }
    
  } catch (e) {
    console.log('神煞计算错误:', e.message);
    console.log(e.stack);
  }
  
  return {
    pillars,
    hideGan,
    shishen,
    trend,
    selfsit,
    empty,
    nayin,
    dayunList,
    gods
  };
}

// 测试案例：广西南宁青秀区，公历1995年11月05日晚上22点30分，男性
const birthDateTime = '1995-11-05 22:30:00';
const gender = 1; // 1=男, 2=女
const sect = 1; // 1=晚子时日柱算明天, 2=晚子时日柱算当天

console.log('出生信息:');
console.log('地点: 广西南宁青秀区');
console.log('公历: 1995年11月05日 22:30');
console.log('性别: 男');
console.log('');

const result = calculateBazi(birthDateTime, gender, sect);

console.log('\n========== 完整排盘结果 ==========');
console.log(JSON.stringify(result, null, 2));

