import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenAiRequestBody, buildPromptText, OPENAI_MODEL, OPENAI_REASONING_EFFORT, OPENAI_MAX_OUTPUT_TOKENS } from '../src/openai_request.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'openai');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

test('OPENAI_MODEL/OPENAI_REASONING_EFFORT/OPENAI_MAX_OUTPUT_TOKENSが合意仕様と一致する', () => {
  assert.equal(OPENAI_MODEL, 'gpt-5.6-terra');
  assert.equal(OPENAI_REASONING_EFFORT, 'low');
  assert.equal(OPENAI_MAX_OUTPUT_TOKENS, 4000);
});

test('buildPromptText: 企業名・公式URL・offering・出典一覧がプロンプトに含まれる', () => {
  const input = loadFixture('input.json');
  const tavilyOutput = loadFixture('tavily_output_ok.json');
  const promptText = buildPromptText({ input, sources: tavilyOutput.sources });

  assert.ok(promptText.includes(input.company_name));
  assert.ok(promptText.includes(input.official_url));
  assert.ok(promptText.includes(input.offering));
  assert.ok(promptText.includes('[src1]'));
  assert.ok(promptText.includes('[src2]'));
  assert.ok(promptText.includes('推測や一般知識で補ってはいけません'));
});

test('buildOpenAiRequestBody: model/reasoning/max_output_tokens/text.formatが仕様通り', () => {
  const input = loadFixture('input.json');
  const tavilyOutput = loadFixture('tavily_output_ok.json');
  const body = buildOpenAiRequestBody({ input, sources: tavilyOutput.sources });

  assert.equal(body.model, 'gpt-5.6-terra');
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.equal(body.max_output_tokens, 4000);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(typeof body.text.format.name, 'string');
  assert.equal(body.text.format.schema.type, 'object');
  assert.equal(body.text.format.schema.additionalProperties, false);
});

test('buildOpenAiRequestBody: schemaの全objectがadditionalProperties=falseになっている', () => {
  const input = loadFixture('input.json');
  const tavilyOutput = loadFixture('tavily_output_ok.json');
  const body = buildOpenAiRequestBody({ input, sources: tavilyOutput.sources });

  function collectObjectSchemas(node, acc = []) {
    if (!node || typeof node !== 'object') return acc;
    if (node.type === 'object') acc.push(node);
    if (node.items) collectObjectSchemas(node.items, acc);
    if (node.properties) {
      for (const key of Object.keys(node.properties)) collectObjectSchemas(node.properties[key], acc);
    }
    return acc;
  }

  const objectSchemas = collectObjectSchemas(body.text.format.schema);
  assert.ok(objectSchemas.length > 0);
  for (const obj of objectSchemas) {
    assert.equal(obj.additionalProperties, false, `additionalProperties:falseになっていないobjectがあります: ${JSON.stringify(obj).slice(0, 100)}`);
  }
});

test('buildOpenAiRequestBody: schemaのsource_ids/evidence_source_idsがminItems:1になっている', () => {
  const input = loadFixture('input.json');
  const tavilyOutput = loadFixture('tavily_output_ok.json');
  const body = buildOpenAiRequestBody({ input, sources: tavilyOutput.sources });
  const schema = body.text.format.schema;

  assert.equal(schema.properties.company_profile.properties.business_overview.properties.source_ids.minItems, 1);
  assert.equal(schema.properties.company_profile.properties.recent_news.items.properties.source_ids.minItems, 1);
  assert.equal(schema.properties.company_profile.properties.org_signals.items.properties.source_ids.minItems, 1);
  assert.equal(schema.properties.proposal_hypotheses.items.properties.evidence_source_ids.minItems, 1);
});
