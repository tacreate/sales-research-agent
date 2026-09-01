import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8'));
}

test('正常系fixtureはスキーマ検証・業務ルール検証の両方を通過する', () => {
  const result = validate(loadFixture('valid.json'));
  assert.equal(result.valid, true);
  assert.deepEqual(result.schemaErrors, []);
  assert.deepEqual(result.businessRuleErrors, []);
});

test('必須項目欠落（company_profile.official_url）はスキーマ検証で失敗する', () => {
  const result = validate(loadFixture('missing_required_field.json'));
  assert.equal(result.valid, false);
  assert.ok(result.schemaErrors.length > 0);
  assert.deepEqual(result.businessRuleErrors, []);
});

test('存在しないsource_idsへの参照は業務ルール検証で失敗する', () => {
  const result = validate(loadFixture('invalid_source_reference.json'));
  assert.equal(result.valid, false);
  assert.deepEqual(result.schemaErrors, []);
  assert.ok(result.businessRuleErrors.some((e) => e.includes('存在しないsource id')));
});

test('根拠(evidence_source_ids)が空の仮説は業務ルール検証で失敗する', () => {
  const result = validate(loadFixture('hypothesis_missing_evidence.json'));
  assert.equal(result.valid, false);
  assert.deepEqual(result.schemaErrors, []);
  assert.ok(result.businessRuleErrors.some((e) => e.includes('根拠となるsource')));
});

test('sources内のid重複は業務ルール検証で失敗する', () => {
  const result = validate(loadFixture('duplicate_source_ids.json'));
  assert.equal(result.valid, false);
  assert.deepEqual(result.schemaErrors, []);
  assert.ok(result.businessRuleErrors.some((e) => e.includes('重複したsource id')));
});

test('スキーマ未定義のフィールドはスキーマ検証で拒否される（additionalProperties: false）', () => {
  const result = validate(loadFixture('unknown_field.json'));
  assert.equal(result.valid, false);
  assert.ok(result.schemaErrors.length > 0);
  assert.deepEqual(result.businessRuleErrors, []);
});

test('仮説(evidence_source_ids)が存在しないsource idを参照した場合も業務ルール検証で失敗する', () => {
  const result = validate(loadFixture('invalid_evidence_reference.json'));
  assert.equal(result.valid, false);
  assert.deepEqual(result.schemaErrors, []);
  assert.ok(result.businessRuleErrors.some((e) => e.includes('proposal_hypotheses[0].evidence_source_ids')));
});
