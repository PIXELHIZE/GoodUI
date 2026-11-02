import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveLocale, resolveProjectPath, type LocaleInput } from '@pixelhize/goodui-core';
import { localizeCliMessage, withCliLocale } from './locale.js';
import spawn from 'cross-spawn';
import { intersects, subset, valid, validRange } from 'semver';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';
export type InstallMode = 'lint' | 'agent' | 'all' | 'config';
export type Preset = 'project' | 'development' | 'tailwind' | 'full';

export interface InstallCommand {
  command: PackageManager;
  args: string[];
  cwd: string;
}

export interface InstallPlan {
  rootDir: string;
  mode: InstallMode;
  preset: Preset;
  packageManager: PackageManager;
  packages: string[];
  commands: InstallCommand[];
  warnings: string[];
  createPackageJson: boolean;
}

export interface InstallResult {
  installed: boolean;
  commandsExecuted: number;
  packageJsonCreated: boolean;
}

export interface InstallOutputHooks {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

export interface InstallExecutionOptions extends InstallOutputHooks {
  locale?: LocaleInput;
  runCommand?: (command: InstallCommand, hooks: InstallOutputHooks) => Promise<void>;
}

export class InstallerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'InstallerError';
  }
}

const managers = ['npm', 'pnpm', 'yarn', 'bun'] as const;
const modes = ['lint', 'agent', 'all', 'config'] as const;
const presets = ['project', 'development', 'tailwind', 'full'] as const;
const supportedEslint = '^9.39.0 || ^10.0.0';

function checkManager(value: unknown): asserts value is PackageManager {
  if (!managers.includes(value as PackageManager)) {
    throw new InstallerError('INVALID_PACKAGE_MANAGER', 'Package manager must be npm, pnpm, yarn, or bun.');
  }
}

function checkMode(value: unknown): asserts value is InstallMode {
  if (!modes.includes(value as InstallMode)) {
    throw new InstallerError('INVALID_INSTALL_MODE', 'Install mode must be lint, agent, all, or config.');
  }
}

export async function chooseInstallMode(options: {
  locale?: LocaleInput;
  mode?: InstallMode;
  yes?: boolean;
  json?: boolean;
  isTTY?: boolean;
  prompt?: () => Promise<InstallMode | null>;
} = {}): Promise<InstallMode | null> {
  return withCliLocale(options.locale, async () => {
    if (options.mode !== undefined) {
      checkMode(options.mode);
      return options.mode;
    }
    if (options.yes) return 'lint';
    const isTTY = options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (options.json || !isTTY) {
      throw new InstallerError('INSTALL_MODE_REQUIRED', 'Non-interactive init requires --yes or --mode lint|agent|all|config.');
    }
    let selected: InstallMode | null;
    if (options.prompt) {
      selected = await options.prompt();
    } else {
      const { select, isCancel } = await import('@clack/prompts');
      const answer = await select<InstallMode>({
        message: localizeCliMessage('How would you like to set up GoodUI?', options.locale) + (resolveLocale(options.locale) === 'ko' ? '\n↑/↓ 이동 · Enter 선택' : ''),
        showInstructions: resolveLocale(options.locale) !== 'ko',
        initialValue: 'lint',
        options: [
          { value: 'lint', label: localizeCliMessage('Lint', options.locale), hint: localizeCliMessage('Local checks, editor integration, and CI', options.locale) },
          { value: 'agent', label: localizeCliMessage('AI agent', options.locale), hint: localizeCliMessage('CLI and MCP tools', options.locale) },
          { value: 'all', label: localizeCliMessage('Lint + AI agent', options.locale), hint: localizeCliMessage('Editor, CI, and MCP tools', options.locale) },
          { value: 'config', label: localizeCliMessage('Configuration only', options.locale), hint: localizeCliMessage('Skip dependency installation', options.locale) },
        ],
      });
      selected = isCancel(answer) ? null : answer;
    }
    if (selected !== null) checkMode(selected);
    return selected;
  });
}

type Manifest = Record<string, unknown>;

