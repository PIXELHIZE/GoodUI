import { resolve } from 'node:path';
import { Linter } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import * as vueParser from 'vue-eslint-parser';
import * as svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import type { Policy, PolicyRule } from '@pixelhize/goodui-core';
import { codeRules } from '../src/code-rules.js';

const rootDir = process.cwd();

function check(code: string, rule: PolicyRule | PolicyRule[], filename = 'src/file.ts', exceptions?: Policy['exceptions']) {
  const policy: Policy = { version: 1, rules: Array.isArray(rule) ? rule : [rule], ...(exceptions ? { exceptions } : {}) };
  const parser = filename.endsWith('.vue') ? vueParser
    : /\.svelte(?:\.[jt]s)?$/.test(filename) ? svelteParser : tsParser;
  const configured = Object.fromEntries([...new Set(policy.rules.map(item => item.kind))].map(kind => [`goodui/${kind}`, ['error', { rootDir, policy }]]));
  return new Linter().verify(code, [{
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue,svelte}'],
    plugins: { goodui: { rules: codeRules } as any },
    languageOptions: {
      parser: parser as any,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { parser: tsParser, project: false, projectService: false, ecmaFeatures: { jsx: true }, svelteConfig: { compilerOptions: {} } },
    },
    rules: configured as any,
  }], { filename: resolve(rootDir, filename) });
}

const common = { id: 'project-contract', reason: 'Keep the public project contract.', suggestion: 'Use the approved implementation.' };

describe('restricted syntax', () => {
  it('reports original JS/TS selector locations with the policy reason and suggestion', () => {
    const messages = check('const value: any = 1;\neval("x");', {
      ...common, kind: 'restricted-syntax', selectors: ['TSAnyKeyword', 'CallExpression[callee.name="eval"]'],
    });
    expect(messages).toHaveLength(2);
    expect(messages.map(item => item.line)).toEqual([1, 2]);
    expect(messages.every(item => item.message.includes(`[${common.id}]`) && item.message.includes(common.reason) && item.message.includes(common.suggestion))).toBe(true);
  });

  it('preserves separate contracts that use the same selector and scopes reasoned exceptions', () => {
    const rules: PolicyRule[] = [
      { ...common, kind: 'restricted-syntax', selectors: ['CallExpression'], files: ['src/**'] },
      { ...common, id: 'second-contract', kind: 'restricted-syntax', selectors: ['CallExpression'] },
    ];
    expect(check('run();', rules)).toHaveLength(2);
    expect(check('run();', rules, 'src/legacy.ts', [{ ruleId: common.id, files: ['src/legacy.ts'], reason: 'Migration boundary.' }])).toHaveLength(1);
    expect(check('run();', rules, 'test/outside.ts')).toHaveLength(1);
  });

  it.each([
    ['src/view.vue', '<template>\n<button @click="eval(\'x\')">Go</button>\n</template>'],
    ['src/view.svelte', '<button onclick={() => eval("x")}>Go</button>'],
  ])('checks template expressions in %s', (filename, source) => {
    const messages = check(source, { ...common, kind: 'restricted-syntax', selectors: ['CallExpression[callee.name="eval"]'] }, filename);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('goodui/restricted-syntax');
    expect(messages[0]?.line).toBe(filename.endsWith('.vue') ? 2 : 1);
  });
});

