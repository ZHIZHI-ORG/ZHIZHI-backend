const fs = require('fs');
const path = require('path');

const DOCUMENT_STATUSES = new Set(['CURRENT', 'PARTIAL', 'ROADMAP', 'HISTORICAL', 'SUPERSEDED']);
const RELEASE_STATUSES = new Set(['LIVE', 'SHIPPABLE', 'EXPERIMENTAL', 'HISTORICAL']);
const VERIFICATION_STATUSES = new Set(['COMMITTED', 'WORKTREE', 'LIVE_VERIFIED', 'EXTERNAL_UNVERIFIED']);
const IGNORED_DIRECTORIES = new Set(['.git', '.vercel', 'coverage', 'dist', 'node_modules']);

function makeFailure(code, file, message) {
  return { code, file: file || '.', message };
}

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function collectFiles(directory, predicate, root = directory) {
  const files = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, predicate, root));
    } else if (entry.isFile() && predicate(absolute)) {
      files.push(normalizeRelative(path.relative(root, absolute)));
    }
  }

  return files.sort();
}

function collectMarkdownFiles(root) {
  return collectFiles(root, (file) => file.toLowerCase().endsWith('.md'), root);
}

function stripFencedCode(content) {
  const kept = [];
  let fence = null;

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(```+|~~~+)/);
    if (match) {
      const marker = match[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence === null) kept.push(line);
  }

  return kept.join('\n');
}

function extractMarkdownLinks(content) {
  const links = [];
  const clean = stripFencedCode(content);
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(clean)) !== null) links.push(match[1].trim());
  return links;
}

function normalizeLinkTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.includes('>')) {
    target = target.slice(1, target.indexOf('>'));
  } else {
    target = target.split(/\s+["']/)[0];
  }
  return target;
}

function validateLinks(root, markdownFiles) {
  const failures = [];

  for (const relativeFile of markdownFiles) {
    const absoluteFile = path.join(root, relativeFile);
    let content;
    try {
      content = fs.readFileSync(absoluteFile, 'utf8');
    } catch (error) {
      failures.push(makeFailure('DOC_READ_ERROR', relativeFile, error.message));
      continue;
    }

    for (const rawTarget of extractMarkdownLinks(content)) {
      const target = normalizeLinkTarget(rawTarget);
      if (!target || target.startsWith('#')) continue;
      if (/^file:\/\//i.test(target)) {
        failures.push(makeFailure('DOC_LOCAL_URL', relativeFile, `local file URL is not portable: ${target}`));
        continue;
      }
      if (/^(https?:|mailto:|tel:)/i.test(target)) continue;

      const pathPart = target.split('#')[0].split('?')[0];
      let decoded;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        failures.push(makeFailure('DOC_LINK_INVALID', relativeFile, `invalid URL encoding: ${target}`));
        continue;
      }

      const resolved = path.resolve(path.dirname(absoluteFile), decoded);
      if (!isInside(root, resolved)) {
        failures.push(makeFailure('DOC_LINK_OUTSIDE_REPO', relativeFile, `link escapes repository: ${target}`));
        continue;
      }
      if (!fs.existsSync(resolved)) {
        failures.push(makeFailure('DOC_LINK_INVALID', relativeFile, `missing link target: ${target}`));
      }
    }
  }

  return failures;
}

function parseInventoryRows(content) {
  const section = content.match(/## 文档清单([\s\S]*?)(?=\n## |$)/);
  if (!section) return [];

  return section[1]
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\[[^\]]+\]\([^)]+\)\s*\|/.test(line))
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      const documentMatch = cells[0].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      return {
        document: documentMatch ? normalizeRelative(documentMatch[1]) : '',
        link: documentMatch ? documentMatch[2] : '',
        status: cells[1] || '',
        release: cells[2] || '',
        verification: cells[3] || '',
        lastVerified: cells[4] || '',
        purpose: cells[5] || '',
        criticality: cells[6] || '',
        sources: cells[7] || '',
      };
    });
}

function validateDocsMap(root, markdownFiles) {
  const failures = [];
  const mapPath = path.join(root, 'docs', 'README.md');
  let content;
  try {
    content = fs.readFileSync(mapPath, 'utf8');
  } catch (error) {
    return [makeFailure('DOC_READ_ERROR', 'docs/README.md', error.message)];
  }

  const rows = parseInventoryRows(content);
  const counts = new Map();

  for (const row of rows) {
    counts.set(row.document, (counts.get(row.document) || 0) + 1);
    if (!DOCUMENT_STATUSES.has(row.status) ||
        !RELEASE_STATUSES.has(row.release) ||
        !VERIFICATION_STATUSES.has(row.verification) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.lastVerified) ||
        !row.purpose || !row.criticality || !row.sources) {
      failures.push(makeFailure('DOC_STATUS_INVALID', row.document || 'docs/README.md', 'inventory metadata is missing or uses an unknown value'));
    }
    if (row.verification === 'WORKTREE' && row.release === 'LIVE') {
      failures.push(makeFailure('DOC_STATUS_INVALID', row.document, 'WORKTREE evidence cannot establish a LIVE release'));
    }
  }

  for (const [document, count] of counts.entries()) {
    if (count > 1) failures.push(makeFailure('DOC_INDEX_DUPLICATE', document, `document appears ${count} times in docs map`));
  }

  for (const markdownFile of markdownFiles) {
    if (!counts.has(markdownFile)) failures.push(makeFailure('DOC_UNINDEXED', markdownFile, 'Markdown file is missing from docs map'));
  }
  for (const document of counts.keys()) {
    if (!markdownFiles.includes(document)) failures.push(makeFailure('DOC_UNINDEXED', document, 'docs map references a non-inventory document'));
  }

  return failures;
}

function validateSourceCoverage(root) {
  const failures = [];
  const guideRelative = 'docs/current-backend-implementation.md';
  let guide;
  try {
    guide = fs.readFileSync(path.join(root, guideRelative), 'utf8');
  } catch (error) {
    return [makeFailure('DOC_READ_ERROR', guideRelative, error.message)];
  }

  let routes = [];
  let migrations = [];
  try {
    routes = collectFiles(path.join(root, 'api', 'api'), (file) => file.endsWith('.ts'), root);
    migrations = collectFiles(path.join(root, 'supabase', 'migrations'), (file) => file.endsWith('.sql'), root);
  } catch (error) {
    return [makeFailure('DOC_READ_ERROR', guideRelative, error.message)];
  }

  for (const route of routes) {
    if (!guide.includes(`\`${route}\``)) failures.push(makeFailure('DOC_ROUTE_UNLISTED', route, 'route source is not represented in current implementation guide'));
  }
  for (const migration of migrations) {
    if (!guide.includes(`\`${migration}\``)) failures.push(makeFailure('DOC_MIGRATION_UNLISTED', migration, 'migration is not represented in current implementation guide'));
  }

  return failures;
}

