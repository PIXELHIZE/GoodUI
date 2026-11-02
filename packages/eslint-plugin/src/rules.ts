import { isRuleApplicable, matchesFile, matchesPattern, validatePolicy, type Policy, type PolicyRule } from '@pixelhize/goodui-core';
import { ESLintUtils, type TSESLint } from '@typescript-eslint/utils';
import { resolve } from 'node:path';
import { createImportResolver, relativePath } from './resolution.js';
import { contextLocale, translatePluginMessage } from './localization.js';

// Each parser extends ESTree with its own template nodes. This adapter type keeps
// those extensions at the traversal boundary, outside the policy representation.
type Node = { type: string; [key: string]: any };
type Kind = PolicyRule['kind'];
export interface RuleOptions { rootDir: string; policy: Policy }
type Context = TSESLint.RuleContext<'violation', [RuleOptions]>;
type Reference = { kind: 'global'; path: string } | { kind: 'import'; source: string; path: string } | { kind: 'local' };
interface UiAttribute { name: string; node: Node }
interface UiElement { name: string; node: Node; attributes: UiAttribute[]; unknownSpread: boolean; component?: Node }

function unwrap(node: Node | null | undefined): Node | undefined {
  while (node && ['ChainExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSInstantiationExpression', 'TSSatisfiesExpression'].includes(node.type)) node = node.expression;
  return node ?? undefined;
}

function staticString(input: Node | null | undefined): string | undefined {
  const node = unwrap(input);
  if (!node) return undefined;
  if (node.type === 'TSLiteralType') return staticString(node.literal);
  if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left), right = staticString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

function propertyName(node: Node): string | undefined {
  if (!node.computed && ['Identifier', 'PrivateIdentifier', 'SvelteName'].includes(node.property?.type)) return node.property.name;
  return staticString(node.property);
}

function nameOf(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (['Identifier', 'JSXIdentifier', 'SvelteName'].includes(node.type)) return node.name;
  if (['JSXMemberExpression', 'SvelteMemberExpressionName'].includes(node.type)) {
    const object = nameOf(node.object), property = nameOf(node.property);
    return object && property ? `${object}.${property}` : undefined;
  }
  return undefined;
}

function canonicalAttribute(name: string): string {
  if (name === 'className') return 'class';
  if (name === 'htmlFor') return 'for';
  if (name.startsWith('v-bind:')) return name.slice(7);
  if (name.startsWith(':')) return name.slice(1);
  if (name.startsWith('v-on:')) return `on:${name.slice(5).toLowerCase()}`;
  if (name.startsWith('@')) return `on:${name.slice(1).toLowerCase()}`;
  if (name.startsWith('on:')) return name.toLowerCase();
  if (/^on[A-Z]/.test(name) || /^on[a-z]/.test(name)) return `on:${name.slice(2).toLowerCase()}`;
  return name;
}

function matches(value: string, patterns: readonly string[] | undefined): boolean { return !!patterns?.length && matchesPattern(value, patterns); }

function createContractRule(kind: Kind) {
  return ESLintUtils.RuleCreator.withoutDocs<[RuleOptions], 'violation'>({
    meta: {
      type: 'problem',
      docs: { description: `Enforce GoodUI ${kind} project contracts.` },
      schema: [{ type: 'object', properties: { rootDir: { type: 'string' }, policy: { type: 'object' } }, required: ['rootDir', 'policy'], additionalProperties: false }],
      messages: { violation: '{{prefix}}{{detail}} {{reasonLabel}}: {{reason}}{{suggestion}}' },
    },
    defaultOptions: [{ rootDir: '.', policy: { version: 1, rules: [] } }],
    create(context) {
      const options = context.options[0];
      const validation = validatePolicy(options?.policy, { locale: contextLocale(context) });
      if (!validation.valid || !validation.policy) throw new Error(translatePluginMessage(`Invalid GoodUI policy: ${validation.errors.join('; ')}`, contextLocale(context)));
      const root = resolve(options.rootDir);
      const file = relativePath(root, context.filename);
      const rules = validation.policy.rules.filter(rule => rule.kind === kind && isRuleApplicable(validation.policy!, rule, file) && (rule.kind !== 'import-boundaries' || matchesFile(file, rule.from)));
      if (!rules.length) return {};
      return createVisitors(context, rules, root, file, kind);
    },
  });
}

