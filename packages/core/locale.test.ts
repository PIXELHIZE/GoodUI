import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PolicyError, definePolicy, getPolicySchema, getPresetCatalog, getRuleCatalog,
  localizeMessage, policySchema, presetCatalog, readPolicy, readPolicySync,
  resolveLocale, resolveProjectPath, ruleCatalog, validatePolicy, writePolicy,
  type LocaleInput, type Policy,
} from './src/index.js';

const roots: string[] = [];
async function project() { const root = await mkdtemp(join(tmpdir(), 'goodui-core-locale-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const policy: Policy = { version: 1, rules: [{ id: 'user-rule', kind: 'restricted-api', globals: ['eval'], reason: 'Policy must contain at least one enabled rule.', suggestion: '사용자 문구 그대로' }] };

describe('request-scoped language resolution', () => {
  it('honors explicit language before environment and system without modifying either', () => {
    const env = { GOODUI_LOCALE: 'ko', LC_ALL: 'en_US.UTF-8', LANG: 'ko_KR.UTF-8' };
    const before = { ...env };
    expect(resolveLocale('en', env, 'ko-KR')).toBe('en');
    expect(resolveLocale('ko', { LANG: 'en' }, 'en-US')).toBe('ko');
    expect(resolveLocale('auto', env, 'en-US')).toBe('ko');
    expect(resolveLocale(undefined, { GOODUI_LOCALE: 'auto', LC_ALL: 'en_US.UTF-8', LANG: 'ko' }, 'ko')).toBe('en');
    expect(env).toEqual(before);
  });

  it('uses LC_ALL, LC_MESSAGES, LANG and Intl fallback in order, with unsupported languages falling back to English', () => {
    expect(resolveLocale(undefined, { LC_ALL: 'ko_KR.UTF-8', LC_MESSAGES: 'en' }, 'en')).toBe('ko');
    expect(resolveLocale(undefined, { LC_ALL: '', LC_MESSAGES: 'ko-KR', LANG: 'en' }, 'en')).toBe('ko');
    expect(resolveLocale(undefined, { LANG: 'ko_KR.UTF-8' }, 'en')).toBe('ko');
    expect(resolveLocale(undefined, {}, 'ko-KR')).toBe('ko');
    for (const language of ['ja_JP.UTF-8', 'C', 'POSIX', 'unknown']) expect(resolveLocale('auto', { LANG: language }, 'ko-KR')).toBe('en');
    expect(resolveLocale(undefined, {}, 'fr-FR')).toBe('en');
  });

  it('rejects invalid explicit input with a stable error code', () => {
    try { resolveLocale('kr' as LocaleInput, {}); throw new Error('expected error'); }
    catch (error) { expect(error).toBeInstanceOf(PolicyError); expect(error).toMatchObject({ code: 'INVALID_LOCALE' }); }
  });
});

describe('localized built-in metadata', () => {
  it('translates descriptions and built-in example prose while retaining identifiers, options and valid standalone schemas', () => {
    const english = getRuleCatalog('en');
    const korean = getRuleCatalog('ko');
    const ajv = new Ajv({ strict: false });
    expect(korean).toHaveLength(9);
    for (let index = 0; index < korean.length; index++) {
      const original = english[index]!, translated = korean[index]!;
      expect(translated.kind).toBe(original.kind);
      expect(translated.description).toMatch(/[가-힣]/);
      expect(translated.example.reason).toMatch(/[가-힣]/);
      const { reason: _r1, suggestion: _s1, ...originalOptions } = original.example;
      const { reason: _r2, suggestion: _s2, ...translatedOptions } = translated.example;
      expect(translatedOptions).toEqual(originalOptions);
      expect(validatePolicy({ version: 1, rules: [translated.example] }).valid).toBe(true);
      expect(ajv.compile(translated.optionsSchema)(translated.example)).toBe(true);
    }
    expect(getPresetCatalog('ko')[0]).toMatchObject({ name: 'tailwind', engine: 'native', description: expect.stringMatching(/[가-힣]/) });
    expect(getPolicySchema('ko')).toMatchObject({ title: 'GoodUI 정책', $id: policySchema.$id });
    expect(ajv.compile(getPolicySchema('ko'))(policy)).toBe(true);
    expect(getRuleCatalog()).toEqual(ruleCatalog);
    expect(getPresetCatalog()).toEqual(presetCatalog);
  });

  it('returns independent metadata copies without mutating the English constants', () => {
    const translated = getRuleCatalog('ko');
    translated[0]!.example.reason = 'changed';
    translated[0]!.optionsSchema.extra = true;
    const schema = getPolicySchema('ko'); schema.title = 'changed';
    expect(getRuleCatalog('ko')[0]!.example.reason).not.toBe('changed');
    expect(getRuleCatalog('en')[0]!.optionsSchema).not.toHaveProperty('extra');
    expect(policySchema.title).toBe('GoodUI policy');
  });
});

describe('localized validation and storage', () => {
  it('translates owned validation errors but preserves valid user policy prose and English defaults', () => {
    expect(validatePolicy({}).errors[0]).toContain('must');
    const invalid = validatePolicy({}, { locale: 'ko' });
    expect(invalid.errors.every(message => /[가-힣]/.test(message))).toBe(true);
    expect(definePolicy(policy, { locale: 'ko' })).toBe(policy);
    expect(policy.rules[0]!.reason).toBe('Policy must contain at least one enabled rule.');
    expect(validatePolicy({ ...policy, rules: [...policy.rules, ...policy.rules] }, { locale: 'ko' }).errors).toEqual(['규칙 ID가 중복됩니다: user-rule']);
  });

  it('preserves JSON-quoted selector payloads and third-party errors while translating aggregate errors', () => {
    const selector = JSON.stringify('bad; /user-value: must be string [');
    const detail = `Rule custom: invalid AST selector ${selector}.`;
    const message = localizeMessage(`Invalid policy: ${detail}; /version: must be equal to constant`, 'ko');
    expect(message).toContain(selector);
    expect(message).toContain('AST selector 문법');
    expect(message).toContain('/version: 지정된 값과 일치해야 합니다.');
    expect(localizeMessage('/version: must be equal to constant\nThird-party error\nDuplicate rule id: custom', 'ko')).toBe('/version: 지정된 값과 일치해야 합니다.\nThird-party error\n규칙 ID가 중복됩니다: custom');
    expect(localizeMessage('/version: must be equal to constant\n/rules: must be array', 'ko')).toBe('/version: 지정된 값과 일치해야 합니다.\n/rules: array 형식이어야 합니다.');
    expect(localizeMessage('External dependency rejected "안녕하세요"', 'ko')).toBe('External dependency rejected "안녕하세요"');
    const userPath = 'folder\nDuplicate rule id: keep-this-text.ts';
    expect(localizeMessage(`Path is outside the project root: ${userPath}`, 'ko')).toBe(`프로젝트 루트 밖의 경로입니다: ${userPath}`);
    expect(localizeMessage('/rules/0/propValues/user\nkey: must be array', 'ko')).toBe('/rules/0/propValues/user\nkey: array 형식이어야 합니다.');
  });

  it('localizes read/path failures with unchanged codes, paths and revision details', async () => {
    const root = await project();
    await expect(readPolicy(root, undefined, { locale: 'ko' })).rejects.toMatchObject({ code: 'POLICY_NOT_FOUND', message: '정책 파일이 존재하지 않습니다: goodui.policy.json' });
    await expect(resolveProjectPath(root, '../outside.ts', { locale: 'ko' })).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT', message: '프로젝트 루트 밖의 경로입니다: ../outside.ts' });
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify({ version: 2, rules: [] }));
    try { await readPolicy(root, undefined, { locale: 'ko' }); throw new Error('expected error'); }
    catch (error) {
      expect(error).toBeInstanceOf(PolicyError);
      expect(error).toMatchObject({ code: 'INVALID_POLICY', message: expect.stringMatching(/^정책이 유효하지 않습니다:/), details: { path: join(root, 'goodui.policy.json'), revision: expect.stringMatching(/^[a-f0-9]{64}$/), errors: expect.arrayContaining([expect.stringMatching(/[가-힣]/)]) } });
      expect((error as Error).message).not.toContain('must');
    }
    expect(() => readPolicySync(root, undefined, { locale: 'ko' })).toThrow('정책이 유효하지 않습니다');
    await expect(readPolicy(root)).rejects.toThrow('Invalid policy');
  });

  it('preserves saved user policy bytes and compare-and-swap behavior across languages', async () => {
    const root = await project();
    const saved = await writePolicy(root, policy, { expectedRevision: null, locale: 'ko' });
    expect(saved.policy).toEqual(policy);
    expect((await readPolicy(root, undefined, { locale: 'ko' })).policy).toEqual(policy);
    const before = await readFile(saved.path, 'utf8');
    await expect(writePolicy(root, policy, { expectedRevision: null, locale: 'ko' })).rejects.toMatchObject({ code: 'POLICY_CONFLICT', message: '정책을 읽은 뒤 내용이 변경됐습니다. 저장하기 전에 다시 읽어 주세요.' });
    expect(await readFile(saved.path, 'utf8')).toBe(before);
  });
});
