import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { PolicyError, policySchema, getPolicySchema, readPolicy, resolveLocale, resolveProjectPath, writePolicy, type LocaleInput, type Policy } from '@pixelhize/goodui-core';
import type { InstallMode, PackageManager, Preset } from './installer.js';
import { applyPreset } from './templates.js';
import { localizeCliMessage, withCliLocale } from './locale.js';
import { applyAiSlopChoices, type AiSlopChoices } from './ai-slop-config.js';

export const initialPolicy: Policy = {
  $schema: './.goodui/schema.json',
  version: 1,
  aiSlop: { enabled: true },
  rules: [{
    id: 'no-eval', kind: 'restricted-api', globals: ['eval'],
    reason: 'Do not execute strings as code.',
    suggestion: 'Use explicit function calls or parse data with JSON.parse instead.',
  }],
};

/** Built-in prose is localized only when creating a new policy. */
export function createInitialPolicy(locale?: LocaleInput): Policy {
  const policy = structuredClone(initialPolicy);
  for (const rule of policy.rules) {
    rule.reason = localizeCliMessage(rule.reason, locale);
    if (rule.suggestion) rule.suggestion = localizeCliMessage(rule.suggestion, locale);
  }
  return policy;
}

export function editorConfig(policyPath = 'goodui.policy.json', locale?: LocaleInput): string {
  return `import { fileURLToPath } from 'node:url';\nimport { createConfig } from '@pixelhize/goodui-cli/config';\n\nexport default await createConfig({\n  rootDir: fileURLToPath(new URL('.', import.meta.url)),\n  policyPath: ${JSON.stringify(policyPath)},\n  locale: ${JSON.stringify(resolveLocale(locale))},\n});\n`;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export interface SetupOptions { rootDir: string; policyPath: string; mode: InstallMode; preset: Preset; packageManager: PackageManager; locale?: LocaleInput; aiSlop?: AiSlopChoices }
export interface ConfigurationPlan {
  policyFile: string; policyCreated: boolean; policyUpdated: boolean;
  schemaFile: string; schemaCreated: boolean; schemaUpdated: boolean;
  configFile?: string; configCreated: boolean; integration?: string;
  scripts: Record<string, string>; warnings: string[];
  mcp?: { mcpServers: Record<string, { command: string; args: string[] }> };
  writes: string[];
  policy: Policy;
  revision: string | null;
  schemaContent: string;
  previousSchema: string | null;
}

function mcpConfiguration(root: string, manager: PackageManager, policyPath: string, locale?: LocaleInput): NonNullable<ConfigurationPlan['mcp']> {
  const commands = {
    npm: ['--prefix', root, 'exec', '--', 'goodui', 'mcp', '--root', root],
    pnpm: ['--dir', root, 'exec', 'goodui', 'mcp', '--root', root],
    yarn: ['--cwd', root, 'exec', 'goodui', 'mcp', '--root', root],
    bun: ['--cwd', root, 'run', 'goodui', 'mcp', '--root', root],
  };
  return { mcpServers: { goodui: { command: manager, args: [...commands[manager], '--policy', policyPath, '--locale', resolveLocale(locale)] } } };
}

/** Read-only preflight: validate existing user files before installing or writing. */
export async function planConfiguration(args: SetupOptions): Promise<ConfigurationPlan> {
  const locale = resolveLocale(args.locale);
  return withCliLocale(locale, async () => {
    const root = await resolveProjectPath(args.rootDir, '.');
    const policyFile = await resolveProjectPath(root, args.policyPath, { allowMissing: true });
    const policyCreated = !await exists(policyFile);
    const snapshot = policyCreated ? undefined : await readPolicy(root, args.policyPath, { locale });
    const schemaFile = await resolveProjectPath(root, '.goodui/schema.json', { allowMissing: true });
    const previousSchema = await exists(schemaFile) ? await readFile(schemaFile, 'utf8') : null;
    const schemaContent = JSON.stringify(getPolicySchema(locale), null, 2) + '\n';
    if (previousSchema !== null && previousSchema !== schemaContent) {
      let knownSchema = false;
      try { knownSchema = JSON.parse(previousSchema.replace(/^\uFEFF/, '')).$id === policySchema.$id; } catch { /* Preserve unrelated user files. */ }
      if (!knownSchema) throw new PolicyError('SCHEMA_CONFLICT', 'The reserved .goodui/schema.json path contains a different file. Move it before setting up GoodUI.');
    }
    const schema = relative(dirname(policyFile), schemaFile).replaceAll('\\', '/');
    let policy = snapshot ? structuredClone(snapshot.policy) : createInitialPolicy(locale);
    if (!policy.$schema || /@pixelhize\/goodui-(?:core|cli)\/schema\.json/.test(policy.$schema) || policyCreated) {
      policy.$schema = schema.startsWith('../') || schema.startsWith('./') ? schema : `./${schema}`;
    }
    const applied = applyPreset(policy, args.preset, locale);
    policy = applyAiSlopChoices(applied.policy, args.aiSlop ?? {}, locale);
    const result: ConfigurationPlan = {
      policyFile, policyCreated, policyUpdated: !!snapshot && JSON.stringify(snapshot.policy) !== JSON.stringify(policy),
      schemaFile, schemaCreated: previousSchema === null, schemaUpdated: previousSchema !== null && previousSchema !== schemaContent,
      configCreated: false, scripts: {}, warnings: [...applied.warnings], writes: [], policy, revision: snapshot?.revision ?? null,
      schemaContent, previousSchema,
    };
    if (result.schemaCreated || result.schemaUpdated) result.writes.push(schemaFile);
    if (result.policyCreated || result.policyUpdated) result.writes.push(policyFile);
    if (args.mode !== 'agent') {
      for (const name of ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts']) {
        if (await exists(resolve(root, name))) { result.configFile = await resolveProjectPath(root, name); break; }
      }
      result.integration = editorConfig(args.policyPath, locale);
      if (!result.configFile) {
        result.configFile = await resolveProjectPath(root, 'eslint.config.mjs', { allowMissing: true });
        result.configCreated = true;
        result.writes.push(result.configFile);
      } else {
        const current = await readFile(result.configFile, 'utf8');
        if (!current.includes('@pixelhize/goodui-cli/config')) result.warnings.push('Existing ESLint configuration is preserved. Add the returned integration snippet to enable GoodUI in your editor; goodui check already works independently.');
      }
    }
    if (args.mode === 'lint' || args.mode === 'all') {
      if (args.policyPath === 'goodui.policy.json') {
        const manifest = await resolveProjectPath(root, 'package.json', { allowMissing: true });
        if (await exists(manifest)) {
          const data = JSON.parse((await readFile(manifest, 'utf8')).replace(/^\uFEFF/, ''));
          if (data.scripts !== undefined && (!data.scripts || typeof data.scripts !== 'object' || Array.isArray(data.scripts))) throw new PolicyError('INVALID_PACKAGE_JSON', 'package.json scripts must be an object.');
          if (Object.hasOwn(data.scripts ?? {}, 'lint:goodui') && data.scripts['lint:goodui'] !== 'goodui check') result.warnings.push('Existing lint:goodui script is preserved; run goodui check directly.');
          else if (!Object.hasOwn(data.scripts ?? {}, 'lint:goodui')) result.scripts['lint:goodui'] = 'goodui check';
        } else result.scripts['lint:goodui'] = 'goodui check';
        if (Object.keys(result.scripts).length) result.writes.push(manifest);
      } else result.warnings.push('A custom policy path is in use. Run goodui check with --policy; add a matching project script if needed.');
    }
    if (args.mode === 'agent' || args.mode === 'all') result.mcp = mcpConfiguration(root, args.packageManager, args.policyPath, locale);
    result.warnings = result.warnings.map(message => localizeCliMessage(message, locale));
    return result;
  });
}

async function addScripts(root: string, additions: Record<string, string>): Promise<void> {
  if (!Object.keys(additions).length) return;
  const path = await resolveProjectPath(root, 'package.json');
  const before = await readFile(path, 'utf8');
  const manifest = JSON.parse(before.replace(/^\uFEFF/, ''));
  if (manifest.scripts !== undefined && (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))) throw new PolicyError('INVALID_PACKAGE_JSON', 'package.json scripts must be an object.');
  const scripts = { ...manifest.scripts };
  for (const [name, command] of Object.entries(additions)) if (!Object.hasOwn(scripts, name)) scripts[name] = command;
  if (JSON.stringify(scripts) === JSON.stringify(manifest.scripts)) return;
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ ...manifest, scripts }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    if (await readFile(path, 'utf8') !== before) throw new PolicyError('PACKAGE_JSON_CONFLICT', 'package.json changed while setting up scripts. Run init again.');
    await resolveProjectPath(root, 'package.json');
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => undefined); }
}