function createVisitors(context: Context, rules: PolicyRule[], root: string, file: string, kind: Kind): TSESLint.RuleListener {
  const source = context.sourceCode;
  const imports = new Map<string, Reference>();
  const readIdentifiers = new WeakSet<object>();
  for (const scope of source.scopeManager?.scopes ?? []) {
    for (const ref of scope.references) if (ref.isRead()) readIdentifiers.add(ref.identifier);
  }
  const resolveImport = kind === 'import-boundaries' ? createImportResolver(root) : undefined;

  function report(rule: PolicyRule, node: Node, detail: string): void {
    const locale = contextLocale(context);
    context.report({ node: node as any, messageId: 'violation', data: {
      prefix: `[${rule.id}] `, detail: translatePluginMessage(detail, locale), reason: rule.reason,
      reasonLabel: locale === 'ko' ? '이유' : 'Reason',
      suggestion: rule.suggestion ? ` ${locale === 'ko' ? '제안' : 'Suggestion'}: ${rule.suggestion}` : '',
    } });
  }

  function templateShadows(name: string, at: Node): boolean {
    for (let current: Node | undefined = at; current; current = current.parent) {
      if (current.type === 'VElement' && current.variables?.some((variable: any) => variable.id?.name === name)) return true;
    }
    return false;
  }

  function getVariable(name: string, at: Node): any {
    let scope: any;
    try { scope = source.getScope(at as any); } catch { return undefined; }
    for (; scope; scope = scope.upper) {
      const variable = scope.set?.get(name);
      if (variable) return variable;
    }
    return undefined;
  }

  function reference(input: Node | undefined, at: Node, depth = 0): Reference {
    const node = unwrap(input);
    if (!node || depth > 12) return { kind: 'local' };
    if (node.type === 'CallExpression') {
      const callee = reference(node.callee, node, depth + 1);
      const specifier = staticString(node.arguments?.[0]);
      if (callee.kind === 'global' && callee.path === 'require' && specifier !== undefined) return { kind: 'import', source: specifier, path: 'default' };
      return { kind: 'local' };
    }
    if (['MemberExpression', 'OptionalMemberExpression', 'JSXMemberExpression', 'SvelteMemberExpressionName'].includes(node.type)) {
      const base = reference(node.object, at, depth + 1);
      const property = node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression' ? propertyName(node) : nameOf(node.property);
      if (!property || base.kind === 'local') return { kind: 'local' };
      return { ...base, path: base.path ? `${base.path}.${property}` : property };
    }
    if (!['Identifier', 'JSXIdentifier'].includes(node.type)) return { kind: 'local' };
    const name = node.name as string;
    if (templateShadows(name, at)) return { kind: 'local' };
    const variable = getVariable(name, at);
    if (variable?.defs?.length) {
      const definition = variable.defs[0];
      if (definition.type === 'ImportBinding') {
        const declaration = definition.parent;
        const specifier = definition.node;
        if (specifier.type === 'TSImportEqualsDeclaration') {
          const source = staticString(specifier.moduleReference.expression);
          return source === undefined ? { kind: 'local' } : { kind: 'import', source, path: 'default' };
        }
        const imported = specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.type === 'ImportNamespaceSpecifier' ? '' : specifier.imported.name ?? specifier.imported.value;
        return { kind: 'import', source: declaration.source.value, path: imported };
      }
      if (definition.type === 'Variable' && definition.parent?.kind === 'const' && definition.node?.init) {
        const declarator = definition.node;
        const resolved = reference(declarator.init, declarator.init, depth + 1);
        if (declarator.id.type === 'Identifier') return resolved;
        if (declarator.id.type === 'ObjectPattern' && resolved.kind !== 'local') {
          const property = declarator.id.properties.find((prop: Node) => prop.type === 'Property' && (prop.value.type === 'Identifier' ? prop.value.name : prop.value.left?.name) === name);
          if (property) {
            const key = property.computed ? staticString(property.key) : property.key.name ?? property.key.value;
            if (typeof key === 'string') return { ...resolved, path: resolved.path ? `${resolved.path}.${key}` : key };
          }
        }
      }
      return { kind: 'local' };
    }
    if (imports.has(name)) return imports.get(name)!;
    return { kind: 'global', path: name };
  }

  function importEdge(node: Node, expression: Node | undefined): void {
    const specifier = staticString(expression);
    for (const rule of rules) {
      if (rule.kind === 'restricted-imports') {
        if (specifier === undefined) report(rule, node, 'The dynamic module specifier cannot be checked statically; use a literal or a reasoned policy exception.');
        else if (matches(specifier, rule.modules)) report(rule, node, `Importing ${JSON.stringify(specifier)} is forbidden.`);
      } else if (rule.kind === 'import-boundaries' && matchesFile(file, rule.from)) {
        if (specifier === undefined) { report(rule, node, 'The dynamic dependency cannot be checked against the import boundary.'); continue; }
        let target: string;
        try { target = resolveImport!(specifier, context.filename); }
        catch (error) { report(rule, node, error instanceof Error ? error.message : 'The dependency cannot be resolved.'); continue; }
        if ((rule.disallow && matchesFile(target, rule.disallow)) || (rule.allow && !matchesFile(target, rule.allow))) report(rule, node, `Import from ${JSON.stringify(file)} to ${JSON.stringify(target)} violates the dependency boundary.`);
      }
    }
  }

  function recordImport(node: Node): void {
    for (const specifier of node.specifiers ?? []) {
      const path = specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.type === 'ImportNamespaceSpecifier' ? '' : specifier.imported?.name ?? specifier.imported?.value;
      imports.set(specifier.local.name, { kind: 'import', source: node.source.value, path });
    }
    if (kind === 'restricted-imports' || kind === 'import-boundaries') importEdge(node.source, node.source);
  }

  function apiNames(ref: Extract<Reference, { kind: 'import' }>): string[] {
    return ref.path.startsWith('default.') ? [ref.path, ref.path.slice(8)] : [ref.path || '*'];
  }

  function prefixes(path: string): string[] { return path.split('.').map((_part, index, parts) => parts.slice(0, index + 1).join('.')); }

  function checkCall(node: Node): void {
    const ref = reference(node.callee, node);
    if ((kind === 'restricted-imports' || kind === 'import-boundaries') && ref.kind === 'global' && ref.path === 'require') {
      importEdge(node, node.arguments?.[0]);
    }
    if (kind === 'restricted-api' && unwrap(node.callee)?.type === 'CallExpression' && ref.kind === 'import') checkApiUsage(node, ref);
  }

  function checkApiReference(node: Node): void {
    if (kind !== 'restricted-api') return;
    for (let current: Node | undefined = node.parent; current; current = current.parent) {
      if (current.type.startsWith('TS') && !['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSInstantiationExpression', 'TSSatisfiesExpression', 'TSModuleBlock', 'TSModuleDeclaration', 'TSEnumDeclaration', 'TSEnumBody', 'TSEnumMember', 'TSParameterProperty', 'TSExportAssignment'].includes(current.type)) return;
    }
    // Evaluate the outermost member chain, not its object identifiers or property names.
    if (node.parent?.type === 'MemberExpression' && node.parent.object === node) return;
    let base = node;
    while (base.type === 'MemberExpression') base = base.object;
    if (base.type !== 'Identifier' && base.type !== 'CallExpression') return;
    let isRead = base.type === 'CallExpression' ? reference(base, base).kind === 'import' : readIdentifiers.has(base);
    if (!isRead) {
      // Vue's template scopes are stored separately from the script scope manager.
      for (let current: Node | undefined = base; current; current = current.parent) {
        if (current.type === 'VExpressionContainer' && current.references?.some((ref: any) => ref.id === base && ref.mode !== 'w')) { isRead = true; break; }
      }
    }
    if (!isRead) return;
    const ref = reference(node, node);
    checkApiUsage(node, ref);
  }

  function checkApiUsage(node: Node, ref: Reference): void {
    for (const rule of rules) {
      if (rule.kind !== 'restricted-api') continue;
      if (ref.kind === 'global') {
        const paths = [ref.path, ref.path.replace(/^(globalThis|window|self)\./, '')].flatMap(prefixes);
        if (paths.some(path => matches(path, rule.globals))) report(rule, node, `Using global API ${JSON.stringify(ref.path)} is forbidden.`);
      } else if (ref.kind === 'import' && rule.imports?.some(entry => matches(ref.source, [entry.source]) && apiNames(ref).flatMap(prefixes).some(name => matches(name, entry.names)))) {
        report(rule, node, `Using ${JSON.stringify(ref.path || '*')} from ${JSON.stringify(ref.source)} is forbidden.`);
      }
    }
  }

  function objectAttributes(expression: Node | undefined, attributes: UiAttribute[]): boolean {
    const node = unwrap(expression);
    if (!node || node.type !== 'ObjectExpression') return false;
    let known = true;
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') { known = objectAttributes(property.argument, attributes) && known; continue; }
      const key = property.computed ? staticString(property.key) : property.key.name ?? property.key.value;
      if (typeof key === 'string') attributes.push({ name: canonicalAttribute(key), node: property });
      else known = false;
    }
    return known;
  }

  function jsxElement(node: Node): void {
    const open = node.openingElement;
    const element: UiElement = { name: nameOf(open.name) ?? '', node: open.name, component: open.name, attributes: [], unknownSpread: false };
    for (const attribute of open.attributes) {
      if (attribute.type === 'JSXSpreadAttribute') { element.unknownSpread = !objectAttributes(attribute.argument, element.attributes) || element.unknownSpread; continue; }
      const name = attribute.name.type === 'JSXNamespacedName' ? `${attribute.name.namespace.name}:${attribute.name.name.name}` : attribute.name.name;
      element.attributes.push({ name: canonicalAttribute(name), node: attribute });
    }
    checkUi(element);
  }

  function vueElement(node: Node): void {
    const name = node.rawName ?? node.name;
    const element: UiElement = { name, node, attributes: [], unknownSpread: false };
    for (const attribute of node.startTag.attributes) {
      if (!attribute.directive) { element.attributes.push({ name: canonicalAttribute(attribute.key.rawName ?? attribute.key.name), node: attribute }); continue; }
      const directive = attribute.key.name.name;
      const argument = attribute.key.argument;
      if (directive === 'bind' && !argument) {
        element.unknownSpread = !objectAttributes(attribute.value?.expression, element.attributes) || element.unknownSpread;
      } else if (directive === 'bind') {
        const key = argument.type === 'VIdentifier' ? argument.rawName ?? argument.name : staticString(argument.expression);
        if (key) element.attributes.push({ name: canonicalAttribute(key), node: attribute });
        else element.unknownSpread = true;
      } else if (directive === 'on' && argument?.type === 'VIdentifier') {
        element.attributes.push({ name: canonicalAttribute(`@${argument.name}`), node: attribute });
      } else if (directive === 'html') {
        element.attributes.push({ name: 'v-html', node: attribute });
      }
    }
    if (name === 'component') {
      const dynamic = node.startTag.attributes.find((attribute: Node) => attribute.directive && attribute.key.name.name === 'bind' && attribute.key.argument?.name === 'is');
      if (dynamic?.value?.expression) element.component = dynamic.value.expression;
    }
    checkUi(element);
  }

  function svelteElement(node: Node): void {
    const element: UiElement = { name: nameOf(node.name) ?? '', node: node.name, component: node.kind === 'component' ? node.name : undefined, attributes: [], unknownSpread: false };
    for (const attribute of node.startTag.attributes) {
      if (attribute.type === 'SvelteSpreadAttribute') { element.unknownSpread = !objectAttributes(attribute.argument, element.attributes) || element.unknownSpread; continue; }
      if (attribute.type === 'SvelteStyleDirective') { element.attributes.push({ name: 'style', node: attribute }); continue; }
      if (attribute.type === 'SvelteDirective') {
        if (attribute.kind === 'EventHandler') element.attributes.push({ name: canonicalAttribute(`on:${attribute.key.name.name}`), node: attribute });
        continue;
      }
      if (attribute.type === 'SvelteSpecialDirective' && attribute.kind === 'this') { element.component = attribute.expression; continue; }
      if (attribute.type === 'SvelteAttribute' || attribute.type === 'SvelteShorthandAttribute') element.attributes.push({ name: canonicalAttribute(attribute.key.name), node: attribute });
    }
    checkUi(element);
  }

  function componentReference(element: UiElement): Reference {
    if (element.component) return reference(element.component, element.node);
    const candidates = [element.name, element.name.replace(/(^|-)(\w)/g, (_match, _prefix: string, value: string) => value.toUpperCase())];
    for (const name of candidates) {
      const ref = reference({ type: 'Identifier', name }, element.node);
      if (ref.kind === 'import') return ref;
    }
    return { kind: 'local' };
  }

  function checkUi(element: UiElement): void {
    const ref = componentReference(element);
    for (const rule of rules) {
      if (rule.kind !== 'restricted-ui') continue;
      if (matches(element.name, rule.tags)) report(rule, element.node, `UI tag ${JSON.stringify(element.name)} is forbidden.`);
      if (ref.kind === 'import' && rule.components?.some(entry => matches(ref.source, [entry.source]) && apiNames(ref).some(name => matches(name || '*', entry.names)))) {
        report(rule, element.node, `Component ${JSON.stringify(ref.path || '*')} from ${JSON.stringify(ref.source)} is forbidden.`);
      }
      for (const attribute of element.attributes) {
        if (rule.attributes?.some(pattern => matches(attribute.name, [canonicalAttribute(pattern)]))) report(rule, attribute.node, `UI attribute ${JSON.stringify(attribute.name)} is forbidden.`);
        if (rule.features?.includes('inline-style') && attribute.name === 'style') report(rule, attribute.node, 'Inline styles are forbidden.');
        if (rule.features?.includes('raw-html') && ['dangerouslySetInnerHTML', 'v-html'].includes(attribute.name)) report(rule, attribute.node, 'Raw HTML insertion is forbidden.');
      }
      if (element.unknownSpread && (rule.attributes?.length || rule.features?.length)) report(rule, element.node, 'Dynamic attributes cannot be checked against the UI attribute/feature contract; use explicit attributes or a reasoned policy exception.');
    }
  }

  const script: Record<string, (node: any) => void> = {
    ImportDeclaration: recordImport,
    ExportNamedDeclaration(node) { if (node.source && (kind === 'restricted-imports' || kind === 'import-boundaries')) importEdge(node.source, node.source); },
    ExportAllDeclaration(node) { if (kind === 'restricted-imports' || kind === 'import-boundaries') importEdge(node.source, node.source); },
    ImportExpression(node) { if (kind === 'restricted-imports' || kind === 'import-boundaries') importEdge(node, node.source); },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type !== 'TSExternalModuleReference') return;
      const specifier = staticString(node.moduleReference.expression);
      if (specifier !== undefined) imports.set(node.id.name, { kind: 'import', source: specifier, path: 'default' });
      if (kind === 'restricted-imports' || kind === 'import-boundaries') importEdge(node, node.moduleReference.expression);
    },
    TSImportType(node) { if (kind === 'restricted-imports' || kind === 'import-boundaries') importEdge(node, node.source ?? node.argument); },
    CallExpression: checkCall,
    NewExpression: checkCall,
  };
  if (kind === 'restricted-ui') {
    script.JSXElement = jsxElement;
    script.SvelteElement = svelteElement;
    script.SvelteMustacheTag = node => {
      if (node.kind === 'raw') for (const rule of rules) if (rule.kind === 'restricted-ui' && rule.features?.includes('raw-html')) report(rule, node, 'Raw HTML insertion is forbidden.');
    };
  }
  if (kind === 'restricted-api') { script.Identifier = checkApiReference; script.MemberExpression = checkApiReference; }
  const services = source.parserServices as any;
  if (services?.defineTemplateBodyVisitor) {
    const template = { ...script };
    if (kind === 'restricted-ui') template.VElement = vueElement;
    return services.defineTemplateBodyVisitor(template, script) as TSESLint.RuleListener;
  }
  return script as TSESLint.RuleListener;
}

export const rules = {
  'restricted-imports': createContractRule('restricted-imports'),
  'restricted-api': createContractRule('restricted-api'),
  'import-boundaries': createContractRule('import-boundaries'),
  'restricted-ui': createContractRule('restricted-ui'),
};
