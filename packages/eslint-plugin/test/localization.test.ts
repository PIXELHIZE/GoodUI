import { afterAll, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, type Linter } from 'eslint';
import { type Policy, type PolicyRule, type TailwindRuleName } from '@pixelhize/goodui-core';
import { createConfig, lintProject, type Diagnostic } from '../src/index.js';

const roots: string[] = [];
// These also occur in GoodUI's translation table: user-authored copies must stay English.
const reason = 'Inline styles are forbidden.';
const suggestion = 'Raw HTML insertion is forbidden.';
const note = 'Inline styles are forbidden.';
afterAll(async () => {
  const parent = await realpath(tmpdir());
  for (const root of roots) {
    const actual = await realpath(root);
    expect(dirname(actual).toLowerCase()).toBe(parent.toLowerCase());
    expect(basename(actual).startsWith('goodui-locale-')).toBe(true);
    await rm(actual, { recursive: true, force: true });
  }
});

function comparable(item: Diagnostic | Linter.LintMessage) {
  return {
    ruleId: item.ruleId, line: item.line, column: item.column, endLine: item.endLine, endColumn: item.endColumn,
    severity: typeof item.severity === 'number' ? item.severity === 2 ? 'error' : 'warning' : item.severity,
    message: item.message,
  };
}

async function editorMessages(rootDir: string, file: string, config: Linter.Config[]) {
  const eslint = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintFiles([resolve(rootDir, file)]);
  expect(result).toBeDefined();
  return result!.messages.map(comparable);
}

let nativeRoot: Promise<string> | undefined;
function nativeFixture(): Promise<string> {
  return nativeRoot ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), 'goodui-locale-native-'));
    roots.push(root);
    await cp(fileURLToPath(new URL('./fixtures/tailwind/', import.meta.url)), root, {
      recursive: true, filter: path => basename(path) !== 'node_modules',
    });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    const tailwind = await realpath(fileURLToPath(new URL('../node_modules/tailwindcss/', import.meta.url)));
    await symlink(tailwind, join(root, 'node_modules/tailwindcss'), process.platform === 'win32' ? 'junction' : 'dir');
    return root;
  })();
}
async function fixture(path: string, source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'goodui-locale-'));
  roots.push(root);
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), source);
  await mkdir(join(root, 'src/server'), { recursive: true });
  await writeFile(join(root, 'src/server/secret.ts'), 'export const secret=1;');
  return root;
}

const contracts: { kind: PolicyRule['kind']; path?: string; source: string; options: Record<string, unknown> }[] = [
  { kind: 'restricted-imports', source: "import 'legacy-client';", options: { modules: ['legacy-client'] } },
  { kind: 'restricted-api', source: 'eval("x");', options: { globals: ['eval'] } },
  { kind: 'restricted-ui', source: 'const page=<button/>;', options: { tags: ['button'] } },
  { kind: 'import-boundaries', path: 'src/ui/page.ts', source: "import {secret} from '../server/secret';", options: { from: ['src/ui/**'], disallow: ['src/server/**'] } },
  { kind: 'restricted-syntax', source: 'const value=1;', options: { selectors: ['VariableDeclaration[kind="const"]'] } },
  { kind: 'file-conventions', path: 'BadName.ts', source: 'const value=1;', options: { nameCase: 'kebab' } },
  { kind: 'export-contracts', source: 'export default 1;', options: { forbidDefault: true } },
  { kind: 'function-limits', source: 'function calculate(a,b){return a+b;}', options: { maxParams: 1 } },
  { kind: 'component-contracts', source: 'const page=<button/>;', options: { tags: ['button'], requiredProps: ['aria-label'] } },
];

