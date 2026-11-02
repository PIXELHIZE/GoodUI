import { describe, expect, it } from 'vitest';
import { DEFAULT_TAILWIND_RULES, getTailwindRules, TAILWIND_RULE_NAMES, validatePolicy, type Policy, type PolicyRule } from '@pixelhize/goodui-core';
import { applyPreset } from '../src/templates.js';
import type { Preset } from '../src/installer.js';

function baseline(): Policy {
  return {
    $schema: './.goodui/schema.json',
    version: 1,
    rules: [{ id: 'no-eval', kind: 'restricted-api', globals: ['eval'], reason: 'Do not execute strings as code.' }],
  };
}

describe('policy profile templates', () => {
  it('localizes only newly inserted built-in contracts and preserves user-authored prose', () => {
    const input = baseline();
    input.rules.push({ id: 'strict-ts-syntax', kind: 'restricted-syntax', enabled: false, selectors: ['TSAnyKeyword'], reason: 'Use explicit TypeScript types and checked nullable values.', suggestion: '사용자가 직접 작성한 안내' });
    input.exceptions = [{ ruleId: 'strict-ts-syntax', files: ['legacy/**'], reason: 'Approved English reason.' }];
    const { policy } = applyPreset(input, 'full', 'ko');
    expect(policy.rules[0]).toEqual(input.rules[0]);
    expect(policy.rules[1]).toEqual(input.rules[1]);
    expect(policy.exceptions).toEqual(input.exceptions);
    expect(policy.rules.find(rule => rule.id === 'function-budget')).toMatchObject({ reason: '함수를 검토하고 테스트하기 쉬운 크기로 유지하세요.', suggestion: expect.stringContaining('동작을 유지하면서') });
    expect(policy.rules.find(rule => rule.id === 'image-alternatives')).toMatchObject({ reason: '보조 기술을 위한 이미지 대체 텍스트를 명시하세요.' });
    expect(applyPreset(policy, 'full', 'en').policy).toEqual(policy);
    expect(input.rules).toHaveLength(2);
    expect(validatePolicy(policy).valid).toBe(true);
  });

  it('translates profile-preservation warnings while keeping IDs and kind values exact', () => {
    const input = baseline();
    input.rules.push({ id: 'button-intent', kind: 'restricted-api', globals: ['confirm'], reason: 'Custom project rule.' });
    input.presets = ['tailwind'];
    input.tailwind = { rules: ['no-unknown-classes'] };
    const { policy, warnings } = applyPreset(input, 'full', 'ko');
    expect(warnings).toEqual([
      '명시된 기존 tailwind.rules를 보존했습니다. full preset은 디자인 규칙을 교체하거나 추가로 활성화하지 않았습니다.',
      '기존 정책 ID "button-intent"는 preset의 "component-contracts" 대신 "restricted-api"를 사용합니다. 기존 규칙을 보존했습니다.',
    ]);
    expect(policy.rules.find(rule => rule.id === 'button-intent')).toEqual(input.rules[1]);
  });
  it.each(['project', 'development', 'tailwind', 'full'] as const)('produces a valid %s policy without mutating its input', preset => {
    const input = baseline();
    const snapshot = structuredClone(input);
    const result = applyPreset(input, preset);
    expect(validatePolicy(result.policy)).toMatchObject({ valid: true, errors: [] });
    expect(input).toEqual(snapshot);
    expect(result.policy).not.toBe(input);
    expect(result.policy.rules[0]).not.toBe(input.rules[0]);
  });

  it('keeps project exactly as supplied instead of inserting an extra default rule', () => {
    const input = baseline();
    input.rules = [{ id: 'custom-api', kind: 'restricted-api', globals: ['fetch'], reason: 'Use the client.' }];
    expect(applyPreset(input, 'project')).toEqual({ policy: input, warnings: [] });
  });

  it('adds explicit syntax and size budgets without imposing framework-specific names or exports', () => {
    const { policy, warnings } = applyPreset(baseline(), 'development');
    expect(warnings).toEqual([]);
    expect(policy.rules.map(rule => rule.id)).toEqual(['no-eval', 'strict-ts-syntax', 'function-budget', 'file-budget']);
    expect(policy.rules[1]).toMatchObject({ kind: 'restricted-syntax', selectors: ['TSAnyKeyword', 'TSNonNullExpression'] });
    expect(policy.rules[2]).toMatchObject({ kind: 'function-limits', maxParams: 5, maxLines: 100, maxStatements: 30, maxDepth: 4, maxComplexity: 15 });
    expect(policy.rules[3]).toMatchObject({ kind: 'file-conventions', maxLines: 400, maxBytes: 48000 });
    expect(policy.rules.every(rule => rule.files === undefined && rule.kind !== 'export-contracts' && !('nameCase' in rule))).toBe(true);
    expect(policy.presets).toBeUndefined();
  });

  it('keeps the four default style checks implicit for the tailwind profile', () => {
    const { policy, warnings } = applyPreset(baseline(), 'tailwind');
    expect(policy.rules).toEqual(baseline().rules);
    expect(policy.presets).toEqual(['tailwind']);
    expect(policy.tailwind?.rules).toBeUndefined();
    expect(getTailwindRules(policy)).toEqual(DEFAULT_TAILWIND_RULES);
    expect(warnings).toEqual([]);
  });

  it('combines all six style checks, three development contracts and two accessible UI contracts', () => {
    const { policy, warnings } = applyPreset(baseline(), 'full');
    expect(warnings).toEqual([]);
    expect(getTailwindRules(policy)).toEqual(TAILWIND_RULE_NAMES);
    expect(policy.rules).toHaveLength(6);
    const button = policy.rules.find(rule => rule.id === 'button-intent');
    const image = policy.rules.find(rule => rule.id === 'image-alternatives');
    expect(button).toMatchObject({ kind: 'component-contracts', tags: ['button'], requiredProps: ['type'], propValues: { type: ['button', 'submit', 'reset'] } });
    expect(image).toMatchObject({ kind: 'component-contracts', tags: ['img'], requiredProps: ['alt'] });
    expect(image).not.toHaveProperty('nonEmptyProps');
    expect(button).not.toHaveProperty('allowDynamicProps');
    expect(image).not.toHaveProperty('allowDynamicProps');
  });

  it('preserves disabled and customized same-id rules, file scope, exceptions and policy metadata', () => {
    const input = baseline();
    const disabled: PolicyRule = { id: 'strict-ts-syntax', kind: 'restricted-syntax', enabled: false, files: ['src/legacy/**'], selectors: ['TSAnyKeyword'], reason: 'Migration is pending.', suggestion: 'Keep the approved exception.' };
    const customBudget: PolicyRule = { id: 'function-budget', kind: 'function-limits', maxLines: 250, reason: 'Reviewed project budget.' };
    input.files = ['src/**'];
    input.ignores = ['src/generated/**'];
    input.rules.push(disabled, customBudget);
    input.exceptions = [{ ruleId: disabled.id, files: ['src/legacy/file.ts'], reason: 'Reviewed legacy module.' }];
    const { policy, warnings } = applyPreset(input, 'full');
    expect(warnings).toEqual([]);
    expect(policy.rules.find(rule => rule.id === disabled.id)).toEqual(disabled);
    expect(policy.rules.find(rule => rule.id === customBudget.id)).toEqual(customBudget);
    expect(policy.files).toEqual(input.files);
    expect(policy.ignores).toEqual(input.ignores);
    expect(policy.exceptions).toEqual(input.exceptions);
    expect(policy.$schema).toBe(input.$schema);
    expect(policy.rules.filter(rule => rule.id === disabled.id)).toHaveLength(1);
  });

  it('preserves a different-kind id collision and reports it instead of overwriting the rule', () => {
    const input = baseline();
    const collision: PolicyRule = { id: 'button-intent', kind: 'restricted-api', globals: ['confirm'], enabled: false, reason: 'This id already has a project meaning.' };
    input.rules.push(collision);
    const { policy, warnings } = applyPreset(input, 'full');
    expect(policy.rules.find(rule => rule.id === collision.id)).toEqual(collision);
    expect(policy.rules.filter(rule => rule.id === collision.id)).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('button-intent');
    expect(warnings[0]).toContain('preserved');
    expect(validatePolicy(policy).valid).toBe(true);
  });

  it('keeps explicit style rules and every custom native style option', () => {
    const input = baseline();
    input.presets = ['tailwind'];
    input.tailwind = {
      rules: ['no-unknown-classes'], themeFiles: ['src/theme.css'],
      allowClasses: ['approved-*'], denyClasses: ['forbidden-*'], allowArbitrary: ['w-[40px]'],
      classFunctions: ['joinClasses'], variantFunctions: ['variants'],
      componentImports: ['@ui/**'], ignoreImports: ['@ui/internal/**'], note: 'Project instructions.',
    };
    input.exceptions = [{ ruleId: 'goodui/no-unknown-classes', files: ['src/legacy/**'], reason: 'Reviewed legacy stylesheet.' }];
    const { policy, warnings } = applyPreset(input, 'full');
    expect(policy.tailwind).toEqual(input.tailwind);
    expect(policy.presets).toEqual(['tailwind']);
    expect(policy.exceptions).toEqual(input.exceptions);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('tailwind.rules');
    expect(validatePolicy(policy).valid).toBe(true);
  });

  it('preserves native options while enabling six checks when no explicit rule list exists', () => {
    const input = baseline();
    input.presets = ['tailwind'];
    input.tailwind = { themeFiles: ['theme.css'], note: 'Keep this note.' };
    const { policy, warnings } = applyPreset(input, 'full');
    expect(policy.tailwind).toEqual({ ...input.tailwind, rules: [...TAILWIND_RULE_NAMES] });
    expect(warnings).toEqual([]);
  });

  it.each(['project', 'development', 'tailwind', 'full'] as const)('does not duplicate contracts or presets when %s is applied repeatedly', preset => {
    const once = applyPreset(baseline(), preset).policy;
    const twice = applyPreset(once, preset).policy;
    expect(twice).toEqual(once);
    expect(new Set(twice.rules.map(rule => rule.id)).size).toBe(twice.rules.length);
    expect(twice.presets ? new Set(twice.presets).size : 0).toBe(twice.presets?.length ?? 0);
    expect(validatePolicy(twice).valid).toBe(true);
  });

  it('rejects unknown runtime profile values without mutating the policy', () => {
    const input = baseline();
    const before = structuredClone(input);
    expect(() => applyPreset(input, 'unknown' as Preset)).toThrow('Preset must be');
    expect(input).toEqual(before);
  });
});
