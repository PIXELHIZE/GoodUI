import { PolicyError } from './errors.js';

export type Locale = 'en' | 'ko';
export type LocaleInput = Locale | 'auto';
export interface LocaleOptions { locale?: Locale }

function detectedLanguage(value: string): Locale {
  return /^ko(?:[-_.@]|$)/i.test(value.trim()) ? 'ko' : 'en';
}

/** Resolve each request independently; no global language setting is mutated. */
export function resolveLocale(input?: LocaleInput, env: NodeJS.ProcessEnv = process.env, systemLocale?: string): Locale {
  if (input !== undefined && input !== 'auto' && input !== 'en' && input !== 'ko') {
    throw new PolicyError('INVALID_LOCALE', 'Locale must be en, ko, or auto.');
  }
  if (input === 'en' || input === 'ko') return input;
  for (const name of ['GOODUI_LOCALE', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name]?.trim();
    if (!value || name === 'GOODUI_LOCALE' && value.toLowerCase() === 'auto') continue;
    return detectedLanguage(value);
  }
  try { return detectedLanguage(systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale); }
  catch { return 'en'; }
}

/** Translate only recognized GoodUI messages; caller/user/third-party text stays intact. */
export function localizeMessage(message: string, locale: Locale): string {
  if (locale === 'en') return message;
  const exact = coreTranslations[message];
  if (exact) return exact;
  const wrapped = /^Invalid policy: ([\s\S]*)$/.exec(message);
  if (wrapped) return `정책이 유효하지 않습니다: ${localizePolicyDetails(wrapped[1]!, locale)}`;
  // File paths and JSON pointers may contain newlines. Recognize their complete
  // messages before treating newlines as aggregate validation separators.
  for (const [pattern, translate] of corePathPatterns) {
    const match = pattern.exec(message);
    if (match) return translate(...match.slice(1));
  }
  if (message.includes('\n')) {
    const lines = message.split('\n');
    if (localizeMessage(lines[0]!, locale) !== lines[0]) return lines.map(line => localizeMessage(line, locale)).join('\n');
  }
  const validation = /^(\/[\s\S]*): (must [\s\S]+)$/.exec(message);
  if (validation) {
    const detail = localizeValidationDetail(validation[2]!);
    if (detail !== validation[2]) return `${validation[1]}: ${detail}`;
  }
  for (const [pattern, translate] of corePatterns) {
    const match = pattern.exec(message);
    if (match) return translate(...match.slice(1));
  }
  return message;
}

const coreTranslations: Readonly<Record<string, string>> = Object.freeze({
  'Locale must be en, ko, or auto.': '언어는 en, ko, auto 중 하나여야 합니다.',
  'Policy must contain at least one enabled rule.': '정책에는 활성 규칙이 하나 이상 필요합니다.',
  'Policy changed since it was read. Read it again before saving.': '정책을 읽은 뒤 내용이 변경됐습니다. 저장하기 전에 다시 읽어 주세요.',
  'Policy was edited while saving. Read it again before saving.': '저장 중 정책이 변경됐습니다. 저장하기 전에 다시 읽어 주세요.',
  'invalid policy': '유효하지 않은 정책',
});

const corePatterns: readonly [RegExp, (...groups: string[]) => string][] = [
  [/^Duplicate rule id: ([\s\S]*)$/, id => `규칙 ID가 중복됩니다: ${id}`],
  [/^Exception references unknown rule id: ([\s\S]*)$/, id => `예외가 존재하지 않는 규칙 ID를 참조합니다: ${id}`],
  [/^Rule ([\s\S]*): invalid AST selector ([\s\S]*)\.$/, (id, selector) => `규칙 ${id}: AST selector 문법이 올바르지 않습니다: ${selector}.`],
  [/^Rule ([\s\S]*): prop ([\s\S]*) cannot be forbidden and required or value-constrained\.$/, (id, prop) => `규칙 ${id}: 속성 ${prop}에 금지와 필수 또는 값 제한을 동시에 지정할 수 없습니다.`],
];

