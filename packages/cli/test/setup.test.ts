import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyConfiguration, createInitialPolicy, editorConfig, initialPolicy, planConfiguration, type SetupOptions } from '../src/setup.js';

const roots: string[] = [];
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'goodui-locale-setup-'));
  roots.push(root);
  return root;
}
function options(rootDir: string, overrides: Partial<SetupOptions> = {}): SetupOptions {
  return { rootDir, policyPath: 'goodui.policy.json', mode: 'all', preset: 'project', packageManager: 'npm', locale: 'ko', ...overrides };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'goodui-locale-setup-'))) throw new Error('Unexpected fixture path.');
    await rm(root, { recursive: true, force: true });
  }
});

describe('localized configuration', () => {
  it('uses automatic detection when generating editor and MCP locale options', async () => {
    vi.stubEnv('GOODUI_LOCALE', 'ko');
    const root = await project();
    const plan = await planConfiguration(options(root, { locale: 'auto' }));
    expect(plan.policy.rules[0]?.reason).toBe('문자열을 코드로 실행하지 마세요.');
    expect(plan.integration).toContain('locale: "ko"');
    expect(plan.mcp?.mcpServers.goodui?.args.slice(-2)).toEqual(['--locale', 'ko']);
    expect(editorConfig(undefined, 'en')).toContain('locale: "en"');
  });

  it('honors an explicit English locale even when the environment prefers Korean', async () => {
    vi.stubEnv('GOODUI_LOCALE', 'ko');
    const root = await project();
    await writeFile(join(root, 'eslint.config.mjs'), 'export default [];');
    const plan = await planConfiguration(options(root, { preset: 'development', locale: 'en' }));
    expect(plan.policy.rules[0]?.reason).toBe('Do not execute strings as code.');
    expect(plan.policy.rules[1]?.reason).toBe('Use explicit TypeScript types and checked nullable values.');
    expect(plan.warnings[0]).toContain('Existing ESLint configuration is preserved.');
    expect(plan.integration).toContain('locale: "en"');
    expect(plan.mcp?.mcpServers.goodui?.args.slice(-2)).toEqual(['--locale', 'en']);
  });

  it('creates Korean built-in policy text and persists an explicit editor and MCP locale', async () => {
    const root = await project();
    const args = options(root, { preset: 'full' });
    const plan = await planConfiguration(args);
    expect(plan.policy.rules[0]).toMatchObject({ id: 'no-eval', kind: 'restricted-api', reason: '문자열을 코드로 실행하지 마세요.' });
    expect(plan.policy.rules.find(rule => rule.id === 'strict-ts-syntax')?.reason).toBe('명확한 TypeScript 타입을 사용하고 null 가능성을 확인하세요.');
    expect(plan.integration).toContain('locale: "ko"');
    expect(plan.mcp?.mcpServers.goodui?.args.slice(-4)).toEqual(['--policy', 'goodui.policy.json', '--locale', 'ko']);
    await writeFile(join(root, 'package.json'), '{}\n');
    await applyConfiguration(args, plan);
    expect(JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8')).rules).toEqual(plan.policy.rules);
    expect(await readFile(join(root, 'eslint.config.mjs'), 'utf8')).toContain('locale: "ko"');
  });

  it('keeps the legacy English initialPolicy export and returns independent localized copies', () => {
    const english = createInitialPolicy('en');
    const korean = createInitialPolicy('ko');
    expect(english).toEqual(initialPolicy);
    expect(korean.rules[0]?.reason).not.toBe(initialPolicy.rules[0]?.reason);
    expect(initialPolicy.rules[0]?.reason).toBe('Do not execute strings as code.');
    expect(english.rules).not.toBe(initialPolicy.rules);
    expect(editorConfig('nested/policy.json', 'en')).toContain('locale: "en"');
  });

  it('preserves existing policy prose, disabled rules, exceptions and custom editor configuration', async () => {
    const root = await project();
    const existing = createInitialPolicy('en');
    existing.rules[0]!.enabled = false;
    existing.rules.push({ id: 'project-only', kind: 'restricted-api', globals: ['fetch'], reason: '기존 사용자 사유', suggestion: 'Use the reviewed client.' });
    existing.exceptions = [{ ruleId: 'project-only', files: ['legacy/**'], reason: 'User-approved exception.' }];
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify(existing));
    const eslint = 'export default []; // user configuration\n';
    const manifest = JSON.stringify({ scripts: { lint: 'custom lint', 'lint:goodui': 'custom policy check' } });
    await writeFile(join(root, 'eslint.config.mjs'), eslint);
    await writeFile(join(root, 'package.json'), manifest);
    const args = options(root);
    const plan = await planConfiguration(args);
    expect(plan.policy).toEqual(existing);
    expect(plan.policyUpdated).toBe(false);
    expect(plan.configCreated).toBe(false);
    expect(plan.warnings).toEqual([
      '기존 ESLint 설정을 보존했습니다. 반환된 통합 코드를 추가하면 에디터에서 GoodUI를 사용할 수 있습니다. goodui check는 독립적으로 실행됩니다.',
      '기존 lint:goodui 스크립트를 보존했습니다. goodui check를 직접 실행하세요.',
    ]);
    await applyConfiguration(args, plan);
    expect(await readFile(join(root, 'eslint.config.mjs'), 'utf8')).toBe(eslint);
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(manifest);
    expect(JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'))).toEqual(existing);
  });

  it('preserves an English existing rule when adding a Korean development profile', async () => {
    const root = await project();
    const existing = createInitialPolicy('en');
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify(existing));
    const plan = await planConfiguration(options(root, { preset: 'development', mode: 'agent' }));
    expect(plan.policy.rules[0]).toEqual(existing.rules[0]);
    expect(plan.policy.rules[1]?.reason).toBe('명확한 TypeScript 타입을 사용하고 null 가능성을 확인하세요.');
  });

  it('localizes setup conflicts and concurrent-file preservation without altering error codes', async () => {
    const root = await project();
    await writeFile(join(root, 'package.json'), '{"scripts":[]}');
    await expect(planConfiguration(options(root))).rejects.toMatchObject({ code: 'INVALID_PACKAGE_JSON', message: 'package.json의 scripts는 객체여야 합니다.' });
    await writeFile(join(root, 'package.json'), '{}');
    const args = options(root);
    const plan = await planConfiguration(args);
    await writeFile(join(root, 'eslint.config.mjs'), 'user-created config');
    await applyConfiguration(args, plan);
    expect(plan.warnings).toContain('동시에 생성된 ESLint 설정을 보존했습니다. 통합 코드를 직접 추가하세요.');
    expect(await readFile(join(root, 'eslint.config.mjs'), 'utf8')).toBe('user-created config');
  });
});
