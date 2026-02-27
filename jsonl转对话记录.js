#!/usr/bin/env node
/**
 * jsonl转对话记录
 *
 * 用法：
 *   node jsonl转对话记录.js <jsonl文件路径> [输出文件路径]
 *
 * 示例：
 *   node jsonl转对话记录.js session.jsonl 对话记录.md
 *
 * 不指定输出文件时，自动生成 对话记录-<时间戳>.md
 *
 * 自动处理：
 *   - 同名目录下的 .txt / .jsonl 分片（Claude Code 长对话拆分）
 *   - subagents/ 目录下的子 agent 对话（Task 工具调用）
 *     通过 Task 的 prompt 文本与 subagent 第一条消息内容匹配关联
 */

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// 参数处理
// ─────────────────────────────────────────────────────────────

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('用法：node jsonl转对话记录.js <jsonl文件路径> [输出文件路径]');
  console.error('');
  console.error('示例：');
  console.error('  node jsonl转对话记录.js session.jsonl');
  console.error('  node jsonl转对话记录.js session.jsonl 我的对话.md');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error(`文件不存在：${inputFile}`);
  process.exit(1);
}

const outputFile = process.argv[3] || `对话记录-${Date.now()}.md`;

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(line => line.trim());
}

function describeToolUse(item) {
  const toolName = item.name || '未知工具';
  if (!item.input) return `*[调用工具: ${toolName}]*`;

  if (toolName === 'Read' && item.input.file_path)
    return `*[读取文件: \`${path.basename(item.input.file_path)}\`]*`;
  if (toolName === 'Write' && item.input.file_path)
    return `*[写入文件: \`${path.basename(item.input.file_path)}\`]*`;
  if (toolName === 'Edit' && item.input.file_path)
    return `*[编辑文件: \`${path.basename(item.input.file_path)}\`]*`;
  if (toolName === 'Bash' && item.input.command) {
    const cmd = item.input.command.slice(0, 80);
    return `*[执行命令: \`${cmd}${item.input.command.length > 80 ? '...' : ''}\`]*`;
  }
  if (toolName === 'Glob' && item.input.pattern)
    return `*[搜索文件: \`${item.input.pattern}\`]*`;
  if (toolName === 'Grep' && item.input.pattern)
    return `*[搜索内容: \`${item.input.pattern}\`]*`;
  if (toolName === 'Task' && item.input.description)
    return null; // Task 由调用方展开处理，这里返回 null 跳过默认描述

  return `*[调用工具: ${toolName}]*`;
}

/**
 * 将工具结果渲染为 markdown：
 *  - 报错：始终展开显示
 *  - 短结果（≤3行 且 ≤200字）：直接内联
 *  - 长结果：<details> 折叠，summary 显示前 2 行作为预览
 */
function describeToolResult(item) {
  const isError = item.is_error === true;

  let raw = '';
  if (typeof item.content === 'string') {
    raw = item.content;
  } else if (Array.isArray(item.content)) {
    raw = item.content
      .filter(c => c && c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }
  raw = stripSystemTags(raw);
  if (!raw) return null;

  const lines = raw.split('\n');

  // 报错：始终展开
  if (isError) {
    return `> ⚠️ **工具报错**\n> \`\`\`\n${raw.split('\n').map(l => '> ' + l).join('\n')}\n> \`\`\``;
  }

  // 短结果：直接内联
  if (lines.length <= 3 && raw.length <= 200) {
    return `> \`\`\`\n${lines.map(l => '> ' + l).join('\n')}\n> \`\`\``;
  }

  // 长结果：折叠，summary 显示前 2 行预览
  const preview = lines.slice(0, 2).join(' ↵ ').slice(0, 100);
  const suffix = raw.length > 1000 ? raw.slice(0, 1000) + `\n…（共 ${lines.length} 行，已截断）` : raw;
  return `<details>\n<summary>↳ ${preview}${lines.length > 2 ? ` … (${lines.length} 行)` : ''}</summary>\n\n\`\`\`\n${suffix}\n\`\`\`\n</details>`;
}

/**
 * 剥离系统注入的标签内容（ide_selection、ide_opened_file、system-reminder 等）
 * 这些标签由 Claude Code 自动注入到 user 消息里，不是用户真实输入
 */
function stripSystemTags(text) {
  return text
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, '')
    .trim();
}

/**
 * 检测是否为系统自动注入的 context summary 消息
 * Claude Code 在上下文压缩时会注入 "This session is being continued..." 消息
 * 这类消息不是用户真实输入，应跳过
 */
function isContextSummary(contentItems) {
  for (const item of contentItems) {
    const text = typeof item === 'string' ? item
      : (item?.type === 'text' ? (item.text || '') : '');
    // 去掉标签后看剩余内容
    const cleaned = stripSystemTags(text);
    if (cleaned.startsWith('This session is being continued')) return true;
    if (cleaned.startsWith('This is a continuation of a previous conversation')) return true;
  }
  return false;
}

