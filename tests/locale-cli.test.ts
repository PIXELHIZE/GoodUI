import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../packages/cli/src/index.js';

const roots: string[] = [];
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'goodui-locale-cli-'));
  roots.push(root);
  return root;
}
async function run(root: string, ...args: string[]) {
  let stdout = '', stderr = '';
  const code = await main(args, root, { stdout: value => { stdout += value; }, stderr: value => { stderr += value; } }, { isTTY: false });
  return { code, stdout, stderr };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    const actual = await realpath(root), parent = await realpath(tmpdir());
    expect(dirname(actual).toLowerCase()).toBe(parent.toLowerCase());
    expect(basename(actual)).toMatch(/^goodui-locale-cli-/);
    await rm(actual, { recursive: true, force: true });
  }
});

describe('Korean and English CLI', () => {
  it('reads the language flag before help dispatch and supports the equals form', async () => {
    const root = await project();
    const ko = await run(root, '--help', '--locale', 'ko');
    expect(ko.code).toBe(0);
    expect(ko.stdout).toContain('키보드 설치 마법사');
    expect(ko.stdout).toContain('goodui check');
    const en = await run(root, '--locale=en', '--help');
    expect(en.stdout).toContain('Keyboard setup wizard');
    expect(en.stdout).not.toMatch(/[가-힣]/);
  });

  it('uses the environment automatically and lets the explicit flag override it', async () => {
    vi.stubEnv('GOODUI_LOCALE', 'ko');
    const root = await project();
    expect((await run(root, '--help')).stdout).toContain('키보드 설치 마법사');
    expect((await run(root, '--help', '--locale', 'en')).stdout).toContain('Keyboard setup wizard');
  });

  it('returns a localized machine-readable error for invalid language flags', async () => {
    vi.stubEnv('GOODUI_LOCALE', 'ko');
    const root = await project();
    const result = await run(root, 'check', '--locale', 'fr', '--format', 'json');
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).error).toMatchObject({ code: 'INVALID_LOCALE', message: expect.stringContaining('지정하세요') });
    expect((await run(root, '--locale', 'ko', '--locale', 'en', '--help')).code).toBe(2);
    vi.stubEnv('GOODUI_LOCALE', 'en');
    expect((await run(root, '--locale', 'ko', '--locale', 'fr')).stderr).toContain('지정하세요');
  });

  it('creates Korean starter contracts and a matching editor configuration', async () => {
    const root = await project();
    const result = await run(root, 'init', '--no-install', '--locale', 'ko', '--format', 'json');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).message).toContain('설정');
    const policy = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(policy.rules[0].id).toBe('no-eval');
    expect(policy.rules[0].reason).toMatch(/[가-힣]/);
    expect(await readFile(join(root, '.goodui/schema.json'), 'utf8')).toMatch(/[가-힣]/);
    expect(await readFile(join(root, 'eslint.config.mjs'), 'utf8')).toMatch(/locale:\s*['"]ko['"]/);
  });

  it('keeps diagnostics, positions and user text stable across concurrent languages', async () => {
    const root = await project();
    await run(root, 'init', '--no-install', '--locale', 'en');
    const originalPolicy = await readFile(join(root, 'goodui.policy.json'), 'utf8');
    const reason = JSON.parse(originalPolicy).rules[0].reason;
    await writeFile(join(root, 'index.ts'), 'eval("1");\n');
    const [ko, en] = await Promise.all([
      run(root, 'check', 'index.ts', '--format', 'json', '--locale', 'ko'),
      run(root, 'check', 'index.ts', '--format', 'json', '--locale', 'en'),
    ]);
    expect([ko.code, en.code]).toEqual([1, 1]);
    const korean = JSON.parse(ko.stdout), english = JSON.parse(en.stdout);
    expect(korean).toMatchObject({ errorCount: 1, warningCount: 0, filesChecked: 1 });
    const left = korean.diagnostics[0], right = english.diagnostics[0];
    for (const key of ['filePath', 'line', 'column', 'ruleId', 'policyId', 'severity', 'reason', 'suggestion']) expect(left[key]).toEqual(right[key]);
    expect(left.reason).toBe(reason);
    expect(left.message).toContain(reason);
    expect(left.message).toMatch(/[가-힣]/);
    expect(left.message).not.toContain('Reason:');
    expect(right.message).toContain('Reason:');
    expect(right.message).not.toMatch(/[가-힣]/);
    expect(await readFile(join(root, 'goodui.policy.json'), 'utf8')).toBe(originalPolicy);
    expect((await run(root, 'check', '--locale', 'ko')).stdout).toContain('오류 1개');
  });

  it('localizes built-in descriptions and setup errors without translating identifiers', async () => {
    const root = await project();
    const catalog = JSON.parse((await run(root, 'rules', '--locale', 'ko', '--format', 'json')).stdout);
    expect(catalog.rules).toHaveLength(28);
    for (const rule of catalog.rules) {
      expect(rule.id).toMatch(/^goodui\/[a-z-]+$/);
      expect(rule.description).toMatch(/[가-힣]/);
    }
    const invalid = await run(root, 'init', '--locale', 'ko', '--format', 'json');
    expect(invalid.code).toBe(2);
    expect(JSON.parse(invalid.stdout).error).toMatchObject({ code: 'INSTALL_MODE_REQUIRED', message: expect.stringMatching(/[가-힣]/) });
  });
});