describe('file conventions', () => {
  it.each([
    ['src/my-widget.test.ts', 'kebab'],
    ['src/my-widget.spec.d.ts', 'kebab'],
    ['src/my-widget.svelte.ts', 'kebab'],
    ['src/my-widget.svelte', 'kebab'],
    ['src/my-widget.vue', 'kebab'],
    ['src/myWidget.test.tsx', 'camel'],
    ['src/MyWidget.spec.tsx', 'pascal'],
    ['src/my_widget.d.ts', 'snake'],
  ] as const)('checks the semantic stem of %s', (filename, nameCase) => {
    expect(check('', { ...common, kind: 'file-conventions', nameCase }, filename)).toEqual([]);
  });

  it('keeps suffix checks literal and reports each failed filename contract at the file start', () => {
    const messages = check('', { ...common, kind: 'file-conventions', nameCase: 'kebab', suffixes: ['.test.ts'] }, 'src/My-widget.spec.d.ts');
    expect(messages).toHaveLength(2);
    expect(messages.every(item => item.line === 1 && item.column === 1)).toBe(true);
    expect(check('', { ...common, kind: 'file-conventions', suffixes: ['*.ts'] }, 'src/value.ts')).toHaveLength(1);
    expect(check('', { ...common, kind: 'file-conventions', suffixes: ['.test.ts', '.spec.ts'] }, 'src/value.spec.ts')).toEqual([]);
  });

  it('counts UTF-8 bytes and physical lines without an extra terminal newline', () => {
    const messages = check('//한\n', { ...common, kind: 'file-conventions', maxBytes: 5, maxLines: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('6 UTF-8 bytes');
    expect(check('\uFEFF//a\n', { ...common, kind: 'file-conventions', maxBytes: 6 })[0]?.message).toContain('7 UTF-8 bytes');
    expect(check('//a\r\n', { ...common, kind: 'file-conventions', maxBytes: 4 })[0]?.message).toContain('5 UTF-8 bytes');
    expect(check('//a\r\n', { ...common, kind: 'file-conventions', maxLines: 1 })).toEqual([]);
    expect(check('//a\r\n//b\r\n', { ...common, kind: 'file-conventions', maxLines: 1 })[0]?.message).toContain('2 lines');
    expect(check('//a\n\n', { ...common, kind: 'file-conventions', maxLines: 1 })[0]?.message).toContain('2 lines');
    expect(check('//a\u2028//b\u2029', { ...common, kind: 'file-conventions', maxLines: 1 })[0]?.message).toContain('2 lines');
    expect(check('', { ...common, kind: 'file-conventions', maxLines: 1, maxBytes: 1 })).toEqual([]);
  });

  it('measures the whole SFC and respects common file exceptions', () => {
    const rule: PolicyRule = { ...common, kind: 'file-conventions', maxLines: 2 };
    const source = '<template>\n<div/>\n</template>\n<style>\n.x{}\n</style>\n';
    expect(check(source, rule, 'src/view.vue')[0]?.message).toContain('6 lines');
    expect(check(source, rule, 'src/view.vue', [{ ruleId: common.id, files: ['src/*.vue'], reason: 'Generated UI.' }])).toEqual([]);
  });
});

describe('export contracts', () => {
  it('recognizes explicit declarations, destructuring, aliases, reexports and namespace exports', () => {
    const source = `
export function run() {}
export const {x: renamed, y = 1, ...rest} = {x: 1};
export const [head, ...tail] = [];
export class Service {}
export {Service as PublicService};
export {remote as remoteName} from './remote.js';
export * as api from './api.js';
`;
    expect(check(source, { ...common, kind: 'export-contracts', requireNamed: ['run', 'renamed', 'y', 'rest', 'head', 'tail', 'Service', 'PublicService', 'remoteName', 'api'] })).toEqual([]);
  });

  it('recognizes TypeScript public declarations without confusing nested namespace exports', () => {
    const source = `
export interface Shape { size: number }
export type State = 'ready';
export enum Kind { A }
export namespace Tools { export const inner = 1; }
export declare function external(): void;
export import Alias = Tools;
`;
    expect(check(source, { ...common, kind: 'export-contracts', requireNamed: ['Shape', 'State', 'Kind', 'Tools', 'external', 'Alias'] })).toEqual([]);
    expect(check(source, { ...common, kind: 'export-contracts', requireNamed: ['inner'] })[0]?.message).toContain('"inner" is missing');
  });

  it.each([
    ['export default function Hidden() {}', 'Hidden'],
    ['const local = 1; export {local as default};', 'local'],
  ])('does not treat local names of default exports as named exports', (source, name) => {
    const messages = check(source, { ...common, kind: 'export-contracts', forbidDefault: true, requireNamed: [name] });
    expect(messages).toHaveLength(2);
    expect(messages.some(item => item.message.includes('Default-style exports'))).toBe(true);
    expect(messages.some(item => item.message.includes('is missing'))).toBe(true);
  });

  it('handles TS export-equals as a forbidden default-style assignment', () => {
    expect(check('const service = {}; export = service;', { ...common, kind: 'export-contracts', forbidDefault: true })).toHaveLength(1);
    expect(check('export * as default from "./remote";', { ...common, kind: 'export-contracts', forbidDefault: true })).toHaveLength(1);
  });

  it('does not infer required names through stars or CommonJS assignments', () => {
    const rule: PolicyRule = { ...common, kind: 'export-contracts', requireNamed: ['run'], forbidStar: true };
    const messages = check('export * from "./remote";', rule);
    expect(messages).toHaveLength(2);
    expect(messages.some(item => item.message.includes('cannot be proven'))).toBe(true);
    expect(check('module.exports.run = () => 1;', rule)[0]?.message).toContain('is missing');
    expect(check('export * as api from "./remote";', { ...common, kind: 'export-contracts', requireNamed: ['api'] })).toEqual([]);
  });

  it.each([
    ['src/view.vue', '<script lang="ts">\nexport const ready = true;\n</script>\n<template><div/></template>', ['ready']],
    ['src/view.svelte', '<script>export let title; export function clear() {}</script><div/>', ['title', 'clear']],
  ] as const)('reads script exports from %s', (filename, source, required) => {
    expect(check(source, { ...common, kind: 'export-contracts', requireNamed: [...required] }, filename)).toEqual([]);
  });
});

describe('function limits', () => {
  it('checks implementations, arrows and methods while skipping overload signatures', () => {
    const source = `
function run(a: number, b: number): void;
function run(a: number, b: number) {}
class Worker { execute(a: number, b: number) {} }
const arrow = (a: number, b: number) => a;
`;
    const messages = check(source, { ...common, kind: 'function-limits', maxParams: 1 });
    expect(messages).toHaveLength(3);
    expect(messages.map(item => item.line)).toEqual([3, 4, 5]);
    expect(messages.every(item => item.message.includes('2 parameters'))).toBe(true);
  });

  it('measures statements, depth and complexity independently for nested functions', () => {
    const source = 'function outer() { function inner() { if (a) { while (b) { work(); } } } return inner; }';
    const messages = check(source, { ...common, kind: 'function-limits', maxStatements: 2, maxDepth: 1, maxComplexity: 2 });
    expect(messages).toHaveLength(3);
    expect(messages.every(item => item.message.includes('"inner"'))).toBe(true);
    expect(messages.some(item => item.message.includes('3 statements'))).toBe(true);
    expect(messages.some(item => item.message.includes('2 control nesting depth'))).toBe(true);
    expect(messages.some(item => item.message.includes('3 complexity'))).toBe(true);
  });

  it('counts descendant statements and declarations, excluding braces', () => {
    const source = 'function run() { const x = 1; if (x) { return 1; } else { throw Error(); } }';
    expect(check(source, { ...common, kind: 'function-limits', maxStatements: 4 })).toEqual([]);
    expect(check(source, { ...common, kind: 'function-limits', maxStatements: 3 })[0]?.message).toContain('4 statements');
  });

  it('does not add nesting for plain braces, else-if, catch or finally', () => {
    const shallow = 'function run() { {{ call(); }} if(a) {} else if(b) {} else if(c) {} try { x(); } catch(e) { y(); } finally { z(); } }';
    expect(check(shallow, { ...common, kind: 'function-limits', maxDepth: 1 })).toEqual([]);
    const nested = 'function run() { try { x(); } catch(e) { if(e) { y(); } } }';
    expect(check(nested, { ...common, kind: 'function-limits', maxDepth: 1 })[0]?.message).toContain('2 control nesting depth');
  });

  it('defines complexity for defaults, branches, logical assignments and optional-chain steps', () => {
    const source = 'function run(a = 0) { if(a) a &&= 1; const x = a ?? 0; const y = obj?.value?.(); switch(a) { case 1: break; default: break; } }';
    expect(check(source, { ...common, kind: 'function-limits', maxComplexity: 8 })).toEqual([]);
    expect(check(source, { ...common, kind: 'function-limits', maxComplexity: 7 })[0]?.message).toContain('8 complexity');
  });

  it('counts inclusive source lines of a function without the file terminal newline', () => {
    const source = 'function run(\n a\n) {\n return a;\n}\n';
    expect(check(source, { ...common, kind: 'function-limits', maxLines: 5 })).toEqual([]);
    expect(check(source, { ...common, kind: 'function-limits', maxLines: 4 })[0]?.message).toContain('5 lines');
  });

  it.each([
    ['src/view.vue', '<template><button @click="(a, b) => a">Go</button></template>'],
    ['src/view.svelte', '<button onclick={(a, b) => a}>Go</button>'],
  ])('checks explicit template functions in %s', (filename, source) => {
    const messages = check(source, { ...common, kind: 'function-limits', maxParams: 1 }, filename);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('goodui/function-limits');
    expect(messages[0]?.message).toContain(common.reason);
  });
});
