import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../packages/cli/src/index.js';

const roots: string[] = [];
async function project() { const root = await mkdtemp(join(tmpdir(), 'goodui-inspect-')); roots.push(root); return root; }
async function run(root: string, ...args: string[]) {
  let stdout = '', stderr = '';
  const code = await main(args, root, { stdout: value => { stdout += value; }, stderr: value => { stderr += value; } }, { isTTY: false });
  return { code, stdout, stderr };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('rule discovery and project diagnostics', () => {
  it('lists all project contracts and native style rules without a project policy', async () => {
    const root = await project();
    const result = await run(root, 'rules', '--format', 'json');
    expect(result.code).toBe(0);
    const rules = JSON.parse(result.stdout).rules;
    expect(rules).toHaveLength(28);
    expect(rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'goodui/component-contracts' }),
      expect.objectContaining({ id: 'goodui/restricted-syntax' }),
      expect.objectContaining({ id: 'goodui/no-raw-colors', preset: 'tailwind', defaultEnabled: true }),
      expect.objectContaining({ id: 'goodui/no-restyle', defaultEnabled: false }),
    ]));
    expect(await readdir(root)).toEqual([]);
  });

  it('explains built-in contracts, native styles, and named project policies', async () => {
    const root = await project();
    const generic = await run(root, 'explain', 'component-contracts', '--format', 'json');
    expect(generic.code).toBe(0);
    expect(JSON.parse(generic.stdout)).toMatchObject({ kind: 'component-contracts', optionsSchema: expect.any(Object) });
    const native = await run(root, 'explain', 'goodui/no-raw-colors', '--format', 'json');
    expect(native.code).toBe(0);
    expect(JSON.parse(native.stdout)).toMatchObject({ preset: 'tailwind', example: { tailwind: { rules: ['no-raw-colors'] } } });
    await run(root, 'init', '--no-install');
    const custom = await run(root, 'explain', 'no-eval', '--format', 'json');
    expect(JSON.parse(custom.stdout)).toMatchObject({ policyId: 'no-eval', contract: { reason: 'Do not execute strings as code.' } });
  });

  it('reports unknown rules and invalid invocation as machine-readable errors', async () => {
    const root = await project();
    const result = await run(root, 'explain', 'not-a-rule', '--format', 'json');
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('UNKNOWN_RULE');
    expect((await run(root, 'explain')).code).toBe(2);
    expect((await run(root, 'rules', '--yes')).code).toBe(2);
  });

  it('diagnoses an initialized policy offline without changing the project', async () => {
    const root = await project();
    await run(root, 'init', '--no-install');
    const before = await readFile(join(root, 'goodui.policy.json'), 'utf8');
    const result = await run(root, 'doctor', '--format', 'json');
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'policy', status: 'ok' }),
      expect.objectContaining({ id: 'schema', status: 'ok' }),
      expect.objectContaining({ id: 'engine', status: 'ok' }),
    ]));
    expect(await readFile(join(root, 'goodui.policy.json'), 'utf8')).toBe(before);
  });

  it('distinguishes missing and invalid policies while leaving files untouched', async () => {
    const root = await project();
    const missing = await run(root, 'doctor', '--format', 'json');
    expect(missing.code).toBe(2);
    expect(JSON.parse(missing.stdout).checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'policy', status: 'error' })]));
    expect(await readdir(root)).toEqual([]);
    await writeFile(join(root, 'goodui.policy.json'), '{broken');
    const invalid = await run(root, 'doctor', '--format', 'json');
    expect(invalid.code).toBe(2);
    expect(await readFile(join(root, 'goodui.policy.json'), 'utf8')).toBe('{broken');
  });

  it('detects invalid package metadata and a missing native theme independently', async () => {
    const root = await project();
    await run(root, 'init', '--no-install');
    await writeFile(join(root, 'package.json'), '[]');
    const manifest = await run(root, 'doctor', '--format', 'json');
    expect(manifest.code).toBe(2);
    expect(JSON.parse(manifest.stdout).checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'installation', status: 'error' })]));
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify({ version: 1, presets: ['tailwind'], rules: [] }));
    const theme = await run(root, 'doctor', '--format', 'json');
    expect(theme.code).toBe(2);
    expect(JSON.parse(theme.stdout).checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'engine', status: 'error', message: expect.stringContaining('Tailwind') })]));
  });
});
