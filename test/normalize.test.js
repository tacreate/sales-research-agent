import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeUrl,
  classifySourceType,
  dedupeSources,
  buildSearchSummary,
  buildExtractSummary,
  buildResearchOutput,
} from '../src/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAVILY_FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'tavily');

function loadTavilyFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(TAVILY_FIXTURES_DIR, name), 'utf-8'));
}

test('normalizeUrl: 末尾スラッシュ・大文字ホスト・トラッキングパラメータ・フラグメントを正規化する', () => {
  assert.equal(normalizeUrl('https://Example.com/About/'), 'https://example.com/About');
  assert.equal(
    normalizeUrl('https://news.example-media.test/2026/08/example-corp-release?utm_source=twitter&utm_medium=social'),
    'https://news.example-media.test/2026/08/example-corp-release'
  );
  assert.equal(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
});

test('normalizeUrl: 不正なURLはnullを返す（架空の値で補わない）', () => {
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl(undefined), null);
});

test('classifySourceType: 公式URLと同一ホストはofficial、異なるホストはexternal', () => {
  assert.equal(classifySourceType('https://example.com/about', 'https://example.com/'), 'official');
  assert.equal(classifySourceType('https://news.example-media.test/x', 'https://example.com/'), 'external');
});

test('dedupeSources: 正規化後URLが同一のものは1件にまとめ、title/snippetの欠落を補い合う', () => {
  const result = dedupeSources([
    { url: 'https://example.com/about/', title: null, snippet: '本文（extract由来）', source_type: 'official', origin: 'extract' },
    { url: 'https://example.com/about', title: '会社概要ページ', snippet: null, source_type: 'official', origin: 'search' },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, '会社概要ページ');
  assert.equal(result[0].snippet, '本文（extract由来）');
  assert.deepEqual(result[0].origin, ['extract', 'search']);
  assert.equal(result[0].id, 'src1');
});

test('dedupeSources: 不正なURLを含む要素は除外される', () => {
  const result = dedupeSources([
    { url: 'not a url', title: 'x', snippet: 'y', source_type: 'external', origin: 'search' },
    { url: 'https://example.com/', title: 'ok', snippet: 'ok', source_type: 'official', origin: 'search' },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://example.com/');
});

test('buildSearchSummary: エラーitemはstatus=errorとなる', () => {
  const result = buildSearchSummary(loadTavilyFixture('search_error.json'), 'q', 3);
  assert.equal(result.status, 'error');
  assert.ok(result.error_message.includes('401'));
});

test('buildSearchSummary: results空配列はstatus=emptyとなる', () => {
  const result = buildSearchSummary(loadTavilyFixture('search_empty.json'), 'q', 3);
  assert.equal(result.status, 'empty');
  assert.equal(result.returned_count, 0);
});

test('buildSearchSummary: 正常系はstatus=okでreturned_countが件数と一致する', () => {
  const result = buildSearchSummary(loadTavilyFixture('search_ok.json'), 'q', 3);
  assert.equal(result.status, 'ok');
  assert.equal(result.returned_count, 3);
});

test('buildExtractSummary: エラーitemはstatus=errorとなる', () => {
  const result = buildExtractSummary(loadTavilyFixture('extract_error.json'), 'https://example.com/');
  assert.equal(result.status, 'error');
  assert.ok(result.error_message.includes('500'));
});

test('buildExtractSummary: failed_resultsに対象URLが含まれる場合はstatus=errorとなる', () => {
  const result = buildExtractSummary(loadTavilyFixture('extract_failed_results.json'), 'https://example.com/');
  assert.equal(result.status, 'error');
  assert.deepEqual(result.failed_urls, ['https://example.com/']);
});

test('buildExtractSummary: 正常系はstatus=okとなる', () => {
  const result = buildExtractSummary(loadTavilyFixture('extract_ok.json'), 'https://example.com/');
  assert.equal(result.status, 'ok');
});

test('buildResearchOutput: search/extractともに正常な場合、重複が排除され出典が構造化される', () => {
  const input = loadTavilyFixture('input.json');
  const output = buildResearchOutput({
    input,
    searchItem: loadTavilyFixture('search_ok.json'),
    extractItem: loadTavilyFixture('extract_ok.json'),
  });
  assert.equal(output.search.status, 'ok');
  assert.equal(output.extract.status, 'ok');
  assert.deepEqual(output.warnings, []);
  // search_ok内の重複("about/"と"about")が1件に統合されるため、
  // extractの1件 + search由来のユニークURL2件 = 3件になるはず
  assert.equal(output.sources.length, 3);
  const officialCount = output.sources.filter((s) => s.source_type === 'official').length;
  assert.equal(officialCount, 2); // extractのトップページ + searchの会社概要ページ（統合後）
});

test('buildResearchOutput: Search失敗時もExtract結果のみでsourcesを構築し、架空情報で補わない', () => {
  const input = loadTavilyFixture('input.json');
  const output = buildResearchOutput({
    input,
    searchItem: loadTavilyFixture('search_error.json'),
    extractItem: loadTavilyFixture('extract_ok.json'),
  });
  assert.equal(output.search.status, 'error');
  assert.equal(output.extract.status, 'ok');
  assert.equal(output.sources.length, 1);
  assert.ok(output.warnings.some((w) => w.includes('Tavily Search呼び出しに失敗')));
});

test('buildResearchOutput: Extract失敗時もSearch結果のみでsourcesを構築し、本文を架空情報で補わない', () => {
  const input = loadTavilyFixture('input.json');
  const output = buildResearchOutput({
    input,
    searchItem: loadTavilyFixture('search_ok.json'),
    extractItem: loadTavilyFixture('extract_failed_results.json'),
  });
  assert.equal(output.extract.status, 'error');
  assert.equal(output.sources.length, 2); // extract由来なし、search由来のユニークURL2件のみ
  assert.ok(output.warnings.some((w) => w.includes('Tavily Extractに失敗')));
});

test('buildResearchOutput: 両方失敗/空の場合はsourcesが空になり、警告が出る', () => {
  const input = loadTavilyFixture('input.json');
  const output = buildResearchOutput({
    input,
    searchItem: loadTavilyFixture('search_empty.json'),
    extractItem: loadTavilyFixture('extract_error.json'),
  });
  assert.equal(output.search.status, 'empty');
  assert.equal(output.extract.status, 'error');
  assert.deepEqual(output.sources, []);
  assert.ok(output.warnings.some((w) => w.includes('有効な出典が1件も取得できませんでした')));
});
