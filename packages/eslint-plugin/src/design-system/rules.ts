import { ESLintUtils } from '@typescript-eslint/utils';
import { getTailwindRules, matchesFile, validatePolicy, type Policy, type TailwindRuleName } from '@pixelhize/goodui-core';
import { relativePath } from '../resolution.js';
import { baseClass, colorClass, matchesClass, nearest, rawColor, restyleCategory, splitClasses } from './classes.js';
import { componentDetails, preparedProject } from './project.js';
import { createUiVisitors, type AstNode, type ClassSite, type ElementSite, type StyleSite } from './ui.js';
import postcss from 'postcss';
import { selectorClasses } from './classes.js';
import { contextLocale, translatePluginMessage } from '../localization.js';

export interface NativeOptions { rootDir: string; policy: Policy }
const SVG_COLORS = new Set(['fill', 'stroke', 'color', 'stopColor', 'stop-color', 'floodColor', 'flood-color', 'lightingColor', 'lighting-color']);

function nativeRule(name: TailwindRuleName) {
  return ESLintUtils.RuleCreator.withoutDocs<[NativeOptions], 'problem'>({
    meta: {
      type: 'problem', docs: { description: `GoodUI native design-system ${name} contract.` },
      schema: [{ type: 'object', required: ['rootDir', 'policy'], additionalProperties: false, properties: { rootDir: { type: 'string' }, policy: { type: 'object' } } }],
      messages: { problem: '{{detail}}{{note}}' },
    },
    defaultOptions: [{ rootDir: '.', policy: { version: 1, rules: [] } }],
    create(context) {
      const options = context.options[0];
      const locale = contextLocale(context);
      const validation = validatePolicy(options.policy, { locale });
      if (!validation.valid || !validation.policy) throw new Error(translatePluginMessage(`Invalid GoodUI policy: ${validation.errors.join('; ')}`, locale));
      const policy = validation.policy;
      const selected = getTailwindRules(policy);
      if (!selected.includes(name)) return {};
      const file = relativePath(options.rootDir, context.filename);
      if (policy.files && !matchesFile(file, policy.files) || policy.ignores && matchesFile(file, policy.ignores)) return {};
      const exempt = (rule: string) => (policy.exceptions ?? []).some(exception => exception.ruleId === `goodui/${rule}` && matchesFile(file, exception.files));
      if (exempt(name)) return {};
      const project = preparedProject(context);
      const config = project.options;
      const reported = new Set<string>();
      const pending = new Map<string, AstNode[]>();
      const localClasses = new Set<string>();
      const primary = ['no-unknown-classes', ...selected].find(rule => selected.includes(rule as TailwindRuleName) && !exempt(rule));
      const note = config.note ? ` ${config.note}` : '';
      function report(node: AstNode, detail: string, token = ''): void {
        const key = `${node.range?.join(':') ?? `${node.loc?.start.line}:${node.loc?.start.column}`}:${token}:${detail}`;
        if (reported.has(key)) return;
        reported.add(key);
        context.report({ node: node as any, messageId: 'problem', data: { detail: translatePluginMessage(detail, locale), note } });
      }
      function colorAdvice(utility = 'bg'): string {
        const names = [...project.colors.keys()].sort().flatMap(token => {
          const base = `${utility}-${token}`;
          const candidates = project.prefixes.length ? [...project.prefixes.map(prefix => `${prefix}:${base}`), base] : [base];
          return project.systems.length ? candidates.filter(candidate => project.systems.some(compiler => compiler.candidatesToCss([candidate])[0])).slice(0, 1) : candidates.slice(0, 1);
        }).slice(0, 6);
        const theme = project.entries[0] ? relativePath(project.root, project.entries[0]) : 'the project theme CSS';
        return translatePluginMessage(names.length ? `Use a declared token such as ${names.join(', ')} from ${theme}.` : `No approved color token is available in ${theme}; ask the project maintainer which existing treatment to use.`, locale);
      }
      function recognized(site: ElementSite | undefined) { return site?.component ? componentDetails(project, site.component, context.filename) : undefined; }
      function classes(site: ClassSite): void {
        const component = (name === 'no-restyle' || name === 'require-static-classes') ? recognized(site.element) : undefined;
        if (name === 'require-static-classes' && site.dynamic) report(site.node, `Cannot determine all classes${site.element ? ` on <${component?.name ?? site.element.name}>` : ' in this helper call'}. Use literal alternatives, a supported class helper, or a one-hop const value.`);
        for (const part of site.parts) for (const token of splitClasses(part.value)) {
          if (matchesClass(token, config.denyClasses)) {
            if (name === primary) report(part.node, `Class ${JSON.stringify(token)} is forbidden by tailwind.denyClasses. Use an approved design token or component variant.`, token);
            continue;
          }
          if (matchesClass(token, config.allowClasses)) continue;
          if (name === 'no-raw-colors') {
            const color = colorClass(token);
            if (color.raw && (!color.color || !project.colors.has(color.color))) report(part.node, `${JSON.stringify(token)} hardcodes a color. ${colorAdvice(color.utility)}`, token);
          }
          if (name === 'no-arbitrary-values') {
            const base = baseClass(token);
            if ((/-\[/.test(base) || base.startsWith('[')) && !matchesClass(token, config.allowArbitrary)) {
              const prefix = /^(-?[\w-]+)-\[/.exec(base)?.[1];
              report(part.node, `${JSON.stringify(token)} embeds an arbitrary value. Use a named theme token${prefix ? ` or an approved ${prefix}-* scale utility` : ''}.`, token);
            }
          }
          if (name === 'no-restyle' && component) {
            const category = restyleCategory(token);
            if (category) {
              const variants = category === 'size and internal spacing' ? component.sizes : component.variants;
              const axis = category === 'size and internal spacing' ? 'size' : 'variant';
              const location = component.file ? ` in ${relativePath(project.root, component.file)}` : '';
              const otherAxis = Object.entries(component.axes ?? {}).find(([name, values]) => name !== 'size' && values.length > 0);
              const koreanLocation = component.file ? ` (${relativePath(project.root, component.file)})` : '';
              const advice = locale === 'ko'
                ? variants.length ? `${axis}: ${variants.join(', ')}을(를) 사용하세요${koreanLocation}.` : otherAxis ? `${otherAxis[0]}: ${otherAxis[1].join(', ')}을(를) 사용하세요${koreanLocation}.` : `기존 컴포넌트 표현을 사용하세요${koreanLocation}. 맞는 표현이 없다면 관리자에게 확인하세요.`
                : variants.length ? `Use ${axis}: ${variants.join(', ')}${location}.` : otherAxis ? `Use ${otherAxis[0]}: ${otherAxis[1].join(', ')}${location}.` : `Use an existing component treatment${location}; ask the maintainer if none applies.`;
              report(part.node, `${JSON.stringify(token)} changes ${category} on <${component.name}>. ${advice} Keep placement and outer spacing on the parent or margin utilities.`, token);
            }
          }
          if (name === 'no-unknown-classes') {
            const marker = project.prefixes.reduce((value, prefix) => value.startsWith(`${prefix}:`) ? value.slice(prefix.length + 1) : value, token);
            if (/^(?:group|peer)(?:\/[\w-]+)?$/.test(marker) || marker === 'dark' || project.declaredClasses.has(token)) continue;
            const nodes = pending.get(token) ?? [];
            nodes.push(part.node);
            pending.set(token, nodes);
          }
        }
      }
      function styles(site: StyleSite): void {
        if (name === 'no-inline-styles') {
          if (site.dynamic) report(site.node, 'Cannot verify this dynamic inline style. Use classes or an explicit object containing CSS custom properties only.');
          for (const property of site.properties) if (!property.name.startsWith('--')) report(property.node, `Inline style sets ${JSON.stringify(property.name)}. Use a design-system class; reserve inline style objects for CSS custom properties.`);
        }
        if (name === 'no-raw-colors') for (const property of site.properties) for (const value of property.values) {
          if (typeof value === 'string' && rawColor(value)) report(property.node, `Inline ${JSON.stringify(property.name)} hardcodes color ${JSON.stringify(value)}. ${colorAdvice()}`);
        }
      }
      const visitors = createUiVisitors(context, {
        classFunctions: config.classFunctions, variantFunctions: config.variantFunctions, onClassSite: classes, onStyleSite: styles,
        onElement(site) {
          if (name !== 'no-raw-colors') return;
          for (const attribute of site.attributes) if (SVG_COLORS.has(attribute.name)) for (const value of attribute.values) {
            if (typeof value === 'string' && rawColor(value)) report(attribute.node, `${attribute.name}=${JSON.stringify(value)} hardcodes a color. Use currentColor or a declared --color-* variable. ${colorAdvice()}`);
          }
        },
        onStyleBlock(node) {
          if (name === 'no-inline-styles') report(node, 'Local <style> elements/blocks are disallowed here. Use existing design-system classes or components.');
          if (name === 'no-unknown-classes' || name === 'no-raw-colors') {
            const text = context.sourceCode.getText(node as any);
            const body = /^<style\b[^>]*>([\s\S]*)<\/style\s*>$/i.exec(text)?.[1];
            if (!body) return;
            try {
              const css = postcss.parse(body);
              css.walkRules(rule => { selectorClasses(rule.selector).forEach(value => localClasses.add(value)); });
              if (name === 'no-raw-colors') css.walkDecls(declaration => { if (rawColor(declaration.value)) report(node, `Local CSS ${declaration.prop} hardcodes ${JSON.stringify(declaration.value)}. ${colorAdvice()}`); });
            } catch { report(node, 'Cannot parse this local CSS block to verify the design-system contract.'); }
          }
        },
      });
      const exit = visitors['Program:exit'];
      visitors['Program:exit'] = (node: AstNode) => {
        exit?.(node);
        if (name !== 'no-unknown-classes' || pending.size === 0) return;
        const candidates = [...pending.keys()];
        const valid = new Set<string>();
        for (const compiler of project.systems) compiler.candidatesToCss(candidates).forEach((css, index) => { if (css) valid.add(candidates[index]!); });
        const invalid = candidates.filter(token => !valid.has(token) && !localClasses.has(token));
        if (!invalid.length) return;
        const vocabulary = (project.vocabulary ??= [...project.declaredClasses, ...project.systems.flatMap(compiler => compiler.getClassList().map(entry => compiler.theme?.prefix && !entry[0].startsWith(`${compiler.theme.prefix}:`) ? `${compiler.theme.prefix}:${entry[0]}` : entry[0]))]).filter(candidate => {
          if (matchesClass(candidate, config.denyClasses)) return false;
          const color = colorClass(candidate);
          return !selected.includes('no-raw-colors') || exempt('no-raw-colors') || matchesClass(candidate, config.allowClasses) || !color.raw || !!color.color && project.colors.has(color.color);
        });
        for (const token of invalid) {
          const nearby = nearest(baseClass(token), vocabulary, 8);
          const usable = new Set(nearby.filter(candidate => project.declaredClasses.has(candidate)));
          for (const compiler of project.systems) compiler.candidatesToCss(nearby).forEach((css, index) => { if (css) usable.add(nearby[index]!); });
          const alternatives = nearby.filter(candidate => usable.has(candidate)).slice(0, 2);
          for (const at of pending.get(token)!) report(at, `Tailwind generates no CSS for ${JSON.stringify(token)}.${alternatives.length ? ` Check spelling or use ${alternatives.map(value => JSON.stringify(value)).join(', ')}.` : ' Use a class declared by the project theme.'}`, token);
        }
      };
      return visitors;
    },
  });
}

export const nativeRules = {
  'no-raw-colors': nativeRule('no-raw-colors'),
  'no-arbitrary-values': nativeRule('no-arbitrary-values'),
  'no-inline-styles': nativeRule('no-inline-styles'),
  'no-unknown-classes': nativeRule('no-unknown-classes'),
  'no-restyle': nativeRule('no-restyle'),
  'require-static-classes': nativeRule('require-static-classes'),
};
