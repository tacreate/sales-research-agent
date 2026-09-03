import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleReport } from '../src/assemble_report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'openai');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

const input = loadFixture('input.json');
const tavilyOutput = loadFixture('tavily_output_ok.json');

test('assembleReport: 正常応答はllm.status=okとなり、Phase3のsourcesとLLM分析が統合される', () => {
  const openAiResponse = loadFixture('response_ok.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  assert.equal(result.meta.llm.status, 'ok');
  assert.equal(result.meta.llm.model, 'gpt-5.6-terra');
  assert.ok(result.report);
  assert.equal(result.report.company_profile.company_name, input.company_name);
  assert.equal(result.report.company_profile.official_url, input.official_url);
  assert.deepEqual(result.report.sources, tavilyOutput.sources);
  assert.ok(result.report.proposal_hypotheses[0].rationale.includes('生成AI') || result.report.proposal_hypotheses[0].rationale.length > 0);
});

test('assembleReport: refusalは明示的に検出され、reportはnullで架空の内容を補わない', () => {
  const openAiResponse = loadFixture('response_refusal.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  assert.equal(result.meta.llm.status, 'refusal');
  assert.equal(result.report, null);
  assert.ok(result.meta.llm.detail.length > 0);
});

test('assembleReport: incompleteは明示的に検出され、reasonが記録される', () => {
  const openAiResponse = loadFixture('response_incomplete.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  assert.equal(result.meta.llm.status, 'incomplete');
  assert.equal(result.report, null);
  assert.equal(result.meta.llm.detail, 'max_output_tokens');
});

test('assembleReport: 空のoutputは明示的にemptyとして検出される', () => {
  const openAiResponse = loadFixture('response_empty.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  assert.equal(result.meta.llm.status, 'empty');
  assert.equal(result.report, null);
});

test('assembleReport: APIエラー（top-level error）はerrorとして検出される', () => {
  const openAiResponse = loadFixture('response_api_error.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  assert.equal(result.meta.llm.status, 'error');
  assert.equal(result.report, null);
  assert.ok(result.meta.llm.detail.includes('Incorrect API key'));
});

test('assembleReport: schema違反（必須項目欠落＋minItems違反）はinvalid_schemaとして検出される', () => {
  const openAiResponse = loadFixture('response_invalid_schema.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  assert.equal(result.meta.llm.status, 'invalid_schema');
  assert.equal(result.report, null);
});

test('assembleReport: 存在しないsource idへの参照はinvalid_referenceとして検出される', () => {
  const openAiResponse = loadFixture('response_invalid_reference.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  assert.equal(result.meta.llm.status, 'invalid_reference');
  assert.equal(result.report, null);
  assert.ok(result.meta.llm.detail.includes('src99'));
});

test('assembleReport: 正常応答の最終reportは既存Phase1 Schema(sales_research_output.schema.json)にも準拠する', async () => {
  const { validate } = await import('../src/validate.js');
  const openAiResponse = loadFixture('response_ok.json');
  const result = assembleReport({ input, tavilyOutput, openAiResponse });

  const phase1Result = validate(result.report);
  assert.equal(phase1Result.valid, true, JSON.stringify([...phase1Result.schemaErrors, ...phase1Result.businessRuleErrors]));
});
