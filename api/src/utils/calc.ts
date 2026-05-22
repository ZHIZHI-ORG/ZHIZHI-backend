import { calculateWeightedWuxingFromChart } from './baziCalculator';

const chart = {
  dayMaster: '乙',
  year: { name: '年柱', stem: '甲', branch: '申', stemElement: '木', branchElement: '金', ganZhi: '甲申' },
  month: { name: '月柱', stem: '丙', branch: '寅', stemElement: '火', branchElement: '木', ganZhi: '丙寅' },
  day: { name: '日柱', stem: '乙', branch: '丑', stemElement: '木', branchElement: '土', ganZhi: '乙丑' },
  time: { name: '时柱', stem: '己', branch: '卯', stemElement: '土', branchElement: '木', ganZhi: '己卯' },
};

const result = calculateWeightedWuxingFromChart(chart);

console.log(JSON.stringify(result, null, 2));
