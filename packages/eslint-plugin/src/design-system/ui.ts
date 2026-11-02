import { classValues, constantInitializer, evaluateValues, expressionName, propertyName, resolveBinding, unwrap, type AstNode, type ClassValues, type ImportedBinding, type ScalarValue } from './values.js';
export { evaluateValues, resolveBinding } from './values.js';
export type { AstNode, ScalarValue } from './values.js';

export interface AttributeSite { name: string; node: AstNode; values: ScalarValue[]; dynamic: boolean; expression?: AstNode; value?: unknown; known: boolean }
export interface ElementSite { name: string; node: AstNode; attributes: AttributeSite[]; unknownSpread: boolean; component?: ImportedBinding }
export interface ClassSite extends ClassValues { node: AstNode; element?: ElementSite }
export interface StyleSite { node: AstNode; properties: AttributeSite[]; dynamic: boolean }
export interface UiCallbacks {
  onText?(node: AstNode, text: string): void;
  onElement?(site: ElementSite): void;
  onClassSite?(site: ClassSite): void;
  onStyleSite?(site: StyleSite): void;
  onStyleBlock?(node: AstNode): void;
  classFunctions?: string[];
  variantFunctions?: string[];
}

/** Text-only visibility guard. It does not infer CSS or execute render functions. */
export function isVisibleUiText(context: any, node: AstNode): boolean {
  for (let ancestor: AstNode | undefined = node; ancestor; ancestor = ancestor.parent) {
    if (['SvelteStyleElement', 'SvelteScriptElement'].includes(ancestor.type)) return false;
    const attrs = ancestor.type === 'JSXElement' ? ancestor.openingElement.attributes
      : ancestor.type === 'VElement' || ancestor.type === 'SvelteElement' ? ancestor.startTag.attributes : undefined;
    if (!attrs) continue;
    const name = ancestor.type === 'JSXElement' ? expressionName(ancestor.openingElement.name)
      : ancestor.type === 'VElement' ? ancestor.rawName ?? ancestor.name : expressionName(ancestor.name);
    if (['script', 'style', 'pre', 'code'].includes(name ?? '')) return false;
    for (const attr of attrs) {
      let key: string | undefined, values: ScalarValue[] = [], dynamic = false;
      if (attr.type === 'JSXAttribute') {
        key = attr.name.name;
        if (!attr.value) values = [true];
        else if (attr.value.type === 'JSXExpressionContainer') ({ values, dynamic } = evaluateValues(context, attr.value.expression));
        else values = [attr.value.value];
      } else if (attr.type === 'VAttribute') {
        key = attr.directive ? attr.key.name.name === 'bind' ? attr.key.argument?.name : undefined : attr.key.name;
        if (attr.directive) ({ values, dynamic } = evaluateValues(context, attr.value?.expression));
        else values = [attr.value ? attr.value.value : true];
      } else if (attr.type === 'SvelteAttribute') {
        key = attr.key.name;
        if (attr.boolean) values = [true];
        else if (attr.value?.length === 1 && attr.value[0].expression) ({ values, dynamic } = evaluateValues(context, attr.value[0].expression));
        else values = [attr.value?.map((part: AstNode) => part.value ?? '').join('')];
      }
      // Only definitely hidden values suppress text. Conditional hidden states do not.
      // aria-hidden removes accessibility exposure, not visual presentation.
      if (key === 'hidden' && !dynamic && values.length && values.every(value => value === '' || Boolean(value))) return false;
    }
  }
  return true;
}