function isObject(value: unknown): value is Manifest {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readManifest(rootDir: string): Promise<Manifest | undefined> {
  const path = await resolveProjectPath(rootDir, 'package.json', { allowMissing: true });
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new InstallerError('INVALID_PACKAGE_JSON', 'Cannot read the project package.json.');
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new InstallerError('INVALID_PACKAGE_JSON', 'The project package.json must contain valid JSON.');
  }
  if (!isObject(manifest)) {
    throw new InstallerError('INVALID_PACKAGE_JSON', 'The project package.json must contain an object.');
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[field];
    if (dependencies !== undefined && (!isObject(dependencies) || Object.values(dependencies).some(value => typeof value !== 'string'))) {
      throw new InstallerError('INVALID_PACKAGE_JSON', `package.json ${field} must map package names to string versions.`);
    }
  }
  return manifest;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function localManagerHint(rootDir: string, manifest: Manifest | undefined): Promise<PackageManager | undefined> {
  if (manifest?.packageManager !== undefined) {
    const value = manifest.packageManager;
    const match = typeof value === 'string' && /^(npm|pnpm|yarn|bun)@\S+$/.exec(value);
    if (!match) {
      throw new InstallerError('INVALID_PACKAGE_MANAGER', 'Unsupported package.json packageManager field. Set --package-manager npm|pnpm|yarn|bun explicitly.');
    }
    return match[1] as PackageManager;
  }
  const locks: [string, PackageManager][] = [
    ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
    ['pnpm-workspace.yaml', 'pnpm'],
  ];
  const found = await Promise.all(locks.map(async ([file, manager]) => await exists(join(rootDir, file)) ? manager : undefined));
  const unique = [...new Set(found.filter((manager): manager is PackageManager => manager !== undefined))];
  if (unique.length > 1) {
    throw new InstallerError('AMBIGUOUS_PACKAGE_MANAGER', 'Multiple package manager lockfiles were found. Set --package-manager npm|pnpm|yarn|bun explicitly.', { packageManagers: unique });
  }
  return unique[0];
}

async function detectManager(rootDir: string, manifest: Manifest | undefined, explicit?: PackageManager): Promise<{ manager: PackageManager; inheritedFrom?: string }> {
  if (explicit !== undefined) {
    checkManager(explicit);
    return { manager: explicit };
  }
  const local = await localManagerHint(rootDir, manifest);
  if (local) return { manager: local };
  // A bootstrap launched through npm exec may still target a pnpm/yarn/bun
  // workspace member. Inspect ancestor metadata, but keep the command cwd here.
  for (let parent = dirname(rootDir); parent !== dirname(parent); parent = dirname(parent)) {
    const parentManifest = await readManifest(parent);
    const inherited = await localManagerHint(parent, parentManifest);
    if (inherited) return { manager: inherited, inheritedFrom: parent };
  }
  return { manager: 'npm' };
}

function hasCompatibleEslint(manifest: Manifest | undefined): boolean {
  const declared = ['dependencies', 'devDependencies', 'optionalDependencies']
    .map(field => (manifest?.[field] as Record<string, string> | undefined)?.eslint)
    .filter((range): range is string => range !== undefined);
  if (!declared.length) return false;
  for (const range of declared) {
    const parsed = validRange(range);
    // Preserve ^9 and ^10 projects without silently upgrading their engine.
    // Unbounded ranges could select an unsupported future major.
    if (!parsed || !subset(parsed, '>=9.0.0 <11.0.0') || !intersects(parsed, supportedEslint)) {
      throw new InstallerError('INSTALL_ESLINT_CONFLICT', `Existing ESLint version range ${JSON.stringify(range)} is not compatible with GoodUI (${supportedEslint}). Update it explicitly or choose --mode agent|config.`, { range, supported: supportedEslint });
    }
  }
  return true;
}

function commandArguments(manager: PackageManager, packages: string[]): string[] {
  return manager === 'npm'
    ? ['install', '--save-dev', '--save-exact', ...packages]
    : manager === 'pnpm'
      ? ['add', '--save-dev', '--save-exact', ...packages]
      : ['add', '--dev', '--exact', ...packages];
}

export async function createInstallPlan(options: {
  locale?: LocaleInput;
  rootDir: string;
  mode: InstallMode;
  preset?: Preset;
  packageManager?: PackageManager;
  version: string;
}): Promise<InstallPlan> {
  return withCliLocale(options.locale, async () => {
    checkMode(options.mode);
    const preset = options.preset ?? 'project';
    if (!presets.includes(preset)) throw new InstallerError('INVALID_PRESET', 'Preset must be project, development, tailwind, or full.');
    if (valid(options.version) !== options.version) {
      throw new InstallerError('INVALID_INSTALL_VERSION', 'The GoodUI installer version must be an exact semantic version.');
    }
    const rootDir = await resolveProjectPath(options.rootDir, '.');
    const manifest = await readManifest(rootDir);
    const detected = await detectManager(rootDir, manifest, options.packageManager);
    const packageManager = detected.manager;
    const packages: string[] = [];
    const warnings: string[] = [];
    if (detected.inheritedFrom) warnings.push(`Detected ${packageManager} from ${detected.inheritedFrom}; dependencies will be added to the selected project ${rootDir}.`);
    if (options.mode !== 'config') {
      packages.push(`@pixelhize/goodui-cli@${options.version}`);
      if ((options.mode === 'lint' || options.mode === 'all') && !hasCompatibleEslint(manifest)) packages.push('eslint@^10.0.0');
    }
    const args = commandArguments(packageManager, packages);
    if (packageManager === 'pnpm' && await exists(join(rootDir, 'pnpm-workspace.yaml'))) args.splice(1, 0, '--workspace-root');
    return {
      rootDir, mode: options.mode, preset, packageManager, packages,
      commands: packages.length ? [{ command: packageManager, args, cwd: rootDir }] : [],
      warnings: warnings.map(message => localizeCliMessage(message, options.locale)),
      createPackageJson: !manifest && options.mode !== 'config',
    };
  });
}

async function runPackageManager(command: InstallCommand, hooks: InstallOutputHooks): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (data: Buffer) => hooks.onStdout?.(String(data)));
    child.stderr?.on('data', (data: Buffer) => hooks.onStderr?.(String(data)));
    child.once('error', error => rejectRun(new InstallerError('INSTALL_EXECUTION_FAILED', `Could not start ${command.command}: ${error.message}`, { command: command.command })));
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new InstallerError('INSTALL_EXECUTION_FAILED', `${command.command} installation failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`, { command: command.command, exitCode: code, signal }));
    });
  });
}

