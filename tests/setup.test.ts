import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, initialPolicy, type CliRuntime } from '../packages/cli/src/index.js';
import { version } from '../packages/cli/src/version.js';

const roots: string[] = [];
async function project(manifest?: object) {
  const root = await mkdtemp(join(tmpdir(), 'goodui-setup-')); roots.push(root);
  if (manifest) await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
  return root;
}
async function run(root: string, args: string[], runtime: CliRuntime = {}) {
  let stdout = '', stderr = '';
  const code = await main(args, root, { stdout: value => { stdout += value; }, stderr: value => { stderr += value; } }, { isTTY: false, ...runtime });
  return { code, stdout, stderr };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))); });

describe('single-entry setup', () => {
  it('requires explicit non-interactive choices and changes nothing', async () => {
    const root = await project();
    const result = await run(root, ['init', '--format', 'json']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('INSTALL_MODE_REQUIRED');
    expect(await readdir(root)).toEqual([]);
  });

  it('previews one main dependency and the required engine without side effects', async () => {
    const root = await project();
    const execute = vi.fn();
    const result = await run(root, ['init', '--dry-run', '--format', 'json'], { executeInstall: execute });
    expect(result.code).toBe(0);
    const preview = JSON.parse(result.stdout);
    expect(preview).toMatchObject({ dryRun: true, mode: 'lint', preset: 'project' });
    expect(preview.installation.packages).toEqual([`@pixelhize/goodui-cli@${version}`, 'eslint@^10.0.0']);
    expect(preview.configuration.integration).toContain('@pixelhize/goodui-cli/config');
    expect(preview.configuration.scripts).toEqual({ 'lint:goodui': 'goodui check' });
    expect(execute).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('permits keyboard cancellation before any mutation', async () => {
    const root = await project();
    const result = await run(root, ['init'], { isTTY: true, promptMode: async () => null });
    expect(result.code).toBe(130);
    expect(await readdir(root)).toEqual([]);
  });

  it('permits cancellation of the keyboard preset selection before installation', async () => {
    const root = await project();
    const execute = vi.fn();
    const result = await run(root, ['init'], { isTTY: true, promptMode: async () => 'all', promptPreset: async () => null, executeInstall: execute });
    expect(result.code).toBe(130);
    expect(execute).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('installs only the main entry and adds a separate script while preserving existing lint', async () => {
    const root = await project({ name: 'demo', scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit' }, devDependencies: { eslint: '^9.39.0' } });
    const execute = vi.fn(async plan => {
      expect(plan.packages).toEqual([`@pixelhize/goodui-cli@${version}`]);
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      manifest.devDependencies['@pixelhize/goodui-cli'] = version;
      await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
      return { installed: true, commandsExecuted: 1, packageJsonCreated: false };
    });
    const result = await run(root, ['init', '--yes', '--mode', 'all', '--format', 'json'], { executeInstall: execute });
    expect(result.code).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(manifest.scripts).toEqual({ lint: 'eslint .', typecheck: 'tsc --noEmit', 'lint:goodui': 'goodui check' });
    const output = JSON.parse(result.stdout);
    expect(output.mcp.mcpServers.goodui.args).toContain('mcp');
    expect(output).toMatchObject({ mode: 'all', policyCreated: true, configCreated: true });
  });

  it('keeps an existing lint:goodui script intact', async () => {
    const root = await project({ scripts: { 'lint:goodui': 'custom-check' }, devDependencies: { eslint: '^10.0.0' } });
    const result = await run(root, ['init', '--mode', 'lint', '--format', 'json'], { executeInstall: async () => ({ installed: true, commandsExecuted: 1, packageJsonCreated: false }) });
    expect(result.code).toBe(0);
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).scripts['lint:goodui']).toBe('custom-check');
    expect(JSON.parse(result.stdout).warnings.join(' ')).toContain('preserved');
  });

  it('keeps dependency logs off JSON stdout', async () => {
    const root = await project({ devDependencies: { eslint: '^10.0.0' } });
    const result = await run(root, ['init', '--yes', '--format', 'json'], { executeInstall: async (_plan, hooks) => {
      hooks?.onStdout?.('install log\n'); hooks?.onStderr?.('warning log\n');
      return { installed: true, commandsExecuted: 1, packageJsonCreated: false };
    } });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).mode).toBe('lint');
    expect(result.stderr).toContain('install log');
    expect(result.stderr).toContain('warning log');
  });

  it('does not write configuration after a failed install', async () => {
    const root = await project();
    const result = await run(root, ['init', '--yes', '--format', 'json'], { executeInstall: async () => { throw new Error('network unavailable'); } });
    expect(result.code).toBe(2);
    expect(await readdir(root)).toEqual([]);
  });

  it('preflights existing malformed policy and scripts before installing', async () => {
    const root = await project({ scripts: 'invalid' });
    const execute = vi.fn();
    expect((await run(root, ['init', '--yes'], { executeInstall: execute })).code).toBe(2);
    expect(execute).not.toHaveBeenCalled();
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, 'goodui.policy.json'), '{broken');
    expect((await run(root, ['init', '--yes'], { executeInstall: execute })).code).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sets up agent policy and returns an MCP recipe without changing host settings', async () => {
    const root = await project({ name: 'agent-project' });
    const result = await run(root, ['init', '--mode', 'agent', '--format', 'json'], { executeInstall: async plan => {
      expect(plan.packages).toEqual([`@pixelhize/goodui-cli@${version}`]);
      return { installed: true, commandsExecuted: 1, packageJsonCreated: false };
    } });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'agent', configCreated: false, mcp: { mcpServers: { goodui: { command: 'npm' } } } });
    expect((await readdir(root)).sort()).toEqual(['.goodui', 'goodui.policy.json', 'package.json']);
  });

  it('ships an offline schema and preserves a different reserved schema file', async () => {
    const root = await project();
    expect((await run(root, ['init', '--no-install'])).code).toBe(0);
    const saved = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(saved.$schema).toBe('./.goodui/schema.json');
    expect(JSON.parse(await readFile(join(root, '.goodui/schema.json'), 'utf8')).properties.presets).toBeDefined();
    await writeFile(join(root, '.goodui/schema.json'), '{"owned":"by someone else"}');
    const result = await run(root, ['init', '--no-install', '--format', 'json']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('SCHEMA_CONFLICT');
    expect(await readFile(join(root, '.goodui/schema.json'), 'utf8')).toBe('{"owned":"by someone else"}');
  });

  it('keeps a custom policy path in the MCP connection recipe', async () => {
    const root = await project({});
    const result = await run(root, ['init', '--mode', 'agent', '--policy', 'config/contracts.json', '--format', 'json'], {
      executeInstall: async () => ({ installed: true, commandsExecuted: 1, packageJsonCreated: false }),
    });
    expect(result.code).toBe(0);
    const args = JSON.parse(result.stdout).mcp.mcpServers.goodui.args;
    expect(args[args.indexOf('--policy') + 1]).toBe('config/contracts.json');
    expect(args[args.indexOf('--locale') + 1]).toBe('en');
  });

  it('merges an explicit Tailwind preset without replacing existing project contracts', async () => {
    const root = await project();
    const policy = { ...initialPolicy, rules: [{ ...initialPolicy.rules[0], reason: 'custom reason' }] };
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify(policy));
    const result = await run(root, ['init', '--no-install', '--preset', 'tailwind', '--format', 'json']);
    expect(result.code).toBe(0);
    const saved = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(saved.presets).toEqual(['tailwind']);
    expect(saved.rules).toEqual(policy.rules);
    expect(JSON.parse(result.stdout).policyUpdated).toBe(true);
  });

  it('preserves an existing native preset without an extra lint package', async () => {
    const root = await project();
    await writeFile(join(root, 'goodui.policy.json'), JSON.stringify({ ...initialPolicy, presets: ['tailwind'] }));
    const result = await run(root, ['init', '--yes', '--dry-run', '--format', 'json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).installation.preset).toBe('tailwind');
    expect(JSON.parse(result.stdout).installation.packages).toEqual([`@pixelhize/goodui-cli@${version}`, 'eslint@^10.0.0']);
  });

  it('previews the development and full profiles without writing files or installing', async () => {
    const root = await project();
    const development = await run(root, ['init', '--preset', 'development', '--dry-run', '--format', 'json']);
    expect(development.code).toBe(0);
    const devPlan = JSON.parse(development.stdout);
    expect(devPlan.configuration.enabledContracts).toEqual(['no-eval', 'strict-ts-syntax', 'function-budget', 'file-budget']);
    expect(devPlan.configuration.designRules).toEqual([]);
    const full = await run(root, ['init', '--preset', 'full', '--dry-run', '--format', 'json']);
    expect(full.code).toBe(0);
    const fullPlan = JSON.parse(full.stdout);
    expect(fullPlan.configuration.designRules).toHaveLength(6);
    expect(fullPlan.configuration.enabledContracts).toContain('button-intent');
    expect(fullPlan.configuration.enabledContracts).toContain('image-alternatives');
    expect(fullPlan.installation.packages).toEqual([`@pixelhize/goodui-cli@${version}`, 'eslint@^10.0.0']);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ['--mode', 'unknown'], ['--preset', 'unknown'], ['--package-manager', 'unknown'],
    ['--mode', 'all', '--no-install'], ['--no-install', '--mode', 'all'],
  ])('rejects invalid init switches %j without changes', async (...flags) => {
    const root = await project();
    expect((await run(root, ['init', ...flags])).code).toBe(2);
    expect(await readdir(root)).toEqual([]);
  });
});