export async function applyConfiguration(args: SetupOptions, plan: ConfigurationPlan): Promise<void> {
  const locale = resolveLocale(args.locale);
  return withCliLocale(locale, async () => {
    if (plan.schemaCreated || plan.schemaUpdated) {
      await mkdir(dirname(plan.schemaFile), { recursive: true });
      await resolveProjectPath(args.rootDir, plan.schemaFile, { allowMissing: true });
      const current = await exists(plan.schemaFile) ? await readFile(plan.schemaFile, 'utf8') : null;
      if (current !== plan.previousSchema) throw new PolicyError('SCHEMA_CONFLICT', 'The generated schema changed during setup. Run init again.');
      const temporary = `${plan.schemaFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, plan.schemaContent, { encoding: 'utf8', flag: 'wx' });
        const latest = await exists(plan.schemaFile) ? await readFile(plan.schemaFile, 'utf8') : null;
        if (latest !== current) throw new PolicyError('SCHEMA_CONFLICT', 'The generated schema changed during setup. Run init again.');
        await rename(temporary, plan.schemaFile);
      } finally { await unlink(temporary).catch(() => undefined); }
    }
    if (plan.policyCreated || plan.policyUpdated) await writePolicy(args.rootDir, plan.policy, { policyPath: args.policyPath, expectedRevision: plan.revision, locale });
    if (plan.configCreated && plan.configFile && plan.integration) {
      await resolveProjectPath(args.rootDir, plan.configFile, { allowMissing: true });
      try { await writeFile(plan.configFile, plan.integration, { encoding: 'utf8', flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; plan.warnings.push(localizeCliMessage('An ESLint config was created concurrently and was preserved. Add the integration snippet manually.', locale)); plan.configCreated = false; }
    }
    await addScripts(args.rootDir, plan.scripts);
  });
}
