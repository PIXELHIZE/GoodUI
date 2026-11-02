import { PolicyError, TAILWIND_RULE_NAMES, type LocaleInput, type Policy, type PolicyRule } from '@pixelhize/goodui-core';
import { localizeCliMessage } from './locale.js';
import type { Preset } from './installer.js';

const developmentRules: PolicyRule[] = [
  {
    id: 'strict-ts-syntax',
    kind: 'restricted-syntax',
    selectors: ['TSAnyKeyword', 'TSNonNullExpression'],
    reason: 'Use explicit TypeScript types and checked nullable values.',
    suggestion: 'Replace any with a specific type or unknown, and narrow null or undefined before use.',
  },
  {
    id: 'function-budget',
    kind: 'function-limits',
    maxParams: 5,
    maxLines: 100,
    maxStatements: 30,
    maxDepth: 4,
    maxComplexity: 15,
    reason: 'Keep functions small enough to review and test.',
    suggestion: 'Extract focused functions or simplify parameters and branching while preserving behavior.',
  },
  {
    id: 'file-budget',
    kind: 'file-conventions',
    maxLines: 400,
    maxBytes: 48000,
    reason: 'Keep source files focused and reviewable.',
    suggestion: 'Split independent responsibilities into focused modules while preserving their public interfaces.',
  },
];

const fullComponentRules: PolicyRule[] = [
  {
    id: 'button-intent',
    kind: 'component-contracts',
    tags: ['button'],
    requiredProps: ['type'],
    propValues: { type: ['button', 'submit', 'reset'] },
    reason: 'Buttons must declare their intended browser behavior.',
    suggestion: 'Set type to button, submit, or reset to match the action.',
  },
  {
    id: 'image-alternatives',
    kind: 'component-contracts',
    tags: ['img'],
    requiredProps: ['alt'],
    reason: 'Images must declare an alternative for assistive technologies.',
    suggestion: 'Add descriptive alt text, or alt="" for a decorative image.',
  },
];

/** Adds missing contracts without taking ownership of the user's existing policy. */
export function applyPreset(input: Policy, preset: Preset, locale?: LocaleInput): { policy: Policy; warnings: string[] } {
  if (!['project', 'development', 'tailwind', 'full'].includes(preset)) {
    throw new PolicyError('INVALID_PRESET', localizeCliMessage('Preset must be project, development, tailwind, or full.', locale));
  }
  const policy = structuredClone(input);
  const warnings: string[] = [];

  function addMissing(rule: PolicyRule): void {
    const existing = policy.rules.find(candidate => candidate.id === rule.id);
    if (!existing) {
      const added = structuredClone(rule);
      added.reason = localizeCliMessage(added.reason, locale);
      if (added.suggestion) added.suggestion = localizeCliMessage(added.suggestion, locale);
      policy.rules.push(added);
    }
    else if (existing.kind !== rule.kind) {
      warnings.push(`Existing policy id ${JSON.stringify(rule.id)} uses ${JSON.stringify(existing.kind)} instead of preset kind ${JSON.stringify(rule.kind)}; the existing rule was preserved.`);
    }
  }

  if (preset === 'development' || preset === 'full') developmentRules.forEach(addMissing);
  if (preset === 'tailwind' || preset === 'full') {
    policy.presets = [...new Set([...(policy.presets ?? []), 'tailwind' as const])];
  }
  if (preset === 'full') {
    if (policy.tailwind?.rules !== undefined) {
      warnings.push('Existing explicit tailwind.rules were preserved; the full preset did not replace or enable additional style rules.');
    } else {
      policy.tailwind = { ...policy.tailwind, rules: [...TAILWIND_RULE_NAMES] };
    }
    fullComponentRules.forEach(addMissing);
  }
  return { policy, warnings: warnings.map(message => localizeCliMessage(message, locale)) };
}
