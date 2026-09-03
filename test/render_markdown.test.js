import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleReport } from '../src/assemble_report.js';
import { renderMarkdown } from '../src/render_markdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'openai');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

const input = loadFixture('input.json');
const tavilyOutput = loadFixture('tavily_output_ok.json');

test('renderMarkdown: 正常時は企業概要・最近の動き・提案仮説・商談質問・注意事項・出典の見出しを含む', () => {
  const result = assembleReport({ input, tavilyOutput, openAiResponse: loadFixture('response_ok.json') });
  const md = renderMarkdown(result);

  assert.ok(md.includes('# Example Corp 商談準備レポート'));
  assert.ok(md.includes('## 企業概要'));
  assert.ok(md.includes('## 最近の動き'));
  assert.ok(md.includes('## 導入・提案仮説'));
  assert.ok(md.includes('## 商談で確認すべき質問'));
  assert.ok(md.includes('## 注意事項・不足情報'));
  assert.ok(md.includes('## 出典'));
  assert.ok(md.includes('生成AI導入・業務自動化支援'));
  assert.ok(md.includes('[^src1]'));
  assert.ok(md.includes('[^src2]'));
});

test('renderMarkdown: recent_newsが空配列の場合は根拠なしメッセージを表示する', () => {
  const analysis = loadFixture('analysis_ok.json');
  analysis.company_profile.recent_news = [];
  const openAiResponse = loadFixture('response_ok.json');
  openAiResponse.output[0].content[0].text = JSON.stringify(analysis);

  const result = assembleReport({ input, tavilyOutput, openAiResponse });
  const md = renderMarkdown(result);

  assert.ok(md.includes('裏付けが取れる最近の動きは見つかりませんでした'));
});

test('renderMarkdown: 失敗時（refusal等）は架空の分析結果を出さず、失敗理由のみを記載する', () => {
  const result = assembleReport({ input, tavilyOutput, openAiResponse: loadFixture('response_refusal.json') });
  const md = renderMarkdown(result);

  assert.ok(md.includes('生成失敗'));
  assert.ok(md.includes('refusal'));
  assert.ok(!md.includes('## 企業概要'));
});
