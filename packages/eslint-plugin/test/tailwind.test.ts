import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { type Policy } from '@pixelhize/goodui-core';
import { createConfig, lintProject } from '../src/index.js';
import { baseClass, splitClasses } from '../src/design-system/classes.js';

const rootDir = fileURLToPath(new URL('./fixtures/tailwind/', import.meta.url));
const temporaryRoots: string[] = [];
const preset: Policy = { version: 1, presets: ['tailwind'], rules: [] };

afterAll(async () => { await Promise.all(temporaryRoots.map(root => rm(root, { recursive: true, force: true }))); });

async function checkText(code: string, extension = 'tsx', tailwind: Policy['tailwind'] = {}) {
  const eslint = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir, policy: { ...preset, tailwind } }) });
  return (await eslint.lintText(code, { filePath: `src/values.${extension}` }))[0]!;
}

async function isolatedTheme(css: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'goodui-native-theme-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'node_modules'), { recursive: true });
  const tailwind = await realpath(fileURLToPath(new URL('../node_modules/tailwindcss/', import.meta.url)));
  await symlink(tailwind, join(root, 'node_modules/tailwindcss'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(root, 'theme.css'), css);
  return root;
}

describe('optional Tailwind preset', () => {
  it('loads the real engine and catches raw colors, off-token values, inline styles and unknown classes', async () => {
    const report = await lintProject({ rootDir, policy: preset, files: ['src/broken.tsx'] });
    const ruleIds = report.diagnostics.map(item => item.ruleId);
    expect(ruleIds).toContain('goodui/no-raw-colors');
    expect(ruleIds).toContain('goodui/no-arbitrary-values');
    expect(ruleIds).toContain('goodui/no-inline-styles');
    expect(ruleIds).toContain('goodui/no-unknown-classes');
    expect(report.diagnostics.every(item => !item.policyId)).toBe(true);
    expect(report.diagnostics.some(item => item.message.includes('rounded-huge'))).toBe(true);
    expect(report.diagnostics.every(item => item.line === 3)).toBe(true);
    expect(report.filesChecked).toBe(1);
    expect((await lintProject({ rootDir, policy: preset, files: ['src/clean.tsx'] })).errorCount).toBe(0);
  }, 20000);

  it('uses the identical Tailwind engine and messages in editor configuration and direct linting', async () => {
    const config = await createConfig({ rootDir, policy: preset });
    const eslint = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: config });
    const editor = await eslint.lintFiles([join(rootDir, 'src/broken.tsx')]);
    const direct = await lintProject({ rootDir, policy: preset, files: ['src/broken.tsx'] });
    expect(direct.diagnostics.map(item => ({ ruleId: item.ruleId, message: item.message })).sort((a, b) => String(a.ruleId).localeCompare(String(b.ruleId))))
      .toEqual(editor[0]!.messages.map(item => ({ ruleId: item.ruleId, message: item.message })).sort((a, b) => String(a.ruleId).localeCompare(String(b.ruleId))));
    expect(config.find(item => item.name === 'goodui/contracts')?.linterOptions?.noInlineConfig).toBe(true);
  }, 20000);

  it.each([
    ['vue', `<template><div class="p-[13px] bg-pink-500 rounded-huge" :style="{ color: 'red' }" /></template>`],
    ['svelte', `<div class="p-[13px] bg-pink-500 rounded-huge" style:color="red"></div>`],
  ])('checks %s template classes through the same native engine', async (extension, code) => {
    const eslint = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir, policy: preset }) });
    const [result] = await eslint.lintText(code, { filePath: `src/template.${extension}` });
    const ruleIds = result!.messages.map(item => item.ruleId);
    expect(ruleIds).toContain('goodui/no-raw-colors');
    expect(ruleIds).toContain('goodui/no-arbitrary-values');
    expect(ruleIds).toContain('goodui/no-inline-styles');
    expect(ruleIds).toContain('goodui/no-unknown-classes');
    expect(result!.messages.every(item => item.ruleId !== null)).toBe(true);
  });

  it('preserves native diagnostic identity when ordinary GoodUI contracts are enabled too', async () => {
    const policy: Policy = { ...preset, rules: [{ id: 'primary-button', kind: 'restricted-ui', tags: ['Button'], reason: 'Use PrimaryButton.' }] };
    const report = await lintProject({ rootDir, policy, files: ['src/broken.tsx'] });
    expect(report.diagnostics.some(item => item.ruleId === 'goodui/restricted-ui' && item.policyId === 'primary-button')).toBe(true);
    expect(report.diagnostics.filter(item => item.ruleId?.startsWith('goodui/no-')).every(item => item.policyId === undefined)).toBe(true);
  });

  it('does not enable component restyling or static-class contracts until explicitly selected', async () => {
    const eslint = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir, policy: preset }) });
    const code = `import { Button } from '@/components/ui/button'; declare const classes: string; const a = <Button className="p-4"/>; const b = <Button className={classes}/>;`;
    const baseline = (await eslint.lintText(code, { filePath: 'src/optional.tsx' }))[0]!;
    expect(baseline.errorCount).toBe(0);
    const optIn: Policy = { ...preset, tailwind: { rules: ['no-restyle', 'require-static-classes'] } };
    const strict = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir, policy: optIn }) });
    const result = (await strict.lintText(code, { filePath: 'src/optional.tsx' }))[0]!;
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-restyle');
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/require-static-classes');
  });

  it('uses centralized native rule exceptions and shared discovery settings', async () => {
    const policy: Policy = {
      ...preset,
      tailwind: { rules: ['no-arbitrary-values'], componentImports: ['@/components/ui/**'], note: 'Follow DESIGN.md.' },
      exceptions: [{ ruleId: 'goodui/no-arbitrary-values', files: ['src/broken.tsx'], reason: 'Pending token migration.' }],
    };
    const report = await lintProject({ rootDir, policy });
    expect(report.errorCount).toBe(0);
    const config = await createConfig({ rootDir, policy });
    const engine = config.find(item => item.name === 'goodui/tailwind');
    expect(engine?.settings?.gooduiNativeProject).toEqual(expect.any(String));
    const eslint = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: config });
    const [result] = await eslint.lintText(`const page = <div className="p-[13px]"/>;`, { filePath: 'src/not-exempt.tsx' });
    expect(result!.messages[0]?.message).toContain('Follow DESIGN.md.');
    expect(result!.messages[0]?.ruleId).toBe('goodui/no-arbitrary-values');
  });

  it('reports missing Tailwind theme entries explicitly while ordinary policies remain unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goodui-missing-tailwind-'));
    temporaryRoots.push(root);
    await expect(createConfig({ rootDir: root, policy: preset })).rejects.toMatchObject({ code: 'TAILWIND_THEME_NOT_FOUND' });
    const policy: Policy = { version: 1, rules: [{ id: 'no-eval', kind: 'restricted-api', globals: ['eval'], reason: 'No dynamic code.' }] };
    const config = await createConfig({ rootDir: root, policy });
    expect(config.some(item => item.name === 'goodui/tailwind')).toBe(false);
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config });
    const result = (await eslint.lintText('eval("x")', { filePath: 'test.ts' }))[0]!;
    expect(result.messages[0]?.ruleId).toBe('goodui/restricted-api');
  });

  it('keeps inline disable comments from bypassing native rules', async () => {
    const config = await createConfig({ rootDir, policy: { ...preset, tailwind: { rules: ['no-arbitrary-values'] } } });
    const eslint = new ESLint({ cwd: rootDir, overrideConfigFile: true, overrideConfig: config });
    const [result] = await eslint.lintText('/* eslint-disable goodui/no-arbitrary-values */\nconst page = <div className="p-[13px]"/>;', { filePath: 'src/inline.tsx' });
    expect(result!.messages.some(item => item.ruleId === 'goodui/no-arbitrary-values' && item.severity === 2)).toBe(true);
  });

  it('tokenizes arbitrary brackets, quoted whitespace and nested variant selectors without splitting them', () => {
    expect(splitClasses(`md:p-[calc(100% - 1rem)] [&:nth-child(2)]:content-['a b'] hover:bg-brand`)).toEqual(['md:p-[calc(100% - 1rem)]', `[&:nth-child(2)]:content-['a b']`, 'hover:bg-brand']);
    expect(baseClass('[&:nth-child(2)]:hover:!bg-brand')).toBe('bg-brand');
  });

  it('reads helper aliases, conditionals, arrays, object keys and one-hop consts', async () => {
    const result = await checkText(`import { clsx as merge } from 'clsx'; const tone = 'bg-red-500'; declare const active: boolean; const page = <div className={merge(['p-[13px]', {'rounded-huge': active}], active ? tone : 'bg-brand')}/>;`);
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-raw-colors');
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-arbitrary-values');
    expect(result.messages.filter(item => item.ruleId === 'goodui/no-unknown-classes')).toHaveLength(1);
    expect(result.messages.filter(item => item.ruleId === 'goodui/no-raw-colors')).toHaveLength(1);
  });

  it('reads finite cva/tv variants and excludes compound slot names from class values', async () => {
    const result = await checkText(`import { Button } from '@/components/ui/button'; import {cva} from 'class-variance-authority'; import {tv} from 'tailwind-variants'; const styles=cva('flex',{variants:{tone:{normal:'bg-brand',danger:'bg-red-500'}}}); const slots=tv({slots:{root:'flex',icon:'block'},compoundSlots:[{slots:['icon'],class:'text-sm'}]}); const page=<Button className={styles({tone:'danger'})}/>;`, 'tsx', { rules: ['no-raw-colors', 'no-unknown-classes', 'require-static-classes'] });
    expect(result.messages.map(item => item.ruleId)).toEqual(['goodui/no-raw-colors']);
  });

  it('supports configured helper names and statically known spreads', async () => {
    const result = await checkText(`const attrs = {className: ['bg-red-500', 'p-[13px]']} as const; const a=<div {...attrs}/>; const b=customJoin('rounded-huge');`, 'tsx', { classFunctions: ['customJoin'] });
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-raw-colors');
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-arbitrary-values');
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-unknown-classes');
  });

  it('reads one-hop object/array lookups without following a second const indirection', async () => {
    const result = await checkText(`const tones={danger:'bg-red-500', safe:'bg-brand'}; const widths=['w-[13px]']; const a=<div className={tones.danger}/>; const b=<div className={widths[0]}/>;`, 'tsx', { rules: ['no-raw-colors', 'no-arbitrary-values', 'require-static-classes'] });
    expect(result.messages.map(item => item.ruleId).sort()).toEqual(['goodui/no-arbitrary-values', 'goodui/no-raw-colors']);
    const indirect = await checkText(`const tone='bg-brand'; const alias=tone; const page=<div className={alias}/>;`, 'tsx', { rules: ['require-static-classes'] });
    expect(indirect.messages.map(item => item.ruleId)).toEqual(['goodui/require-static-classes']);
  });

  it.each([
    ['vue', `<script setup>const tone='bg-red-500';const active=true;</script><template><div :class="['p-[13px]', {'rounded-huge': active}, tone]" /></template>`],
    ['svelte', `<script>const active=true;</script><div class:bg-red-500={active} class={['p-[13px]','rounded-huge']}></div>`],
  ])('reads %s class expressions and directives', async (extension, code) => {
    const result = await checkText(code, extension);
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-raw-colors');
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-arbitrary-values');
    expect(result.messages.map(item => item.ruleId)).toContain('goodui/no-unknown-classes');
    expect(result.messages.every(item => item.ruleId !== null)).toBe(true);
  });

  it('keeps known template pieces and reports only unresolved pieces with static checking enabled', async () => {
    const code = "declare const tone:string; const page=<div className={`p-4 bg-${tone} bg-red-500`}/>;";
    const result = await checkText(code, 'tsx', { rules: ['no-raw-colors', 'require-static-classes'] });
    expect(result.messages.map(item => item.ruleId).sort()).toEqual(['goodui/no-raw-colors', 'goodui/require-static-classes']);
    const finite = await checkText(`declare const active:boolean; const tone=active?'bg-brand':'bg-accent'; const page=<div className={['flex',tone,{'text-sm':active}]}/>;`, 'tsx', { rules: ['no-unknown-classes', 'require-static-classes'] });
    expect(finite.errorCount).toBe(0);
  });

  it('checks raw SVG colors and var fallbacks while allowing semantic variables and gradient references', async () => {
    const result = await checkText(`const a=<svg fill="#ff0000" stroke="var(--color-brand, red)"/>; const b=<svg fill="url(#gradient)" stroke="var(--color-brand)"/>; const c=<div style={{'--tone':'var(--color-brand, #f00)'}}/>;`, 'tsx', { rules: ['no-raw-colors', 'no-inline-styles'] });
    expect(result.messages.filter(item => item.ruleId === 'goodui/no-raw-colors')).toHaveLength(3);
    expect(result.messages.some(item => item.ruleId === 'goodui/no-inline-styles')).toBe(false);
    expect(result.messages.every(item => item.message.includes('bg-accent'))).toBe(true);
  });

  it('checks the complete CSS named-color vocabulary, including coral and tomato', async () => {
    const result = await checkText(`const page=<svg fill="coral" stroke="tomato" color="salmon"/>;`, 'tsx', { rules: ['no-raw-colors'] });
    expect(result.errorCount).toBe(3);
  });

  it('handles class allow/deny globs and literal brackets in intentional arbitrary-value allowances', async () => {
    const allowed = await checkText(`const a=<div className="hover:bg-red-500 w-[13px]"/>;`, 'tsx', { allowClasses: ['bg-red-*'], allowArbitrary: ['w-[*]'] });
    expect(allowed.errorCount).toBe(0);
    const denied = await checkText(`const a=<div className="hover:bg-red-500"/>;`, 'tsx', { allowClasses: ['bg-red-*'], denyClasses: ['bg-red-*'] });
    expect(denied.errorCount).toBe(1);
    expect(denied.messages[0]?.message).toContain('forbidden');
  });

  it('accepts generated utilities, marker classes, literal escaped selectors and Unicode CSS classes', async () => {
    const result = await checkText(`const a=<div className="group peer group/card peer/edit dark vendor:card 커스텀 ordinary-custom goodui-compiler-class"/>;`, 'tsx', { rules: ['no-unknown-classes'] });
    expect(result.messages).toEqual([]);
  });

  it('follows a basic component barrel and suggests variants from the defining source', async () => {
    const result = await checkText(`import {Action as Save} from '@/components/actions'; const page=<Save className="p-4"/>;`, 'tsx', { rules: ['no-restyle'] });
    expect(result.errorCount).toBe(1);
    expect(result.messages[0]?.message).toContain('sm, lg'.split(', ').sort().join(', '));
    expect(result.messages[0]?.message).toContain('components/ui/button.tsx');
    const ignored = await checkText(`import {Action as Save} from '@/components/actions'; const page=<Save className="p-4"/>;`, 'tsx', { rules: ['no-restyle'], ignoreImports: ['@/components/actions'] });
    expect(ignored.errorCount).toBe(0);
  });

  it('keeps sibling exports out of star-barrel and same-file component variant suggestions', async () => {
    const star = await checkText(`import {Button} from '@/components/star'; const a=<Button className="p-4"/>;`, 'tsx', { rules: ['no-restyle'] });
    expect(star.errorCount).toBe(1);
    expect(star.messages[0]?.message).toContain('lg, sm');
    expect(star.messages[0]?.message).not.toContain('huge');
    expect(star.messages[0]?.message).toContain('button.tsx');
    const local = await checkText(`import {CompactButton} from '@/components/ui/mixed'; const a=<CompactButton className="p-4"/>;`, 'tsx', { rules: ['no-restyle'] });
    expect(local.errorCount).toBe(1);
    expect(local.messages[0]?.message).toContain('compact');
    expect(local.messages[0]?.message).not.toContain('huge');
  });

  it('reads aliased cva factories and names real variant axes instead of inventing a variant prop', async () => {
    const result = await checkText(`import {Panel} from '@/components/ui/panel'; const a=<Panel className="p-4 bg-brand"/>;`, 'tsx', { rules: ['no-restyle'] });
    expect(result.messages.some(item => item.message.includes('size: lg, sm'))).toBe(true);
    expect(result.messages.some(item => item.message.includes('tone: quiet, standard'))).toBe(true);
    expect(result.messages.every(item => !item.message.includes('variant: quiet'))).toBe(true);
  });

  it('respects lexical require shadowing while recognizing real CommonJS component aliases', async () => {
    const local = await checkText(`function View(require: (name:string)=>any) { const Local=require('@/components/ui/button'); return <Local className="p-4"/>; }`, 'tsx', { rules: ['no-restyle'] });
    expect(local.errorCount).toBe(0);
    const imported = await checkText(`const {Button:Local}=require('@/components/ui/button'); const page=<Local className="p-4"/>;`, 'tsx', { rules: ['no-restyle'] });
    expect(imported.errorCount).toBe(1);
  });

  it('does not treat a relative import of the framework palette as project-owned tokens', async () => {
    const root = await isolatedTheme(`@import './node_modules/tailwindcss/theme.css';`);
    const policy: Policy = { ...preset, tailwind: { themeFiles: ['theme.css'], rules: ['no-raw-colors'] } };
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir: root, policy }) });
    const [result] = await eslint.lintText(`const page=<div className="bg-red-500"/>;`, { filePath: 'a.tsx' });
    expect(result!.messages.map(item => item.ruleId)).toEqual(['goodui/no-raw-colors']);
    expect(result!.messages[0]?.message).not.toContain('bg-red-500 from');
  });

  it('supports Tailwind prefixes on ordinary utilities and group/peer marker classes', async () => {
    const root = await isolatedTheme('@import "tailwindcss" prefix(tw); @theme {--color-brand:#123456;}');
    const policy: Policy = { ...preset, tailwind: { themeFiles: ['theme.css'], rules: ['no-unknown-classes'] } };
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir: root, policy }) });
    const [result] = await eslint.lintText(`const a=<div className="tw:group tw:peer/field tw:group-hover:flex tw:bg-red-500"/>;`, { filePath: 'a.tsx' });
    expect(result!.messages).toEqual([]);
    const [typo] = await eslint.lintText(`const a=<div className="tw:rounded-huge"/>;`, { filePath: 'a.tsx' });
    expect(typo!.messages[0]?.message).toContain('"tw:rounded-');
    const color = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir: root, policy: { ...policy, tailwind: { ...policy.tailwind, rules: ['no-raw-colors', 'no-unknown-classes'] } } }) });
    const [raw] = await color.lintText(`const a=<div className="tw:bg-red-500"/>;`, { filePath: 'a.tsx' });
    expect(raw!.messages[0]?.message).toContain('tw:bg-brand');
  });

  it.each([
    ['tsx', `const page=<style>{'.local{color:red}'}</style>;`],
    ['vue', `<template><div class="local" /></template><style>.local { display:block }</style>`],
    ['svelte', `<div class="local"></div><style>.local { display:block }</style>`],
  ])('reports %s local style blocks and permits their literal classes when only class validity is checked', async (extension, code) => {
    const result = await checkText(code, extension, { rules: ['no-inline-styles'] });
    expect(result.messages.some(item => item.ruleId === 'goodui/no-inline-styles')).toBe(true);
    if (extension !== 'tsx') expect((await checkText(code, extension, { rules: ['no-unknown-classes'] })).errorCount).toBe(0);
  });

  it('detects a stale prepared theme and refreshes it on the next direct scan', async () => {
    const root = await isolatedTheme('@import "tailwindcss"; @theme {--color-brand:red;}');
    await writeFile(join(root, 'a.tsx'), 'const a=<div className="bg-brand"/>;');
    const policy: Policy = { ...preset, tailwind: { themeFiles: ['theme.css'], rules: ['no-unknown-classes'] } };
    const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: await createConfig({ rootDir: root, policy }) });
    await writeFile(join(root, 'theme.css'), '@import "tailwindcss"; @theme {--color-brand:blue;} /* changed */');
    await expect(eslint.lintFiles(['a.tsx'])).rejects.toThrow('Design source changed');
    expect((await lintProject({ rootDir: root, policy })).errorCount).toBe(0);
  });

  it('fails closed when the official compiler cannot load a configured theme dependency', async () => {
    const root = await isolatedTheme('@import "tailwindcss"; @plugin "./does-not-exist.mjs";');
    const policy: Policy = { ...preset, tailwind: { themeFiles: ['theme.css'], rules: ['no-unknown-classes'] } };
    await expect(createConfig({ rootDir: root, policy })).rejects.toMatchObject({ code: 'TAILWIND_COMPILER_ERROR' });
  });
});
