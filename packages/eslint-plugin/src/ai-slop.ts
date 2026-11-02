import { ESLintUtils } from '@typescript-eslint/utils';
import type { Linter } from 'eslint';
import {
  AI_SLOP_RULE_NAMES, getAiSlopRuleCatalog, getAiSlopRules, matchesFile, validatePolicy,
  type AiSlopPolicy, type AiSlopRuleName, type Locale, type Policy,
} from '@pixelhize/goodui-core';
import { relativePath } from './resolution.js';
import { contextLocale } from './localization.js';
import type { AstNode } from './design-system/ui.js';
import { createStyleVisitors } from './ai-slop-style.js';
import { createContentVisitors } from './ai-slop-content.js';

export interface AiSlopContext { ruleName: AiSlopRuleName; rootDir: string; policy: Policy; settings: AiSlopPolicy; locale: Locale }
export type AiSlopReport = (node: AstNode, message: { en: string; ko: string }) => void;
interface AiSlopOptions { rootDir: string; policy: Policy }

export function isAiSlopApplicable(policy: Policy, name: AiSlopRuleName, file: string): boolean {
  if (!getAiSlopRules(policy).includes(name)) return false;
  if (policy.files && !matchesFile(file, policy.files) || policy.ignores && matchesFile(file, policy.ignores)) return false;
  if (policy.aiSlop?.files && !matchesFile(file, policy.aiSlop.files) || policy.aiSlop?.ignores && matchesFile(file, policy.aiSlop.ignores)) return false;
  return !(policy.exceptions ?? []).some(exception => exception.ruleId === `goodui/${name}` && matchesFile(file, exception.files));
}

function createRule(ruleName: AiSlopRuleName) {
  return ESLintUtils.RuleCreator.withoutDocs<[AiSlopOptions], 'violation'>({
    meta: {
      type: 'problem', docs: { description: `Check the explicit AI-slop pattern ${ruleName}.` },
      schema: [{ type: 'object', required: ['rootDir', 'policy'], additionalProperties: false, properties: { rootDir: { type: 'string' }, policy: { type: 'object' } } }],
      messages: { violation: '{{detail}} {{reasonLabel}}: {{reason}} {{suggestionLabel}}: {{suggestion}}{{note}}' },
    },
    defaultOptions: [{ rootDir: '.', policy: { version: 1, rules: [] } }],
    create(context) {
      const { rootDir, policy } = context.options[0];
      const locale = contextLocale(context);
      const validation = validatePolicy(policy, { locale });
      if (!validation.valid) throw new Error(validation.errors.join('; '));
      if (!isAiSlopApplicable(policy, ruleName, relativePath(rootDir, context.filename))) return {};
      const entry = getAiSlopRuleCatalog(locale).find(rule => rule.name === ruleName)!;
      const seen = new Set<string>();
      const report: AiSlopReport = (node, message) => {
        const detail = message[locale];
        const key = `${node.range?.join(':')}:${detail}`;
        if (seen.has(key)) return;
        seen.add(key);
        context.report({ node: node as any, messageId: 'violation', data: {
          detail, reason: entry.reason, suggestion: entry.suggestion,
          reasonLabel: locale === 'ko' ? '이유' : 'Reason', suggestionLabel: locale === 'ko' ? '제안' : 'Suggestion',
          note: policy.aiSlop?.note ? ` ${policy.aiSlop.note}` : '',
        } });
      };
      const options: AiSlopContext = { ruleName, rootDir, policy, settings: policy.aiSlop ?? {}, locale };
      return (AI_SLOP_RULE_NAMES.slice(0, 6).includes(ruleName) ? createStyleVisitors(context, options, report) : createContentVisitors(context, options, report)) as any;
    },
  });
}

export const aiSlopRules = Object.fromEntries(AI_SLOP_RULE_NAMES.map(name => [name, createRule(name)]));

export function aiSlopConfigs(rootDir: string, policy: Policy, files: string[]): Linter.Config[] {
  const selected = getAiSlopRules(policy);
  if (!selected.length) return [];
  return [{ name: 'goodui/ai-slop', files, rules: Object.fromEntries(selected.map(name => [`goodui/${name}`, ['error', { rootDir, policy }]])) }];
}
