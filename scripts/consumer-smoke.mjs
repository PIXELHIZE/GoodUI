import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'goodui-consumer-'));
const registryMode = process.argv.includes('--registry');
const cliManifest = JSON.parse(await readFile(join(workspace, 'packages/cli/package.json'), 'utf8'));
const mainPackage = cliManifest.name;
const internalPackages = ['core', 'eslint-plugin', 'mcp'];
const slash = value => value.replaceAll('\\', '/');

async function run(command, args, cwd, allowed = [0]) {
  try { return { ...await execute(command, args, { cwd, maxBuffer: 4 * 1024 * 1024, timeout: 180000 }), code: 0 }; }
  catch (error) {
    if (allowed.includes(error.code)) return { stdout: String(error.stdout), stderr: String(error.stderr), code: error.code };
    throw new Error(`${command} failed (${error.code}):\n${error.stdout ?? ''}\n${error.stderr ?? error.message}`);
  }
}

function findNpm() {
  const candidates = [
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const match = candidates.find(existsSync);
  if (!match) throw new Error('npm CLI is required for the isolated consumer smoke test.');
  return match;
}

async function pnpm(args, cwd) {
  const manager = process.env.npm_execpath;
  if (!manager) throw new Error('Run this script through pnpm test:consumer or pnpm test:published.');
  return /\.[cm]?js$/.test(manager)
    ? run(process.execPath, [manager, ...args], cwd)
    : run(manager, args, cwd);
}

async function assertMainDependency(root, onlyMain) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const direct = { ...manifest.dependencies, ...manifest.devDependencies };
  const goodui = Object.keys(direct).filter(name => name === mainPackage || /@pixelhize\/(goodui-core|eslint-plugin-goodui|goodui-mcp)/.test(name));
  assert.deepEqual(goodui, [mainPackage], 'Only the main GoodUI package may be a direct dependency.');
  if (onlyMain) assert.deepEqual(Object.keys(direct), [mainPackage], 'The baseline must install exactly one direct dependency.');
}

