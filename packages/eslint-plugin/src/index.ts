import { readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { ESLint, type Linter } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import * as vueParser from 'vue-eslint-parser';
import * as svelteParser from 'svelte-eslint-parser';
import fg from 'fast-glob';
import { getAiSlopRuleCatalog, getAiSlopRules, getTailwindRules, isRuleApplicable, matchesFile, PolicyError, readPolicy, resolveLocale, resolveProjectPathSync, validatePolicy, type Locale, type LocaleInput, type Policy } from '@pixelhize/goodui-core';
import { rules } from './rules.js';
import { codeRules } from './code-rules.js';
import { componentRules } from './component-rules.js';
import { relativePath, slash } from './resolution.js';
import { nativeRules, tailwindConfigs } from './tailwind.js';
import { contextLocale, localizedError, translatePluginMessage } from './localization.js';
import { aiSlopConfigs, aiSlopRules, isAiSlopApplicable } from './ai-slop.js';

export interface ConfigOptions { rootDir: string; policyPath?: string; policy?: Policy; locale?: LocaleInput }
export interface LintOptions extends ConfigOptions { files?: string[] }
export interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  ruleId: string | null;
  policyId?: string;
  severity: 'error' | 'warning';
  message: string;
  reason?: string;
  suggestion?: string;
}
export interface LintReport { diagnostics: Diagnostic[]; errorCount: number; warningCount: number; filesChecked: number }

const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte']);
const defaultFiles = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue,svelte}'];
const defaultIgnores = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**'];

const integrityRule = {
  meta: { type: 'problem' as const, schema: [], messages: { invalid: '{{message}}' } },
  create(context: any) {
    const locale = contextLocale(context);
    return {
      Program(node: any) {
        const services = context.sourceCode.parserServices;
        if (!services?.defineTemplateBodyVisitor) return;
        for (const error of node.templateBody?.errors ?? []) {
          // Vue intentionally accepts self-closing HTML elements in SFC templates.
          if (error.code === 'non-void-html-element-start-tag-with-trailing-solidus') continue;
          context.report({ loc: { line: error.lineNumber, column: error.column }, messageId: 'invalid', data: { message: translatePluginMessage(`Vue template parse error: ${error.message}`, locale) } });
        }
        const fragment = services.getDocumentFragment?.();
        for (const element of fragment?.children ?? []) {
          if (element.type !== 'VElement') continue;
          const language = element.startTag.attributes.find((attribute: any) => !attribute.directive && attribute.key.name === 'lang');
          const external = element.startTag.attributes.find((attribute: any) => !attribute.directive && attribute.key.name === 'src');
          if (['script', 'template'].includes(element.name) && external) {
            context.report({ node: external, messageId: 'invalid', data: { message: translatePluginMessage('External Vue script/template blocks are unsupported; inline the source so its contracts can be checked.', locale) } });
          }
          if (element.name === 'template' && language && language.value?.value !== 'html') {
            context.report({ node: language, messageId: 'invalid', data: { message: translatePluginMessage(`Unsupported Vue template language ${JSON.stringify(language.value?.value)}. GoodUI requires an HTML template.`, locale) } });
          }
          if (element.name === 'script' && language && !['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx'].includes(language.value?.value)) {
            context.report({ node: language, messageId: 'invalid', data: { message: translatePluginMessage(`Unsupported Vue script language ${JSON.stringify(language.value?.value)}.`, locale) } });
          }
        }
      },
    };
  },
};

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
const policyRules = { ...rules, ...codeRules, ...componentRules };
export const plugin = {
  meta: { name: packageMetadata.name, version: packageMetadata.version },
  rules: { ...policyRules, ...nativeRules, ...aiSlopRules, 'parse-integrity': integrityRule },
};
export default plugin;

async function resolveOptions(options: ConfigOptions, locale: Locale): Promise<{ root: string; policy: Policy }> {
  const root = resolveProjectPathSync(resolve(options.rootDir), '.');
  const input = options.policy ?? (await readPolicy(root, options.policyPath, { locale })).policy;
  const checked = validatePolicy(input, { locale });
  if (!checked.valid || !checked.policy) throw new PolicyError('INVALID_POLICY', checked.errors.join('; '));
  return { root, policy: checked.policy };
}

async function configFor(root: string, policy: Policy, locale: Locale): Promise<Linter.Config[]> {
  const options = { rootDir: root, policy };
  const configured: Linter.RulesRecord = { 'goodui/parse-integrity': 'error' };
  for (const kind of Object.keys(policyRules)) configured[`goodui/${kind}`] = ['error', options];
  const configs: Linter.Config[] = [
    { name: 'goodui/ignores', ignores: [...defaultIgnores, ...(policy.ignores ?? [])] },
    {
      name: 'goodui/contracts',
      files: policy.files ?? defaultFiles,
      plugins: { goodui: plugin as unknown as ESLint.Plugin },
      settings: { gooduiLocale: locale },
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
      rules: configured,
    },
    {
      name: 'goodui/javascript-typescript',
      files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
      languageOptions: { parser: tsParser as unknown as Linter.Parser, parserOptions: { ecmaFeatures: { jsx: true }, project: false, projectService: false } },
    },
    {
      name: 'goodui/vue', files: ['**/*.vue'],
      languageOptions: { parser: vueParser as unknown as Linter.Parser, parserOptions: { parser: tsParser, project: false, projectService: false, ecmaFeatures: { jsx: true } } },
    },
    {
      name: 'goodui/svelte', files: ['**/*.svelte', '**/*.svelte.js', '**/*.svelte.ts'],
      languageOptions: { parser: svelteParser as unknown as Linter.Parser, parserOptions: { parser: tsParser, project: false, projectService: false, svelteConfig: { compilerOptions: {} } } },
    },
  ];
  return [...configs, ...await tailwindConfigs(root, policy, policy.files ?? defaultFiles), ...aiSlopConfigs(root, policy, policy.files ?? defaultFiles)];
}