export function canonicalAttribute(name: string): string {
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

/** Visits original framework nodes without extracting or rewriting source text. */
export function createUiVisitors(context: any, callbacks: UiCallbacks): Record<string, any> {
  const source = context.sourceCode;
  function text(node: AstNode): void {
    if (callbacks.onText && isVisibleUiText(context, node)) callbacks.onText(node, String(node.value ?? ''));
  }
  function renderedExpression(node: AstNode): void {
    if (!callbacks.onText || !isVisibleUiText(context, node)) return;
    const parent = node.parent;
    const direct = node.type === 'JSXExpressionContainer' ? ['JSXElement', 'JSXFragment'].includes(parent?.type ?? '')
      : node.type === 'VExpressionContainer' ? parent?.type === 'VElement'
      : node.type === 'SvelteMustacheTag' && !['SvelteAttribute', 'SvelteStyleDirective', 'SvelteDirective', 'SvelteSpecialDirective'].includes(parent?.type ?? '');
    if (!direct) return;
    for (const value of evaluateValues(context, node.expression).values) if (typeof value === 'string') callbacks.onText(node, value);
  }
  function attribute(name: string, node: AstNode, expression?: AstNode, literal?: ScalarValue): AttributeSite {
    const evaluated = expression ? evaluateValues(context, expression) : { values: [literal], dynamic: false };
    return { name: canonicalAttribute(name), node, ...evaluated, expression, known: !evaluated.dynamic, value: evaluated.values.length === 1 ? evaluated.values[0] : evaluated.values };
  }
  function spread(input: AstNode, attrs: AttributeSite[], hops = 0): boolean {
    let node = unwrap(input);
    if (node?.type === 'Identifier') node = unwrap(constantInitializer(context, node, hops));
    if (node?.type !== 'ObjectExpression') return false;
    let known = true;
    for (const prop of node.properties) {
      if (prop.type === 'SpreadElement') { known = spread(prop.argument, attrs, hops + 1) && known; continue; }
      const key = propertyName(prop);
      if (key === undefined) { known = false; continue; }
      attrs.push(attribute(key, prop, prop.value));
    }
    return known;
  }
  function component(name: string, at: AstNode): ImportedBinding | undefined {
    const direct = resolveBinding(context, name, at);
    if (direct) return direct;
    return resolveBinding(context, name.replace(/(^|-)(\w)/g, (_match, _separator: string, value: string) => value.toUpperCase()), at);
  }
  function styles(attr: AttributeSite): StyleSite {
    const properties: AttributeSite[] = [];
    const expression = unwrap(attr.expression);
    if (expression && spread(expression, properties)) return { node: attr.node, properties, dynamic: false };
    if (!attr.dynamic && attr.values.every(value => typeof value === 'string')) {
      for (const value of attr.values) {
        for (const declaration of String(value).split(';')) {
          const colon = declaration.indexOf(':');
          if (colon > 0) properties.push(attribute(declaration.slice(0, colon).trim(), attr.node, undefined, declaration.slice(colon + 1).trim()));
        }
      }
      return { node: attr.node, properties, dynamic: false };
    }
    return { node: attr.node, properties, dynamic: true };
  }
  function emit(site: ElementSite): void {
    site.component ??= component(site.name, site.node);
    callbacks.onElement?.(site);
    for (const attr of site.attributes) {
      if (attr.name === 'class' && callbacks.onClassSite) callbacks.onClassSite({ node: attr.node, element: site, ...(attr.expression ? classValues(context, attr.expression, callbacks) : { parts: attr.values.filter((value): value is string => typeof value === 'string').map(value => ({ value, node: attr.node })), dynamic: attr.dynamic }) });
      if (attr.name === 'style' && callbacks.onStyleSite) callbacks.onStyleSite(styles(attr));
    }
    if (site.unknownSpread && callbacks.onClassSite) callbacks.onClassSite({ node: site.node, element: site, parts: [], dynamic: true });
  }
  function jsx(node: AstNode): void {
    const open = node.openingElement;
    const site: ElementSite = { name: expressionName(open.name) ?? '', node: open.name, attributes: [], unknownSpread: false };
    for (const attr of open.attributes) {
      if (attr.type === 'JSXSpreadAttribute') { site.unknownSpread = !spread(attr.argument, site.attributes) || site.unknownSpread; continue; }
      const key = attr.name.type === 'JSXNamespacedName' ? `${attr.name.namespace.name}:${attr.name.name.name}` : attr.name.name;
      if (!attr.value) site.attributes.push(attribute(key, attr, undefined, true));
      else if (attr.value.type === 'JSXExpressionContainer') site.attributes.push(attribute(key, attr, attr.value.expression));
      else site.attributes.push(attribute(key, attr, undefined, attr.value.value));
    }
    emit(site);
    if (site.name === 'style') callbacks.onStyleBlock?.(node);
  }
  function vue(node: AstNode): void {
    const site: ElementSite = { name: node.rawName ?? node.name, node, attributes: [], unknownSpread: false };
    for (const attr of node.startTag.attributes) {
      if (!attr.directive) { site.attributes.push(attribute(attr.key.rawName ?? attr.key.name, attr, undefined, attr.value ? attr.value.value : true)); continue; }
      const directive = attr.key.name.name;
      const arg = attr.key.argument;
      if (directive === 'bind' && !arg) { site.unknownSpread = !spread(attr.value?.expression, site.attributes) || site.unknownSpread; continue; }
      const name = arg?.type === 'VIdentifier' ? arg.rawName ?? arg.name : evaluateValues(context, arg?.expression).values[0];
      if (directive === 'bind' && typeof name === 'string') site.attributes.push(attribute(name, attr, attr.value?.expression));
      else if (directive === 'on' && typeof name === 'string') site.attributes.push(attribute(`on:${name}`, attr, attr.value?.expression));
      else if (directive === 'bind') site.unknownSpread = true;
      else if (directive === 'html') site.attributes.push(attribute('v-html', attr, attr.value?.expression));
    }
    const dynamic = site.name === 'component' ? site.attributes.find(attr => attr.name === 'is') : undefined;
    if (dynamic?.expression) {
      const name = expressionName(dynamic.expression);
      if (name) site.component = component(name, dynamic.expression);
    }
    emit(site);
  }
  function svelte(node: AstNode): void {
    const site: ElementSite = { name: expressionName(node.name) ?? '', node: node.name, attributes: [], unknownSpread: false };
    const classDirectives: { node: AstNode; value: string }[] = [];
    for (const attr of node.startTag.attributes) {
      if (attr.type === 'SvelteSpreadAttribute') { site.unknownSpread = !spread(attr.argument, site.attributes) || site.unknownSpread; continue; }
      if (attr.type === 'SvelteStyleDirective') {
        const key = attr.key.name.name;
        const valueNode = attr.value?.find((part: AstNode) => part.expression)?.expression;
        callbacks.onStyleSite?.({ node: attr, properties: [attribute(key, attr, valueNode, attr.value?.map((part: AstNode) => part.value ?? '').join(''))], dynamic: false });
        continue;
      }
      if (attr.type === 'SvelteDirective') {
        const key = attr.key.name.name;
        if (attr.kind === 'Class') { classDirectives.push({ node: attr, value: key }); site.attributes.push(attribute('class', attr, undefined, key)); }
        else if (attr.kind === 'Binding') site.attributes.push(attribute(key, attr, attr.expression));
        else if (attr.kind === 'EventHandler') site.attributes.push(attribute(`on:${key}`, attr, attr.expression));
        continue;
      }
      if (attr.type === 'SvelteSpecialDirective') {
        const name = expressionName(attr.expression);
        if (name) site.component = component(name, attr.expression);
        continue;
      }
      if (attr.type === 'SvelteShorthandAttribute') { site.attributes.push(attribute(attr.key.name, attr, attr.value)); continue; }
      if (attr.type !== 'SvelteAttribute') continue;
      if (attr.boolean) { site.attributes.push(attribute(attr.key.name, attr, undefined, true)); continue; }
      const pieces = attr.value ?? [];
      if (pieces.length === 1 && pieces[0].expression) site.attributes.push(attribute(attr.key.name, attr, pieces[0].expression));
      else if (pieces.every((part: AstNode) => part.type === 'SvelteLiteral')) site.attributes.push(attribute(attr.key.name, attr, undefined, pieces.map((part: AstNode) => part.value).join('')));
      else {
        // Mixed Svelte text and expressions use the same template evaluator.
        const quasis: any[] = [], expressions: AstNode[] = [];
        let text = '';
        for (const piece of pieces) {
          if (piece.type === 'SvelteLiteral') text += piece.value;
          else { quasis.push({ type: 'TemplateElement', value: { cooked: text }, range: attr.range, loc: attr.loc }); expressions.push(piece.expression); text = ''; }
        }
        quasis.push({ type: 'TemplateElement', value: { cooked: text }, range: attr.range, loc: attr.loc });
        site.attributes.push(attribute(attr.key.name, attr, { type: 'TemplateLiteral', quasis, expressions, parent: attr, range: attr.range, loc: attr.loc }));
      }
    }
    emit(site);
  }
  const visitors: Record<string, any> = {
    JSXText: text,
    JSXExpressionContainer: renderedExpression,
    SvelteText: text,
    SvelteMustacheTag: renderedExpression,
    JSXElement: jsx,
    SvelteElement: svelte,
    SvelteStyleElement(node: AstNode) { callbacks.onStyleBlock?.(node); },
    CallExpression(node: AstNode) {
      const name = expressionName(node.callee) ?? '';
      const binding = resolveBinding(context, name, node);
      const supported = [...(callbacks.classFunctions ?? []), ...(callbacks.variantFunctions ?? []), 'cn', 'cx', 'clsx', 'classNames', 'twMerge', 'twJoin', 'cva', 'tv'];
      if (supported.includes(name) || binding && supported.includes(binding.name)) callbacks.onClassSite?.({ node, ...classValues(context, node, callbacks) });
    },
    'Program:exit'() {
      const fragment = source.parserServices?.getDocumentFragment?.();
      for (const node of fragment?.children ?? []) if (node.type === 'VElement' && node.name === 'style') callbacks.onStyleBlock?.(node);
    },
  };
  const services = source.parserServices;
  if (services?.defineTemplateBodyVisitor) return services.defineTemplateBodyVisitor({ ...visitors, VElement: vue, VText: text, VExpressionContainer: renderedExpression }, visitors);
  return visitors;
}
