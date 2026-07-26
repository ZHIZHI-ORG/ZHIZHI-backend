import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { verifyRepository } = require('../scripts/verify-docs.js') as {
  verifyRepository: (options: { root: string }) => {
    markdownFiles: string[];
    failures: Array<{ code: string; file: string; message: string }>;
  };
};

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function inventoryRow(document: string, link: string, status = 'CURRENT', release = 'SHIPPABLE', verification = 'COMMITTED'): string {
  return `| [${document}](${link}) | ${status} | ${release} | ${verification} | 2026-07-11 | purpose | High | source |`;
}

function createValidFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhizhi-docs-'));
  write(root, 'README.md', '# Fixture\n\n[Guide](docs/current-backend-implementation.md)\n');
  write(root, 'api/api/health.ts', 'export default function handler() {}\n');
  write(root, 'supabase/migrations/002_fixture.sql', '-- fixture\n');
  write(root, 'docs/README.md', [
    '# Docs',
    '',
    '## 文档清单',
    '',
    '| Document | Status | Release | Verification | Last verified | Primary purpose | Product criticality | Sources |',
    '|---|---|---|---|---|---|---|---|',
    inventoryRow('README.md', '../README.md'),
    inventoryRow('docs/README.md', 'README.md'),
    inventoryRow('docs/current-backend-implementation.md', 'current-backend-implementation.md'),
    '',
    '## 维护规则',
  ].join('\n'));
  write(root, 'docs/current-backend-implementation.md', [
    '# Guide',
    '',
    '`api/api/health.ts`',
    '`supabase/migrations/002_fixture.sql`',
    '',
    '## 外部运行证据',
    '',
    '| Dependency | Verification | Checked on | Evidence | Current conclusion | Required next action |',
    '|---|---|---|---|---|---|',
    '| Supabase | EXTERNAL_UNVERIFIED | 2026-07-11 | Not probed | local only | verify live |',
    '',
    '## Next',
  ].join('\n'));
  return root;
}

function codes(root: string): string[] {
  return verifyRepository({ root }).failures.map((failure) => failure.code);
}

function run(): void {
  const roots: string[] = [];
  try {
    const valid = createValidFixture();
    roots.push(valid);
    const validResult = verifyRepository({ root: valid });
    assert.deepEqual(validResult.failures, [], 'valid fixture should pass');
    assert.equal(validResult.markdownFiles.length, 3);

    const links = createValidFixture();
    roots.push(links);
    write(links, 'orphan.md', '[missing](missing.md)\n[local](file:///tmp/local.md)\n[outside](../outside.md)\n[bad](%ZZ.md)\n');
    const linkCodes = codes(links);
    assert.ok(linkCodes.includes('DOC_UNINDEXED'));
    assert.ok(linkCodes.includes('DOC_LINK_INVALID'));
    assert.ok(linkCodes.includes('DOC_LOCAL_URL'));
    assert.ok(linkCodes.includes('DOC_LINK_OUTSIDE_REPO'));

    const coverage = createValidFixture();
    roots.push(coverage);
    const guidePath = path.join(coverage, 'docs/current-backend-implementation.md');
    fs.writeFileSync(guidePath, fs.readFileSync(guidePath, 'utf8')
      .replace('`api/api/health.ts`', 'route omitted')
      .replace('`supabase/migrations/002_fixture.sql`', 'migration omitted'));
    const coverageCodes = codes(coverage);
    assert.ok(coverageCodes.includes('DOC_ROUTE_UNLISTED'));
    assert.ok(coverageCodes.includes('DOC_MIGRATION_UNLISTED'));

    const metadata = createValidFixture();
    roots.push(metadata);
    const mapPath = path.join(metadata, 'docs/README.md');
    let map = fs.readFileSync(mapPath, 'utf8');
    map = map.replace('| CURRENT | SHIPPABLE | COMMITTED |', '| UNKNOWN | LIVE | WORKTREE |');
    map = map.replace('\n## 维护规则', `\n${inventoryRow('README.md', '../README.md')}\n\n## 维护规则`);
    fs.writeFileSync(mapPath, map);
    const metadataCodes = codes(metadata);
    assert.ok(metadataCodes.includes('DOC_STATUS_INVALID'));
    assert.ok(metadataCodes.includes('DOC_INDEX_DUPLICATE'));

    const external = createValidFixture();
    roots.push(external);
    const externalGuide = path.join(external, 'docs/current-backend-implementation.md');
    fs.writeFileSync(externalGuide, fs.readFileSync(externalGuide, 'utf8').replace('| Not probed | local only | verify live |', '|  | local only | verify live |'));
    assert.ok(codes(external).includes('DOC_EXTERNAL_EVIDENCE_MISSING'));

    const missingRoot = path.join(os.tmpdir(), `zhizhi-docs-missing-${Date.now()}`);
    assert.ok(codes(missingRoot).includes('DOC_READ_ERROR'));

    console.log('Documentation integrity tests passed');
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

run();