/** Creates self-contained flat configuration without importing project ESLint config. */
export async function createConfig(options: ConfigOptions): Promise<Linter.Config[]> {
  const locale = resolveLocale(options.locale);
  try {
    const { root, policy } = await resolveOptions(options, locale);
    return await configFor(root, policy, locale);
  } catch (error) { throw localizedError(error, locale); }
}

/** Explicit paths are confined to the project; policy globs select the source files. */
async function lintResolved(options: LintOptions, locale: Locale): Promise<LintReport> {
  const { root, policy } = await resolveOptions(options, locale);
  if (options.files?.length === 0) throw new PolicyError('NO_FILES', 'The explicit file list is empty.');
  const candidates = new Set<string>();
  const ignores = [...defaultIgnores, ...(policy.ignores ?? [])];
  for (const requested of options.files ?? ['.']) {
    const path = resolveProjectPathSync(root, requested);
    if (statSync(path).isDirectory()) {
      const discovered = await fg(defaultFiles, { cwd: path, absolute: true, dot: true, followSymbolicLinks: false, onlyFiles: true, ignore: defaultIgnores });
      for (const file of discovered) candidates.add(resolveProjectPathSync(root, file));
    } else if (statSync(path).isFile()) {
      if (!extensions.has(extname(path))) throw new PolicyError('UNSUPPORTED_FILE', `Unsupported source file: ${relativePath(root, path)}`);
      candidates.add(path);
    } else throw new PolicyError('UNSUPPORTED_FILE', `Not a regular file or directory: ${requested}`);
  }
  const files = [...candidates].filter(path => {
    const file = relativePath(root, path);
    return !matchesFile(file, ignores) && (!policy.files || matchesFile(file, policy.files));
  }).sort();
  if (!files.length) throw new PolicyError('NO_FILES', 'No supported source files remain after applying the policy file patterns and ignores.');
  const presetRules = getTailwindRules(policy);
  const aiChecks = getAiSlopRules(policy);
  if (!files.some(path => {
    const file = relativePath(root, path);
    const ordinary = policy.rules.some(rule => isRuleApplicable(policy, rule, file) && (rule.kind !== 'import-boundaries' || matchesFile(file, rule.from)));
    const preset = presetRules.some(name => !(policy.exceptions ?? []).some(exception => exception.ruleId === `goodui/${name}` && matchesFile(file, exception.files)));
    return ordinary || preset || aiChecks.some(name => isAiSlopApplicable(policy, name, file));
  })) {
    throw new PolicyError('NO_APPLICABLE_RULES', 'No enabled policy contract applies to the selected source files.');
  }
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await configFor(root, policy, locale), errorOnUnmatchedPattern: true, warnIgnored: false });
  const results = await eslint.lintFiles(files);
  if (!results.length) throw new PolicyError('NO_FILES', 'ESLint did not check any source files.');
  const diagnostics: Diagnostic[] = [];
  const aiCatalog = getAiSlopRuleCatalog(locale);
  for (const result of results) {
    for (const message of result.messages) {
      const aiEntry = aiCatalog.find(entry => message.ruleId === `goodui/${entry.name}`);
      const policyRule = !aiEntry && message.ruleId?.startsWith('goodui/') ? policy.rules.find(rule => message.message.startsWith(`[${rule.id}] `)) : undefined;
      const diagnostic: Diagnostic = {
        filePath: slash(result.filePath), line: message.line ?? 1, column: message.column ?? 1,
        ruleId: message.ruleId, severity: message.severity === 2 ? 'error' : 'warning',
        message: locale === 'ko' && message.ruleId === null ? `${message.fatal ? '구문 분석 오류' : '외부 검사기 안내'}: ${message.message.replace(/^Parsing error:\s*/, '')}` : message.message,
      };
      if (message.endLine !== undefined) diagnostic.endLine = message.endLine;
      if (message.endColumn !== undefined) diagnostic.endColumn = message.endColumn;
      if (policyRule) { diagnostic.policyId = policyRule.id; diagnostic.reason = policyRule.reason; if (policyRule.suggestion) diagnostic.suggestion = policyRule.suggestion; }
      if (aiEntry) { diagnostic.policyId = 'ai-slop'; diagnostic.reason = aiEntry.reason; diagnostic.suggestion = aiEntry.suggestion; }
      diagnostics.push(diagnostic);
    }
  }
  diagnostics.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column || (a.policyId ?? '').localeCompare(b.policyId ?? ''));
  return { diagnostics, errorCount: diagnostics.filter(item => item.severity === 'error').length, warningCount: diagnostics.filter(item => item.severity === 'warning').length, filesChecked: results.length };
}

export async function lintProject(options: LintOptions): Promise<LintReport> {
  const locale = resolveLocale(options.locale);
  try { return await lintResolved(options, locale); }
  catch (error) { throw localizedError(error, locale); }
}