export async function executeInstallPlan(plan: InstallPlan, options: InstallExecutionOptions = {}): Promise<InstallResult> {
  return withCliLocale(options.locale, async () => {
    checkManager(plan.packageManager);
    for (const command of plan.commands) {
      if (command.command !== plan.packageManager || command.cwd !== plan.rootDir || !Array.isArray(command.args) || command.args.some(arg => typeof arg !== 'string')) {
        throw new InstallerError('INVALID_INSTALL_PLAN', 'Install commands must use the planned package manager, argument array, and project root.');
      }
    }
    const rootDir = await resolveProjectPath(plan.rootDir, '.');
    // Re-read before the first mutation: a user may have changed the manifest since preview.
    const manifest = await readManifest(rootDir);
    let packageJsonCreated = false;
    if (plan.createPackageJson && !manifest) {
      const path = await resolveProjectPath(rootDir, 'package.json', { allowMissing: true });
      try {
        await writeFile(path, `${JSON.stringify({ private: true }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        packageJsonCreated = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await readManifest(rootDir);
      }
    }
    let commandsExecuted = 0;
    const run = options.runCommand ?? runPackageManager;
    for (const command of plan.commands) {
      try {
        await run(command, options);
      } catch (error) {
        if (error instanceof InstallerError) throw error;
        throw new InstallerError('INSTALL_EXECUTION_FAILED', `Dependency installation failed: ${error instanceof Error ? error.message : String(error)}`, { command: command.command });
      }
      commandsExecuted++;
    }
    return { installed: commandsExecuted > 0, commandsExecuted, packageJsonCreated };
  });
}
