import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'schema', 'sales_research_output.schema.json');

let cachedValidateFn = null;

function getSchemaValidateFn() {
  if (cachedValidateFn) return cachedValidateFn;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  const ajv = new Ajv({ allErrors: true, strict: true });
  cachedValidateFn = ajv.compile(schema);
  return cachedValidateFn;
}

/** JSON Schema (schema/sales_research_output.schema.json) に対する構造検証。 */
export function validateSchema(data) {
  const validateFn = getSchemaValidateFn();
  const valid = validateFn(data);
  return { valid, errors: valid ? [] : (validateFn.errors ?? []) };
}

function collectSourceIdRefs(data) {
  const refs = [];
  const pushRefs = (ids, refPath) => {
    if (!Array.isArray(ids)) return;
    for (const id of ids) refs.push({ id, path: refPath });
  };

  const overview = data?.company_profile?.business_overview;
  if (overview) pushRefs(overview.source_ids, 'company_profile.business_overview.source_ids');

  (data?.company_profile?.recent_news ?? []).forEach((item, i) => {
    pushRefs(item.source_ids, `company_profile.recent_news[${i}].source_ids`);
  });

  (data?.company_profile?.org_signals ?? []).forEach((item, i) => {
    pushRefs(item.source_ids, `company_profile.org_signals[${i}].source_ids`);
  });

  (data?.proposal_hypotheses ?? []).forEach((item, i) => {
    pushRefs(item.evidence_source_ids, `proposal_hypotheses[${i}].evidence_source_ids`);
  });

  return refs;
}

/**
 * JSON Schemaでは表現できない業務ルールを検証する。
 * - source_ids / evidence_source_ids が実在する sources[].id を参照していること
 * - 各仮説の evidence_source_ids が1件以上であること（根拠なし仮説を禁止）
 */
export function validateBusinessRules(data) {
  const errors = [];
  const sourceIds = new Set((data?.sources ?? []).map((s) => s.id));

  for (const ref of collectSourceIdRefs(data)) {
    if (!sourceIds.has(ref.id)) {
      errors.push(`${ref.path}: 存在しないsource id "${ref.id}" を参照しています`);
    }
  }

  (data?.proposal_hypotheses ?? []).forEach((item, i) => {
    if (!Array.isArray(item.evidence_source_ids) || item.evidence_source_ids.length === 0) {
      errors.push(`proposal_hypotheses[${i}].evidence_source_ids: 仮説の根拠となるsourceが1件も指定されていません`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/** JSON Schema検証 → 業務ルール検証の順で実行する。スキーマ違反時は業務ルール検証を行わない。 */
export function validate(data) {
  const schemaResult = validateSchema(data);
  if (!schemaResult.valid) {
    return { valid: false, schemaErrors: schemaResult.errors, businessRuleErrors: [] };
  }
  const businessResult = validateBusinessRules(data);
  return {
    valid: businessResult.valid,
    schemaErrors: [],
    businessRuleErrors: businessResult.errors,
  };
}
