import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildResearchOutput } from '../src/normalize.js';
import { buildOpenAiRequestBody } from '../src/openai_request.js';
import { assembleReport } from '../src/assemble_report.js';
import { renderMarkdown } from '../src/render_markdown.js';

/**
 * n8nのCodeノードは外部モジュールをimportできないため、workflow JSON内に
 * src/normalize.js・src/openai_request.js・src/assemble_report.js・src/render_markdown.jsと
 * 同一のロジックを手動で複製している（docs/ASSUMPTIONS.md参照）。
 * このテストは、それぞれが実際に同じ入力に対して同じ出力を返すことを実行レベルで確認し、
 * 手動同期の漏れ（コピー忘れ・修正漏れ）を検出する。
 *
 * テキスト差分比較（diff）ではなく実行結果の比較にしているのは、コメントや
 * 変数名などの些細な違いを誤検知せず、振る舞いの一致だけを検証するため。
 * ビルドスクリプトによる自動生成は導入していない（プロセスの複雑化を避けるため。
 * docs/ASSUMPTIONS.md参照）。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'sales-research-agent.json');
const TAVILY_FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'tavily');
const OPENAI_FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'openai');

function loadTavilyFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(TAVILY_FIXTURES_DIR, name), 'utf-8'));
}

function loadOpenAiFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(OPENAI_FIXTURES_DIR, name), 'utf-8'));
}

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
}

function findCodeNode(workflow, name) {
  const node = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.code' && n.name === name);
  if (!node) throw new Error(`workflow内にCodeノード"${name}"が見つかりません`);
  return node.parameters.jsCode;
}

/**
 * jsCode末尾のn8nノード参照部分（$('...')等）はvmサンドボックス内では動作しないため、
 * `const input = $('Fixed Test Input')`より前の関数宣言部分のみを取り出して実行する。
 * 実際のn8n Codeノードのサンドボックス（JS Task Runner）にはURL等のWeb APIが
 * 存在しないため、vmサンドボックスにもここでは意図的に何も注入しない。
 */
function loadFunctionsFromWorkflowCode(jsCode, functionNames) {
  const marker = "const input = $('Fixed Test Input')";
  const idx = jsCode.indexOf(marker);
  if (idx === -1) {
    throw new Error('想定した構造（末尾のn8nノード参照部分）が見つからず、同期チェックができません');
  }
  const functionsOnly = jsCode.slice(0, idx);

  const context = {};
  vm.createContext(context);
  const exposeStatements = functionNames.map((name) => `this.__${name} = ${name};`).join('\n');
  vm.runInContext(`${functionsOnly}\n${exposeStatements}`, context);

  const result = {};
  for (const name of functionNames) {
    if (typeof context[`__${name}`] !== 'function') {
      throw new Error(`workflow内のjsCodeから${name}関数を取り出せませんでした`);
    }
    result[name] = context[`__${name}`];
  }
  return result;
}

