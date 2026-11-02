/** Framework extensions stay at this boundary; policy values remain plain JSON. */
export type AstNode = { type: string; parent?: AstNode; range?: [number, number]; loc?: any; [key: string]: any };
export type ScalarValue = string | number | boolean | null | undefined;
export interface EvaluatedValues { values: ScalarValue[]; dynamic: boolean }
export interface ClassPart { value: string; node: AstNode }
export interface ClassValues { parts: ClassPart[]; dynamic: boolean }
export interface ImportedBinding { source: string; name: string; localName: string; file?: string }

export function unwrap(node: AstNode | null | undefined): AstNode | undefined {
  while (node && ['ChainExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression', 'TSInstantiationExpression'].includes(node.type)) node = node.expression;
  return node ?? undefined;
}

export function propertyName(node: AstNode): string | undefined {
  const key = node.key ?? node.property;
  if (!key) return undefined;
  if (!node.computed && ['Identifier', 'JSXIdentifier', 'SvelteName', 'VIdentifier'].includes(key.type)) return key.name;
  return typeof key.value === 'string' || typeof key.value === 'number' ? String(key.value) : undefined;
}

function scopeVariable(context: any, name: string, at: AstNode): any {
  let scope: any;
  try { scope = context.sourceCode.getScope(at); } catch { return undefined; }
  for (; scope; scope = scope.upper) if (scope.set?.has(name)) return scope.set.get(name);
  // vue-eslint-parser stores template references separately from script scopes.
  return context.sourceCode.scopeManager?.scopes.find((candidate: any) => candidate.type === 'module' && candidate.set?.has(name))?.set.get(name);
}

function templateShadow(name: string, at: AstNode): boolean {
  for (let parent: AstNode | undefined = at; parent; parent = parent.parent) {
    if (parent.type === 'VElement' && parent.variables?.some((variable: any) => variable.id?.name === name)) return true;
  }
  return false;
}

const importCache = new WeakMap<object, Map<string, ImportedBinding>>();
function fileImports(context: any): Map<string, ImportedBinding> {
  const source = context.sourceCode;
  const cached = importCache.get(source);
  if (cached) return cached;
  const found = new Map<string, ImportedBinding>();
  const seen = new WeakSet<object>();
  function visit(node: AstNode): void {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) found.set(specifier.local.name, {
        source: String(node.source.value), localName: specifier.local.name,
        name: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.type === 'ImportNamespaceSpecifier' ? '*' : String(specifier.imported.name ?? specifier.imported.value),
      });
    }
    for (const key of source.visitorKeys[node.type] ?? []) {
      const value = node[key];
      if (Array.isArray(value)) for (const child of value) { if (child?.type) visit(child); }
      else if (value?.type) visit(value);
    }
  }
  visit(source.ast);
  importCache.set(source, found);
  return found;
}

export function constantInitializer(context: any, input: AstNode, hops = 0): AstNode | undefined {
  const node = unwrap(input);
  if (!node || node.type !== 'Identifier' || hops >= 1 || templateShadow(node.name, node)) return undefined;
  const variable = scopeVariable(context, node.name, node);
  const definition = variable?.defs?.find((def: any) => def.type === 'Variable' && def.parent?.kind === 'const' && def.node?.id?.type === 'Identifier');
  return definition?.node?.init;
}

function memberInitializer(context: any, node: AstNode, hops: number): { node: AstNode; hops: number } | undefined {
  const key = propertyName(node);
  if (key === undefined) return undefined;
  let object = unwrap(node.object);
  if (object?.type === 'Identifier') { object = unwrap(constantInitializer(context, object, hops)); hops++; }
  if (object?.type === 'ArrayExpression' && /^\d+$/.test(key)) {
    const item = object.elements[Number(key)];
    return item && item.type !== 'SpreadElement' ? { node: item, hops } : undefined;
  }
  if (object?.type !== 'ObjectExpression') return undefined;
  for (const property of [...object.properties].reverse()) {
    if (property.type === 'SpreadElement') return undefined;
    if (propertyName(property) === undefined) return undefined;
    if (propertyName(property) === key) return { node: property.value, hops };
  }
  return undefined;
}

