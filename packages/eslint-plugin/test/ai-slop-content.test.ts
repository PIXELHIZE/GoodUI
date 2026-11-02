import { resolve } from 'node:path';
import { Linter } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import * as vueParser from 'vue-eslint-parser';
import * as svelteParser from 'svelte-eslint-parser';
import { describe, expect, it } from 'vitest';
import type { AiSlopPolicy, AiSlopRuleName, Locale, Policy } from '@pixelhize/goodui-core';
import { createContentVisitors } from '../src/ai-slop-content.js';

type Extension = 'tsx' | 'vue' | 'svelte';
const extensions: Extension[] = ['tsx', 'vue', 'svelte'];
const rootDir = process.cwd();
function ui(extension: Extension, markup: string, script = ''): string {
  if (extension === 'tsx') return `${script}\nconst page = (${markup});`;
  if (extension === 'vue') return `${script ? `<script setup lang="ts">${script}</script>` : ''}<template>${markup}</template>`;
  return `${script ? `<script lang="ts">${script}</script>` : ''}${markup}`;
}
function check(ruleName: AiSlopRuleName, markup: string, options: { extension?: Extension; locale?: Locale; settings?: AiSlopPolicy; script?: string; raw?: boolean } = {}) {
  const extension = options.extension ?? 'tsx';
  const settings = options.settings ?? {};
  const policy: Policy = { version: 1, presets: ['ai-slop'], rules: [], aiSlop: settings };
  const source = options.raw ? markup : ui(extension, markup, options.script);
  const parser = extension === 'vue' ? vueParser : extension === 'svelte' ? svelteParser : tsParser;
  const rule = {
    meta: { type: 'problem', schema: [] },
    create(context: any) {
      return createContentVisitors(context, { rootDir, policy, settings, ruleName, locale: options.locale ?? 'en' }, (node, message) => {
        context.report({ node, message: message[options.locale ?? 'en'] });
      });
    },
  };
  const result = new Linter().verify(source, [{
    files: ['**/*.{tsx,vue,svelte}'],
    languageOptions: { parser: parser as any, parserOptions: { parser: tsParser, project: false, projectService: false, ecmaFeatures: { jsx: true }, svelteConfig: { compilerOptions: {} } } },
    plugins: { goodui: { rules: { [ruleName]: rule } } as any },
    rules: { [`goodui/${ruleName}`]: 'error' },
  }], { filename: resolve(rootDir, `src/anti-slop.${extension}`) });
  expect(result.every(item => item.ruleId === `goodui/${ruleName}`)).toBe(true);
  return result;
}

