import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuleTester } from '@typescript-eslint/rule-tester';
import * as parser from '@typescript-eslint/parser';
import { type Policy, type PolicyRule } from '@pixelhize/goodui-core';
import { createConfig, lintProject, plugin } from '../src/index.js';

const roots: string[] = [];
async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'goodui-plugin-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

function policy(...rules: PolicyRule[]): Policy { return { version: 1, rules }; }
const api: PolicyRule = { id: 'safe-network', kind: 'restricted-api', globals: ['fetch', 'eval'], imports: [{ source: 'unsafe-client', names: ['send'] }], reason: 'Use the approved network wrapper.', suggestion: 'Use privateFetch().' };
const ui: PolicyRule = { id: 'design-system', kind: 'restricted-ui', tags: ['button'], components: [{ source: 'legacy-ui', names: ['Button', 'default'] }], attributes: ['className'], features: ['inline-style', 'raw-html'], reason: 'Use the shared design system.' };
const imports: PolicyRule = { id: 'dependencies', kind: 'restricted-imports', modules: ['forbidden', 'forbidden/**'], reason: 'Use approved dependencies.' };

describe('cross-framework contracts', () => {
  it.each([
    ['component.tsx', `import { Button as Legacy } from 'legacy-ui'; import { send as transmit } from 'unsafe-client';\ntransmit(); globalThis['fetch']('/api');\nexport const Page = () => <><button style={{color:'red'}} /><Legacy className="x" dangerouslySetInnerHTML={{__html:'x'}} /></>;`],
    ['component.vue', `<script setup lang="ts">\nimport { Button as Legacy } from 'legacy-ui'; import { send as transmit } from 'unsafe-client';\ntransmit();\n</script>\n<template><button :style="{}" @click="fetch('/api')" /><Legacy class="x" v-html="'x'" /></template>`],
    ['component.svelte', `<script lang="ts">\nimport { Button as Legacy } from 'legacy-ui'; import { send as transmit } from 'unsafe-client';\ntransmit();\n</script>\n<button style:color="red" onclick={() => fetch('/api')}></button><Legacy class="x" />{@html '<p>x</p>'}`],
  ])('checks calls, components, attributes and features in %s', async (filename, code) => {
    const root = await fixture({ [filename]: code });
    const report = await lintProject({ rootDir: root, policy: policy(api, ui) });
    expect(report.filesChecked).toBe(1);
    expect(report.diagnostics.some(item => item.ruleId === null)).toBe(false);
    expect(report.diagnostics.filter(item => item.policyId === api.id)).toHaveLength(2);
    expect(report.diagnostics.filter(item => item.policyId === ui.id).length).toBeGreaterThanOrEqual(5);
    expect(report.diagnostics.every(item => item.line > 0 && item.column > 0)).toBe(true);
    expect(report.diagnostics.find(item => item.policyId === api.id)?.suggestion).toBe('Use privateFetch().');
  });

  it.each([
    ['clean.ts', 'function local(fetch: () => void) { fetch(); } const clean = true;'],
    ['clean.tsx', 'const Button = () => <span/>; const clean = <Button data-id="ok"/>;'],
    ['clean.vue', '<script setup lang="ts">const items = [() => 1];</script><template><span v-for="fetch in items" @click="fetch()" /></template>'],
    ['clean.svelte', '<script lang="ts">const items = [() => 1];</script>{#each items as fetch}<span onclick={() => fetch()}></span>{/each}'],
  ])('preserves local scope in %s', async (filename, code) => {
    const root = await fixture({ [filename]: code });
    expect((await lintProject({ rootDir: root, policy: policy(api, ui) })).diagnostics).toEqual([]);
  });

  it.each([
    ['imports.js', `import 'forbidden'; export { x } from 'forbidden/export'; export * from 'forbidden/all'; import('forbidden/dynamic'); require('forbidden/require');`],
    ['imports.vue', `<script setup lang="ts">import 'forbidden';</script><template><span /></template>`],
    ['imports.svelte', `<script lang="ts">import 'forbidden';</script><span></span>`],
  ])('checks imports and reexports in %s', async (filename, code) => {
    const root = await fixture({ [filename]: code });
    const report = await lintProject({ rootDir: root, policy: policy(imports) });
    expect(report.errorCount).toBe(filename.endsWith('.js') ? 5 : 1);
    expect(report.diagnostics.every(item => item.policyId === imports.id)).toBe(true);
  });

  it('handles namespace imports, default methods, const aliases, optional calls and shadowing', async () => {
    const root = await fixture({ 'calls.ts': `import * as client from 'unsafe-client'; import defaultClient from 'unsafe-client';\nclient.send?.(); defaultClient['send'](); const call = fetch; call('/x'); const { send: transmit } = client; transmit();\nfunction safe(fetch: () => void, client: {send():void}) { fetch(); client.send(); }` });
    const report = await lintProject({ rootDir: root, policy: policy(api) });
    expect(report.errorCount).toBe(5);
  });

  it('checks callback references and call/apply/bind while excluding property keys and type positions', async () => {
    const root = await fixture({ 'references.ts': `declare function use(value: unknown): void;\nuse(fetch); fetch.call(null, '/a'); fetch.apply(null, ['/a']); fetch.bind(null);\nconst obj = { fetch: 1 }; type Response = ReturnType<typeof fetch>; type Shape = { fetch: string };\nfunction local(fetch: () => void) { use(fetch); fetch.call(null); }` });
    const report = await lintProject({ rootDir: root, policy: policy(api) });
    expect(report.errorCount).toBe(4);
    expect(report.diagnostics.every(item => item.line === 2)).toBe(true);
  });

  it.each(['common.cjs', 'common.cts'])('tracks CommonJS destructuring and direct require calls in %s', async filename => {
    const root = await fixture({ [filename]: `const {send: transmit} = require('unsafe-client'); transmit();\nrequire('unsafe-client').send(); const client = require('unsafe-client'); client.send.apply(null, []);\nfunction local(require) { require('unsafe-client').send(); }` });
    const report = await lintProject({ rootDir: root, policy: policy(api) });
    expect(report.errorCount).toBe(3);
  });

  it('supports import-equals API bindings and import type expressions', async () => {
    const root = await fixture({ 'imports.cts': `import client = require('unsafe-client'); client.send(); type A = import('forbidden').A;` });
    const report = await lintProject({ rootDir: root, policy: policy(api, imports) });
    expect(report.errorCount).toBe(2);
    expect(report.diagnostics.map(item => item.policyId)).toEqual([api.id, imports.id]);
  });

  it('checks runtime TypeScript namespaces and chained API member references', async () => {
    const root = await fixture({ 'runtime.ts': `namespace Runtime { fetch('/x'); } fetch.call.bind(null); const info = fetch.name;` });
    expect((await lintProject({ rootDir: root, policy: policy(api) })).errorCount).toBe(3);
  });

  it('resolves kebab-case Vue component aliases', async () => {
    const root = await fixture({ 'alias.vue': `<script setup>import { Button as LegacyButton } from 'legacy-ui';</script><template><legacy-button /></template>` });
    expect((await lintProject({ rootDir: root, policy: policy(ui) })).errorCount).toBe(1);
  });

  it('keeps literal bracket filenames and diagnoses original template positions', async () => {
    const root = await fixture({ 'app/[id]/page.vue': '<template>\n  <div @click="fetch(\'/x\')" />\n</template>' });
    const report = await lintProject({ rootDir: root, files: ['app/[id]/page.vue'], policy: policy(api) });
    expect(report.filesChecked).toBe(1);
    expect(report.diagnostics[0]).toMatchObject({ policyId: api.id, line: 2, column: 16 });
  });

  it('supports Svelte rune modules without requiring project compiler dependencies', async () => {
    const root = await fixture({ 'state.svelte.ts': 'let count = $state(0); fetch("/x");' });
    const report = await lintProject({ rootDir: root, policy: policy(api) });
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.policyId).toBe(api.id);
  });
});

