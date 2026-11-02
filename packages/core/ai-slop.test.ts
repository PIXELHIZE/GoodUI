import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AI_SLOP_RULE_NAMES, DEFAULT_AI_SLOP_RULES, getAiSlopRuleCatalog, getAiSlopRules,
  getPolicySchema, getPresetCatalog, getTailwindRules, readPolicy, validatePolicy,
  writePolicy, type AiSlopRuleName, type Policy,
} from './src/index.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const projectPolicy = (): Policy => ({ version: 1, rules: [{ id: 'user-rule', kind: 'restricted-api', globals: ['eval'], reason: 'Keep the project reason unchanged.' }] });
const aiOnly = (): Policy => ({ version: 1, presets: ['ai-slop'], rules: [] });
const disabledDefaults = () => Object.fromEntries(DEFAULT_AI_SLOP_RULES.map(name => [name, false])) as Partial<Record<AiSlopRuleName, boolean>>;

describe('AI-slop group activation and compatibility', () => {
  it('keeps the fixed rule order, with exactly ten defaults and three opt-in rules', () => {
    expect(AI_SLOP_RULE_NAMES).toEqual([
      'no-gradient-text', 'no-purple-gradients', 'no-glassmorphism', 'no-decorative-blobs',
      'no-hover-lift', 'no-bounce-animation', 'no-emoji-icons', 'no-generic-copy',
      'no-placeholder-copy', 'no-placeholder-links', 'no-nested-cards', 'no-oversized-radius',
      'no-generic-fonts',
    ]);
    expect(DEFAULT_AI_SLOP_RULES).toEqual(AI_SLOP_RULE_NAMES.slice(0, 10));
  });

  it('leaves existing policies and configuration-only groups off', () => {
    const existing = projectPolicy();
    expect(getAiSlopRules(existing)).toEqual([]);
    for (const aiSlop of [{}, { rules: { 'no-gradient-text': true } }, { enabled: false }]) {
      const policy = { ...existing, aiSlop };
      expect(getAiSlopRules(policy)).toEqual([]);
      expect(validatePolicy(policy).valid).toBe(true);
    }
    expect(existing).not.toHaveProperty('aiSlop');
    expect(getAiSlopRules({ ...existing, presets: ['tailwind'] })).toEqual([]);
  });

  it('enables defaults through the preset or an explicit switch without needing Tailwind', () => {
    for (const policy of [aiOnly(), { version: 1 as const, rules: [], aiSlop: { enabled: true } }]) {
      expect(validatePolicy(policy)).toMatchObject({ valid: true, errors: [] });
      expect(getAiSlopRules(policy)).toEqual(DEFAULT_AI_SLOP_RULES);
      expect(getTailwindRules(policy)).toEqual([]);
    }
    const policy: Policy = { ...aiOnly(), presets: ['tailwind', 'ai-slop'] };
    expect(getTailwindRules(policy).length).toBeGreaterThan(0);
    expect(getAiSlopRules(policy)).toEqual(DEFAULT_AI_SLOP_RULES);
  });

  it('lets an explicit switch override preset membership and preserves deterministic override order', () => {
    const disabled: Policy = { ...projectPolicy(), presets: ['ai-slop'], aiSlop: { enabled: false, rules: { 'no-nested-cards': true } } };
    expect(getAiSlopRules(disabled)).toEqual([]);
    expect(validatePolicy(disabled).valid).toBe(true);
    const enabled: Policy = { ...projectPolicy(), aiSlop: { enabled: true, rules: { 'no-generic-fonts': true, 'no-gradient-text': false, 'no-nested-cards': true } } };
    expect(getAiSlopRules(enabled)).toEqual([...DEFAULT_AI_SLOP_RULES.slice(1), 'no-nested-cards', 'no-generic-fonts']);
    expect(validatePolicy(enabled).valid).toBe(true);
  });

  it('requires an actually enabled check when no ordinary or Tailwind rules are active', () => {
    for (const policy of [
      { ...aiOnly(), aiSlop: { enabled: false } },
      { version: 1, rules: [], aiSlop: { enabled: true, rules: disabledDefaults() } },
      { ...aiOnly(), aiSlop: { rules: disabledDefaults() } },
    ]) {
      expect(validatePolicy(policy)).toMatchObject({ valid: false, errors: ['Policy must contain at least one enabled rule.'] });
    }
    expect(validatePolicy({ version: 1, rules: [], aiSlop: {} }).valid).toBe(false);
    expect(validatePolicy({ version: 1, rules: [], aiSlop: { enabled: true, rules: { ...disabledDefaults(), 'no-nested-cards': true } } }).valid).toBe(true);
    expect(validatePolicy({ ...projectPolicy(), aiSlop: { enabled: true, rules: disabledDefaults() } }).valid).toBe(true);
  });
});

