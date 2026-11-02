import { basename, resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import {
  isRuleApplicable, PolicyError, validatePolicy,
  type PolicyRule,
} from '@pixelhize/goodui-core';
import { ESLintUtils, type TSESLint } from '@typescript-eslint/utils';
import type { RuleOptions } from './rules.js';
import { relativePath } from './resolution.js';
import { contextLocale, translatePluginMessage } from './localization.js';

type Node = { type: string; [key: string]: any };
type Context = TSESLint.RuleContext<'violation', [RuleOptions]>;
type Listener = Record<string, (node: Node) => void>;
type Kind = 'restricted-syntax' | 'file-conventions' | 'export-contracts' | 'function-limits';
type RuleOf<K extends Kind> = Extract<PolicyRule, { kind: K }>;

function report(context: Context, rule: PolicyRule, node: Node | undefined, detail: string): void {
  const locale = contextLocale(context);
  context.report({
    ...(node ? { node: node as any } : { loc: { line: 1, column: 0 } }),
    messageId: 'violation',
    data: {
      prefix: `[${rule.id}] `,
      detail: translatePluginMessage(detail, locale),
      reason: rule.reason,
      reasonLabel: locale === 'ko' ? '이유' : 'Reason',
      suggestion: rule.suggestion ? ` ${locale === 'ko' ? '제안' : 'Suggestion'}: ${rule.suggestion}` : '',
    },
  });
}

function factory<K extends Kind>(kind: K, create: (context: Context, rules: RuleOf<K>[]) => Listener) {
  return ESLintUtils.RuleCreator.withoutDocs<[RuleOptions], 'violation'>({
    meta: {
      type: 'problem',
      docs: { description: `Enforce GoodUI ${kind} project contracts.` },
      schema: [{
        type: 'object',
        properties: { rootDir: { type: 'string' }, policy: { type: 'object' } },
        required: ['rootDir', 'policy'],
        additionalProperties: false,
      }],
      messages: { violation: '{{prefix}}{{detail}} {{reasonLabel}}: {{reason}}{{suggestion}}' },
    },
    defaultOptions: [{ rootDir: '.', policy: { version: 1, rules: [] } }],
    create(context) {
      const options = context.options[0];
      const validation = validatePolicy(options?.policy, { locale: contextLocale(context) });
      if (!validation.valid || !validation.policy) {
        throw new PolicyError('INVALID_POLICY', validation.errors.join('; '));
      }
      const policy = validation.policy;
      const file = relativePath(resolve(options.rootDir), context.filename);
      const applicable = policy.rules.filter(
        (rule): rule is RuleOf<K> => rule.kind === kind && isRuleApplicable(policy, rule, file),
      );
      return applicable.length ? create(context, applicable) as TSESLint.RuleListener : {};
    },
  });
}

function withTemplates(context: Context, listeners: Listener): Listener {
  const services = context.sourceCode.parserServices as any;
  return services?.defineTemplateBodyVisitor
    ? services.defineTemplateBodyVisitor(listeners, listeners)
    : listeners;
}

const restrictedSyntax = factory('restricted-syntax', (context, rules) => {
  const grouped = new Map<string, RuleOf<'restricted-syntax'>[]>();
  for (const rule of rules) for (const selector of rule.selectors) {
    const matching = grouped.get(selector) ?? [];
    if (!matching.includes(rule)) matching.push(rule);
    grouped.set(selector, matching);
  }
  return withTemplates(context, Object.fromEntries([...grouped].map(([selector, matching]) => [
    selector,
    (node: Node) => {
      for (const rule of matching) report(context, rule, node, `Syntax matching ${JSON.stringify(selector)} is forbidden.`);
    },
  ])));
});

// Case applies to the semantic stem, not conventional test/declaration/rune suffixes.
// `my-widget.spec.d.ts`, `my-widget.test.tsx`, `my-widget.svelte.ts` -> `my-widget`.
// Other dotted suffixes remain part of the stem. suffixes itself always checks the
// original basename with case-sensitive literal endsWith, with no implicit dots/globs.
function filenameStem(filename: string): string {
  let stem = filename.replace(/\.(?:[cm]?[jt]sx?|vue|svelte)$/i, '');
  while (/\.(?:test|spec|d|svelte)$/.test(stem)) stem = stem.replace(/\.(?:test|spec|d|svelte)$/, '');
  return stem;
}

const cases = {
  kebab: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  camel: /^[a-z][A-Za-z0-9]*$/,
  pascal: /^[A-Z][A-Za-z0-9]*$/,
  snake: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/,
};

function physicalLines(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/);
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

const fileConventions = factory('file-conventions', (context, rules) => ({
  Program() {
    const filename = basename(context.filename);
    const stem = filenameStem(filename);
    const text = context.sourceCode.text;
    const lines = physicalLines(text);
    // ESLint removes a leading UTF-8 BOM from text but records it separately.
    const bytes = Buffer.byteLength(text, 'utf8') + (context.sourceCode.hasBOM ? 3 : 0);
    for (const rule of rules) {
      if (rule.nameCase && !cases[rule.nameCase].test(stem)) {
        report(context, rule, undefined, `Filename stem ${JSON.stringify(stem)} must use ${rule.nameCase} case.`);
      }
      if (rule.suffixes && !rule.suffixes.some(suffix => filename.endsWith(suffix))) {
        report(context, rule, undefined, `Filename ${JSON.stringify(filename)} must end with one of ${rule.suffixes.map(suffix => JSON.stringify(suffix)).join(', ')}.`);
      }
      if (rule.maxLines !== undefined && lines > rule.maxLines) {
        report(context, rule, undefined, `File has ${lines} lines; maximum is ${rule.maxLines}.`);
      }
      if (rule.maxBytes !== undefined && bytes > rule.maxBytes) {
        report(context, rule, undefined, `File has ${bytes} UTF-8 bytes; maximum is ${rule.maxBytes}.`);
      }
    }
  },
}));

function exportedName(node: Node | undefined): string | undefined {
  return node?.type === 'Identifier' ? node.name : typeof node?.value === 'string' ? node.value : undefined;
}

function bindingNames(node: Node | null | undefined, output: Set<string>): void {
  if (!node) return;
  if (node.type === 'Identifier') output.add(node.name);
  else if (node.type === 'AssignmentPattern') bindingNames(node.left, output);
  else if (node.type === 'RestElement') bindingNames(node.argument, output);
  else if (node.type === 'ArrayPattern') for (const item of node.elements) bindingNames(item, output);
  else if (node.type === 'ObjectPattern') for (const property of node.properties) {
    bindingNames(property.type === 'RestElement' ? property.argument : property.value, output);
  }
}

function topLevel(node: Node): boolean {
  return node.parent?.type === 'Program' || node.parent?.type === 'SvelteScriptElement';
}

// Explicit ESM declarations/reexports are provable, including type exports.
// Namespace exports (`export * as api`) prove only `api`; bare stars prove no
// required names. CommonJS assignments are intentionally not inferred. TS `export =`
// is a default-style assignment for forbidDefault, not a named export declaration.
const exportContracts = factory('export-contracts', (context, rules) => {
  const names = new Set<string>();
  let hasUnqualifiedStar = false;

  function checkDefault(node: Node): void {
    for (const rule of rules) if (rule.forbidDefault) report(context, rule, node, 'Default-style exports are forbidden; use explicit named exports.');
  }

  return {
    ExportNamedDeclaration(node) {
      if (!topLevel(node)) return;
      const declaration = node.declaration;
      if (declaration?.type === 'VariableDeclaration') {
        for (const item of declaration.declarations) bindingNames(item.id, names);
      } else if (declaration?.id?.type === 'Identifier') names.add(declaration.id.name);
      for (const specifier of node.specifiers ?? []) {
        const name = exportedName(specifier.exported);
        if (name === 'default') checkDefault(specifier);
        else if (name !== undefined) names.add(name);
      }
    },
    ExportDefaultDeclaration(node) {
      if (topLevel(node)) checkDefault(node);
    },
    TSExportAssignment(node) {
      if (topLevel(node)) checkDefault(node);
    },
    TSImportEqualsDeclaration(node) {
      if (topLevel(node) && node.isExport && node.id?.type === 'Identifier') names.add(node.id.name);
    },
    ExportAllDeclaration(node) {
      if (!topLevel(node)) return;
      const name = exportedName(node.exported);
      if (name === 'default') checkDefault(node);
      else if (name !== undefined) names.add(name);
      else hasUnqualifiedStar = true;
      for (const rule of rules) if (rule.forbidStar) report(context, rule, node, 'Star exports are forbidden; list each public export explicitly.');
    },
    'Program:exit'() {
      for (const rule of rules) for (const required of rule.requireNamed ?? []) {
        if (names.has(required)) continue;
        const detail = hasUnqualifiedStar
          ? `Required named export ${JSON.stringify(required)} cannot be proven through a star export; export it explicitly.`
          : `Required named export ${JSON.stringify(required)} is missing.`;
        report(context, rule, undefined, detail);
      }
    },
  };
});

const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'TSEmptyBodyFunctionExpression', 'TSDeclareFunction']);
const declarationStatements = new Set(['VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration', 'TSImportEqualsDeclaration', 'TSDeclareFunction']);
const controls = new Set(['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'TryStatement', 'WithStatement']);
const branchTypes = new Set(['IfStatement', 'ConditionalExpression', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'LogicalExpression', 'AssignmentPattern']);

interface Metrics { statements: number; depth: number; complexity: number }

// Statements count descendant statements/declarations, excluding braces. A nested
// function declaration is one outer statement, but its body has independent metrics.
// Depth counts if/loop/switch/try/with structures; plain braces do not count.
// Else-if and catch/finally stay at their parent's control depth.
// Complexity = 1 + if/ternary/loop/catch/non-default case/logical/default-value
// branches + logical assignments + EACH optional member/call step. ChainExpression
// itself adds nothing. Nested functions are excluded; parameters' defaults are read.
function measureFunction(context: Context, node: Node): Metrics {
  const metrics: Metrics = { statements: 0, depth: 0, complexity: 1 };
  const keys = context.sourceCode.visitorKeys as Record<string, readonly string[]>;

  function visit(current: Node, depth: number, parent?: Node): void {
    if (!current || typeof current.type !== 'string') return;
    const statement = (current.type.endsWith('Statement') && current.type !== 'BlockStatement') || declarationStatements.has(current.type);
    if (statement) metrics.statements++;
    if (functionTypes.has(current.type)) return;
    const elseIf = current.type === 'IfStatement' && parent?.type === 'IfStatement' && parent.alternate === current;
    const nextDepth = depth + (controls.has(current.type) && !elseIf ? 1 : 0);
    metrics.depth = Math.max(metrics.depth, nextDepth);
    if (branchTypes.has(current.type)) metrics.complexity++;
    if (current.type === 'SwitchCase' && current.test !== null) metrics.complexity++;
    if (current.type === 'AssignmentExpression' && ['&&=', '||=', '??='].includes(current.operator)) metrics.complexity++;
    if (['MemberExpression', 'CallExpression'].includes(current.type) && current.optional) metrics.complexity++;
    for (const key of keys[current.type] ?? []) {
      const value = current[key];
      if (Array.isArray(value)) for (const child of value) {
        if (child && typeof child.type === 'string') visit(child, nextDepth, current);
      }
      else if (value && typeof value.type === 'string') visit(value, nextDepth, current);
    }
  }

  for (const parameter of node.params ?? []) visit(parameter, 0);
  visit(node.body, 0);
  return metrics;
}

function functionName(node: Node): string {
  if (node.id?.name) return node.id.name;
  if (node.parent?.type === 'VariableDeclarator' && node.parent.id?.type === 'Identifier') return node.parent.id.name;
  const key = node.parent?.key;
  if (key?.type === 'Identifier') return key.name;
  if (typeof key?.value === 'string') return key.value;
  return '<anonymous>';
}

const functionLimits = factory('function-limits', (context, rules) => {
  function inspect(node: Node): void {
    if (!node.body) return; // TypeScript overload/ambient signatures have no implementation.
    const metrics = measureFunction(context, node);
    const values = {
      maxParams: { value: node.params.length, label: 'parameters' },
      maxLines: { value: node.loc.end.line - node.loc.start.line + 1, label: 'lines' },
      maxStatements: { value: metrics.statements, label: 'statements' },
      maxDepth: { value: metrics.depth, label: 'control nesting depth' },
      maxComplexity: { value: metrics.complexity, label: 'complexity' },
    };
    for (const rule of rules) for (const key of Object.keys(values) as (keyof typeof values)[]) {
      const limit = rule[key];
      if (limit !== undefined && values[key].value > limit) {
        report(context, rule, node, `Function ${JSON.stringify(functionName(node))} has ${values[key].value} ${values[key].label}; maximum is ${limit}.`);
      }
    }
  }
  return withTemplates(context, {
    FunctionDeclaration: inspect,
    FunctionExpression: inspect,
    ArrowFunctionExpression: inspect,
    TSEmptyBodyFunctionExpression: inspect,
    TSDeclareFunction: inspect,
  });
});

export const codeRules = {
  'restricted-syntax': restrictedSyntax,
  'file-conventions': fileConventions,
  'export-contracts': exportContracts,
  'function-limits': functionLimits,
};