// 提取消息内容为纯文本（递归处理字符串或数组）
function extractText(content) {
  if (typeof content === 'string') return stripSystemTags(content);
  if (Array.isArray(content)) {
    return content
      .filter(c => c && c.type === 'text')
      .map(c => c.text || '')
      .join('\n')
      .trim();
  }
  return '';
}

// ─────────────────────────────────────────────────────────────
// 解析 subagent 对话
// 返回格式化的 markdown 字符串（折叠块）
// ─────────────────────────────────────────────────────────────

function parseSubagentMessages(lines) {
  const seenUuids = new Set();
  const messages = [];

  // 预扫描 tool_use_id → toolName
  const localToolUseIdToName = new Map();
  for (const line of lines) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    const content = r.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      if (item?.type === 'tool_use' && item.id && item.name) {
        localToolUseIdToName.set(item.id, item.name);
      }
    }
  }

  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }

    if (record.type !== 'user' && record.type !== 'assistant') continue;
    const role = record.message?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    if (record.uuid) {
      if (seenUuids.has(record.uuid)) continue;
      seenUuids.add(record.uuid);
    }

    const rawContent = record.message?.content;
    const contentItems = typeof rawContent === 'string'
      ? [{ type: 'text', text: rawContent }]
      : (Array.isArray(rawContent) ? rawContent : []);

    if (isContextSummary(contentItems)) continue;

    const parts = [];

    for (const item of contentItems) {
      if (item.type === 'text' && item.text) {
        const cleaned = stripSystemTags(item.text);
        if (cleaned) parts.push(cleaned);
        continue;
      }
      if (item.type === 'tool_use') {
        const desc = describeToolUse(item);
        if (desc) parts.push(desc);
        continue;
      }
      if (item.type === 'tool_result') {
        const sourceName = localToolUseIdToName.get(item.tool_use_id);
        if (sourceName === 'Task') continue;
        const block = describeToolResult(item);
        if (block) parts.push(block);
        continue;
      }
    }

    const text = parts.join('\n\n').trim();
    if (!text) continue;
    messages.push({ role, text });
  }

  return messages;
}

