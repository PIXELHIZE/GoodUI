import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseInstallMode, createInstallPlan, executeInstallPlan,
  type InstallMode, type PackageManager, type Preset,
} from '../src/installer.js';

const spawnMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
vi.mock('cross-spawn', () => ({ default: spawnMock }));
vi.mock('@clack/prompts', () => ({ select: selectMock, isCancel: (value: unknown) => typeof value === 'symbol' }));

const roots: string[] = [];
async function project(manifest?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'goodui-install & spaces-'));
  roots.push(root);
  if (manifest) await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  return root;
}
const version = '0.2.0';
const cli = `@pixelhize/goodui-cli@${version}`;

beforeEach(() => { spawnMock.mockReset(); selectMock.mockReset(); });
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'goodui-install & spaces-'))) throw new Error('Unexpected test directory.');
    await rm(root, { recursive: true, force: true });
  }
});

describe('installer mode selection', () => {
  it('localizes the keyboard wizard without changing mode values', async () => {
    selectMock.mockResolvedValue('all');
    expect(await chooseInstallMode({ locale: 'ko', isTTY: true })).toBe('all');
    expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'GoodUI를 어떻게 설정할까요?\n↑/↓ 이동 · Enter 선택',
      showInstructions: false,
      options: expect.arrayContaining([
        { value: 'lint', label: '린트 검사', hint: '로컬 검사, 에디터 연동, CI' },
        { value: 'config', label: '설정만 생성', hint: '의존성 설치 생략' },
      ]),
    }));
    await expect(chooseInstallMode({ locale: 'ko', isTTY: false })).rejects.toMatchObject({
      code: 'INSTALL_MODE_REQUIRED', message: '비대화형 init에는 --yes 또는 --mode lint|agent|all|config가 필요합니다.',
    });
  });
  it('supports explicit modes and --yes without opening a prompt', async () => {
    const prompt = vi.fn();
    expect(await chooseInstallMode({ mode: 'agent', yes: true, json: true, isTTY: false, prompt })).toBe('agent');
    expect(await chooseInstallMode({ yes: true, json: true, isTTY: false, prompt })).toBe('lint');
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each([{ isTTY: false }, { isTTY: true, json: true }])('requires explicit flags for noninteractive input %j', async options => {
    const prompt = vi.fn();
    await expect(chooseInstallMode({ ...options, prompt })).rejects.toMatchObject({ code: 'INSTALL_MODE_REQUIRED' });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('returns cancellation before any project or package manager operation', async () => {
    const root = await project();
    const prompt = vi.fn().mockResolvedValue(null);
    expect(await chooseInstallMode({ isTTY: true, prompt })).toBeNull();
    expect(prompt).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported runtime values rather than interpreting them as command input', async () => {
    await expect(chooseInstallMode({ mode: 'lint; echo unsafe' as InstallMode, yes: true })).rejects.toMatchObject({ code: 'INVALID_INSTALL_MODE' });
  });
});

describe('read-only installation planning', () => {
  it('localizes installer errors and inherited-manager notices while preserving paths and enums', async () => {
    const root = await project({ packageManager: 'pnpm@11.0.0' });
    const member = join(root, 'member');
    await mkdir(member);
    const plan = await createInstallPlan({ rootDir: member, mode: 'agent', version, locale: 'ko' });
    expect(plan.packageManager).toBe('pnpm');
    expect(plan.warnings[0]).toBe(`${root}에서 pnpm을 감지했습니다. 선택한 프로젝트 ${member}에 의존성을 추가합니다.`);
    await writeFile(join(member, 'package.json'), '{invalid');
    await expect(createInstallPlan({ rootDir: member, mode: 'agent', version, locale: 'ko' })).rejects.toMatchObject({ code: 'INVALID_PACKAGE_JSON', message: '프로젝트의 package.json에 유효한 JSON이 필요합니다.' });
    await writeFile(join(member, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^8' } }));
    await expect(createInstallPlan({ rootDir: member, mode: 'lint', version, locale: 'ko' })).rejects.toMatchObject({ code: 'INSTALL_ESLINT_CONFLICT', message: expect.stringContaining('--mode agent|config') });
  });
  it.each([
    ['lint', [cli, 'eslint@^10.0.0']],
    ['all', [cli, 'eslint@^10.0.0']],
    ['agent', [cli]],
    ['config', []],
  ] as const)('plans only the main direct package for %s, plus the required engine', async (mode, packages) => {
    const root = await project();
    const plan = await createInstallPlan({ rootDir: root, mode, version });
    expect(plan.packages).toEqual(packages);
    expect(plan.commands).toHaveLength(mode === 'config' ? 0 : 1);
    expect(plan.createPackageJson).toBe(mode !== 'config');
    expect(await readdir(root)).toEqual([]);
  });

  it.each(['npm', 'pnpm', 'yarn', 'bun'] as const)('uses %s as an executable with an argument array', async packageManager => {
    const root = await project();
    const plan = await createInstallPlan({ rootDir: root, mode: 'lint', packageManager, version });
    expect(plan.commands[0]).toMatchObject({ command: packageManager, cwd: root });
    expect(plan.commands[0]?.args.slice(-2)).toEqual([cli, 'eslint@^10.0.0']);
    expect(plan.commands[0]?.args[0]).toBe(packageManager === 'npm' ? 'install' : 'add');
    expect(plan.commands[0]?.args).not.toContain(root);
  });

  it('applies explicit manager, packageManager field, and lockfile precedence', async () => {
    const root = await project({ packageManager: 'yarn@4.0.0' });
    await writeFile(join(root, 'pnpm-lock.yaml'), '');
    await writeFile(join(root, 'package-lock.json'), '{}');
    expect((await createInstallPlan({ rootDir: root, mode: 'agent', version })).packageManager).toBe('yarn');
    expect((await createInstallPlan({ rootDir: root, mode: 'agent', version, packageManager: 'bun' })).packageManager).toBe('bun');
    await writeFile(join(root, 'package.json'), '{}');
    await expect(createInstallPlan({ rootDir: root, mode: 'agent', version })).rejects.toMatchObject({ code: 'AMBIGUOUS_PACKAGE_MANAGER' });
  });

  it.each([
    ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
  ] as const)('detects %s without changing it', async (filename, manager) => {
    const root = await project();
    await writeFile(join(root, filename), 'unchanged');
    expect((await createInstallPlan({ rootDir: root, mode: 'agent', version })).packageManager).toBe(manager);
    expect(await readFile(join(root, filename), 'utf8')).toBe('unchanged');
  });

  it('allows an explicitly selected pnpm workspace root without redirecting member installs', async () => {
    const root = await project({ packageManager: 'pnpm@11.0.0' });
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const rootPlan = await createInstallPlan({ rootDir: root, mode: 'lint', version });
    expect(rootPlan.commands[0]?.args).toContain('--workspace-root');
    expect(rootPlan.commands[0]?.cwd).toBe(root);
    const member = join(root, 'packages', 'member');
    await mkdir(member, { recursive: true });
    await writeFile(join(member, 'package.json'), JSON.stringify({ name: 'workspace-member' }));
    const memberPlan = await createInstallPlan({ rootDir: member, mode: 'agent', version });
    expect(memberPlan.packageManager).toBe('pnpm');
    expect(memberPlan.commands[0]?.cwd).toBe(member);
    expect(memberPlan.commands[0]?.args).not.toContain('--workspace-root');
  });

  it.each(['^9.0.0', '^9.39.0', '^10.0.0', '10.1.0', '>=9.39.0 <11'])('preserves a compatible ESLint range %s', async range => {
    const root = await project({ devDependencies: { eslint: range }, scripts: { lint: 'custom-lint' } });
    const before = await readFile(join(root, 'package.json'), 'utf8');
    const plan = await createInstallPlan({ rootDir: root, mode: 'all', version });
    expect(plan.packages).toEqual([cli]);
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it.each(['^8.0.0', '9.10.0', '*', 'file:../eslint', 'not a range'])('refuses to silently replace an incompatible or unknown ESLint range %s', async range => {
    const root = await project({ dependencies: { eslint: range } });
    const before = await readFile(join(root, 'package.json'), 'utf8');
    await expect(createInstallPlan({ rootDir: root, mode: 'lint', version })).rejects.toMatchObject({ code: 'INSTALL_ESLINT_CONFLICT' });
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
    expect((await createInstallPlan({ rootDir: root, mode: 'agent', version })).packages).toEqual([cli]);
  });

  it('uses the bundled style engine without adding a separate preset package', async () => {
    const root = await project({ devDependencies: { eslint: '^10', tailwindcss: '^3.4.0' } });
    const before = await readFile(join(root, 'package.json'), 'utf8');
    const plan = await createInstallPlan({ rootDir: root, mode: 'all', preset: 'tailwind', version, packageManager: 'npm' });
    expect(plan.packages).toEqual([cli]);
    expect(plan.warnings).toEqual([]);
    expect(plan.packages.some(name => name.startsWith('tailwindcss@'))).toBe(false);
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
    const config = await createInstallPlan({ rootDir: root, mode: 'config', preset: 'tailwind', version });
    expect(config.commands).toEqual([]);
  });

  it.each(['lint', 'agent', 'all', 'config'] as const)('keeps preset installation dependencies identical in %s mode', async mode => {
    const root = await project({});
    const common = { rootDir: root, mode, version, packageManager: 'npm' as const };
    const ordinary = await createInstallPlan({ ...common, preset: 'project' });
    for (const preset of ['development', 'tailwind', 'full'] as const) {
      const styled = await createInstallPlan({ ...common, preset });
      expect(styled.packages).toEqual(ordinary.packages);
      expect(styled.commands).toEqual(ordinary.commands);
    }
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe('{}\n');
  });

  it.each(['project', 'development', 'tailwind', 'full'] as const)('accepts the %s profile without adding another GoodUI dependency', async preset => {
    const root = await project({});
    const plan = await createInstallPlan({ rootDir: root, mode: 'agent', preset, version, packageManager: 'npm' });
    expect(plan.preset).toBe(preset);
    expect(plan.packages).toEqual([cli]);
    expect(plan.warnings).toEqual([]);
  });

  it('rejects an unsupported profile before any filesystem or process change', async () => {
    const root = await project({});
    await expect(createInstallPlan({ rootDir: root, mode: 'agent', preset: 'full; echo unsafe' as Preset, version })).rejects.toMatchObject({ code: 'INVALID_PRESET' });
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe('{}\n');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('rejects malformed manifests, unsupported managers, and non-semver installer versions', async () => {
    const root = await project();
    await writeFile(join(root, 'package.json'), '{ invalid json');
    await expect(createInstallPlan({ rootDir: root, mode: 'agent', version })).rejects.toMatchObject({ code: 'INVALID_PACKAGE_JSON' });
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe('{ invalid json');
    await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'unknown@1' }));
    await expect(createInstallPlan({ rootDir: root, mode: 'agent', version })).rejects.toMatchObject({ code: 'INVALID_PACKAGE_MANAGER' });
    await expect(createInstallPlan({ rootDir: root, mode: 'agent', version, packageManager: 'npm && echo unsafe' as PackageManager })).rejects.toMatchObject({ code: 'INVALID_PACKAGE_MANAGER' });
    await expect(createInstallPlan({ rootDir: root, mode: 'agent', version: 'latest;echo unsafe', packageManager: 'npm' })).rejects.toMatchObject({ code: 'INVALID_INSTALL_VERSION' });
    expect(await readdir(root)).toEqual(['package.json']);
  });
});

describe('installation execution', () => {
  it('localizes execution failures without changing error codes or subprocess details', async () => {
    const root = await project({});
    const plan = await createInstallPlan({ rootDir: root, mode: 'agent', packageManager: 'npm', version, locale: 'ko' });
    await expect(executeInstallPlan(plan, { locale: 'ko', runCommand: async () => { throw new Error('offline'); } })).rejects.toMatchObject({
      code: 'INSTALL_EXECUTION_FAILED', message: '의존성 설치에 실패했습니다: offline', details: { command: 'npm' },
    });
  });
  it('creates only a missing minimal manifest and leaves the remaining work to the selected manager', async () => {
    const root = await project();
    const plan = await createInstallPlan({ rootDir: root, mode: 'lint', version });
    const runCommand = vi.fn().mockResolvedValue(undefined);
    const result = await executeInstallPlan(plan, { runCommand });
    expect(result).toEqual({ installed: true, commandsExecuted: 1, packageJsonCreated: true });
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))).toEqual({ private: true });
    expect(runCommand).toHaveBeenCalledWith(plan.commands[0], expect.objectContaining({ runCommand }));
  });

  it('preserves existing package data and scripts on a package manager failure', async () => {
    const root = await project({ name: 'existing-project', scripts: { lint: 'custom command' }, dependencies: { other: '^1' } });
    const before = await readFile(join(root, 'package.json'), 'utf8');
    const plan = await createInstallPlan({ rootDir: root, mode: 'agent', version });
    await expect(executeInstallPlan(plan, { runCommand: async () => { throw new Error('network unavailable'); } })).rejects.toMatchObject({ code: 'INSTALL_EXECUTION_FAILED' });
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('revalidates a changed manifest and rejects malformed plans before mutation', async () => {
    const root = await project();
    const plan = await createInstallPlan({ rootDir: root, mode: 'agent', version });
    const tampered = { ...plan, commands: [{ ...plan.commands[0]!, command: 'node' as PackageManager }] };
    await expect(executeInstallPlan(tampered)).rejects.toMatchObject({ code: 'INVALID_INSTALL_PLAN' });
    expect(await readdir(root)).toEqual([]);
    await writeFile(join(root, 'package.json'), '{broken');
    await expect(executeInstallPlan(plan)).rejects.toMatchObject({ code: 'INVALID_PACKAGE_JSON' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('uses cross-spawn with fixed arguments, no shell interpolation, and streamed output', async () => {
    const root = await project({});
    const plan = await createInstallPlan({ rootDir: root, mode: 'lint', packageManager: 'pnpm', version });
    spawnMock.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      queueMicrotask(() => {
        child.stdout.write('installation output');
        child.stderr.write('installation diagnostic');
        child.emit('close', 0, null);
      });
      return child;
    });
    const onStdout = vi.fn(), onStderr = vi.fn();
    expect(await executeInstallPlan(plan, { onStdout, onStderr })).toMatchObject({ installed: true, commandsExecuted: 1 });
    expect(spawnMock).toHaveBeenCalledWith('pnpm', ['add', '--save-dev', '--save-exact', cli, 'eslint@^10.0.0'], expect.objectContaining({ cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    expect(onStdout).toHaveBeenCalledWith('installation output');
    expect(onStderr).toHaveBeenCalledWith('installation diagnostic');
  });

  it.each(['exit', 'spawn'] as const)('propagates package manager %s failures', async failure => {
    const root = await project({});
    const plan = await createInstallPlan({ rootDir: root, mode: 'agent', version });
    spawnMock.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      queueMicrotask(() => {
        if (failure === 'spawn') child.emit('error', new Error('executable missing'));
        else child.emit('close', 7, null);
      });
      return child;
    });
    await expect(executeInstallPlan(plan)).rejects.toMatchObject({ code: 'INSTALL_EXECUTION_FAILED' });
  });
});