describe('per-call Korean and English diagnostics', () => {
  it.each(contracts)('localizes $kind while retaining user policy text and machine fields', async entry => {
    const path = entry.path ?? 'sample.tsx';
    const rootDir = await fixture(path, entry.source);
    const policy: Policy = { version: 1, rules: [{ id: `policy-${entry.kind}`, kind: entry.kind, reason, suggestion, ...entry.options } as PolicyRule] };
    const bytes = JSON.stringify(policy);
    const originalEnvironment = process.env.GOODUI_LOCALE;
    const [ko, en, koConfig, enConfig] = await Promise.all([
      lintProject({ rootDir, policy, files: [path], locale: 'ko' }),
      lintProject({ rootDir, policy, files: [path], locale: 'en' }),
      createConfig({ rootDir, policy, locale: 'ko' }),
      createConfig({ rootDir, policy, locale: 'en' }),
    ]);
    expect(ko.errorCount).toBeGreaterThan(0);
    expect(ko.errorCount).toBe(en.errorCount);
    expect(ko.diagnostics.every(item => item.ruleId === `goodui/${entry.kind}`)).toBe(true);
    expect(ko.diagnostics.every(item => /[가-힣]/.test(item.message))).toBe(true);
    expect(en.diagnostics.every(item => !/[가-힣]/.test(item.message))).toBe(true);
    for (const diagnostic of ko.diagnostics) {
      expect(diagnostic.message).toContain(`이유: ${reason}`);
      expect(diagnostic.message).toContain(`제안: ${suggestion}`);
      expect(diagnostic.message).not.toContain(' Reason:');
      expect(diagnostic.reason).toBe(reason);
      expect(diagnostic.suggestion).toBe(suggestion);
      expect(diagnostic.policyId).toBe(`policy-${entry.kind}`);
    }
    expect(ko.diagnostics.map(({ message, ...data }) => data)).toEqual(en.diagnostics.map(({ message, ...data }) => data));
    const [koEditor, enEditor] = await Promise.all([editorMessages(rootDir, path, koConfig), editorMessages(rootDir, path, enConfig)]);
    expect(ko.diagnostics.map(comparable)).toEqual(koEditor);
    expect(en.diagnostics.map(comparable)).toEqual(enEditor);
    expect(JSON.stringify(policy)).toBe(bytes);
    expect(process.env.GOODUI_LOCALE).toBe(originalEnvironment);
  });

  const native: { rule: TailwindRuleName; source: string }[] = [
    { rule: 'no-raw-colors', source: 'const page=<div className="bg-red-500"/>;' },
    { rule: 'no-arbitrary-values', source: 'const page=<div className="p-[13px]"/>;' },
    { rule: 'no-inline-styles', source: 'const page=<div style={{padding:13}}/>;' },
    { rule: 'no-unknown-classes', source: 'const page=<div className="rounded-huge"/>;' },
    { rule: 'no-restyle', source: "import {Button} from '@/components/ui/button'; const page=<Button className=\"p-4\"/>;" },
    { rule: 'require-static-classes', source: 'declare const classes:string; const page=<div className={classes}/>;' },
  ];
  it.each(native)('localizes native $rule consistently in ESLint configuration', async ({ rule, source }) => {
    const rootDir = await nativeFixture();
    const path = `src/localized-${rule}.tsx`;
    await writeFile(join(rootDir, path), source);
    const policy: Policy = { version: 1, presets: ['tailwind'], rules: [], tailwind: { rules: [rule], note } };
    const bytes = JSON.stringify(policy);
    const [ko, en, koConfig, enConfig] = await Promise.all([
      lintProject({ rootDir, policy, files: [path], locale: 'ko' }),
      lintProject({ rootDir, policy, files: [path], locale: 'en' }),
      createConfig({ rootDir, policy, locale: 'ko' }),
      createConfig({ rootDir, policy, locale: 'en' }),
    ]);
    expect(ko.errorCount).toBeGreaterThan(0);
    expect(ko.errorCount).toBe(en.errorCount);
    expect(ko.diagnostics.every(item => item.ruleId === `goodui/${rule}` && /[가-힣]/.test(item.message))).toBe(true);
    expect(en.diagnostics.every(item => item.ruleId === `goodui/${rule}` && !/[가-힣]/.test(item.message))).toBe(true);
    expect(ko.diagnostics.every(item => item.message.endsWith(note))).toBe(true);
    expect(en.diagnostics.every(item => item.message.endsWith(note))).toBe(true);
    expect(ko.diagnostics.map(({ message, ...data }) => data)).toEqual(en.diagnostics.map(({ message, ...data }) => data));
    const [koEditor, enEditor] = await Promise.all([editorMessages(rootDir, path, koConfig), editorMessages(rootDir, path, enConfig)]);
    expect(ko.diagnostics.map(comparable)).toEqual(koEditor);
    expect(en.diagnostics.map(comparable)).toEqual(enEditor);
    expect(JSON.stringify(policy)).toBe(bytes);
  }, 20000);

  it('labels external parser failures in Korean and keeps the original parser text', async () => {
    const rootDir = await fixture('broken.ts', 'const = ;');
    const policy: Policy = { version: 1, rules: [{ id: 'eval', kind: 'restricted-api', globals: ['eval'], reason }] };
    const en = await lintProject({ rootDir, policy, locale: 'en' });
    const ko = await lintProject({ rootDir, policy, locale: 'ko' });
    expect(ko.diagnostics[0]?.message).toBe(`구문 분석 오류: ${en.diagnostics[0]!.message.replace(/^Parsing error:\s*/, '')}`);
    expect(ko.diagnostics[0]?.ruleId).toBeNull();
  });

  it('localizes configuration failures without changing their error codes', async () => {
    const rootDir = await fixture('a.ts', 'const value=1;');
    const policy: Policy = { version: 1, presets: ['tailwind'], rules: [] };
    await expect(createConfig({ rootDir, policy, locale: 'ko' })).rejects.toMatchObject({ code: 'TAILWIND_THEME_NOT_FOUND', message: expect.stringMatching(/[가-힣]/) });
    await expect(createConfig({ rootDir, policy, locale: 'en' })).rejects.toMatchObject({ code: 'TAILWIND_THEME_NOT_FOUND', message: expect.stringContaining('Tailwind v4 CSS entry') });
  });
});
