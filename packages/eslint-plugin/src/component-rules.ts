import { isRuleApplicable, matchesPattern, validatePolicy, type ComponentContractsRule, type StaticPropValue } from '@pixelhize/goodui-core';
import { ESLintUtils } from '@typescript-eslint/utils';
import { resolve } from 'node:path';
import type { RuleOptions } from './rules.js';
import { relativePath } from './resolution.js';
import { createUiVisitors, type ElementSite } from './design-system/ui.js';
import { contextLocale, translatePluginMessage } from './localization.js';

function canonicalProp(name: string): string {
  if (name === 'className') return 'class';
  if (name === 'htmlFor') return 'for';
  if (name.startsWith('v-bind:')) return name.slice(7);
  if (name.startsWith(':')) return name.slice(1);
  if (name.startsWith('v-on:')) return `on:${name.slice(5).toLowerCase()}`;
  if (name.startsWith('@')) return `on:${name.slice(1).toLowerCase()}`;
  if (name.startsWith('on:')) return name.toLowerCase();
  if (/^on[A-Za-z]/.test(name)) return `on:${name.slice(2).toLowerCase()}`;
  return name;
}

function matches(value: string, patterns: readonly string[] | undefined): boolean {
  return !!patterns?.length && matchesPattern(value, patterns);
}

/** Nonempty props contain a nonblank string or a finite number, not null/boolean. */
function nonEmpty(value: StaticPropValue | undefined): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' && Number.isFinite(value);
}

export const componentRules = {
  'component-contracts': ESLintUtils.RuleCreator.withoutDocs<[RuleOptions], 'violation'>({
    meta: {
      type: 'problem',
      docs: { description: 'Enforce explicit project component prop contracts across JSX, Vue and Svelte.' },
      schema: [{ type: 'object', required: ['rootDir', 'policy'], additionalProperties: false, properties: { rootDir: { type: 'string' }, policy: { type: 'object' } } }],
      messages: { violation: '[{{id}}] {{detail}} {{reasonLabel}}: {{reason}}{{suggestion}}' },
    },
    defaultOptions: [{ rootDir: '.', policy: { version: 1, rules: [] } }],
    create(context) {
      const options = context.options[0];
      const validation = validatePolicy(options?.policy, { locale: contextLocale(context) });
      if (!validation.valid || !validation.policy) throw new Error(translatePluginMessage(`Invalid GoodUI policy: ${validation.errors.join('; ')}`, contextLocale(context)));
      const root = resolve(options.rootDir);
      const file = relativePath(root, context.filename);
      const rules = validation.policy.rules.filter((rule): rule is ComponentContractsRule => rule.kind === 'component-contracts' && isRuleApplicable(validation.policy!, rule, file));
      if (!rules.length) return {};

      function report(rule: ComponentContractsRule, node: ElementSite['node'], detail: string): void {
        const locale = contextLocale(context);
        context.report({ node: node as any, messageId: 'violation', data: {
          id: rule.id, detail: translatePluginMessage(detail, locale), reason: rule.reason, reasonLabel: locale === 'ko' ? '이유' : 'Reason', suggestion: rule.suggestion ? ` ${locale === 'ko' ? '제안' : 'Suggestion'}: ${rule.suggestion}` : '',
        } });
      }

      return createUiVisitors(context, {
        onElement(site) {
          const attributes = new Map(site.attributes.map(attribute => [canonicalProp(attribute.name), attribute]));
          for (const rule of rules) {
            const imported = site.component;
            const target = matches(site.name, rule.tags) || !!imported && rule.components?.some(entry => matches(imported.source, [entry.source]) && matches(imported.name, entry.names));
            if (!target) continue;
            const allowDynamic = rule.allowDynamicProps === true;
            if (site.unknownSpread && !allowDynamic) {
              report(rule, site.node, `Dynamic prop spread on ${JSON.stringify(site.name)} cannot be verified; use explicit props or allowDynamicProps.`);
            }
            for (const name of rule.requiredProps ?? []) {
              if (!attributes.has(canonicalProp(name)) && !site.unknownSpread) report(rule, site.node, `Component ${JSON.stringify(site.name)} requires prop ${JSON.stringify(name)}.`);
            }
            const forbidden = new Set((rule.forbiddenProps ?? []).map(canonicalProp));
            const nonEmptyNames = new Set((rule.nonEmptyProps ?? []).map(canonicalProp));
            const required = new Set((rule.requiredProps ?? []).map(canonicalProp));
            const allowedValues = new Map(Object.entries(rule.propValues ?? {}).map(([name, values]) => [canonicalProp(name), values]));
            for (const [name, attribute] of attributes) {
              if (forbidden.has(name)) {
                report(rule, attribute.node, `Prop ${JSON.stringify(name)} is forbidden on ${JSON.stringify(site.name)}.`);
                continue;
              }
              const values = allowedValues.get(name);
              const checked = required.has(name) || nonEmptyNames.has(name) || values !== undefined;
              if (!checked) continue;
              if (attribute.dynamic && !allowDynamic) report(rule, attribute.node, `Dynamic value of prop ${JSON.stringify(name)} cannot be verified; use a static value or allowDynamicProps.`);
              if (nonEmptyNames.has(name) && attribute.values.some(value => !nonEmpty(value))) {
                report(rule, attribute.node, `Prop ${JSON.stringify(name)} must contain a nonblank string or number.`);
              }
              if (values && attribute.values.some(value => !values.some(allowed => Object.is(value, allowed)))) {
                report(rule, attribute.node, `Prop ${JSON.stringify(name)} must be one of ${JSON.stringify(values)}.`);
              }
            }
          }
        },
      });
    },
  }),
};