describe.each(extensions)('bounded AI-slop content checks in %s', extension => {
  it.each([
    ['no-emoji-icons', '<h1>🚀 Launch</h1>'],
    ['no-generic-copy', '<h1>Unlock your potential</h1>'],
    ['no-placeholder-copy', '<p>Lorem ipsum dolor sit amet</p>'],
    ['no-placeholder-links', '<a href="#">Read more</a>'],
    ['no-nested-cards', '<Card><div><Card>Body</Card></div></Card>'],
    ['no-oversized-radius', '<div class="rounded-3xl">Body</div>'],
    ['no-generic-fonts', '<p class="font-[Inter]">Body</p>'],
  ] as const)('reports %s with stable locations in both languages', (ruleName, markup) => {
    const en = check(ruleName, markup, { extension, locale: 'en' });
    const ko = check(ruleName, markup, { extension, locale: 'ko' });
    expect(en).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0]?.message).toMatch(/[가-힣]/);
    expect(ko[0]?.message).not.toBe(en[0]?.message);
    expect(ko.map(({ message, ...rest }) => rest)).toEqual(en.map(({ message, ...rest }) => rest));
  });

  it('does not inspect ordinary strings, comments, data attributes, handlers or translation arguments', () => {
    const script = `// 🚀 Unlock your potential Lorem ipsum\nconst unused = 'Unlock your potential'; const sample = 'Lorem ipsum'; function t(value: string) { return value; }`;
    const markup = '<div data-description="Lorem ipsum">Real product content</div>';
    for (const ruleName of ['no-emoji-icons', 'no-generic-copy', 'no-placeholder-copy'] as const) {
      expect(check(ruleName, markup, { extension, script })).toEqual([]);
    }
    const translated = extension === 'tsx' ? '<p>{t("Lorem ipsum")}</p>' : extension === 'vue' ? '<p>{{ t("Lorem ipsum") }}</p>' : '<p>{t("Lorem ipsum")}</p>';
    expect(check('no-placeholder-copy', translated, { extension, script })).toEqual([]);
  });

  it('checks direct rendered literals and a one-hop constant without scanning unrelated code', () => {
    const literal = extension === 'vue' ? '<h1>{{ "Unlock your potential" }}</h1>' : '<h1>{"Unlock your potential"}</h1>';
    const bound = extension === 'vue' ? '<h1>{{ copy }}</h1>' : '<h1>{copy}</h1>';
    expect(check('no-generic-copy', literal, { extension })).toHaveLength(1);
    expect(check('no-generic-copy', bound, { extension, script: 'const copy = "Unlock your potential";' })).toHaveLength(1);
    expect(check('no-placeholder-copy', '<input title="Lorem ipsum" aria-label="[Your Brand]" placeholder="[Company Name]"/>', { extension })).toHaveLength(3);
  });

  it('ignores code examples and explicitly hidden text', () => {
    const markup = '<div><pre><code>🚀 Unlock your potential Lorem ipsum</code></pre><p hidden>🚀 Unlock your potential Lorem ipsum</p></div>';
    for (const ruleName of ['no-emoji-icons', 'no-generic-copy', 'no-placeholder-copy'] as const) expect(check(ruleName, markup, { extension })).toEqual([]);
  });

  it('checks visually present text even when aria-hidden removes it from the accessibility tree', () => {
    const markup = '<span aria-hidden="true">🚀 Unlock your potential Lorem ipsum</span>';
    for (const ruleName of ['no-emoji-icons', 'no-generic-copy', 'no-placeholder-copy'] as const) expect(check(ruleName, markup, { extension })).toHaveLength(1);
  });

  it('does not scan script or style contents as UI copy', () => {
    const markup = extension === 'tsx'
      ? '<div><style>{".x { content: \'🚀 Lorem ipsum Unlock your potential\'; }"}</style><script>{"const example = \'Lorem ipsum\';"}</script><p>Real content</p></div>'
      : extension === 'vue'
        ? '<script setup>const example="🚀 Lorem ipsum Unlock your potential";</script><template><p>Real content</p></template><style>.x { content: "🚀 Lorem ipsum Unlock your potential"; }</style>'
        : '<script>const example="🚀 Lorem ipsum Unlock your potential";</script><p>Real content</p><style>.x { content: "🚀 Lorem ipsum Unlock your potential"; }</style>';
    for (const ruleName of ['no-emoji-icons', 'no-generic-copy', 'no-placeholder-copy'] as const) expect(check(ruleName, markup, { extension, raw: true })).toEqual([]);
  });

  it('allows ordinary symbols and recognizes explicit emoji presentation', () => {
    expect(check('no-emoji-icons', '<p>© 2026 ™ ❤ ☀ 123</p>', { extension })).toEqual([]);
    expect(check('no-emoji-icons', '<p>❤\uFE0F</p>', { extension })).toHaveLength(1);
    expect(check('no-emoji-icons', '<p>&#128640;</p>', { extension })).toHaveLength(1);
  });

  it('uses exact case-insensitive phrase allowances rather than substring suppression', () => {
    expect(check('no-generic-copy', '<h1>UNLOCK   YOUR potential</h1>', { extension, settings: { allowPhrases: ['unlock your potential'] } })).toEqual([]);
    expect(check('no-generic-copy', '<h1>Unlock your potential today</h1>', { extension, settings: { allowPhrases: ['Unlock your potential'] } })).toHaveLength(1);
    expect(check('no-emoji-icons', '<h1>🚀 Launch</h1>', { extension, settings: { allowPhrases: ['🚀 launch'] } })).toEqual([]);
    expect(check('no-generic-copy', '<p>Use the workflow to unlock a file.</p>', { extension })).toEqual([]);
    expect(check('no-generic-copy', '<p>혁신적인 솔루션으로 작업합니다.</p>', { extension })).toHaveLength(1);
  });

  it('allows real fragments and destinations but rejects clearly empty link targets', () => {
    expect(check('no-placeholder-links', '<div><a href="">Empty</a><a href=" JAVASCRIPT:void(0); ">No action</a></div>', { extension })).toHaveLength(2);
    expect(check('no-placeholder-links', '<div><a href="#pricing">Pricing</a><a href="/">Home</a><a href="https://example.com">Visit</a></div>', { extension })).toEqual([]);
    expect(check('no-placeholder-links', '<Link href="#">Read</Link>', { extension })).toHaveLength(1);
    expect(check('no-placeholder-links', '<Link to="#">Read</Link>', { extension })).toHaveLength(1);
    const script = 'import {Link as NavLink} from "react-router-dom";';
    expect(check('no-placeholder-links', '<NavLink to="#">Read</NavLink>', { extension, script })).toHaveLength(1);
    expect(check('no-placeholder-links', '<NavLink to="/path">Read</NavLink>', { extension, script })).toEqual([]);
    expect(check('no-placeholder-links', '<a to="#" href="/path">Read</a>', { extension })).toEqual([]);
  });

  it('limits nested-card findings to explicit Card names or card classes', () => {
    expect(check('no-nested-cards', '<Card><CardHeader>Heading</CardHeader><article>Body</article></Card>', { extension })).toEqual([]);
    const markup = '<div class="card"><article><div class="card">Body</div></article></div>';
    expect(check('no-nested-cards', markup, { extension })).toHaveLength(1);
    expect(check('no-nested-cards', markup, { extension, settings: { allowClasses: ['card'] } })).toEqual([]);
  });

  it('allows ordinary radii, pills, font aliases and declared class exemptions', () => {
    expect(check('no-oversized-radius', '<div class="rounded-2xl rounded-full rounded-[24px] rounded-[var(--radius-card)]">Body</div>', { extension })).toEqual([]);
    expect(check('no-oversized-radius', '<div class="md:rounded-3xl rounded-[32px]">Body</div>', { extension })).toHaveLength(2);
    expect(check('no-oversized-radius', '<div class="md:rounded-3xl">Body</div>', { extension, settings: { allowClasses: ['rounded-3xl'] } })).toEqual([]);
    expect(check('no-generic-fonts', '<p class="font-sans font-mono font-[var(--font-body)]">Body</p>', { extension })).toEqual([]);
    expect(check('no-generic-fonts', '<p class="font-[Inter] font-inter">Body</p>', { extension, settings: { allowFonts: ['INTER'] } })).toEqual([]);
  });
});