/** Resolves lexical imports and simple aliases, preserving template-local shadowing. */
export function resolveBinding(context: any, name: string, at: AstNode, depth = 0): ImportedBinding | undefined {
  if (depth > 4 || templateShadow(name, at)) return undefined;
  const segments = name.split('.');
  const root = segments.shift()!;
  const variable = scopeVariable(context, root, at);
  const definition = variable?.defs?.[0];
  let binding: ImportedBinding | undefined;
  if (definition?.type === 'ImportBinding') {
    const specifier = definition.node;
    if (specifier.type === 'TSImportEqualsDeclaration') {
      const value = specifier.moduleReference?.expression?.value;
      if (typeof value === 'string') binding = { source: value, name: 'default', localName: root };
    } else binding = { source: String(definition.parent.source.value), localName: root, name: specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.type === 'ImportNamespaceSpecifier' ? '*' : String(specifier.imported.name ?? specifier.imported.value) };
  } else if (definition?.type === 'Variable' && definition.parent?.kind === 'const') {
    const init = unwrap(definition.node.init);
    const alias = expressionName(init);
    if (alias) binding = resolveBinding(context, alias, init!, depth + 1);
    else {
      const call = init?.type === 'CallExpression' ? init : init?.type === 'MemberExpression' && init.object.type === 'CallExpression' ? init.object : undefined;
      if (call && expressionName(call.callee) === 'require' && !scopeVariable(context, 'require', call)?.defs?.length && typeof call.arguments[0]?.value === 'string') {
        let imported = init?.type === 'MemberExpression' ? propertyName(init) : 'default';
        if (definition.node.id.type === 'ObjectPattern') {
          const property = definition.node.id.properties.find((item: AstNode) => item.type === 'Property' && item.value?.name === root);
          imported = property ? propertyName(property) : undefined;
        }
        if (imported) binding = { source: call.arguments[0].value, name: imported, localName: root };
      }
    }
  } else if (definition) return undefined;
  else binding = fileImports(context).get(root);
  if (!binding) return undefined;
  for (const segment of segments) binding = { ...binding, name: binding.name === '*' || binding.name === 'default' ? segment : `${binding.name}.${segment}` };
  return { ...binding, localName: name };
}

export function expressionName(input: AstNode | null | undefined): string | undefined {
  const node = unwrap(input);
  if (!node) return undefined;
  if (['Identifier', 'JSXIdentifier', 'SvelteName'].includes(node.type)) return node.name;
  if (['MemberExpression', 'JSXMemberExpression', 'SvelteMemberExpressionName'].includes(node.type)) {
    const base = expressionName(node.object);
    const property = node.type === 'MemberExpression' ? propertyName(node) : expressionName(node.property);
    return base && property ? `${base}.${property}` : undefined;
  }
  return undefined;
}

export function evaluateValues(context: any, input: AstNode | null | undefined, hops = 0): EvaluatedValues {
  const node = unwrap(input);
  if (!node) return { values: [], dynamic: true };
  if (['Literal', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'SvelteLiteral', 'VLiteral'].includes(node.type)) {
    const value = node.value;
    return ['string', 'number', 'boolean'].includes(typeof value) || value === null ? { values: [value], dynamic: false } : { values: [], dynamic: true };
  }
  if (node.type === 'Identifier' && node.name === 'undefined' && !scopeVariable(context, 'undefined', node)?.defs?.length) return { values: [undefined], dynamic: false };
  if (node.type === 'Identifier') {
    const init = constantInitializer(context, node, hops);
    return init ? evaluateValues(context, init, hops + 1) : { values: [], dynamic: true };
  }
  if (node.type === 'MemberExpression') {
    const value = memberInitializer(context, node, hops);
    return value ? evaluateValues(context, value.node, value.hops) : { values: [], dynamic: true };
  }
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
    const left = evaluateValues(context, node.type === 'ConditionalExpression' ? node.consequent : node.left, hops);
    const right = evaluateValues(context, node.type === 'ConditionalExpression' ? node.alternate : node.right, hops);
    return { values: [...left.values, ...right.values], dynamic: left.dynamic || right.dynamic };
  }
  if (node.type === 'TemplateLiteral') {
    let values = [''];
    for (let i = 0; i < node.quasis.length; i++) {
      values = values.map(value => value + (node.quasis[i].value.cooked ?? node.quasis[i].value.raw));
      if (i < node.expressions.length) {
        const evaluated = evaluateValues(context, node.expressions[i], hops);
        if (evaluated.dynamic || values.length * evaluated.values.length > 64) return { values: [], dynamic: true };
        values = values.flatMap(value => evaluated.values.map(part => value + String(part)));
      }
    }
    return { values, dynamic: false };
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = evaluateValues(context, node.left, hops), right = evaluateValues(context, node.right, hops);
    if (left.dynamic || right.dynamic || left.values.length * right.values.length > 64) return { values: [], dynamic: true };
    return { values: left.values.flatMap(a => right.values.map(b => String(a) + String(b))), dynamic: false };
  }
  if (node.type === 'UnaryExpression' && ['-', '+', '!'].includes(node.operator)) {
    const operand = evaluateValues(context, node.argument, hops);
    return { values: operand.values.map(value => node.operator === '!' ? !value : node.operator === '-' ? -Number(value) : Number(value)), dynamic: operand.dynamic };
  }
  return { values: [], dynamic: true };
}

export const DEFAULT_CLASS_FUNCTIONS = ['cn', 'cx', 'clsx', 'classNames', 'twMerge', 'twJoin'];
export const DEFAULT_VARIANT_FUNCTIONS = ['cva', 'tv'];