describe('policy enforcement and static limits', () => {
  it('keeps bare package names distinct from relative module specifiers', async () => {
    const root = await fixture({ 'a.ts': `import './forbidden'; export { value } from './forbidden/index'; require('./forbidden'); import 'forbidden';` });
    const report = await lintProject({ rootDir: root, policy: policy(imports) });
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('Importing "forbidden"');
  });
  it('uses policy file/rule/exception scopes', async () => {
    const root = await fixture({ 'src/a.ts': 'fetch("x")', 'src/legacy.ts': 'fetch("x")', 'test/a.ts': 'fetch("x")', 'src/excluded.ts': 'fetch("x")' });
    const scoped: Policy = { ...policy({ ...api, files: ['src/**'] }), files: ['src/**'], ignores: ['src/excluded.ts'], exceptions: [{ ruleId: api.id, files: ['src/legacy.ts'], reason: 'Legacy migration.' }] };
    const report = await lintProject({ rootDir: root, policy: scoped });
    expect(report.filesChecked).toBe(2);
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.filePath).toContain('/src/a.ts');
  });

  it('ignores inline eslint disabling and project configuration', async () => {
    const root = await fixture({ 'a.ts': '/* eslint-disable goodui/restricted-api */\nfetch("x");', 'eslint.config.js': 'throw new Error("must not execute")' });
    const report = await lintProject({ rootDir: root, files: ['a.ts'], policy: policy(api) });
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics.some(item => item.policyId === api.id)).toBe(true);
    expect(report.warningCount).toBe(1);
  });

  it('fails unknown module specifiers only when the import contract applies', async () => {
    const root = await fixture({ 'a.ts': 'const dependency = "something"; import(dependency); require(dependency);' });
    const report = await lintProject({ rootDir: root, policy: policy(imports) });
    expect(report.errorCount).toBe(2);
    expect((await lintProject({ rootDir: root, policy: policy(api) })).errorCount).toBe(0);
  });

  it.each([
    ['a.tsx', 'declare const props: object; const a = <div {...props} />;'],
    ['a.vue', '<script setup>const props = {};</script><template><div v-bind="props" /></template>'],
    ['a.svelte', '<script>const props = {};</script><div {...props}></div>'],
  ])('diagnoses indeterminate attributes in %s only for relevant UI contracts', async (filename, code) => {
    const root = await fixture({ [filename]: code });
    expect((await lintProject({ rootDir: root, policy: policy(ui) })).errorCount).toBe(1);
    expect((await lintProject({ rootDir: root, policy: policy({ ...ui, attributes: undefined, features: undefined, components: undefined }) })).errorCount).toBe(0);
  });

  it('inspects object-literal spreads', async () => {
    const root = await fixture({ 'a.tsx': `const a = <div {...{style: {color: 'red'}}} />; const b = <div {...{'data-id': 'ok'}}/>;` });
    const report = await lintProject({ rootDir: root, policy: policy(ui) });
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('Inline styles');
  });

  it('reports Vue parse recovery and unsupported template languages', async () => {
    const root = await fixture({ 'broken.vue': '<template><div></span></template>', 'pug.vue': '<template lang="pug">div Hello</template>' });
    const report = await lintProject({ rootDir: root, policy: policy(api) });
    expect(report.errorCount).toBeGreaterThanOrEqual(2);
    expect(report.diagnostics.some(item => item.message.includes('Unsupported Vue template language'))).toBe(true);
  });

  it('does not report successful scans without checked files or applicable contracts', async () => {
    const root = await fixture({ 'a.ts': 'const a = 1' });
    await expect(lintProject({ rootDir: root, policy: { ...policy(api), files: ['missing/**'] } })).rejects.toMatchObject({ code: 'NO_FILES' });
    await expect(lintProject({ rootDir: root, policy: policy({ ...api, files: ['other/**'] }) })).rejects.toMatchObject({ code: 'NO_APPLICABLE_RULES' });
    await expect(lintProject({ rootDir: root, policy: policy(api), files: ['../outside.ts'] })).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
  });

  it('returns flat configurations that disable inline configuration', async () => {
    const root = await fixture({ 'a.ts': 'const a = 1' });
    const config = await createConfig({ rootDir: root, policy: policy(api) });
    expect(config.some(item => item.linterOptions?.noInlineConfig)).toBe(true);
  });
});

