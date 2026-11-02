import type { AiSlopContext, AiSlopReport } from './ai-slop.js';
import { baseClass, matchesClass, splitClasses } from './design-system/classes.js';
import { createUiVisitors, isVisibleUiText, type ElementSite } from './design-system/ui.js';
import { classValues, type AstNode } from './design-system/values.js';

const genericPhrases = ['unlock your potential', 'revolutionize your workflow', '혁신적인 솔루션', '무한한 가능성'];
const placeholderPhrases = ['lorem ipsum', '[your brand]', '[company name]', '[your company]', '[your product]', '[insert text]', '[placeholder]', '[회사명]', '[브랜드명]', '[제품명]'];
const genericFonts = new Set(['inter', 'arial', 'helvetica', 'roboto']);
const emoji = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/u;
const textAttributes = new Set(['title', 'aria-label', 'placeholder']);
const textRules = new Set(['no-emoji-icons', 'no-generic-copy', 'no-placeholder-copy']);
const normalized = (text: string): string => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
const folded = (text: string): string => normalized(text).toLowerCase();
const fontName = (text: string): string => normalized(text).replace(/^(['"])(.*)\1$/, '$2').toLowerCase();

function matchingPhrase(text: string, phrases: string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const phrase of phrases) {
    let index = lower.indexOf(phrase);
    while (index !== -1) {
      // English phrase matches need word boundaries; Korean suffixes remain valid.
      const bounded = !/^[a-z]/.test(phrase) || !/[\p{L}\p{N}_]/u.test(lower[index - 1] ?? '') && !/[\p{L}\p{N}_]/u.test(lower[index + phrase.length] ?? '');
      if (bounded) return text.slice(index, index + phrase.length);
      index = lower.indexOf(phrase, index + 1);
    }
  }
  return undefined;
}

function elementNode(node: AstNode): AstNode | undefined {
  for (let current: AstNode | undefined = node; current; current = current.parent) {
    if (['JSXElement', 'VElement', 'SvelteElement'].includes(current.type)) return current;
  }
  return undefined;
}

function oversized(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 32;
  if (typeof value !== 'string') return false;
  const match = /^(\d+(?:\.\d+)?)(px|rem)$/i.exec(value.trim());
  return !!match && Number(match[1]) >= (match[2]!.toLowerCase() === 'px' ? 32 : 2);
}

/** Independent, bounded source checks. No AI authorship or rendered-quality inference. */
export function createContentVisitors(context: any, options: AiSlopContext, report: AiSlopReport): Record<string, any> {
  const { ruleName, settings } = options;
  const allowedPhrases = new Set((settings.allowPhrases ?? []).map(folded));
  const allowedFonts = new Set((settings.allowFonts ?? []).map(fontName));
  const cardElements = new WeakSet<object>();
  const reported = new WeakMap<object, Set<string>>();
  function emit(node: AstNode, en: string, ko: string): void {
    const seen = reported.get(node) ?? new Set<string>();
    if (seen.has(en)) return;
    seen.add(en); reported.set(node, seen);
    report(node, { en, ko });
  }

  function checkText(node: AstNode, raw: string): void {
    const value = normalized(raw);
    if (!value || allowedPhrases.has(folded(value))) return;
    if (ruleName === 'no-emoji-icons') {
      const match = emoji.exec(value)?.[0];
      if (match) emit(node, `Visible UI text contains emoji ${JSON.stringify(match)}. Use an intentional icon or plain text.`, `표시되는 UI 문구에 이모지 ${JSON.stringify(match)}이(가) 있습니다. 용도에 맞는 아이콘이나 일반 문구를 사용하세요.`);
    } else if (ruleName === 'no-generic-copy' || ruleName === 'no-placeholder-copy') {
      const phrase = matchingPhrase(value, ruleName === 'no-generic-copy' ? genericPhrases : placeholderPhrases);
      if (!phrase) return;
      if (ruleName === 'no-generic-copy') emit(node, `Visible UI copy contains generic phrase ${JSON.stringify(phrase)}. Describe a concrete product capability.`, `표시되는 UI 문구에 상투적인 표현 ${JSON.stringify(phrase)}이(가) 있습니다. 제품의 구체적인 기능을 설명하세요.`);
      else emit(node, `Visible UI copy contains placeholder ${JSON.stringify(phrase)}. Replace it with project-specific content.`, `표시되는 UI 문구에 임시 내용 ${JSON.stringify(phrase)}이(가) 있습니다. 프로젝트에 맞는 실제 내용으로 바꾸세요.`);
    }
  }

  function classTokens(site: ElementSite): string[] {
    return site.attributes.filter(attr => attr.name === 'class').flatMap(attr =>
      (attr.expression ? classValues(context, attr.expression).parts.map(part => part.value)
        : attr.values.filter((value): value is string => typeof value === 'string')).flatMap(splitClasses));
  }
  function card(site: ElementSite): boolean {
    return site.name === 'Card' || site.name.endsWith('.Card') || site.component?.name === 'Card'
      || classTokens(site).some(token => baseClass(token) === 'card' && !matchesClass(token, settings.allowClasses));
  }
  function parentCard(node: AstNode): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      // JSX inside a prop callback is not a rendered child of that component.
      if (['JSXAttribute', 'VAttribute', 'SvelteAttribute'].includes(parent.type)) return false;
      if (cardElements.has(parent)) return true;
    }
    return false;
  }
  function linkTargets(site: ElementSite): readonly string[] {
    if (site.name === 'a' || site.component?.source === 'next/link') return ['href'];
    if (['react-router', 'react-router-dom'].includes(site.component?.source ?? '') && ['Link', 'NavLink'].includes(site.component?.name ?? '')) return ['to'];
    return site.name === 'Link' || site.name.endsWith('.Link') ? ['href', 'to'] : [];
  }
  function checkFonts(node: AstNode, raw: string): void {
    for (const family of raw.split(',')) {
      const font = fontName(family);
      if (!genericFonts.has(font) || allowedFonts.has(font)) continue;
      const value = normalized(family).replace(/^(['"])(.*)\1$/, '$2');
      emit(node, `UI explicitly selects generic font ${JSON.stringify(value)}. Use the project's approved font family.`, `UI에서 범용 글꼴 ${JSON.stringify(value)}을(를) 직접 선택했습니다. 프로젝트에서 승인한 글꼴을 사용하세요.`);
    }
  }

  return createUiVisitors(context, {
    onText: textRules.has(ruleName) ? checkText : undefined,
    onElement(site) {
      if (!isVisibleUiText(context, site.node)) return;
      if (textRules.has(ruleName)) for (const attr of site.attributes) {
        if (textAttributes.has(attr.name)) for (const value of attr.values) if (typeof value === 'string') checkText(attr.node, value);
      }
      if (ruleName === 'no-placeholder-links') for (const attr of site.attributes) {
        if (!linkTargets(site).includes(attr.name)) continue;
        for (const value of attr.values) {
          if (typeof value !== 'string') continue;
          const trimmed = value.trim();
          if (trimmed !== '' && trimmed !== '#' && !/^javascript:\s*void\s*\(\s*0\s*\)\s*;?$/i.test(trimmed)) continue;
          emit(attr.node, `Link target ${JSON.stringify(value)} is a placeholder. Set a real destination or use a button for an action.`, `링크 대상 ${JSON.stringify(value)}은(는) 임시 값입니다. 실제 이동 경로를 지정하거나 동작에는 버튼을 사용하세요.`);
        }
      }
      if (ruleName === 'no-nested-cards' && card(site)) {
        const element = elementNode(site.node);
        if (element) {
          if (parentCard(element)) emit(site.node, 'An explicit Card or card class is nested inside another card. Remove the redundant container.', '명시적인 Card 또는 card 클래스가 다른 카드 안에 중첩되어 있습니다. 불필요한 컨테이너를 제거하세요.');
          cardElements.add(element);
        }
      }
    },
    onClassSite(site) {
      if (!site.element || !isVisibleUiText(context, site.node)) return;
      for (const part of site.parts) for (const token of splitClasses(part.value)) {
        if (matchesClass(token, settings.allowClasses)) continue;
        const base = baseClass(token);
        if (ruleName === 'no-oversized-radius' && (/^rounded-[3-9]xl$/.test(base) || oversized(/^rounded-\[(.+)\]$/.exec(base)?.[1]))) {
          emit(part.node, `Class ${JSON.stringify(token)} explicitly applies a large corner radius. Use an approved surface radius.`, `클래스 ${JSON.stringify(token)}이(가) 큰 모서리 반경을 직접 지정합니다. 승인된 표면 모서리 값을 사용하세요.`);
        }
        if (ruleName === 'no-generic-fonts') {
          const family = /^font-\[(.+)\]$/.exec(base)?.[1]?.replaceAll('_', ' ') ?? /^font-(inter|arial|helvetica|roboto)$/i.exec(base)?.[1];
          if (family) checkFonts(part.node, family);
        }
      }
    },
    onStyleSite(site) {
      if (!isVisibleUiText(context, site.node)) return;
      for (const property of site.properties) {
        if (ruleName === 'no-oversized-radius' && ['borderRadius', 'border-radius'].includes(property.name)) {
          for (const value of property.values) if (oversized(value)) emit(property.node, `Inline border radius ${JSON.stringify(value)} is large (at least 32px or 2rem). Use an approved surface radius.`, `인라인 모서리 반경 ${JSON.stringify(value)}이(가) 큽니다(32px 또는 2rem 이상). 승인된 표면 모서리 값을 사용하세요.`);
        }
        if (ruleName === 'no-generic-fonts' && ['fontFamily', 'font-family'].includes(property.name)) {
          for (const value of property.values) if (typeof value === 'string') checkFonts(property.node, value);
        }
      }
    },
  });
}
