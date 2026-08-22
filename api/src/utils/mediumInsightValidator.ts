import {
  MEDIUM_INSIGHT_CONTENT_TYPES,
  MEDIUM_INSIGHT_DOMAINS,
  MediumInsightAiCard,
  MediumInsightAiOutput,
  MediumInsightDomain,
  MediumInsightFactSnapshot,
  MediumInsightRecentCard,
} from '../models/MediumInsight';

export class MediumInsightContentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly invalidSlots: string[] = [],
  ) {
    super(message);
    this.name = 'MediumInsightContentError';
  }
}

export function validateMediumInsightOutput(input: {
  output: unknown;
  snapshot: MediumInsightFactSnapshot;
  recentCards?: MediumInsightRecentCard[];
}): MediumInsightAiOutput {
  const output = input.output;
  if (!isRecord(output) || !Array.isArray(output.domains)) {
    throw new MediumInsightContentError('INVALID_SCHEMA', '输出必须包含 domains 数组');
  }
  if (Object.keys(output).some((key) => key !== 'domains')) {
    throw new MediumInsightContentError('UNKNOWN_FIELD', '输出包含未知顶层字段');
  }

  const knownRefs = new Set(input.snapshot.facts.map((fact) => fact.ref));
  if (knownRefs.size !== input.snapshot.facts.length || knownRefs.size === 0) {
    throw new MediumInsightContentError('INVALID_FACT_SNAPSHOT', '事实引用必须非空且唯一');
  }

  const domains = output.domains.map((rawDomain, domainIndex) => {
    if (!isRecord(rawDomain) || !isDomain(rawDomain.domain) || !Array.isArray(rawDomain.cards)) {
      throw new MediumInsightContentError('INVALID_DOMAIN', `domains[${domainIndex}] 无效`);
    }
    const domain = rawDomain.domain;
    if (Object.keys(rawDomain).some((key) => key !== 'domain' && key !== 'cards')) {
      throw new MediumInsightContentError('UNKNOWN_FIELD', `${domain} 包含未知字段`);
    }
    if (rawDomain.cards.length !== 8) {
      throw new MediumInsightContentError('INVALID_CARDINALITY', `${domain} 必须恰好包含 8 张卡`);
    }
    return {
      domain,
      cards: rawDomain.cards.map((rawCard, cardIndex) => validateCard({
        rawCard,
        domain,
        cardIndex,
        knownRefs,
      })),
    };
  });

  if (domains.length !== MEDIUM_INSIGHT_DOMAINS.length) {
    throw new MediumInsightContentError('INVALID_CARDINALITY', '必须恰好包含五个领域');
  }
  if (new Set(domains.map((item) => item.domain)).size !== MEDIUM_INSIGHT_DOMAINS.length) {
    throw new MediumInsightContentError('DUPLICATE_DOMAIN', '领域必须唯一');
  }
  for (const domain of MEDIUM_INSIGHT_DOMAINS) {
    if (!domains.some((item) => item.domain === domain)) {
      throw new MediumInsightContentError('MISSING_DOMAIN', `缺少 ${domain} 领域`);
    }
  }

  const recentByDomain = groupRecent(input.recentCards ?? []);
  for (const domain of domains) {
    validateTextUniqueness(domain.domain, domain.cards, recentByDomain.get(domain.domain) ?? []);
  }

  return {
    domains: MEDIUM_INSIGHT_DOMAINS.map((domain) => domains.find((item) => item.domain === domain)!),
  };
}

function validateCard(input: {
  rawCard: unknown;
  domain: MediumInsightDomain;
  cardIndex: number;
  knownRefs: Set<string>;
}): MediumInsightAiCard {
  const slot = `${input.domain}:${input.cardIndex}`;
  if (!isRecord(input.rawCard)) {
    throw new MediumInsightContentError('INVALID_CARD', `${slot} 必须是对象`, [slot]);
  }
  const allowed = new Set(['title', 'preview', 'content_type', 'fact_refs']);
  if (Object.keys(input.rawCard).some((key) => !allowed.has(key))) {
    throw new MediumInsightContentError('UNKNOWN_FIELD', `${slot} 包含未知字段`, [slot]);
  }
  const { title, preview, content_type: contentType, fact_refs: factRefs } = input.rawCard;
  if (typeof title !== 'string' || unicodeLength(title.trim()) < 4 || unicodeLength(title.trim()) > 16) {
    throw new MediumInsightContentError('INVALID_TITLE', `${slot} 标题必须为 4–16 个字符`, [slot]);
  }
  const normalizedPreview = typeof preview === 'string' ? preview.trim() : '';
  const previewLength = unicodeLength(normalizedPreview);
  if (previewLength < 24 || previewLength > 56) {
    throw new MediumInsightContentError(
      'INVALID_PREVIEW',
      `${slot} 预览必须为 24–56 个字符`,
      [slot],
    );
  }
  if (!MEDIUM_INSIGHT_CONTENT_TYPES.includes(contentType as never)) {
    throw new MediumInsightContentError('INVALID_CONTENT_TYPE', `${slot} content_type 无效`, [slot]);
  }
  if (!Array.isArray(factRefs) || factRefs.length < 1 || factRefs.length > 4) {
    throw new MediumInsightContentError('INVALID_FACT_REFS', `${slot} 必须引用 1–4 个事实`, [slot]);
  }
  if (factRefs.some((ref) => typeof ref !== 'string' || !input.knownRefs.has(ref))) {
    throw new MediumInsightContentError('UNKNOWN_FACT_REF', `${slot} 引用了未知事实`, [slot]);
  }
  if (new Set(factRefs).size !== factRefs.length) {
    throw new MediumInsightContentError('DUPLICATE_FACT_REF', `${slot} 事实引用重复`, [slot]);
  }
  return {
    title: title.trim(),
    preview: normalizedPreview,
    content_type: contentType as MediumInsightAiCard['content_type'],
    fact_refs: factRefs as string[],
  };
}

function validateTextUniqueness(
  domain: MediumInsightDomain,
  cards: MediumInsightAiCard[],
  recent: MediumInsightRecentCard[],
): void {
  const accepted: Array<{ slot: string; text: string }> = recent.map((card, index) => ({
    slot: `recent:${index}`,
    text: `${card.title}${card.preview}`,
  }));
  cards.forEach((card, index) => {
    const slot = `${domain}:${index}`;
    const text = `${card.title}${card.preview}`;
    for (const prior of accepted) {
      const exact = normalizeText(text) === normalizeText(prior.text);
      if (exact) {
        throw new MediumInsightContentError(
          'DUPLICATE_TEXT',
          `${slot} 与 ${prior.slot} 重复`,
          [slot],
        );
      }
    }
    accepted.push({ slot, text });
  });
}

function groupRecent(cards: MediumInsightRecentCard[]): Map<MediumInsightDomain, MediumInsightRecentCard[]> {
  const result = new Map<MediumInsightDomain, MediumInsightRecentCard[]>();
  for (const card of cards) {
    if (!isDomain(card.domain)) continue;
    const existing = result.get(card.domain) ?? [];
    if (existing.length < 112) existing.push(card);
    result.set(card.domain, existing);
  }
  return result;
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .replace(/(?:其实|往往|通常|更容易|可能)/g, '');
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function isDomain(value: unknown): value is MediumInsightDomain {
  return MEDIUM_INSIGHT_DOMAINS.includes(value as never);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