describe('import boundaries', () => {
  it.each(['a.ts', 'a.vue', 'a.svelte'])('resolves relative and tsconfig alias dependencies in %s', async filename => {
    const code = `import { secret } from '@/server/secret'; import { shared } from '../shared/index';`;
    const component = filename.endsWith('.vue') ? `<script setup lang="ts">${code}</script><template><span/></template>` : filename.endsWith('.svelte') ? `<script lang="ts">${code}</script><span></span>` : code;
    const root = await fixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      [`src/client/${filename}`]: component, 'src/server/secret.ts': 'export const secret = 1;', 'src/shared/index.ts': 'export const shared = 1;',
    });
    const boundary: PolicyRule = { id: 'layers', kind: 'import-boundaries', from: ['src/client/**'], allow: ['src/shared/**'], disallow: ['src/server/**'], reason: 'Client code must not reach server code.' };
    const report = await lintProject({ rootDir: root, policy: policy(boundary) });
    expect(report.errorCount).toBe(1);
    expect(report.diagnostics[0]?.message).toContain('src/server/secret.ts');
  });

  it('resolves component aliases, index modules and explicit deny precedence', async () => {
    const root = await fixture({
      'jsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }),
      'src/client/a.ts': `import A from '@/shared/A.vue'; import { x } from '../shared';`,
      'src/shared/A.vue': '<template><span /></template>', 'src/shared/index.ts': 'export const x = 1;',
    });
    const report = await lintProject({ rootDir: root, policy: policy({ id: 'layers', kind: 'import-boundaries', from: ['src/client/**'], allow: ['src/shared/**'], disallow: ['src/shared/A.vue'], reason: 'Use approved modules.' }) });
    expect(report.errorCount).toBe(1);
  });

  it('gives exact aliases precedence over wildcards and rejects compiler config escapes', async () => {
    const root = await fixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@*': ['./src/public/*'], '@secret': ['./src/private/secret.ts'] } } }),
      'src/client.ts': `import secret from '@secret';`, 'src/private/secret.ts': 'export default 1;', 'src/public/secret.ts': 'export default 2;',
    });
    const boundary: PolicyRule = { id: 'layers', kind: 'import-boundaries', from: ['src/client.ts'], disallow: ['src/private/**'], reason: 'Keep private code out.' };
    expect((await lintProject({ rootDir: root, policy: policy(boundary) })).errorCount).toBe(1);
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ extends: '../outside.json' }));
    // A missing external config is also a configuration error instead of a successful scan.
    await expect(lintProject({ rootDir: root, policy: policy(boundary) })).rejects.toThrow();
  });

  it('canonicalizes symlink dependency targets before checking boundaries', async () => {
    const root = await fixture({ 'src/client/a.ts': `import secret from '../public/secret';`, 'src/private/secret.ts': 'export default 1;' });
    await symlink(join(root, 'src/private'), join(root, 'src/public'), 'junction');
    const boundary: PolicyRule = { id: 'layers', kind: 'import-boundaries', from: ['src/client/**'], disallow: ['src/private/**'], reason: 'Keep private code out.' };
    expect((await lintProject({ rootDir: root, policy: policy(boundary) })).errorCount).toBe(1);
    await expect(lintProject({ rootDir: root, files: ['src/private'], policy: policy(boundary) })).rejects.toMatchObject({ code: 'NO_APPLICABLE_RULES' });
  });
});

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;
const tester = new RuleTester({ languageOptions: { parser } });
tester.run('restricted-api', plugin.rules['restricted-api'], {
  valid: [{ code: 'function local(fetch: () => void) { fetch(); }', options: [{ rootDir: process.cwd(), policy: policy(api) }] }],
  invalid: [{ code: 'eval("x")', options: [{ rootDir: process.cwd(), policy: policy(api) }], errors: [{ messageId: 'violation', line: 1, column: 1 }] }],
});