const corePathPatterns: readonly [RegExp, (...groups: string[]) => string][] = [
  [/^Cannot inspect project path: ([\s\S]*)$/, path => `프로젝트 경로를 확인할 수 없습니다: ${path}`],
  [/^Project root must be an existing directory: ([\s\S]*)$/, path => `프로젝트 루트는 존재하는 디렉터리여야 합니다: ${path}`],
  [/^Path is outside the project root: ([\s\S]*)$/, path => `프로젝트 루트 밖의 경로입니다: ${path}`],
  [/^Path resolves outside the project root: ([\s\S]*)$/, path => `경로의 실제 대상이 프로젝트 루트 밖에 있습니다: ${path}`],
  [/^Path does not exist: ([\s\S]*)$/, path => `경로가 존재하지 않습니다: ${path}`],
  [/^Cannot resolve project path: ([\s\S]*)$/, path => `프로젝트 경로의 실제 대상을 확인할 수 없습니다: ${path}`],
  [/^Policy is not valid JSON: ([\s\S]*)$/, path => `정책 파일의 JSON 형식이 올바르지 않습니다: ${path}`],
  [/^Policy file does not exist: ([\s\S]*)$/, path => `정책 파일이 존재하지 않습니다: ${path}`],
  [/^Cannot read policy file: ([\s\S]*)$/, path => `정책 파일을 읽을 수 없습니다: ${path}`],
  [/^Cannot lock policy file: ([\s\S]*)$/, path => `정책 파일을 잠글 수 없습니다: ${path}`],
  [/^Policy is being edited, or a stale lock needs removal: ([\s\S]*)$/, path => `정책을 편집 중이거나 남은 잠금 파일을 정리해야 합니다: ${path}`],
  [/^Cannot write policy file: ([\s\S]*)$/, path => `정책 파일을 저장할 수 없습니다: ${path}`],
];

function localizeValidationDetail(message: string): string {
  const exact: Record<string, string> = {
    'must NOT have additional properties': '허용되지 않은 속성이 있습니다.',
    'must match exactly one schema in oneOf': '허용된 형식 중 정확히 하나와 일치해야 합니다.',
    'must match a schema in anyOf': '허용된 형식 중 하나와 일치해야 합니다.',
    'must be equal to one of the allowed values': '허용된 값 중 하나여야 합니다.',
    'must be equal to constant': '지정된 값과 일치해야 합니다.',
    'must contain at least 1 valid item(s)': '조건에 맞는 항목이 하나 이상 필요합니다.',
    'must be object': 'object 형식이어야 합니다.',
    'must be array': 'array 형식이어야 합니다.',
    'must be string': 'string 형식이어야 합니다.',
    'must be boolean': 'boolean 형식이어야 합니다.',
    'must be number': 'number 형식이어야 합니다.',
    'must be integer': 'integer 형식이어야 합니다.',
  };
  if (exact[message]) return exact[message];
  const patterns: [RegExp, (...groups: string[]) => string][] = [
    [/^must have required property '([\s\S]*)'$/, property => `필수 속성이 없습니다: ${property}.`],
    [/^must NOT have fewer than (\d+) items$/, count => `항목이 최소 ${count}개 필요합니다.`],
    [/^must NOT have fewer than (\d+) properties$/, count => `속성이 최소 ${count}개 필요합니다.`],
    [/^must NOT have fewer than (\d+) characters$/, count => `문자가 최소 ${count}개 필요합니다.`],
    [/^must NOT have duplicate items \(items ## (\d+) and (\d+) are identical\)$/, (first, second) => `중복 항목이 있습니다: ${first}, ${second}.`],
    [/^must match pattern "([\s\S]*)"$/, pattern => `패턴과 일치해야 합니다: ${pattern}.`],
    [/^must be >= ([\s\S]*)$/, limit => `${limit} 이상이어야 합니다.`],
    [/^must be ((?:string|number|boolean|null|array|object|integer)(?:,(?:string|number|boolean|null|array|object|integer))+)$/, types => `${types} 형식 중 하나여야 합니다.`],
    [/^must match "(then|else)" schema$/, branch => `${branch} 조건의 형식과 일치해야 합니다.`],
    [/^must have property ([\s\S]*) when property ([\s\S]*) is present$/, (required, field) => `${field} 속성이 있으면 ${required} 속성도 필요합니다.`],
  ];
  for (const [pattern, translate] of patterns) {
    const match = pattern.exec(message);
    if (match) return translate(...match.slice(1));
  }
  return message;
}

function localizePolicyDetails(detail: string, locale: Locale): string {
  // JSON-quoted selector/property payloads can themselves contain formatter-like
  // separators. Only split outside those payloads, keeping their bytes intact.
  let quoted = false, escaped = false, start = 0;
  const parts: string[] = [];
  for (let index = 0; index < detail.length; index++) {
    const char = detail[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    const separator = char === '\n' ? '\n' : detail.startsWith('; ', index) && /^(?:\/|Rule |Duplicate rule id: |Exception references unknown rule id: |Policy must contain)/.test(detail.slice(index + 2)) ? '; ' : '';
    if (separator) {
      parts.push(localizeMessage(detail.slice(start, index), locale), separator);
      index += separator.length - 1;
      start = index + 1;
    }
  }
  return parts.join('') + localizeMessage(detail.slice(start), locale);
}