describe('content edge cases', () => {
  it('keeps conditional hidden states visible to the check and honors a definite hidden flag', () => {
    expect(check('no-generic-copy', '<h1 hidden={flag ? true : unknown}>Unlock your potential</h1>')).toHaveLength(1);
    expect(check('no-generic-copy', '<h1 hidden={false}>Unlock your potential</h1>')).toHaveLength(1);
    expect(check('no-generic-copy', '<h1 hidden={0}>Unlock your potential</h1>')).toHaveLength(1);
    expect(check('no-generic-copy', '<h1 hidden>Unlock your potential</h1>')).toEqual([]);
    expect(check('no-generic-copy', '<p>Preunlock your potentializer</p>')).toEqual([]);
  });

  it('does not treat JSX in a prop callback as a card child', () => {
    expect(check('no-nested-cards', '<Card onClick={() => <Card/>}/>')).toEqual([]);
    expect(check('no-nested-cards', '<Panel><Panel/></Panel>', { script: 'import {Card as Panel} from "design-system";' })).toHaveLength(1);
  });

  it.each([
    ['tsx', '<div style={{borderRadius:32,fontFamily:"Inter, Arial, sans-serif"}}>Body</div>'],
    ['vue', '<div :style="{borderRadius:32,fontFamily:\'Inter, Arial, sans-serif\'}">Body</div>'],
    ['svelte', '<div style="border-radius:2rem;font-family:Inter, Arial, sans-serif">Body</div>'],
  ] as const)('checks explicit inline radius/font values in %s', (extension, markup) => {
    expect(check('no-oversized-radius', markup, { extension })).toHaveLength(1);
    expect(check('no-generic-fonts', markup, { extension })).toHaveLength(2);
    expect(check('no-generic-fonts', markup, { extension, settings: { allowFonts: ['inter', 'Arial'] } })).toEqual([]);
  });
});