describe('AI-slop policy schema and exceptions', () => {
  it('accepts all known boolean overrides and independent source/allow scopes', () => {
    const policy: Policy = {
      ...aiOnly(), files: ['src/**'], ignores: ['src/generated/**'],
      aiSlop: {
        enabled: true, rules: Object.fromEntries(AI_SLOP_RULE_NAMES.map(name => [name, true])),
        files: ['src/ui/**'], ignores: ['src/ui/legacy/**'], allowClasses: ['hover:-translate-y-1'],
        allowPhrases: ['Keep This English Phrase.'], allowFonts: ['Inter'], note: 'My project note.',
      },
    };
    expect(validatePolicy(policy).policy).toBe(policy);
    expect(getAiSlopRules(policy)).toEqual(AI_SLOP_RULE_NAMES);
    expect(validatePolicy({ ...policy, aiSlop: { enabled: true, rules: {}, ignores: [], allowClasses: [], allowPhrases: [], allowFonts: [] } }).valid).toBe(true);
  });

  it('rejects unknown rule names, nonboolean overrides and unknown options even while the group is off', () => {
    const invalidOptions = [
      { enabled: false, rules: { 'no-unknown-ai-pattern': true } },
      { enabled: false, rules: { 'no-gradient-text': 'false' } },
      { enabled: true, rules: { 'no-gradient-text': 1 } },
      { enabled: 'true' }, { rules: [] }, { extra: true }, { files: [] },
      { allowClasses: [''] }, { allowPhrases: ['  '] }, { allowFonts: ['Inter', 'Inter'] },
    ];
    for (const aiSlop of invalidOptions) expect(validatePolicy({ ...projectPolicy(), aiSlop }).valid, JSON.stringify(aiSlop)).toBe(false);
    expect(validatePolicy({ ...projectPolicy(), presets: ['unknown-ai-preset'] }).valid).toBe(false);
    expect(validatePolicy({ ...projectPolicy(), presets: ['ai-slop', 'ai-slop'] }).valid).toBe(false);
  });

  it('recognizes every AI exception whenever the group is configured, including disabled or opt-in rules', () => {
    const exceptions = AI_SLOP_RULE_NAMES.map(name => ({ ruleId: `goodui/${name}`, files: ['legacy/**'], reason: 'Intentional project exception.' }));
    for (const configuration of [
      { aiSlop: { enabled: false } },
      { aiSlop: {} },
      { presets: ['ai-slop'] },
      { presets: ['ai-slop'], aiSlop: { enabled: false } },
    ]) expect(validatePolicy({ ...projectPolicy(), ...configuration, exceptions }).valid).toBe(true);
    expect(validatePolicy({ ...projectPolicy(), exceptions }).valid).toBe(false);
    expect(validatePolicy({ ...projectPolicy(), aiSlop: { enabled: false }, exceptions: [{ ruleId: 'goodui/no-missing-pattern', files: ['**'], reason: 'Unknown.' }] }).valid).toBe(false);
  });

  it('localizes invalid options and keeps the JSON pointer and property names stable', () => {
    const value = { ...projectPolicy(), aiSlop: { enabled: true, rules: { 'no-gradient-text': 'true' } } };
    const english = validatePolicy(value, { locale: 'en' });
    const korean = validatePolicy(value, { locale: 'ko' });
    expect(english.valid).toBe(false);
    expect(korean.errors).toHaveLength(english.errors.length);
    expect(korean.errors.every(error => /[가-힣]/.test(error))).toBe(true);
    expect(korean.errors.some(error => error.startsWith('/aiSlop/rules/no-gradient-text:'))).toBe(true);
  });

  it('round-trips policy prose and disabled exceptions without silently enabling or translating them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goodui-ai-policy-')); roots.push(root);
    const policy: Policy = { ...projectPolicy(), aiSlop: { enabled: false, allowPhrases: ['Unlock your potential'], note: 'Keep my English note.' }, exceptions: [{ ruleId: 'goodui/no-generic-copy', files: ['legacy/**'], reason: 'My English exception.' }] };
    const created = await writePolicy(root, policy, { expectedRevision: null, locale: 'ko' });
    const loaded = await readPolicy(root, undefined, { locale: 'ko' });
    expect(loaded).toEqual(created);
    expect(loaded.policy).toEqual(policy);
    expect(getAiSlopRules(loaded.policy)).toEqual([]);
    expect(await readFile(created.path, 'utf8')).toContain('Unlock your potential');
  });
});