async function assertMcp(root, cli, locale = 'en') {
  const help = await run(process.execPath, [cli, 'mcp', '--locale', locale, '--help'], root);
  assert.match(help.stdout, /--root/);
  const child = spawn(process.execPath, [cli, 'mcp', '--root', root, '--locale', locale], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  try {
    const tools = await new Promise((resolveTools, reject) => {
      const timeout = setTimeout(() => reject(new Error(`MCP handshake timed out: ${errors}`)), 15000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`MCP exited before responding (${code}): ${errors}`)); });
      child.stdout.on('data', chunk => {
        output += chunk;
        let newline;
        while ((newline = output.indexOf('\n')) !== -1) {
          const line = output.slice(0, newline).trim();
          output = output.slice(newline + 1);
          if (!line) continue;
          let message;
          try { message = JSON.parse(line); }
          catch { clearTimeout(timeout); reject(new Error(`MCP stdout was not JSON: ${line}`)); return; }
          if (message.id === 1) {
            if (message.error) { clearTimeout(timeout); reject(new Error(JSON.stringify(message.error))); return; }
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
          } else if (message.id === 2) {
            clearTimeout(timeout);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolveTools(message.result.tools);
          }
        }
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'goodui-consumer-smoke', version: '1.0.0' } } })}\n`);
    });
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_policy', 'get_rule_catalog', 'lint', 'set_policy', 'validate_policy']);
    if (locale === 'ko') for (const tool of tools) assert.match(tool.description, /[가-힣]/, `${tool.name} must have a Korean description.`);
  } finally {
    child.stdin.end();
    if (child.pid && child.exitCode === null) await new Promise(resolveExit => {
      const timeout = setTimeout(() => { child.kill(); resolveExit(); }, 2000);
      child.once('exit', () => { clearTimeout(timeout); resolveExit(); });
    });
  }
}

async function assertNativeDesign(root, cli, label) {
  const policyFile = join(root, 'goodui.policy.json');
  const before = await readFile(policyFile, 'utf8');
  const original = JSON.parse(before);
  const theme = join(root, 'theme.css');
  const design = join(root, 'design.tsx');
  assert(!existsSync(theme) && !existsSync(design), 'Native smoke fixtures must not replace existing files.');
  try {
    // No @import or target-project Tailwind dependency: the packaged primitive
    // must be sufficient to validate utility candidates against this theme.
    await writeFile(theme, '@theme { --color-brand: #112233; --spacing: .25rem; }\n@tailwind utilities;\n');
    await writeFile(policyFile, JSON.stringify({
      $schema: original.$schema, version: 1, files: ['design.tsx'],
      presets: ['tailwind'], rules: [], tailwind: { themeFiles: ['theme.css'] },
    }));
    await writeFile(design, 'export const View = () => <div className="p-[13px] bg-[#f00] rounded-huge" />;\n');
    const failed = await run(process.execPath, [cli, 'check', '--format', 'json'], root, [1]);
    assert.equal(failed.code, 1);
    const report = JSON.parse(failed.stdout);
    assert.equal(report.filesChecked, 1);
    for (const ruleId of ['goodui/no-arbitrary-values', 'goodui/no-raw-colors', 'goodui/no-unknown-classes']) {
      assert(report.diagnostics.some(diagnostic => diagnostic.ruleId === ruleId), `${label} must report native ${ruleId} from the main package.`);
    }
    await writeFile(design, 'export const View = () => <div className="p-4 bg-brand" />;\n');
    const passed = await run(process.execPath, [cli, 'check', '--format', 'json'], root);
    assert.equal(JSON.parse(passed.stdout).errorCount, 0);
  } finally {
    await writeFile(policyFile, before);
    await rm(design, { force: true });
    await rm(theme, { force: true });
  }
  assert.equal(await readFile(policyFile, 'utf8'), before, 'Native smoke must restore the original policy bytes.');
}

async function assertDevelopmentProfile(root, cli, label) {
  const policyFile = join(root, 'goodui.policy.json');
  const typedFile = join(root, 'typed.ts');
  const beforePolicy = await readFile(policyFile, 'utf8');
  const beforeSource = await readFile(typedFile, 'utf8');
  const beforeManifest = await readFile(join(root, 'package.json'), 'utf8');
  try {
    await run(process.execPath, [cli, 'init', '--no-install', '--yes', '--preset', 'development', '--format', 'json'], root);
    await writeFile(typedFile, 'const value: any = 1;\n');
    const failed = await run(process.execPath, [cli, 'check', 'typed.ts', '--format', 'json'], root, [1]);
    assert.equal(failed.code, 1);
    assert(JSON.parse(failed.stdout).diagnostics.some(diagnostic => diagnostic.policyId === 'strict-ts-syntax' && diagnostic.ruleId === 'goodui/restricted-syntax'), `${label} must enforce the development profile TypeScript contract.`);
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), beforeManifest, 'Configuration-only development setup must preserve package.json.');
  } finally {
    await writeFile(typedFile, beforeSource);
    await writeFile(policyFile, beforePolicy);
  }
}

async function assertAiSlop(root, cli, label) {
  const policyPath = join(root, 'goodui.policy.json');
  const original = await readFile(policyPath, 'utf8');
  const sourcePath = join(root, 'ai-slop.tsx');
  assert(!existsSync(sourcePath));
  try {
    const policy = JSON.parse(original);
    policy.files = ['ai-slop.tsx'];
    policy.aiSlop = { enabled: true };
    await writeFile(policyPath, JSON.stringify(policy));
    await writeFile(sourcePath, 'export const Page = () => <main><h1 className="bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">Unlock your potential 🚀</h1><a href="#">Try it</a><button className="hover:scale-105">Save</button></main>;\n');
    const inspect = async expected => {
      const result = await run(process.execPath, [cli, 'check', '--locale', 'ko', '--format', 'json'], root, [expected]);
      assert.equal(result.code, expected);
      return JSON.parse(result.stdout);
    };
    const failing = await inspect(1);
    for (const name of ['no-gradient-text', 'no-purple-gradients', 'no-generic-copy', 'no-emoji-icons', 'no-placeholder-links', 'no-hover-lift']) {
      assert(failing.diagnostics.some(d => d.ruleId === `goodui/${name}`), `${name} must detect its source pattern in ${label}.`);
    }
    assert(failing.diagnostics.every(d => d.line > 0 && d.column > 0 && /[가-힣]/.test(d.message)));
    await run(process.execPath, [cli, 'policy', 'disable', 'no-emoji-icons', '--format', 'json'], root);
    const partial = await inspect(1);
    assert(!partial.diagnostics.some(d => d.ruleId === 'goodui/no-emoji-icons'));
    assert(partial.diagnostics.some(d => d.ruleId === 'goodui/no-gradient-text'));
    await run(process.execPath, [cli, 'policy', 'disable', 'ai-slop', '--format', 'json'], root);
    await inspect(0);
    await run(process.execPath, [cli, 'policy', 'enable', 'ai-slop', '--format', 'json'], root);
    assert(!(await inspect(1)).diagnostics.some(d => d.ruleId === 'goodui/no-emoji-icons'), 'Group reactivation must preserve individual choices.');
    await run(process.execPath, [cli, 'init', '--no-install', '--ai-slop-rules', 'no-placeholder-links', '--format', 'json'], root);
    assert.deepEqual([...new Set((await inspect(1)).diagnostics.map(d => d.ruleId))], ['goodui/no-placeholder-links']);
    await writeFile(sourcePath, 'export const Page = () => <main><h1>Review project activity</h1><a href="/projects">Open projects</a></main>;\n');
    await inspect(0);
  } finally {
    await writeFile(policyPath, original);
    await rm(sourcePath, { force: true });
  }
}

async function exercise(root, label, nativeEslint, packageManager = 'npm') {
  const cli = join(root, 'node_modules', mainPackage, 'dist/index.js');
  const installed = packageManager === 'pnpm'
    ? await pnpm(['exec', 'goodui', '--version'], root)
    : await run(process.execPath, [findNpm(), 'exec', '--', 'goodui', '--version'], root);
  assert.equal(installed.stdout.trim(), cliManifest.version);
  const beforeInit = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await run(process.execPath, [cli, 'init', '--no-install', '--yes', '--locale', 'en', '--format', 'json'], root);
  await assertMainDependency(root, !nativeEslint);
  const afterInit = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(afterInit.devDependencies, beforeInit.devDependencies, 'Configuration-only initialization must not add dependencies.');
  const policy = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
  assert.match(policy.$schema, /(?:^|\/)\.goodui\/schema\.json$/);
  assert(existsSync(resolve(root, policy.$schema)), 'The initializer must create the local schema copy.');
  const editorConfig = await readFile(join(root, 'eslint.config.mjs'), 'utf8');
  assert.match(editorConfig, /@pixelhize\/goodui-cli\/config/);
  assert.doesNotMatch(editorConfig, /@pixelhize\/(eslint-plugin-goodui|goodui-core)/);
  const loaded = await run(process.execPath, ['--input-type=module', '-e', "const config = await import('@pixelhize/goodui-cli/config'); const schema = await import('@pixelhize/goodui-cli/schema.json', { with: { type: 'json' } }); if (typeof config.createConfig !== 'function' || schema.default.properties.version.const !== 1) process.exit(1);"], root);
  assert.equal(loaded.code, 0);
  const setupGuide = await readFile(join(root, 'node_modules', mainPackage, 'SETUP.md'), 'utf8');
  assert.match(setupGuide, /--dry-run/);
  const packageRoot = join(root, 'node_modules', mainPackage);
  for (const name of await readdir(join(packageRoot, 'examples'))) {
    if (!name.endsWith('.json')) continue;
    const example = JSON.parse(await readFile(join(packageRoot, 'examples', name), 'utf8'));
    assert(existsSync(resolve(packageRoot, 'examples', example.$schema)), `Packaged example schema must resolve: ${name}`);
  }
  for (const folder of ['docs', 'examples']) {
    for (const file of await readdir(join(packageRoot, folder))) {
      if (!file.endsWith('.md')) continue;
      const source = join(packageRoot, folder, file);
      const markdown = await readFile(source, 'utf8');
      for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(?:https?:|#)/.test(match[1])) continue;
        assert(existsSync(resolve(dirname(source), match[1].split('#')[0])), `Packaged guide link must resolve: ${source} -> ${match[1]}`);
      }
    }
  }
  assert(existsSync(join(packageRoot, 'docs', 'policy.md')));
  assert(existsSync(join(packageRoot, 'examples', 'tailwind-policy.json')));
  const catalog = JSON.parse((await run(process.execPath, [cli, 'rules', '--format', 'json'], root)).stdout);
  assert.equal(catalog.rules.length, 28, 'The packaged CLI must expose all built-in contracts.');
  assert(catalog.rules.some(rule => rule.id === 'goodui/component-contracts'));
  assert(catalog.rules.some(rule => rule.id === 'goodui/no-unknown-classes'));
  const koreanHelp = await run(process.execPath, [cli, '--help', '--locale', 'ko'], root);
  assert.match(koreanHelp.stdout, /키보드 설치 마법사/);
  const koreanCatalog = JSON.parse((await run(process.execPath, [cli, 'rules', '--locale', 'ko', '--format', 'json'], root)).stdout);
  assert.deepEqual(koreanCatalog.rules.map(rule => rule.id), catalog.rules.map(rule => rule.id));
  for (const rule of koreanCatalog.rules) assert.match(rule.description, /[가-힣]/);
  for (const id of ['function-limits', 'goodui/no-restyle']) {
    const explanation = JSON.parse((await run(process.execPath, [cli, 'explain', id, '--format', 'json'], root)).stdout);
    assert(explanation.id?.startsWith('goodui/'), `The packaged CLI must explain ${id}.`);
  }
  const customExplanation = JSON.parse((await run(process.execPath, [cli, 'explain', 'no-eval', '--format', 'json'], root)).stdout);
  assert.equal(customExplanation.policyId, 'no-eval');
  const health = JSON.parse((await run(process.execPath, [cli, 'doctor', '--format', 'json'], root)).stdout);
  assert.equal(health.ok, true, 'The initialized policy and bundled engine must be ready; editor warnings are permitted.');
  for (const id of ['policy', 'schema', 'engine']) assert(health.checks.some(check => check.id === id && check.status === 'ok'), `Doctor must validate ${id} in ${label}.`);

  const badSources = {
    'plain.js': 'eval("1");\n',
    'common.cjs': 'module.exports = eval("1");\n',
    'typed.ts': 'const value: number = eval("1");\n',
    'react.tsx': 'export const View = () => <button onClick={() => eval("1")}>Go</button>;\n',
    'view.vue': '<template><button @click="eval(\'1\')">Go</button></template>\n',
    'view.svelte': '<button onclick={() => eval("1")}>Go</button>\n',
  };
  for (const [name, source] of Object.entries(badSources)) await writeFile(join(root, name), source);
  const failing = await run(process.execPath, [cli, 'check', '--locale', 'en', '--format', 'json'], root, [1]);
  assert.equal(failing.code, 1);
  const report = JSON.parse(failing.stdout);
  for (const name of Object.keys(badSources)) {
    assert(report.diagnostics.some(d => basename(d.filePath) === name && d.policyId === 'no-eval'), `${name} should report no-eval in ${label}`);
  }
  const policyBeforeTranslation = await readFile(join(root, 'goodui.policy.json'), 'utf8');
  const korean = JSON.parse((await run(process.execPath, [cli, 'check', '--locale', 'ko', '--format', 'json'], root, [1])).stdout);
  const stableFields = diagnostics => diagnostics.map(({filePath, line, column, ruleId, policyId, severity, reason, suggestion}) => ({filePath, line, column, ruleId, policyId, severity, reason, suggestion}));
  assert.deepEqual(stableFields(korean.diagnostics), stableFields(report.diagnostics));
  for (const diagnostic of korean.diagnostics) {
    assert.match(diagnostic.message, /[가-힣]/);
    assert(!diagnostic.message.includes('Reason:'));
  }
  assert.equal(await readFile(join(root, 'goodui.policy.json'), 'utf8'), policyBeforeTranslation);
  if (nativeEslint) {
    const editor = await run(process.execPath, [join(root, 'node_modules/eslint/bin/eslint.js'), '.', '--format', 'json'], root, [1]);
    const nativeDiagnostics = JSON.parse(editor.stdout).flatMap(result => result.messages.filter(m => m.ruleId?.startsWith('goodui/')).map(m => ({ filePath: result.filePath, line: m.line, column: m.column, ruleId: m.ruleId, message: m.message })));
    const normalize = values => values.map(({ filePath, line, column, ruleId, message }) => ({ filePath: slash(filePath), line, column, ruleId, message })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(normalize(report.diagnostics.filter(d => d.policyId)), normalize(nativeDiagnostics));
  }
  const goodSources = {
    'plain.js': 'const value = 1;\n',
    'common.cjs': 'module.exports = 1;\n',
    'typed.ts': 'const value: number = 1;\n',
    'react.tsx': 'export const View = () => <button>Go</button>;\n',
    'view.vue': '<template><button>Go</button></template>\n',
    'view.svelte': '<button>Go</button>\n',
  };
  for (const [name, source] of Object.entries(goodSources)) await writeFile(join(root, name), source);
  const passing = await run(process.execPath, [cli, 'check', '--format', 'json'], root);
  assert.equal(JSON.parse(passing.stdout).errorCount, 0);
  await run(process.execPath, [cli, 'policy', 'validate'], root);
  const before = await readFile(join(root, 'goodui.policy.json'), 'utf8');
  await run(process.execPath, [cli, 'init', '--no-install', '--yes'], root);
  assert.equal(await readFile(join(root, 'goodui.policy.json'), 'utf8'), before);
  await assertNativeDesign(root, cli, label);
  await assertDevelopmentProfile(root, cli, label);
  await assertAiSlop(root, cli, label);
  await assertMainDependency(root, !nativeEslint);
  await assertMcp(root, cli, 'ko');
  console.log(`${label}: main-only install, packaged guides/schema, six-language parity, native/development contracts, AI Slop detection/group/member toggles, Korean/English and MCP passed.`);
}

try {
  let cliSpec = cliManifest.version;
  const overrides = {};
  if (!registryMode) {
    const packDirectory = join(temporary, 'packs');
    await mkdir(packDirectory);
    for (const name of [...internalPackages, 'cli']) {
      const manifest = JSON.parse(await readFile(join(workspace, 'packages', name, 'package.json'), 'utf8'));
      await pnpm(['--dir', join(workspace, 'packages', name), 'pack', '--pack-destination', packDirectory], workspace);
      const archive = join(packDirectory, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`);
      assert(existsSync(archive), `Missing packed package: ${archive}`);
      if (name === 'cli') cliSpec = `file:${slash(archive)}`;
      else overrides[manifest.name] = `file:${slash(archive)}`;
    }
    assert.equal((await readdir(packDirectory)).filter(name => name.endsWith('.tgz')).length, 4);
  }
  const npm = findNpm();
  for (const major of [null, 9, 10]) {
    const label = major === null ? 'npm CLI-only baseline' : `npm ESLint ${major} harness`;
    const root = join(temporary, major === null ? 'npm-cli-only' : `eslint-${major}`);
    await mkdir(root);
    const dependencies = { [mainPackage]: cliSpec };
    if (major !== null) dependencies.eslint = major === 9 ? '^9.39.0' : '^10.0.0';
    const npmOverrides = { ...overrides, ...(major === null ? {} : { eslint: '$eslint' }) };
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'goodui-consumer', private: true, type: 'module', devDependencies: dependencies, ...(Object.keys(npmOverrides).length ? { overrides: npmOverrides } : {}) }));
    await run(process.execPath, [npm, 'install', '--prefer-online', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], root);
    await assertMainDependency(root, major === null);
    await exercise(root, label, major !== null);
  }
  const strictRoot = join(temporary, 'pnpm-cli-only');
  await mkdir(strictRoot);
  await writeFile(join(strictRoot, 'package.json'), JSON.stringify({ name: 'goodui-strict-consumer', private: true, type: 'module', devDependencies: { [mainPackage]: cliSpec } }));
  const overrideLines = Object.entries(overrides).map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`);
  await writeFile(join(strictRoot, 'pnpm-workspace.yaml'), `nodeLinker: isolated\nhoist: false\npublicHoistPattern: []\n${overrideLines.length ? `overrides:\n${overrideLines.join('\n')}\n` : ''}`);
  await pnpm(['install', '--ignore-scripts', '--no-frozen-lockfile', '--registry=https://registry.npmjs.org/'], strictRoot);
  await assertMainDependency(strictRoot, true);
  for (const name of internalPackages) {
    const manifest = JSON.parse(await readFile(join(workspace, 'packages', name, 'package.json'), 'utf8'));
    assert(!existsSync(join(strictRoot, 'node_modules', manifest.name)), `Strict pnpm must not hoist ${manifest.name} into the consumer root.`);
  }
  await exercise(strictRoot, 'strict pnpm CLI-only baseline', false, 'pnpm');
} finally {
  const parent = realpathSync(tmpdir());
  const realTemporary = realpathSync(temporary);
  if (dirname(realTemporary).toLowerCase() !== parent.toLowerCase() || !basename(realTemporary).startsWith('goodui-consumer-')) {
    throw new Error(`Refusing to remove unexpected temporary path: ${realTemporary}`);
  }
  await rm(realTemporary, { recursive: true, force: true });
}
