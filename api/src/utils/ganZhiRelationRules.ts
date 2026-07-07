export type RelationElement = '木' | '火' | '土' | '金' | '水';

export const STEM_COMBINATIONS: Array<{ stems: [string, string]; element: RelationElement; label: string }> = [
  { stems: ['甲', '己'], element: '土', label: '甲己合土' },
  { stems: ['乙', '庚'], element: '金', label: '乙庚合金' },
  { stems: ['丙', '辛'], element: '水', label: '丙辛合水' },
  { stems: ['丁', '壬'], element: '木', label: '丁壬合木' },
  { stems: ['戊', '癸'], element: '火', label: '戊癸合火' },
];

export const BRANCH_CLASHES: Array<[string, string]> = [
  ['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥'],
];

export const BRANCH_HARMS: Array<[string, string]> = [
  ['子', '未'], ['丑', '午'], ['寅', '巳'], ['卯', '辰'], ['申', '亥'], ['酉', '戌'],
];

export const BRANCH_BREAKS: Array<[string, string]> = [
  ['子', '酉'], ['卯', '午'], ['辰', '丑'], ['寅', '亥'], ['巳', '申'], ['未', '戌'],
];

export const BRANCH_PUNISHMENTS: Array<[string, string]> = [
  ['子', '卯'], ['寅', '巳'], ['巳', '申'], ['申', '寅'], ['丑', '戌'], ['戌', '未'], ['丑', '未'],
];

export const BRANCH_SIX_COMBINATIONS: Array<{ branches: [string, string]; element: RelationElement; label: string }> = [
  { branches: ['子', '丑'], element: '土', label: '子丑六合' },
  { branches: ['寅', '亥'], element: '木', label: '寅亥六合' },
  { branches: ['卯', '戌'], element: '火', label: '卯戌六合' },
  { branches: ['辰', '酉'], element: '金', label: '辰酉六合' },
  { branches: ['巳', '申'], element: '水', label: '巳申六合' },
  { branches: ['午', '未'], element: '土', label: '午未六合' },
];

export const BRANCH_THREE_HARMONIES: Array<{ branches: [string, string, string]; element: RelationElement; center: string; label: string }> = [
  { branches: ['申', '子', '辰'], element: '水', center: '子', label: '申子辰三合水局' },
  { branches: ['亥', '卯', '未'], element: '木', center: '卯', label: '亥卯未三合木局' },
  { branches: ['寅', '午', '戌'], element: '火', center: '午', label: '寅午戌三合火局' },
  { branches: ['巳', '酉', '丑'], element: '金', center: '酉', label: '巳酉丑三合金局' },
];

export const BRANCH_THREE_MEETINGS: Array<{ branches: [string, string, string]; element: RelationElement; center: string; label: string; direction: string }> = [
  { branches: ['寅', '卯', '辰'], element: '木', center: '卯', label: '寅卯辰三会木局', direction: '东方' },
  { branches: ['巳', '午', '未'], element: '火', center: '午', label: '巳午未三会火局', direction: '南方' },
  { branches: ['申', '酉', '戌'], element: '金', center: '酉', label: '申酉戌三会金局', direction: '西方' },
  { branches: ['亥', '子', '丑'], element: '水', center: '子', label: '亥子丑三会水局', direction: '北方' },
];

export function orderedBranchesForRule(ruleBranches: [string, string, string], branches: string[]): string[] {
  return ruleBranches.filter(branch => branches.includes(branch));
}

export type CanonicalDerivedBranchRelation =
  | 'branch_half_harmony'
  | 'branch_arch_harmony'
  | 'branch_half_meeting'
  | 'branch_arch_meeting';

export interface CanonicalDerivedBranchRule {
  branches: [string, string];
  groupBranches: [string, string, string];
  relation: CanonicalDerivedBranchRelation;
  relationName: string;
  aliases: string[];
  element: RelationElement;
  centerBranch: string;
  missingBranch?: string;
  baseIntensity: number;
}

export function buildCanonicalDerivedBranchRules(): CanonicalDerivedBranchRule[] {
  const rules: CanonicalDerivedBranchRule[] = [];

  BRANCH_THREE_HARMONIES.forEach((rule) => {
    const [first, center, last] = rule.branches;
    rules.push({
      branches: [first, center],
      groupBranches: rule.branches,
      relation: 'branch_half_harmony',
      relationName: '地支半合',
      aliases: ['半合'],
      element: rule.element,
      centerBranch: center,
      missingBranch: last,
      baseIntensity: 0.60,
    });
    rules.push({
      branches: [center, last],
      groupBranches: rule.branches,
      relation: 'branch_half_harmony',
      relationName: '地支半合',
      aliases: ['半合'],
      element: rule.element,
      centerBranch: center,
      missingBranch: first,
      baseIntensity: 0.60,
    });
    rules.push({
      branches: [first, last],
      groupBranches: rule.branches,
      relation: 'branch_arch_harmony',
      relationName: '地支拱合',
      aliases: ['拱合'],
      element: rule.element,
      centerBranch: center,
      missingBranch: center,
      baseIntensity: 0.50,
    });
  });

  BRANCH_THREE_MEETINGS.forEach((rule) => {
    const [first, center, last] = rule.branches;
    rules.push({
      branches: [first, center],
      groupBranches: rule.branches,
      relation: 'branch_half_meeting',
      relationName: '地支半会',
      aliases: ['半会'],
      element: rule.element,
      centerBranch: center,
      missingBranch: last,
      baseIntensity: 0.56,
    });
    rules.push({
      branches: [center, last],
      groupBranches: rule.branches,
      relation: 'branch_half_meeting',
      relationName: '地支半会',
      aliases: ['半会'],
      element: rule.element,
      centerBranch: center,
      missingBranch: first,
      baseIntensity: 0.56,
    });
    rules.push({
      branches: [first, last],
      groupBranches: rule.branches,
      relation: 'branch_arch_meeting',
      relationName: '地支拱会',
      aliases: ['拱会'],
      element: rule.element,
      centerBranch: center,
      missingBranch: center,
      baseIntensity: 0.48,
    });
  });

  return rules;
}

export function canonicalDerivedBranchLabel(rule: CanonicalDerivedBranchRule): string {
  const branches = rule.branches.join('');
  if (rule.relation === 'branch_half_harmony') return `${branches}半合${rule.element}`;
  if (rule.relation === 'branch_arch_harmony') return `${branches}拱合${rule.missingBranch || ''}`;
  if (rule.relation === 'branch_half_meeting') return `${branches}半会${rule.element}`;
  return `${branches}拱会${rule.missingBranch || ''}${rule.element}`;
}