describe('AI-slop localized discovery metadata', () => {
  it('exposes thirteen translated rule descriptions and stable identifiers/defaults/categories', () => {
    const en = getAiSlopRuleCatalog(), ko = getAiSlopRuleCatalog('ko');
    expect(en.map(rule => rule.name)).toEqual(AI_SLOP_RULE_NAMES);
    expect(en.filter(rule => rule.defaultEnabled).map(rule => rule.name)).toEqual(DEFAULT_AI_SLOP_RULES);
    expect(ko.map(({ id, name, defaultEnabled, category }) => ({ id, name, defaultEnabled, category }))).toEqual(en.map(({ id, name, defaultEnabled, category }) => ({ id, name, defaultEnabled, category })));
    for (const rule of ko) {
      expect(rule.id).toBe(`goodui/${rule.name}`);
      expect(rule.description).toMatch(/[가-힣]/);
      expect(rule.reason).toMatch(/[가-힣]/);
      expect(rule.suggestion).toMatch(/[가-힣]/);
    }
    en[0]!.reason = 'changed';
    expect(getAiSlopRuleCatalog()[0]!.reason).not.toBe('changed');
  });

  it('publishes a valid AI-only preset example and matching localized schema descriptions', () => {
    const en = getPresetCatalog('en').find(preset => preset.name === 'ai-slop')!;
    const ko = getPresetCatalog('ko').find(preset => preset.name === 'ai-slop')!;
    expect(en).toMatchObject({ engine: 'native', defaultRules: DEFAULT_AI_SLOP_RULES, availableRules: AI_SLOP_RULE_NAMES });
    expect(ko.description).toMatch(/[가-힣]/);
    expect(ko.example).toEqual(en.example);
    expect(validatePolicy(en.example).valid).toBe(true);
    for (const locale of ['en', 'ko'] as const) {
      const schema = getPolicySchema(locale);
      const check = new Ajv({ strict: false }).compile(schema);
      expect(check(en.example)).toBe(true);
      expect(check({ ...projectPolicy(), aiSlop: { rules: { invalid: true } } })).toBe(false);
      const group = (schema.properties as Record<string, { description: string; properties: Record<string, { description?: string }> }>).aiSlop!;
      if (locale === 'ko') {
        expect(group.description).toMatch(/[가-힣]/);
        for (const option of Object.values(group.properties)) if (option.description) expect(option.description).toMatch(/[가-힣]/);
      }
    }
  });
});