function renderSubagentBlock(description, subagentType, messages) {
  const lines = [];
  lines.push(`<details>`);
  lines.push(`<summary>🔧 子任务：${description}（${subagentType || 'agent'}）</summary>`);
  lines.push(``);

  for (const { role, text } of messages) {
    if (role === 'user') {
      lines.push(`**> 子任务输入**`);
    } else {
      lines.push(`**> 子任务输出**`);
    }
    lines.push(``);
    // 缩进内容，避免干扰外层 markdown
    lines.push(text.split('\n').map(l => `> ${l}`).join('\n'));
    lines.push(``);
  }

  lines.push(`</details>`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// 加载所有 subagent 对话
// key = 第一条 user 消息前 300 字（用于与主对话 Task prompt 匹配）
// ─────────────────────────────────────────────────────────────

const inputBaseName = inputFile.replace(/\.jsonl$/, '');
const shardDir = inputBaseName;
const subagentDir = path.join(shardDir, 'subagents');

// subagentMap: promptKey → { description(来自主线程Task), subagentType, messages }
// 先建立 promptKey → messages 映射，description 在主线程解析时填入
const subagentByPrompt = new Map(); // promptKey → messages[]

if (fs.existsSync(subagentDir) && fs.statSync(subagentDir).isDirectory()) {
  const files = fs.readdirSync(subagentDir)
    .filter(f => f.endsWith('.jsonl'))
    .filter(f => !f.includes('compact')) // 跳过压缩摘要文件
    .map(f => path.join(subagentDir, f));

  for (const fpath of files) {
    const lines = readLines(fpath);
    if (lines.length === 0) continue;

    // 取第一条 user 消息作为 key
    let promptKey = '';
    for (const line of lines) {
      let r;
      try { r = JSON.parse(line); } catch { continue; }
      if (r.message?.role === 'user') {
        const content = r.message.content;
        promptKey = extractText(content).slice(0, 300);
        break;
      }
    }

    if (!promptKey) continue;

    const messages = parseSubagentMessages(lines);
    subagentByPrompt.set(promptKey, messages);
  }

  if (subagentByPrompt.size > 0) {
    console.log(`🤖 发现 ${subagentByPrompt.size} 个子 agent 对话`);
  }
}

// ─────────────────────────────────────────────────────────────
// 收集主文件 + 分片的所有行
// ─────────────────────────────────────────────────────────────

let allLines = readLines(inputFile);

if (fs.existsSync(shardDir) && fs.statSync(shardDir).isDirectory()) {
  const shardFiles = fs.readdirSync(shardDir)
    .filter(f => f.endsWith('.txt') || f.endsWith('.jsonl'))
    .map(f => path.join(shardDir, f))
    .sort();

  if (shardFiles.length > 0) {
    console.log(`📂 发现分片目录（${shardFiles.length} 个文件）`);
    for (const sf of shardFiles) {
      allLines = allLines.concat(readLines(sf));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 预扫描：建立 tool_use_id → toolName 映射（用于跳过 Task 的 tool_result）
// ─────────────────────────────────────────────────────────────

const toolUseIdToName = new Map();

for (const line of allLines) {
  let record;
  try { record = JSON.parse(line); } catch { continue; }
  const content = record.message?.content;
  if (!Array.isArray(content)) continue;
  for (const item of content) {
    if (item?.type === 'tool_use' && item.id && item.name) {
      toolUseIdToName.set(item.id, item.name);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 解析主对话，Task 工具调用时内联 subagent 展开块
// ─────────────────────────────────────────────────────────────

const seenUuids = new Set();
const messages = [];

for (const line of allLines) {
  let record;
  try { record = JSON.parse(line); } catch { continue; }

  if (record.type !== 'user' && record.type !== 'assistant') continue;
  const role = record.message?.role;
  if (role !== 'user' && role !== 'assistant') continue;

  if (record.uuid) {
    if (seenUuids.has(record.uuid)) continue;
    seenUuids.add(record.uuid);
  }

  const timestamp = record.timestamp
    ? new Date(record.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '';

  const rawContent = record.message?.content;
  // content 可能是字符串（整条消息作为纯文本），统一转成数组格式
  const contentItems = typeof rawContent === 'string'
    ? [{ type: 'text', text: rawContent }]
    : (Array.isArray(rawContent) ? rawContent : []);

  // 跳过 context summary 消息（Claude Code 自动注入，非用户真实输入）
  if (isContextSummary(contentItems)) continue;

  const textParts = [];

  for (const item of contentItems) {
    if (typeof item === 'string') {
      const cleaned = stripSystemTags(item);
      if (cleaned) textParts.push(cleaned);
      continue;
    }

    if (item.type === 'text' && item.text) {
      const cleaned = stripSystemTags(item.text);
      if (cleaned) textParts.push(cleaned);
      continue;
    }

    if (item.type === 'tool_use') {
      if (item.name === 'Task' && item.input) {
        // Task 工具：尝试关联 subagent 对话
        const taskPrompt = (item.input.prompt || '').trim();
        const promptKey = taskPrompt.slice(0, 300);
        const description = item.input.description || 'Task';
        const subagentType = item.input.subagent_type || '';

        const subMsgs = subagentByPrompt.get(promptKey);
        if (subMsgs && subMsgs.length > 0) {
          textParts.push(renderSubagentBlock(description, subagentType, subMsgs));
        } else {
          // 没找到 subagent，退而显示简单描述
          textParts.push(`*[启动子任务: ${description}（${subagentType}）]*`);
        }
        continue;
      }

      const desc = describeToolUse(item);
      if (desc) textParts.push(desc);
      continue;
    }

    if (item.type === 'tool_result') {
      // Task 的 tool_result 跳过（内容已在 subagent 展开块里展示，避免重复）
      const sourceName = toolUseIdToName.get(item.tool_use_id);
      if (sourceName === 'Task') continue;

      const block = describeToolResult(item);
      if (block) textParts.push(block);
      continue;
    }
  }

  const text = textParts.join('\n\n').trim();
  if (!text) continue;

  messages.push({ role, timestamp, text });
}

// ─────────────────────────────────────────────────────────────
// 生成 Markdown
// ─────────────────────────────────────────────────────────────

const fileName = path.basename(inputFile);
const lines_md = [
  `# 对话记录`,
  ``,
  `**来源文件**：\`${fileName}\`  `,
  `**消息条数**：${messages.length}  `,
  `**导出时间**：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
  ``,
  `---`,
  ``,
];

for (let i = 0; i < messages.length; i++) {
  const { role, timestamp, text } = messages[i];

  lines_md.push(role === 'user' ? `## 👤 用户` : `## 🤖 Claude`);

  if (timestamp) {
    lines_md.push(`*${timestamp}*`);
    lines_md.push(``);
  }

  lines_md.push(text);
  lines_md.push(``);
  lines_md.push(`---`);
  lines_md.push(``);
}

// ─────────────────────────────────────────────────────────────
// 写入文件
// ─────────────────────────────────────────────────────────────

fs.writeFileSync(outputFile, lines_md.join('\n'), 'utf-8');

console.log(`✅ 转换完成`);
console.log(`   输入：${inputFile}`);
console.log(`   输出：${outputFile}`);
console.log(`   共 ${messages.length} 条消息`);