function validateExternalEvidence(root) {
  const guideRelative = 'docs/current-backend-implementation.md';
  let content;
  try {
    content = fs.readFileSync(path.join(root, guideRelative), 'utf8');
  } catch (error) {
    return [makeFailure('DOC_READ_ERROR', guideRelative, error.message)];
  }

  const section = content.match(/## [^\n]*外部运行证据([\s\S]*?)(?=\n## |$)/);
  if (!section) return [makeFailure('DOC_EXTERNAL_EVIDENCE_MISSING', guideRelative, 'external evidence section is missing')];

  const rows = section[1]
    .split(/\r?\n/)
    .filter((line) => /^\|.*\b(?:LIVE_VERIFIED|EXTERNAL_UNVERIFIED)\b.*\|$/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

  if (rows.length === 0) return [makeFailure('DOC_EXTERNAL_EVIDENCE_MISSING', guideRelative, 'no structured external evidence rows found')];

  const failures = [];
  for (const cells of rows) {
    const [dependency, verification, checkedOn, evidence, conclusion, nextAction] = cells;
    if (!dependency || !VERIFICATION_STATUSES.has(verification) || !/^\d{4}-\d{2}-\d{2}$/.test(checkedOn || '') || !evidence || !conclusion || !nextAction) {
      failures.push(makeFailure('DOC_EXTERNAL_EVIDENCE_MISSING', guideRelative, `incomplete external evidence row: ${dependency || '(unnamed)'}`));
    }
  }
  return failures;
}

function verifyRepository(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, '..', '..'));
  const failures = [];
  let markdownFiles;

  try {
    markdownFiles = collectMarkdownFiles(root);
  } catch (error) {
    return { root, markdownFiles: [], failures: [makeFailure('DOC_READ_ERROR', '.', error.message)] };
  }

  if (markdownFiles.length === 0) failures.push(makeFailure('DOC_INVENTORY_EMPTY', '.', 'no Markdown files found'));
  failures.push(...validateDocsMap(root, markdownFiles));
  failures.push(...validateLinks(root, markdownFiles));
  failures.push(...validateSourceCoverage(root));
  failures.push(...validateExternalEvidence(root));

  return { root, markdownFiles, failures };
}

function runCli() {
  const result = verifyRepository();
  if (result.failures.length === 0) {
    console.log(`Documentation integrity: OK (${result.markdownFiles.length} Markdown files)`);
    return;
  }

  console.error(`Documentation integrity: FAILED (${result.failures.length} issue(s))`);
  for (const failure of result.failures) {
    console.error(`[${failure.code}] ${failure.file}: ${failure.message}`);
  }
  process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  collectMarkdownFiles,
  extractMarkdownLinks,
  parseInventoryRows,
  validateDocsMap,
  validateExternalEvidence,
  validateLinks,
  validateSourceCoverage,
  verifyRepository,
};
