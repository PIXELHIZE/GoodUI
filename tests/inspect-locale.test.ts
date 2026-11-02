import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { policySchema, getPolicySchema } from '../packages/core/src/index.js';
import { diagnose, explainRule, listRules } from '../packages/cli/src/inspect.js';

const roots: string[] = [];
async function project() { const root = await mkdtemp(join(tmpdir(), 'goodui-inspect-locale-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('localized rule discovery and project diagnostics', () => {
  it('localizes all 15 descriptions and options while keeping machine identifiers stable', async () => {
    const root = await project();
    const english = listRules('en'), korean = listRules('ko');
    expect(korean.rules).toHaveLength(28);
    expect(korean.rules.map(rule => rule.id)).toEqual(english.rules.map(rule => rule.id));
    expect(korean.rules.every(rule => /[가-힣]/.test(rule.description))).toBe(true);
    const common = await explainRule('component-contracts', root, undefined, 'ko');
    expect(common).toMatchObject({ kind: 'component-contracts', description: expect.stringMatching(/[가-힣]/), example: { id: 'explicit-button-contract', reason: expect.stringMatching(/[가-힣]/) } });
    const native = await explainRule('goodui/no-raw-colors', root, undefined, 'ko');
    expect(native).toMatchObject({ id: 'goodui/no-raw-colors', guidance: expect.stringMatching(/[가-힣]/), example: { tailwind: { rules: ['no-raw-colors'] } } });
    expect(JSON.stringify(native.optionsSchema)).toContain('GoodUI 자체 디자인 시스템');
    expect(await readdir(root)).toEqual([]);
  });

  it('preserves custom policy prose and exception reasons exactly', async () => {
    const root = await project();
    const contract = { id: 'custom', kind: 'restricted-api', globals: ['eval'], reason: 'Keep my English reason.', suggestion: '사용자가 작성한 제안' };
    const exceptions = [{ ruleId: 'custom', files: ['legacy/**'], reason: 'Do not translate this exception.' }];
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify({ version: 1, rules: [contract], exceptions }));
    expect(await explainRule('custom', root, undefined, 'ko')).toMatchObject({ policyId: 'custom', contract, exceptions });
    await expect(explainRule('missing', root, undefined, 'ko')).rejects.toMatchObject({ code: 'UNKNOWN_RULE', message: expect.stringContaining('알 수 없는 규칙 또는 정책 ID') });
  });

  it('translates doctor guidance without writing files or changing report keys/statuses', async () => {
    const root = await project();
    const policy = JSON.stringify({ $schema: './schema.json', version: 1, rules: [{ id: 'custom', kind: 'restricted-api', globals: ['eval'], reason: 'User English reason.' }] });
    await writeFile(join(root, 'goodui.policy.json'), policy);
    await writeFile(join(root, 'schema.json'), JSON.stringify(policySchema));
    const english = await diagnose(root, undefined, 'en');
    const korean = await diagnose(root, undefined, 'ko');
    expect(korean.ok).toBe(true);
    expect(korean.checks.map(({ id, status }) => ({ id, status }))).toEqual(english.checks.map(({ id, status }) => ({ id, status })));
    expect(korean.checks.filter(check => check.id !== 'node').every(check => /[가-힣]/.test(check.message))).toBe(true);
    expect(korean.checks.filter(check => check.hint).every(check => /[가-힣]/.test(check.hint!))).toBe(true);
    expect(await readFile(join(root, 'goodui.policy.json'), 'utf8')).toBe(policy);
    expect((await readdir(root)).sort()).toEqual(['goodui.policy.json', 'schema.json']);
  });

  it('localizes invalid policy and manifest errors', async () => {
    const root = await project();
    await writeFile(join(root, 'package.json'), '[]');
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify({ version: 2, rules: [] }));
    const report = await diagnose(root, undefined, 'ko');
    expect(report.ok).toBe(false);
    expect(report.checks.find(check => check.id === 'installation')?.message).toBe('package.json은 객체여야 합니다.');
    expect(report.checks.find(check => check.id === 'policy')?.message).toMatch(/^정책이 유효하지 않습니다:/);
  });

  it('accepts a Korean generated schema when doctor uses either display language', async () => {
    const root = await project();
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify({ $schema: './schema.json', version: 1, rules: [{ id: 'custom', kind: 'restricted-api', globals: ['eval'], reason: 'User reason.' }] }));
    await writeFile(join(root, 'schema.json'), JSON.stringify(getPolicySchema('ko')));
    for (const language of ['en', 'ko'] as const) {
      const report = await diagnose(root, undefined, language);
      expect(report.ok).toBe(true);
      expect(report.checks.find(check => check.id === 'schema')?.status).toBe('ok');
    }
  });
});
