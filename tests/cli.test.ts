import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { version } from '../packages/cli/src/version.js';
import { main, initialPolicy } from '../packages/cli/src/index.js';

const roots: string[] = [];
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'goodui-cli-'));
  roots.push(root);
  return root;
}
async function run(root: string, ...args: string[]) {
  let stdout = '', stderr = '';
  const code = await main(args, root, { stdout: value => { stdout += value; }, stderr: value => { stderr += value; } });
  return { code, stdout, stderr };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('CLI user workflow', () => {
  it('initializes a working policy and preserves both files on repeat', async () => {
    const root = await project();
    const first = await run(root, 'init', '--no-install', '--format', 'json');
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout).policyCreated).toBe(true);
    expect(JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'))).toEqual(initialPolicy);
    const second = await run(root, 'init', '--no-install', '--format', 'json');
    expect(second.code).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ policyCreated: false, configCreated: false });
  });

  it('preserves an existing CommonJS ESLint config and provides integration code', async () => {
    const root = await project();
    await writeFile(join(root, 'eslint.config.cjs'), 'module.exports = [];\n');
    const result = await run(root, 'init', '--no-install');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('createConfig');
    expect(await readFile(join(root, 'eslint.config.cjs'), 'utf8')).toBe('module.exports = [];\n');
  });

  it('returns 1 for violations, then 0 after correction, with structured diagnostics', async () => {
    const root = await project();
    await run(root, 'init', '--no-install');
    await writeFile(join(root, 'index.ts'), 'eval("1");\n');
    const bad = await run(root, 'check', '--format', 'json');
    expect(bad.code).toBe(1);
    expect(bad.stderr).toBe('');
    const report = JSON.parse(bad.stdout);
    expect(report.diagnostics[0]).toMatchObject({ policyId: 'no-eval', severity: 'error', line: 1 });
    await writeFile(join(root, 'index.ts'), 'const count: number = 1;\n');
    expect((await run(root, 'check')).code).toBe(0);
    expect((await run(root, 'policy', 'validate', '--format', 'json')).code).toBe(0);
  });

  it('does not execute the project ESLint config when checking', async () => {
    const root = await project();
    await run(root, 'init', '--no-install');
    await writeFile(join(root, 'eslint.config.mjs'), 'throw new Error("UNTRUSTED_CONFIG_EXECUTED");');
    await writeFile(join(root, 'index.js'), 'const value = 1;\n');
    expect((await run(root, 'check')).code).toBe(0);
  });

  it('uses an explicit root and custom policy file', async () => {
    const root = await project();
    expect((await run(process.cwd(), 'init', '--no-install', '--root', root, '--policy', 'contracts.json')).code).toBe(0);
    await writeFile(join(root, 'index.cjs'), 'eval("1");');
    expect((await run(process.cwd(), 'check', 'index.cjs', '--root', root, '--policy', 'contracts.json')).code).toBe(1);
  });

  it('resolves schema completion relative to a nested policy', async () => {
    const root = await project();
    expect((await run(root, 'init', '--no-install', '--policy', 'config/contracts.json')).code).toBe(0);
    const policy = JSON.parse(await readFile(join(root, 'config/contracts.json'), 'utf8'));
    expect(policy.$schema).toBe('../.goodui/schema.json');
    await writeFile(join(root, 'index.ts'), 'const value: number = 1;');
    expect((await run(root, 'check', '--policy', 'config/contracts.json')).code).toBe(0);
  });

  it('returns configuration errors for a missing or disabled policy', async () => {
    const root = await project();
    const missing = await run(root, 'check', '--format', 'json');
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout).error.code).toBe('POLICY_NOT_FOUND');
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify({ ...initialPolicy, aiSlop: { enabled: false }, rules: initialPolicy.rules.map(rule => ({ ...rule, enabled: false })) }));
    expect((await run(root, 'policy', 'validate')).code).toBe(2);
    expect((await run(root, 'check')).code).toBe(2);
  });

  it.each([['check', '--format', 'xml'], ['init', '--no-install', '--root'], ['wat'], ['check', '--unknown']])('reports invalid arguments %j', async (...args) => {
    const root = await project();
    const result = await run(root, ...args);
    expect(result.code).toBe(2);
    expect(result.stderr).not.toBe('');
  });

  it('offers help and version without a policy', async () => {
    const root = await project();
    expect((await run(root, '--help')).stdout).toContain('goodui check');
    expect((await run(root, '--version')).stdout.trim()).toBe(version);
  });
});
