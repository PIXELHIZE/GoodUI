import { join } from 'node:path';
import { Linter } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import * as vueParser from 'vue-eslint-parser';
import * as svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import type { ComponentContractsRule, Policy } from '@pixelhize/goodui-core';
import { componentRules } from '../src/component-rules.js';

const root = process.cwd();
const base: ComponentContractsRule = {
  id: 'button-contract', kind: 'component-contracts', tags: ['button'],
  requiredProps: ['type', 'aria-label'], nonEmptyProps: ['aria-label'],
  propValues: { type: ['button', 'submit', 'reset'] },
  reason: 'Buttons declare their behavior and accessible name.',
};

function lint(code: string, rule: ComponentContractsRule = base, extension = 'tsx', extras: Partial<Policy> = {}) {
  const parser = extension === 'vue' ? vueParser : extension === 'svelte' ? svelteParser : tsParser;
  const policy: Policy = { version: 1, rules: [rule], ...extras };
  const config = [{
    files: [`**/*.${extension}`],
    languageOptions: { parser, parserOptions: { parser: tsParser, ecmaFeatures: { jsx: true }, project: false, projectService: false, svelteConfig: { compilerOptions: {} } } },
    plugins: { goodui: { rules: componentRules } },
    rules: { 'goodui/component-contracts': ['error', { rootDir: root, policy }] },
  }];
  return new Linter().verify(code, config as any, { filename: join(root, `component-contracts.${extension}`) });
}

describe('native component contracts', () => {
  it.each([
    ['tsx', 'const view = <button type="button" aria-label="Save" />;'],
    ['vue', '<template><button type="button" aria-label="Save" /></template>'],
    ['svelte', '<button type="button" aria-label="Save" />'],
  ])('accepts explicit valid props in %s', (extension, source) => {
    expect(lint(source, base, extension)).toEqual([]);
  });

  it.each([
    ['tsx', 'const view = <button />;'],
    ['vue', '<template><button /></template>'],
    ['svelte', '<button />'],
  ])('requires configured props in %s and keeps original source locations', (extension, source) => {
    const messages = lint(source, base, extension);
    expect(messages).toHaveLength(2);
    expect(messages.every(message => message.ruleId === 'goodui/component-contracts' && message.line === 1)).toBe(true);
    expect(messages.some(message => message.message.includes('"aria-label"'))).toBe(true);
  });

  it('checks nonempty and allowed present values without making optional props required', () => {
    const rule: ComponentContractsRule = { ...base, requiredProps: ['type'], forbiddenProps: ['dangerouslySetInnerHTML'] };
    expect(lint('const view = <button type="button" />;', rule)).toEqual([]);
    const invalid = lint('const view = <button type="invalid" aria-label="  " dangerouslySetInnerHTML={{__html: "x"}} />;', rule);
    expect(invalid).toHaveLength(3);
    expect(invalid.map(message => message.message).join('\n')).toContain('must contain a nonblank string or number');
    expect(invalid.map(message => message.message).join('\n')).toContain('must be one of');
    expect(invalid.map(message => message.message).join('\n')).toContain('is forbidden');
  });

  it('uses typed primitive allowed values and rejects boolean/null nonempty values', () => {
    const rule: ComponentContractsRule = { ...base, requiredProps: ['count', 'active'], nonEmptyProps: ['label'], propValues: { count: [1], active: [false], mode: [null] } };
    expect(lint('const view = <button count={1} active={false} mode={null} label={0} />;', rule)).toEqual([]);
    expect(lint('const view = <button count="1" active={false} label={true} />;', rule)).toHaveLength(2);
  });

  it('inspects static spreads and preserves last-write prop precedence', () => {
    expect(lint('const props = {type: "button", "aria-label": "Save"} as const; const view = <button {...props} />;')).toEqual([]);
    expect(lint('const view = <button {...{type:"wrong", "aria-label":"Save"}} type="button" />;')).toEqual([]);
    expect(lint('const view = <button type="button" aria-label="Save" {...{type:"wrong"}} />;')).toHaveLength(1);
  });

  it.each([
    ['tsx', 'const view = <button {...props} />;'],
    ['vue', '<template><button v-bind="props" /></template>'],
    ['svelte', '<button {...props} />'],
  ])('refuses unknown prop spreads by default in %s', (extension, source) => {
    const messages = lint(source, base, extension);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('Dynamic prop spread');
    expect(lint(source, { ...base, allowDynamicProps: true }, extension)).toEqual([]);
  });

  it('requires dynamic checked props to be explicitly allowed and still rejects known bad branches', () => {
    const source = 'const view = <button type={kind} aria-label={label} />;';
    expect(lint(source)).toHaveLength(2);
    expect(lint(source, { ...base, allowDynamicProps: true })).toEqual([]);
    expect(lint('const view = <button type={ok ? "wrong" : unknown} aria-label="Save" />;', { ...base, allowDynamicProps: true })).toHaveLength(1);
  });

  it('accepts statically known const and conditional values in all frameworks', () => {
    expect(lint('const kind = "button" as const; const view = <button type={kind} aria-label={ok ? "Save" : "Send"} />;')).toEqual([]);
    expect(lint('<template><button :type="\'button\'" :aria-label="\'Save\'" /></template>', base, 'vue')).toEqual([]);
    expect(lint('<script>const kind="button";</script><button type={kind} aria-label="Save" />', base, 'svelte')).toEqual([]);
  });

  it('matches imported aliases and namespace members while respecting local shadowing', () => {
    const rule: ComponentContractsRule = { ...base, tags: undefined, components: [{ source: '@app/ui', names: ['Button'] }], requiredProps: ['variant'], nonEmptyProps: undefined, propValues: { variant: ['primary', 'secondary'] } };
    expect(lint('import {Button as Action} from "@app/ui"; const Alias=Action; const view=<Alias variant="primary"/>;', rule)).toEqual([]);
    expect(lint('import * as UI from "@app/ui"; const view=<UI.Button />;', rule)).toHaveLength(1);
    expect(lint('import {Button as Action} from "@app/ui"; function render(Action: any){return <Action/>;}', rule)).toEqual([]);
    expect(lint('import {Button as Action} from "other-ui"; const view=<Action/>;', rule)).toEqual([]);
  });

  it('matches default relative imports and imported Vue/Svelte component names', () => {
    const rule: ComponentContractsRule = { ...base, tags: undefined, components: [{ source: './Button', names: ['default'] }] };
    expect(lint('import Action from "./Button"; const view=<Action/>;', rule)).toHaveLength(2);
    expect(lint('import Action from "Button"; const view=<Action/>;', rule)).toEqual([]);
    expect(lint('<script setup>import Action from "./Button";</script><template><Action /></template>', rule, 'vue')).toHaveLength(2);
    expect(lint('<script>import Action from "./Button";</script><Action />', rule, 'svelte')).toHaveLength(2);
  });

  it('applies rule file scopes and centralized exceptions', () => {
    expect(lint('const view=<button/>;', { ...base, files: ['src/**'] })).toEqual([]);
    expect(lint('const view=<button/>;', base, 'tsx', { exceptions: [{ ruleId: base.id, files: ['**/*.tsx'], reason: 'A reviewed generated fixture.' }] })).toEqual([]);
  });
});
