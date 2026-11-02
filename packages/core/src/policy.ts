import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import { minimatch } from "minimatch";
import esquery from 'esquery';
import { AI_SLOP_RULE_NAMES, DEFAULT_AI_SLOP_RULES, DEFAULT_TAILWIND_RULES, TAILWIND_RULE_NAMES, type AiSlopRuleName, type Policy, type PolicyRule, type PolicyValidationResult, type TailwindRuleName } from "./types.js";
import { PolicyError } from './errors.js';
import { localizeMessage, type LocaleOptions } from './locale.js';
export { PolicyError } from './errors.js';

export const policySchema = JSON.parse(
  readFileSync(new URL("../schema.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile<Policy>(policySchema);

export function validatePolicy(value: unknown, options: LocaleOptions = {}): PolicyValidationResult {
  const locale = options.locale ?? 'en';
  if (!validateSchema(value)) {
    const errors = (validateSchema.errors ?? []).map(
      (error) => localizeMessage(`${error.instancePath || "/"}: ${error.message ?? "invalid policy"}`, locale),
    );
    return { valid: false, errors: [...new Set(errors)] };
  }

  const errors: string[] = [];
  const ids = new Set<string>();
  for (const rule of value.rules) {
    if (ids.has(rule.id)) errors.push(`Duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
    if (rule.kind === 'restricted-syntax') {
      for (const selector of rule.selectors) {
        try { esquery.parse(selector); }
        catch { errors.push(`Rule ${rule.id}: invalid AST selector ${JSON.stringify(selector)}.`); }
      }
    }
    if (rule.kind === 'component-contracts') {
      const required = new Set(rule.requiredProps ?? []);
      for (const name of rule.forbiddenProps ?? []) {
        if (required.has(name) || rule.nonEmptyProps?.includes(name) || Object.hasOwn(rule.propValues ?? {}, name)) {
          errors.push(`Rule ${rule.id}: prop ${JSON.stringify(name)} cannot be forbidden and required or value-constrained.`);
        }
      }
    }
  }
  const tailwindEnabled = value.presets?.includes('tailwind') === true;
  if (!tailwindEnabled && getAiSlopRules(value).length === 0 && !value.rules.some((rule) => rule.enabled !== false)) {
    errors.push("Policy must contain at least one enabled rule.");
  }
  for (const exception of value.exceptions ?? []) {
    const knownAiSlop = (value.aiSlop !== undefined || value.presets?.includes('ai-slop')) && AI_SLOP_RULE_NAMES.some(name => exception.ruleId === `goodui/${name}`);
    if (!ids.has(exception.ruleId) && !(tailwindEnabled && TAILWIND_RULE_NAMES.some(name => exception.ruleId === `goodui/${name}`)) && !knownAiSlop) {
      errors.push(`Exception references unknown rule id: ${exception.ruleId}`);
    }
  }
  return errors.length === 0
    ? { valid: true, errors: [], policy: value }
    : { valid: false, errors: errors.map(message => localizeMessage(message, locale)) };
}

/** Native design-system contracts are enabled only by an explicit preset. */
export function getTailwindRules(policy: Policy): readonly TailwindRuleName[] {
  return policy.presets?.includes('tailwind') ? policy.tailwind?.rules ?? DEFAULT_TAILWIND_RULES : [];
}

/** Existing policies stay off; an explicit switch overrides preset membership. */
export function getAiSlopRules(policy: Policy): readonly AiSlopRuleName[] {
  if (!(policy.aiSlop?.enabled ?? policy.presets?.includes('ai-slop') ?? false)) return [];
  return AI_SLOP_RULE_NAMES.filter(name => policy.aiSlop?.rules?.[name] ?? DEFAULT_AI_SLOP_RULES.includes(name));
}

export function definePolicy(input: Policy, options: LocaleOptions = {}): Policy {
  const result = validatePolicy(input, options);
  if (!result.valid || !result.policy) {
    throw new PolicyError("INVALID_POLICY", result.errors.join("\n"), { errors: result.errors });
  }
  return result.policy;
}

export function matchesFile(file: string, patterns: readonly string[]): boolean {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  return patterns.some((pattern) => minimatch(normalized, pattern.replaceAll("\\", "/"), { dot: true, nonegate: true }));
}

/** Match source/module/property names without collapsing their leading ./ prefix. */
export function matchesPattern(value: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => minimatch(value, pattern, { dot: true, nonegate: true }));
}

export function isRuleApplicable(policy: Policy, rule: PolicyRule, relativeFile: string): boolean {
  if (rule.enabled === false) return false;
  if (policy.files && !matchesFile(relativeFile, policy.files)) return false;
  if (policy.ignores && matchesFile(relativeFile, policy.ignores)) return false;
  if (rule.files && !matchesFile(relativeFile, rule.files)) return false;
  return !(policy.exceptions ?? []).some(
    (exception) => exception.ruleId === rule.id && exception.reason.trim().length > 0 && matchesFile(relativeFile, exception.files),
  );
}
