import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeResearchInput, sanitizeOfficialUrl, isBlockedHostname, MAX_COMPANY_NAME_LENGTH } from '../src/sanitize_input.js';

test('sanitizeResearchInput: 正常な入力はそのまま正規化される', () => {
  const result = sanitizeResearchInput({
    company_name: '  Example Corp  ',
    official_url: ' https://example.com/ ',
    research_purpose: ' 導入検討 ',
  });
  assert.equal(result.valid, true);
  assert.equal(result.error_message, null);
  assert.equal(result.input.company_name, 'Example Corp');
  assert.equal(result.input.official_url, 'https://example.com/');
  assert.equal(result.input.research_purpose, '導入検討');
});

test('sanitizeResearchInput: research_purposeは任意項目のため空でも有効', () => {
  const result = sanitizeResearchInput({ company_name: 'Example Corp', official_url: 'https://example.com/' });
  assert.equal(result.valid, true);
  assert.equal(result.input.research_purpose, '');
});

test('sanitizeResearchInput: company_name欠落は不正', () => {
  const result = sanitizeResearchInput({ official_url: 'https://example.com/' });
  assert.equal(result.valid, false);
  assert.ok(result.error_message.includes('会社名'));
});

test('sanitizeResearchInput: official_url欠落は不正', () => {
  const result = sanitizeResearchInput({ company_name: 'Example Corp' });
  assert.equal(result.valid, false);
  assert.ok(result.error_message.includes('公式URL'));
});

test('sanitizeResearchInput: 長すぎる入力は上限で切り詰められる（架空の値で補わず、拒否もしない）', () => {
  const longName = 'a'.repeat(MAX_COMPANY_NAME_LENGTH + 100);
  const result = sanitizeResearchInput({ company_name: longName, official_url: 'https://example.com/' });
  assert.equal(result.valid, true);
  assert.equal(result.input.company_name.length, MAX_COMPANY_NAME_LENGTH);
});

test('sanitizeResearchInput: オブジェクト以外の値が来ても例外にならない', () => {
  const result = sanitizeResearchInput(null);
  assert.equal(result.valid, false);
});

test('sanitizeOfficialUrl: http/https以外のスキームは拒否される', () => {
  assert.equal(sanitizeOfficialUrl('ftp://example.com/').valid, false);
  assert.equal(sanitizeOfficialUrl('javascript:alert(1)').valid, false);
  assert.equal(sanitizeOfficialUrl('file:///etc/passwd').valid, false);
});

test('sanitizeOfficialUrl: localhost・ループバック・プライベートIPは拒否される（SSRF対策）', () => {
  assert.equal(sanitizeOfficialUrl('http://localhost/').valid, false);
  assert.equal(sanitizeOfficialUrl('http://127.0.0.1/').valid, false);
  assert.equal(sanitizeOfficialUrl('http://192.168.1.1/').valid, false);
  assert.equal(sanitizeOfficialUrl('http://10.0.0.1/').valid, false);
  assert.equal(sanitizeOfficialUrl('http://172.16.0.1/').valid, false);
  assert.equal(sanitizeOfficialUrl('http://169.254.169.254/').valid, false); // クラウドメタデータエンドポイント
  assert.equal(sanitizeOfficialUrl('http://[::1]/').valid, false);
});

test('sanitizeOfficialUrl: 通常の公式URLは許可される', () => {
  assert.equal(sanitizeOfficialUrl('https://example.com/').valid, true);
  assert.equal(sanitizeOfficialUrl('http://example.co.jp').valid, true);
});

test('isBlockedHostname: 172.32.x.xなどブロック範囲外は許可される', () => {
  assert.equal(isBlockedHostname('172.32.0.1'), false);
  assert.equal(isBlockedHostname('example.com'), false);
});