export function classValues(context: any, input: AstNode | null | undefined, options: { classFunctions?: string[]; variantFunctions?: string[] } = {}, hops = 0): ClassValues {
  const node = unwrap(input);
  if (!node) return { parts: [], dynamic: true };
  const combine = (values: ClassValues[]): ClassValues => ({ parts: values.flatMap(value => value.parts), dynamic: values.some(value => value.dynamic) });
  if (node.type === 'Identifier') {
    const init = constantInitializer(context, node, hops);
    return init ? classValues(context, init, options, hops + 1) : { parts: [], dynamic: true };
  }
  if (node.type === 'MemberExpression') {
    const value = memberInitializer(context, node, hops);
    return value ? classValues(context, value.node, options, value.hops) : { parts: [], dynamic: true };
  }
  if (node.type === 'ConditionalExpression') return combine([classValues(context, node.consequent, options, hops), classValues(context, node.alternate, options, hops)]);
  if (node.type === 'LogicalExpression') return node.operator === '&&' ? classValues(context, node.right, options, hops) : combine([classValues(context, node.left, options, hops), classValues(context, node.right, options, hops)]);
  if (node.type === 'ArrayExpression') return combine(node.elements.filter(Boolean).map((element: AstNode) => classValues(context, element.type === 'SpreadElement' ? element.argument : element, options, hops)));
  if (node.type === 'ObjectExpression') {
    const values: ClassValues[] = [];
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') { values.push(classValues(context, property.argument, options, hops)); continue; }
      const condition = evaluateValues(context, property.value, hops);
      if (!condition.dynamic && condition.values.every(value => !value)) continue;
      const keys = property.computed ? evaluateValues(context, property.key, hops) : { values: [propertyName(property)], dynamic: false };
      values.push({ parts: keys.values.filter((key): key is string => typeof key === 'string').map(value => ({ value, node: property.key })), dynamic: keys.dynamic });
    }
    return combine(values);
  }
  if (node.type === 'CallExpression') {
    const name = expressionName(node.callee) ?? '';
    const imported = resolveBinding(context, name, node);
    const names = [name, imported?.name ?? ''];
    if (names.some(name => [...DEFAULT_VARIANT_FUNCTIONS, ...(options.variantFunctions ?? [])].includes(name))) {
      const values: ClassValues[] = [];
      const readVariants = (object: AstNode, compound = false): void => {
        if (object.type !== 'ObjectExpression') { values.push({ parts: [], dynamic: true }); return; }
        for (const property of object.properties) {
          const key = propertyName(property);
          if (['class', 'className'].includes(key ?? '') || !compound && key === 'base') values.push(classValues(context, property.value, options, hops));
          if (!compound && (key === 'slots' || key === 'variants')) {
            const scan = (value: AstNode): void => {
              if (value.type === 'ObjectExpression') for (const child of value.properties) { if (child.type === 'Property') scan(child.value); }
              else values.push(classValues(context, value, options, hops));
            };
            scan(property.value);
          }
          if (key === 'compoundVariants' || key === 'compoundSlots') {
            for (const entry of property.value.elements ?? []) if (entry) readVariants(entry, true);
          }
        }
      };
      if (node.arguments[0]?.type === 'ObjectExpression') readVariants(node.arguments[0]);
      else if (node.arguments[0]) values.push(classValues(context, node.arguments[0], options, hops));
      if (node.arguments[1]) readVariants(node.arguments[1]);
      return combine(values);
    }
    if (names.some(name => [...DEFAULT_CLASS_FUNCTIONS, ...(options.classFunctions ?? [])].includes(name))) return combine(node.arguments.map((argument: AstNode) => classValues(context, argument.type === 'SpreadElement' ? argument.argument : argument, options, hops)));
    const factory = node.callee.type === 'CallExpression' ? node.callee : node.callee.type === 'Identifier' ? unwrap(constantInitializer(context, node.callee, hops)) : undefined;
    if (factory?.type === 'CallExpression') {
      const factoryName = expressionName(factory.callee) ?? '';
      const origin = resolveBinding(context, factoryName, factory);
      if ([...DEFAULT_VARIANT_FUNCTIONS, ...(options.variantFunctions ?? [])].some(name => name === factoryName || name === origin?.name)) {
        const values = [classValues(context, factory, options, hops + 1)];
        for (const argument of node.arguments) if (argument.type === 'ObjectExpression') for (const property of argument.properties) {
          if (['class', 'className'].includes(propertyName(property) ?? '')) values.push(classValues(context, property.value, options, hops));
        }
        return combine(values);
      }
    }
    return { parts: [], dynamic: true };
  }
  const evaluated = evaluateValues(context, node, hops);
  if (!evaluated.dynamic) return { parts: evaluated.values.filter(value => typeof value === 'string' || typeof value === 'number' && value !== 0).map(value => ({ value: String(value), node })), dynamic: false };
  if (node.type === 'TemplateLiteral') {
    // Preserve complete literal tokens while dropping fragments next to holes.
    const parts: ClassPart[] = [];
    for (let i = 0; i < node.quasis.length; i++) {
      let value = node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
      if (i > 0 && !/^\s/.test(value)) value = value.replace(/^\S+/, '');
      if (i < node.expressions.length && !/\s$/.test(value)) value = value.replace(/\S+$/, '');
      if (value.trim()) parts.push({ value, node: node.quasis[i] });
    }
    return { parts, dynamic: true };
  }
  return { parts: [], dynamic: true };
}
