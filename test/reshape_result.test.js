import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reshapeResult } from '../src/reshape_result.js';

test('reshapeResult: official/externalを分離し、n8n内部フィールド(_source等)は含まれない', () => {
  const raw = {
    input: { company_name: 'Example Corp', official_url: 'https://example.com/', research_purpose: '', _source: 'webhook', _input_error: '' },
    search: { status: 'ok' },
    extract: { status: 'ok' },
    sources: [
      { id: 'src1', url: 'https://example.com/', title: null, snippet: '会社概要', source_type: 'official', origin: ['extract'] },
      { id: 'src2', url: 'https://news.example.test/a', title: 'ニュース記事', snippet: '内容', source_type: 'external', origin: ['search'] },
    ],
    warnings: [],
    generated_at: '2026-09-06T00:00:00.000Z',
  };

  const result = reshapeResult(raw);

  assert.equal(result.company_name, 'Example Corp');
  assert.equal(result.official_url, 'https://example.com/');
  assert.equal(result.official_sources.length, 1);
  assert.equal(result.external_sources.length, 1);
  assert.equal(result.official_sources[0].title, '公式サイト'); // titleがnullの場合
  assert.equal(result.external_sources[0].title, 'ニュース記事');
  assert.equal('_source' in result, false);
  assert.equal('_input_error' in result, false);
  assert.equal('search' in result, false); // 生のsearch/extractステータスは含めない
  assert.equal('extract' in result, false);
});

test('reshapeResult: sourcesが空でもエラーにならない', () => {
  const raw = { input: { company_name: 'X', official_url: 'https://x.example/' }, sources: [], warnings: ['有効な出典が1件も取得できませんでした。'] };
  const result = reshapeResult(raw);
  assert.deepEqual(result.official_sources, []);
  assert.deepEqual(result.external_sources, []);
  assert.deepEqual(result.warnings, ['有効な出典が1件も取得できませんでした。']);
});

test('reshapeResult: 長いsnippetは上限文字数で切り詰められる', () => {
  const longSnippet = 'あ'.repeat(3000);
  const raw = {
    input: { company_name: 'X', official_url: 'https://x.example/' },
    sources: [{ id: 's1', url: 'https://x.example/', title: 'Title', snippet: longSnippet, source_type: 'official' }],
    warnings: [],
  };
  const result = reshapeResult(raw);
  assert.ok(result.official_sources[0].snippet.length <= 2000);
});

test('reshapeResult: 外部サイトでtitleがnullの場合は「外部サイト」と表示する', () => {
  const raw = {
    input: { company_name: 'X', official_url: 'https://x.example/' },
    sources: [{ id: 's1', url: 'https://news.example.test/', title: null, snippet: null, source_type: 'external' }],
    warnings: [],
  };
  const result = reshapeResult(raw);
  assert.equal(result.external_sources[0].title, '外部サイト');
});
