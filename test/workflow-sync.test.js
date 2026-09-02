import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildResearchOutput } from '../src/normalize.js';

/**
 * n8nのCodeノードは外部モジュールをimportできないため、workflow JSON内に
 * src/normalize.jsと同一のロジックを手動で複製している（docs/ASSUMPTIONS.md参照）。
 * このテストは、両者が実際に同じ入力に対して同じ出力を返すことを実行レベルで確認し、
 * 手動同期の漏れ（コピー忘れ・修正漏れ）を検出する。
 *
 * テキスト差分比較（diff）ではなく実行結果の比較にしているのは、コメントや
 * 変数名などの些細な違いを誤検知せず、振る舞いの一致だけを検証するため。
 * ビルドスクリプトによる自動生成は導入していない（プロセスの複雑化を避けるため。
 * docs/ASSUMPTIONS.md参照）。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'phase3-tavily-research.json');
const TAVILY_FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'tavily');

function loadTavilyFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(TAVILY_FIXTURES_DIR, name), 'utf-8'));
}

function extractCodeNodeJs(workflow) {
  const codeNode = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.code');
  if (!codeNode) throw new Error('workflow内にCodeノードが見つかりません');
  return codeNode.parameters.jsCode;
}

/**
 * jsCode末尾のn8nノード参照部分（$('Fixed Test Input')等）はvmサンドボックス内では
 * 動作しないため、関数宣言部分のみを取り出してbuildResearchOutputを呼び出せるようにする。
 */
function loadBuildResearchOutputFromWorkflowCode(jsCode) {
  const marker = "const input = $('Fixed Test Input')";
  const idx = jsCode.indexOf(marker);
  if (idx === -1) {
    throw new Error('想定した構造（末尾のn8nノード参照部分）が見つからず、同期チェックができません');
  }
  const functionsOnly = jsCode.slice(0, idx);

  // 実際のn8n Codeノードのサンドボックス（JS Task Runner）にはURL等のWeb APIが
  // 存在しないため、vmサンドボックスにもここでは意図的に何も注入しない
  // （src/normalize.jsがURL等に依存していないことを、この実行自体でも間接的に検証する）
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionsOnly}\nthis.__buildResearchOutput = buildResearchOutput;`, context);

  if (typeof context.__buildResearchOutput !== 'function') {
    throw new Error('workflow内のjsCodeからbuildResearchOutput関数を取り出せませんでした');
  }
  return context.__buildResearchOutput;
}

test('workflowのCodeノードとsrc/normalize.jsは、同一fixtureに対して同一の出力を返す（手動同期チェック）', () => {
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
  const jsCode = extractCodeNodeJs(workflow);
  const workflowBuildResearchOutput = loadBuildResearchOutputFromWorkflowCode(jsCode);

  const input = loadTavilyFixture('input.json');
  const cases = [
    ['search_ok.json', 'extract_ok.json'],
    ['search_error.json', 'extract_ok.json'],
    ['search_empty.json', 'extract_ok.json'],
    ['search_ok.json', 'extract_error.json'],
    ['search_ok.json', 'extract_failed_results.json'],
    ['search_error.json', 'extract_error.json'],
  ];

  for (const [searchFixtureName, extractFixtureName] of cases) {
    const searchItem = loadTavilyFixture(searchFixtureName);
    const extractItem = loadTavilyFixture(extractFixtureName);

    const fromModule = buildResearchOutput({ input, searchItem, extractItem });
    // vm（別レルム）で生成した値はプロトタイプが異なりdeepEqual(strict)が誤って
    // 不一致と判定するため、JSON往復でプレーンオブジェクトに変換してから比較する
    const fromWorkflow = JSON.parse(JSON.stringify(workflowBuildResearchOutput({ input, searchItem, extractItem })));

    // generated_atは実行時刻依存のため比較対象から除外する
    const { generated_at: _a, ...moduleRest } = fromModule;
    const { generated_at: _b, ...workflowRest } = fromWorkflow;

    assert.deepEqual(
      workflowRest,
      moduleRest,
      `${searchFixtureName} + ${extractFixtureName} でworkflowとsrc/normalize.jsの出力が一致しません（同期漏れの可能性）`
    );
  }
});

/**
 * PR #6の実API確認で発覚したインシデントの再発防止テスト。
 *
 * n8n Codeノードの実行サンドボックス（JS Task Runner）には`URL`/`URLSearchParams`が
 * 存在せず、`require(...)`も許可されていない（実機検証で確認、docs/ASSUMPTIONS.md参照）。
 * 通常の`npm test`はNode.js上で実行されるため`URL`が普通に使えてしまい、
 * この非互換性を検知できなかった。そのため、ソースコードのテキストを直接検査し、
 * n8n Codeノードのサンドボックスで使えないAPIを使用していないことを確認する。
 */
/**
 * コード中のコメント（`/** ... *\/`ブロックコメント、および行頭が`//`の行）を除去する。
 * 説明コメント内で「使ってはいけないAPI」の例として`new URL(...)`等の文字列に
 * 言及しても誤検知しないようにするための、簡易的な処理（本格的なJSパーサーは使わない）。
 */
function stripComments(code) {
  const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlockComments
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

test('src/normalize.jsとworkflow内Codeノードは、n8n Codeノードのサンドボックスで未提供のAPI（URL/require等）を使用していない', () => {
  const normalizeSource = stripComments(fs.readFileSync(path.join(__dirname, '..', 'src', 'normalize.js'), 'utf-8'));
  const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
  const jsCode = stripComments(extractCodeNodeJs(workflow));

  const forbiddenPatterns = [
    { pattern: /\bnew\s+URL\s*\(/, label: 'new URL(...)' },
    { pattern: /\bURLSearchParams\b/, label: 'URLSearchParams' },
    { pattern: /\brequire\s*\(/, label: 'require(...)' },
    { pattern: /\bfetch\s*\(/, label: 'fetch(...)' },
  ];

  for (const { pattern, label } of forbiddenPatterns) {
    assert.equal(
      pattern.test(normalizeSource),
      false,
      `src/normalize.jsで${label}が使われています（n8n Codeノードのサンドボックスでは利用不可）`
    );
    assert.equal(
      pattern.test(jsCode),
      false,
      `workflow内のCodeノードで${label}が使われています（n8n Codeノードのサンドボックスでは利用不可）`
    );
  }
});