test('workflowのNormalizeノードとsrc/normalize.jsは、同一fixtureに対して同一の出力を返す（手動同期チェック）', () => {
  const workflow = loadWorkflow();
  const jsCode = findCodeNode(workflow, 'Normalize, Dedupe & Structure Output');
  const { buildResearchOutput: workflowBuildResearchOutput } = loadFunctionsFromWorkflowCode(jsCode, [
    'buildResearchOutput',
  ]);

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

test('workflowのBuild OpenAI RequestノードとSRC/openai_request.jsは、同一fixtureに対して同一のリクエストボディを返す（手動同期チェック）', () => {
  const workflow = loadWorkflow();
  const jsCode = findCodeNode(workflow, 'Build OpenAI Request');
  const { buildOpenAiRequestBody: workflowBuild } = loadFunctionsFromWorkflowCode(jsCode, ['buildOpenAiRequestBody']);

  const input = loadOpenAiFixture('input.json');
  const tavilyOutput = loadOpenAiFixture('tavily_output_ok.json');

  const fromModule = buildOpenAiRequestBody({ input, sources: tavilyOutput.sources });
  const fromWorkflow = JSON.parse(JSON.stringify(workflowBuild({ input, sources: tavilyOutput.sources })));

  assert.deepEqual(fromWorkflow, fromModule);
});

test('workflowのValidate & Assemble ReportノードとSRC/assemble_report.js・render_markdown.jsは、同一fixtureに対して同一の出力を返す（手動同期チェック）', () => {
  const workflow = loadWorkflow();
  const jsCode = findCodeNode(workflow, 'Validate & Assemble Report');
  const { assembleReport: workflowAssemble, renderMarkdown: workflowRender } = loadFunctionsFromWorkflowCode(jsCode, [
    'assembleReport',
    'renderMarkdown',
  ]);

  const input = loadOpenAiFixture('input.json');
  const tavilyOutput = loadOpenAiFixture('tavily_output_ok.json');
  const responseFixtures = [
    'response_ok.json',
    'response_refusal.json',
    'response_incomplete.json',
    'response_empty.json',
    'response_api_error.json',
    'response_invalid_schema.json',
    'response_invalid_reference.json',
  ];

  for (const fixtureName of responseFixtures) {
    const openAiResponse = loadOpenAiFixture(fixtureName);

    const fromModule = assembleReport({ input, tavilyOutput, openAiResponse });
    const fromWorkflow = JSON.parse(JSON.stringify(workflowAssemble({ input, tavilyOutput, openAiResponse })));

    const { generated_at: _a, ...moduleMetaRest } = fromModule.meta;
    const { generated_at: _b, ...workflowMetaRest } = fromWorkflow.meta;

    assert.deepEqual(workflowMetaRest, moduleMetaRest, `${fixtureName}: metaが一致しません（同期漏れの可能性）`);
    assert.deepEqual(fromWorkflow.report, fromModule.report, `${fixtureName}: reportが一致しません（同期漏れの可能性）`);

    // Markdown生成は時刻依存(generated_at)があるため、同一のmeta/reportを両実装に
    // 与えて文字列が一致することを確認する（実行時刻の違いによる誤検知を避ける）。
    const markdownFromModule = renderMarkdown(fromModule);
    const markdownFromWorkflow = workflowRender(fromModule);
    assert.equal(markdownFromWorkflow, markdownFromModule, `${fixtureName}: Markdown出力が一致しません（同期漏れの可能性）`);
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
 * ajv等の外部モジュールへの依存（require/importで解決できない）も同様に検査する。
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

test('src配下のロジックとworkflow内の全Codeノードは、n8n Codeノードのサンドボックスで未提供のAPI（URL/require/ajv等）を使用していない', () => {
  const workflow = loadWorkflow();
  const srcFiles = ['normalize.js', 'openai_request.js', 'assemble_report.js', 'render_markdown.js'];
  const codeNodeNames = ['Normalize, Dedupe & Structure Output', 'Build OpenAI Request', 'Validate & Assemble Report'];

  const forbiddenPatterns = [
    { pattern: /\bnew\s+URL\s*\(/, label: 'new URL(...)' },
    { pattern: /\bURLSearchParams\b/, label: 'URLSearchParams' },
    { pattern: /\brequire\s*\(/, label: 'require(...)' },
    { pattern: /\bfetch\s*\(/, label: 'fetch(...)' },
    { pattern: /from\s+['"]ajv['"]/, label: "import ... from 'ajv'" },
  ];

  for (const fileName of srcFiles) {
    const source = stripComments(fs.readFileSync(path.join(__dirname, '..', 'src', fileName), 'utf-8'));
    for (const { pattern, label } of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `src/${fileName}で${label}が使われています（n8n Codeノードのサンドボックスでは利用不可）`);
    }
  }

  for (const nodeName of codeNodeNames) {
    const jsCode = stripComments(findCodeNode(workflow, nodeName));
    for (const { pattern, label } of forbiddenPatterns) {
      assert.equal(
        pattern.test(jsCode),
        false,
        `workflow内のCodeノード"${nodeName}"で${label}が使われています（n8n Codeノードのサンドボックスでは利用不可）`
      );
    }
  }
});
