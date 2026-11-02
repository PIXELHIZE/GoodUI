import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import type { AiSlopContext, AiSlopReport } from './ai-slop.js';
import { baseClass, matchesClass, splitClasses } from './design-system/classes.js';
import { createUiVisitors, type AstNode, type ClassSite, type ElementSite, type StyleSite } from './design-system/ui.js';
import { classValues, constantInitializer, DEFAULT_CLASS_FUNCTIONS, evaluateValues, expressionName, resolveBinding, unwrap } from './design-system/values.js';

interface State { node: AstNode; scenarios: string[][]; styles: Map<string, string[]>; decorative: boolean; hover: boolean; css: boolean }
const keyOf = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).toLowerCase();
const gradient = (value: string) => /(?:linear|radial|conic)-gradient\(/i.test(value);
const backgroundGradient = (token: string) => /^bg-(?:gradient-to-|linear(?:-to-|-\[|-\d)|radial|conic)/.test(token) || /^bg-\[/.test(token) && gradient(token) || /^\[background(?:-image)?:/.test(token) && gradient(token);

function combine(left: string[][], right: string[][]): string[][] {
  const results: string[][] = [];
  for (const a of left) for (const b of right) { if (results.length >= 64) return results; results.push([...a, ...b]); }
  return results;
}

/** Keeps mutually exclusive string branches separate instead of unioning their classes. */
function scenarios(context: any, input: AstNode, options: AiSlopContext, hops = 0): string[][] {
  const node = unwrap(input);
  if (!node) return [[]];
  const values = evaluateValues(context, node, hops);
  if (!values.dynamic) return values.values.map(value => typeof value === 'string' ? splitClasses(value) : []);
  if (node.type === 'Identifier') { const init = constantInitializer(context, node, hops); return init ? scenarios(context, init, options, hops + 1) : [[]]; }
  if (node.type === 'ConditionalExpression') return [...scenarios(context, node.consequent, options, hops), ...scenarios(context, node.alternate, options, hops)].slice(0, 64);
  if (node.type === 'LogicalExpression') return node.operator === '&&' ? [[], ...scenarios(context, node.right, options, hops)].slice(0, 64) : [...scenarios(context, node.left, options, hops), ...scenarios(context, node.right, options, hops)].slice(0, 64);
  if (node.type === 'ArrayExpression') return node.elements.filter(Boolean).reduce((all: string[][], item: AstNode) => combine(all, scenarios(context, item.type === 'SpreadElement' ? item.argument : item, options, hops)), [[]]);
  if (node.type === 'CallExpression') {
    const name = expressionName(node.callee) ?? '';
    const imported = resolveBinding(context, name, node);
    if (DEFAULT_CLASS_FUNCTIONS.includes(name) || imported && DEFAULT_CLASS_FUNCTIONS.includes(imported.name)) {
      return node.arguments.reduce((all: string[][], argument: AstNode) => combine(all, scenarios(context, argument.type === 'SpreadElement' ? argument.argument : argument, options, hops)), [[]]);
    }
  }
  // A factory's alternatives/slots are not automatically on the same element.
  // Unknown conditions in class objects are checked individually with static keys.
  const known = classValues(context, node, options.policy.tailwind);
  if (node.type === 'TemplateLiteral') return [known.parts.flatMap(part => splitClasses(part.value))];
  return known.parts.length ? known.parts.map(part => splitClasses(part.value)) : [[]];
}

function elementOf(node: AstNode): AstNode | undefined {
  for (let current: AstNode | undefined = node; current; current = current.parent) if (['JSXElement', 'VElement', 'SvelteElement'].includes(current.type)) return current;
  return undefined;
}

function emptyElement(node: AstNode): boolean {
  return (node.children ?? []).every((child: AstNode) => ['JSXText', 'VText', 'SvelteText'].includes(child.type) ? !String(child.value ?? child.raw ?? '').trim() : ['SvelteHTMLComment', 'JSXEmptyExpression'].includes(child.type));
}

function purple(value: string): boolean {
  if (/\b(?:purple|violet|fuchsia|indigo|rebeccapurple)\b/i.test(value)) return true;
  for (const match of value.matchAll(/#([\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b/gi)) {
    const hex = match[1]!;
    const rgb = hex.length <= 4 ? [...hex.slice(0, 3)].map(channel => parseInt(channel + channel, 16)) : [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
    if (purpleRgb(rgb)) return true;
  }
  for (const match of value.replaceAll('_', ' ').matchAll(/rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)/gi)) {
    if (purpleRgb(match.slice(1).map(channel => parseFloat(channel) * (channel.endsWith('%') ? 2.55 : 1)))) return true;
  }
  for (const match of value.replaceAll('_', ' ').matchAll(/hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%/gi)) {
    const hue = ((Number(match[1]) % 360) + 360) % 360;
    if (hue >= 260 && hue <= 320 && Number(match[2]) >= 25) return true;
  }
  return false;
}

function purpleRgb(channels: number[]): boolean {
  const [r, g, b] = channels.map(channel => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < 0.15 || max < 0.2) return false;
  let hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  return hue >= 260 && hue <= 320;
}

function translucent(value: string): boolean {
  const text = value.replaceAll('_', ' ').trim();
  const utility = /\/([\d.]+)$/.exec(text);
  if (utility) return Number(utility[1]) > 0 && Number(utility[1]) < 100;
  const hex = /#([\da-f]{8}|[\da-f]{4})\b/i.exec(text)?.[1];
  if (hex) { const alpha = parseInt(hex.length === 4 ? hex[3]! + hex[3]! : hex.slice(6), 16); return alpha > 0 && alpha < 255; }
  if (/var\(/.test(text)) return false;
  const colorFunction = /^(?:rgba?|hsla?)\(([^()]*)\)$/i.exec(text)?.[1];
  if (colorFunction) {
    const channels = colorFunction.includes('/') ? colorFunction.split('/') : colorFunction.split(',');
    const alpha = colorFunction.includes('/') ? channels.at(-1)! : channels.length === 4 ? channels[3]! : undefined;
    if (alpha !== undefined) { const number = parseFloat(alpha) / (alpha.trim().endsWith('%') ? 100 : 1); return number > 0 && number < 1; }
  }
  return false;
}

function positiveBlur(value: string, minimum = 0): boolean {
  const match = /blur\(\s*([\d.]+)(px|rem)?\s*\)/i.exec(value);
  return !!match && Number(match[1]) * (match[2] === 'rem' ? 16 : 1) > minimum;
}

function negativeTranslate(value: string): boolean {
  const y = /translateY\(\s*(-[\d.]+)(?:px|rem|%)/i.exec(value)?.[1] ?? /translate(?:3d)?\([^,]+,\s*(-[\d.]+)(?:px|rem|%)/i.exec(value)?.[1];
  return y !== undefined && Number(y) < 0;
}

function scaleFactor(value: string): number | undefined {
  const match = /^([\d.]+)(%)?$/.exec(value.trim());
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number / (match[2] ? 100 : 1) : undefined;
}

function enlargedUtility(base: string): boolean {
  const amount = /^scale(?:-[xy])?-(.+)$/.exec(base)?.[1];
  if (amount === undefined) return false;
  const arbitrary = /^\[([^\]]+)\]$/.exec(amount)?.[1];
  const factor = arbitrary === undefined ? /^[\d.]+$/.test(amount) ? Number(amount) / 100 : undefined : scaleFactor(arbitrary);
  return factor !== undefined && factor > 1;
}

function enlargedTransform(value: string): boolean {
  for (const match of value.matchAll(/\bscale(?:X|Y)?\(\s*([^()]*)\s*\)/gi)) {
    const values = match[1]!.trim().split(/[\s,]+/).map(scaleFactor);
    if (values.length >= 1 && values.length <= 2 && values.every(number => number !== undefined) && values.some(number => number! > 1)) return true;
  }
  return false;
}

function hoverSelector(selector: string): boolean {
  let found = false;
  try { selectorParser(selectors => { selectors.walkPseudos(node => {
    if (node.value !== ':hover') return;
    let parent: any = node.parent;
    while (parent) { if (parent.type === 'pseudo' && parent.value === ':not') return; parent = parent.parent; }
    found = true;
  }); }).processSync(selector); } catch { /* Unknown selector syntax is not proof. */ }
  return found;
}

function hoverVariant(token: string): boolean {
  const variants: string[] = [];
  let start = 0, depth = 0, quote = '', escaped = false;
  for (let index = 0; index < token.length; index++) {
    const character = token[index]!;
    if (escaped) { escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (depth > 0 && (character === '"' || character === "'")) { quote = character; continue; }
    if ('[({'.includes(character)) depth++;
    else if ('])}'.includes(character)) depth--;
    else if (character === ':' && depth === 0) { variants.push(token.slice(start, index)); start = index + 1; }
  }
  return variants.some(variant => variant === 'hover' || /^(?:group|peer)-hover(?:\/[^:]+)?$/.test(variant)
    || variant.startsWith('[') && variant.endsWith(']') && hoverSelector(variant.slice(1, -1).replaceAll('_', ' ')));
}

function largeDimension(token: string, axis: 'w' | 'h'): boolean {
  if (new RegExp(`^(?:${axis}|size)-(?:3[2-9]|[4-9]\\d|\\d{3,})$`).test(token)) return true;
  const value = new RegExp(`^(?:${axis}|size)-\\[([\\d.]+)(px|rem)\\]$`).exec(token);
  return !!value && Number(value[1]) * (value[2] === 'rem' ? 16 : 1) >= 128;
}

export function createStyleVisitors(context: any, options: AiSlopContext, report: AiSlopReport): Record<string, any> {
  const states = new Map<AstNode, State>();
  function state(node: AstNode): State {
    let current = states.get(node);
    if (!current) { current = { node, scenarios: [[]], styles: new Map(), decorative: emptyElement(node), hover: false, css: false }; states.set(node, current); }
    return current;
  }
  function inspect(current: State): void {
    const singleton = (key: string) => { const values = current.styles.get(key); return values?.length === 1 ? values[0]! : ''; };
    const backgrounds = [...(current.styles.get('background') ?? []), ...(current.styles.get('background-image') ?? []), ...(current.styles.get('background-color') ?? [])];
    for (const rawTokens of current.scenarios) {
      const tokens = rawTokens.filter(token => !matchesClass(token, options.settings.allowClasses));
      const bases = tokens.map(baseClass);
      const has = (pattern: RegExp) => bases.some(token => pattern.test(token));
      const background = singleton('background') || singleton('background-image');
      const hasGradient = bases.some(backgroundGradient) || gradient(background);
      if (options.ruleName === 'no-gradient-text') {
        const clipped = bases.includes('bg-clip-text') || [singleton('background-clip'), singleton('-webkit-background-clip')].includes('text');
        const transparent = bases.includes('text-transparent') || [singleton('color'), singleton('-webkit-text-fill-color')].includes('transparent');
        if (hasGradient && clipped && transparent) report(current.node, { en: 'Gradient background, text clipping, and transparent text are combined on one element.', ko: '한 요소에 그라데이션 배경, 텍스트 클리핑, 투명한 글자가 함께 지정되어 있습니다.' });
      }
      if (options.ruleName === 'no-purple-gradients') {
        const purpleStop = bases.some(token => /^(?:from|via|to)-(?:purple|violet|fuchsia|indigo)-\d/.test(token) || /^(?:from|via|to)-\[/.test(token) && purple(token));
        if (hasGradient && (purpleStop || bases.some(token => backgroundGradient(token) && purple(token)))) report(current.node, { en: 'A gradient background uses an explicit purple-family color stop.', ko: '그라데이션 배경에 보라색 계열의 색상 정지점이 직접 지정되어 있습니다.' });
      }
      if (options.ruleName === 'no-glassmorphism') {
        const blur = has(/^backdrop-blur(?:-(?!none$|0$|\[0(?:px|rem)?\]$).+)?$/) || positiveBlur(singleton('backdrop-filter') || singleton('-webkit-backdrop-filter'));
        const tint = bases.some(token => /^bg-/.test(token) && translucent(token)) || translucent(singleton('background') || singleton('background-color'));
        if (blur && tint) report(current.node, { en: 'Backdrop blur is combined with a translucent background.', ko: '배경 흐림과 반투명 배경이 함께 지정되어 있습니다.' });
      }
      if (options.ruleName === 'no-decorative-blobs') {
        const positioned = bases.includes('absolute') || bases.includes('fixed') || ['absolute', 'fixed'].includes(singleton('position'));
        const rounded = bases.includes('rounded-full') || /^(?:50%|9999px)$/.test(singleton('border-radius'));
        const blurred = has(/^blur-(?:xl|[2-9]xl|\[(?:[2-9]\d|\d{3,})px\])$/) || positiveBlur(singleton('filter'), 15);
        const large = (bases.some(token => largeDimension(token, 'w')) && bases.some(token => largeDimension(token, 'h'))) || ['width', 'height'].every(key => { const match = /^([\d.]+)(px|rem)$/.exec(singleton(key)); return !!match && Number(match[1]) * (match[2] === 'rem' ? 16 : 1) >= 128; });
        const colored = has(/^bg-(?!transparent$|clip-|cover$|contain$|center$|no-repeat$).+/) || backgrounds.some(value => !!value && value !== 'transparent' && !/var\(/.test(value));
        const decorative = current.decorative || bases.includes('pointer-events-none') || singleton('pointer-events') === 'none';
        if (positioned && rounded && blurred && large && colored && decorative) report(current.node, { en: 'A decorative large rounded shape combines absolute/fixed positioning, strong blur, and a colored background.', ko: '장식용 큰 둥근 요소에 absolute/fixed 배치, 강한 흐림, 색상 배경이 함께 지정되어 있습니다.' });
      }
      if (options.ruleName === 'no-hover-lift') for (const token of tokens) {
        const base = baseClass(token);
        const hover = hoverVariant(token);
        const amount = /^-translate-y-(.+)$/.exec(base)?.[1];
        const upward = amount !== undefined && /^(?:[\d.]+(?:\/\d+)?|px|full|\[[\d.]+(?:px|rem|%)\])$/.test(amount) && !/^(?:0(?:\.0+)?|\[0(?:\.0+)?(?:px|rem|%)\])$/.test(amount);
        if (hover && (upward || /^translate-y-\[-(?:[\d.]+)(?:px|rem|%)\]$/.test(base) && !/^translate-y-\[-0(?:\.0+)?(?:px|rem|%)\]$/.test(base))) report(current.node, { en: `Hover applies the upward translation ${JSON.stringify(token)}.`, ko: `hover 상태에 위쪽 이동 ${JSON.stringify(token)}이(가) 지정되어 있습니다.` });
        else if (hover && enlargedUtility(base)) report(current.node, { en: `Hover applies the static enlargement ${JSON.stringify(token)}.`, ko: `hover 상태에 정적 확대 ${JSON.stringify(token)}이(가) 지정되어 있습니다.` });
      }
      if (options.ruleName === 'no-bounce-animation') for (const token of tokens) {
        if (/^animate-bounce$/.test(baseClass(token)) || /^animate-\[/.test(baseClass(token)) && /(?:^|[^\w])bounce(?:[^\w]|$)/i.test(baseClass(token).replaceAll('_', ' '))) report(current.node, { en: `The bounce animation ${JSON.stringify(token)} is assigned.`, ko: `바운스 애니메이션 ${JSON.stringify(token)}이(가) 지정되어 있습니다.` });
      }
    }
    if (options.ruleName === 'no-purple-gradients') for (const background of backgrounds) if (gradient(background) && purple(background)) report(current.node, { en: `A gradient has a literal purple-family stop: ${JSON.stringify(background)}.`, ko: `그라데이션에 보라색 계열 값이 직접 지정되어 있습니다: ${JSON.stringify(background)}.` });
    if (options.ruleName === 'no-hover-lift' && current.hover) {
      for (const value of current.styles.get('transform') ?? []) {
        if (negativeTranslate(value)) report(current.node, { en: `A :hover selector applies upward translation ${JSON.stringify(value)}.`, ko: `:hover 선택자에 위쪽 이동 ${JSON.stringify(value)}이(가) 지정되어 있습니다.` });
        else if (enlargedTransform(value)) report(current.node, { en: `A :hover selector applies static enlargement ${JSON.stringify(value)}.`, ko: `:hover 선택자에 정적 확대 ${JSON.stringify(value)}이(가) 지정되어 있습니다.` });
      }
      for (const value of current.styles.get('scale') ?? []) {
        const factors = value.trim().split(/\s+/).map(scaleFactor);
        if (factors.length >= 1 && factors.length <= 2 && factors.every(number => number !== undefined) && factors.some(number => number! > 1)) report(current.node, { en: `A :hover selector sets scale to ${JSON.stringify(value)}.`, ko: `:hover 선택자의 scale에 확대 값 ${JSON.stringify(value)}이(가) 지정되어 있습니다.` });
      }
    }
    if (options.ruleName === 'no-bounce-animation') for (const property of ['animation', 'animation-name']) for (const value of current.styles.get(property) ?? []) if (/(?:^|[\s,])(?:[\w-]*bounce[\w-]*)(?:\s|,|$)/i.test(value)) report(current.node, { en: `${property} assigns the bounce animation ${JSON.stringify(value)}.`, ko: `${property}에 바운스 애니메이션 ${JSON.stringify(value)}이(가) 지정되어 있습니다.` });
  }
  function classes(site: ClassSite): void {
    const element = site.element ? elementOf(site.element.node) : undefined;
    // Helper calls inside an attribute are already represented by that attribute.
    if (!site.element && elementOf(site.node)) return;
    const current = state(element ?? site.node);
    const expression = site.element?.attributes.find(attribute => attribute.node === site.node && attribute.name === 'class')?.expression;
    const choices = expression ? scenarios(context, expression, options) : site.node.type === 'CallExpression' ? scenarios(context, site.node, options) : site.parts.map(part => splitClasses(part.value));
    current.scenarios = combine(current.scenarios, choices.length ? choices : [[]]);
    current.node = site.node;
  }
  function styles(site: StyleSite): void {
    if (site.dynamic) return;
    const current = state(elementOf(site.node) ?? site.node);
    if (current.node.type === 'JSXElement' || current.node.type === 'VElement' || current.node.type === 'SvelteElement') current.node = site.node;
    for (const property of site.properties) if (!property.dynamic) current.styles.set(keyOf(property.name), property.values.filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String));
  }
  function cssBlock(node: AstNode): void {
    const original = context.sourceCode.getText(node);
    const match = /^<style\b[^>]*>([\s\S]*)<\/style\s*>$/i.exec(original);
    const bodies: { text: string; base?: number; node: AstNode }[] = [];
    if (match && node.type !== 'JSXElement') bodies.push({ text: match[1]!, base: node.range![0] + original.indexOf('>') + 1, node });
    else if (node.type === 'JSXElement') for (const child of node.children) {
      if (child.type === 'JSXExpressionContainer') for (const value of evaluateValues(context, child.expression).values) if (typeof value === 'string') bodies.push({ text: value, node: child.expression });
      if (child.type === 'JSXText' && child.value.trim()) bodies.push({ text: child.value, node: child });
    }
    for (const body of bodies) {
      let css: postcss.Root;
      try { css = postcss.parse(body.text); } catch { continue; }
      css.walkRules(rule => {
        let ancestor: any = rule.parent;
        while (ancestor) { if (ancestor.type === 'atrule' && /keyframes$/i.test(ancestor.name)) return; ancestor = ancestor.parent; }
        const offset = rule.source?.start?.offset ?? 0;
        const length = rule.toString().length;
        const at: AstNode = body.base === undefined ? body.node : { type: 'GooduiCssEvidence', range: [body.base + offset, body.base + offset + length], loc: { start: context.sourceCode.getLocFromIndex(body.base + offset), end: context.sourceCode.getLocFromIndex(body.base + offset + length) } };
        const current: State = { node: at, scenarios: [[]], styles: new Map(), decorative: /(?:blob|orb|glow)/i.test(rule.selector), hover: hoverSelector(rule.selector), css: true };
        for (const declaration of rule.nodes ?? []) if (declaration.type === 'decl') current.styles.set(keyOf(declaration.prop), [declaration.value]);
        inspect(current);
      });
    }
  }
  const visitors = createUiVisitors(context, {
    onElement(site: ElementSite) {
      const current = state(elementOf(site.node) ?? site.node);
      if (site.attributes.some(attribute => attribute.name === 'aria-hidden' && attribute.values.some(value => value === true || value === 'true'))) current.decorative = true;
    },
    onClassSite: classes, onStyleSite: styles, onStyleBlock: cssBlock,
  });
  const previous = visitors['Program:exit'];
  visitors['Program:exit'] = (node: AstNode) => { previous?.(node); states.forEach(inspect); };
  return visitors;
}
