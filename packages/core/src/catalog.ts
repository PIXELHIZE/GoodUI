import { AI_SLOP_RULE_NAMES, DEFAULT_AI_SLOP_RULES, DEFAULT_TAILWIND_RULES, TAILWIND_RULE_NAMES, type Policy, type PolicyRule } from "./types.js";
import { policySchema } from "./policy.js";
import type { Locale } from './locale.js';

const definitions = policySchema["definitions"] as Record<string, unknown>;
const optionsSchema = (name: string) => {
  const selected = new Set<string>();
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const ref = (value as { $ref?: unknown }).$ref;
    if (typeof ref === 'string' && ref.startsWith('#/definitions/')) {
      const target = ref.slice('#/definitions/'.length);
      if (!selected.has(target)) { selected.add(target); visit(definitions[target]); }
    }
    for (const child of Object.values(value)) visit(child);
  }
  const body = definitions[name] as Record<string, unknown>;
  visit(body);
  return { ...body, ...(selected.size ? { definitions: Object.fromEntries([...selected].map(key => [key, definitions[key]])) } : {}) };
};

export const presetCatalog = [{
  name: 'tailwind',
  engine: 'native',
  description: 'Native GoodUI Tailwind token and design-system contracts with framework-aware source diagnostics.',
  setup: 'goodui init --yes --preset tailwind',
  defaultRules: DEFAULT_TAILWIND_RULES,
  availableRules: TAILWIND_RULE_NAMES,
}, {
  name: 'ai-slop',
  engine: 'native',
  description: 'Optional source checks for repeated AI-generated design patterns, stock UI copy and placeholder content.',
  setup: 'goodui init --yes',
  defaultRules: DEFAULT_AI_SLOP_RULES,
  availableRules: AI_SLOP_RULE_NAMES,
  example: { version: 1, presets: ['ai-slop'], rules: [] } satisfies Policy,
}] as const;

export const ruleCatalog = [
  {
    kind: "restricted-imports",
    description: "Disallow configured module specifiers in imports, exports, require and static dynamic imports.",
    optionsSchema: optionsSchema("restrictedImports"),
    example: {
      id: "approved-network-library",
      kind: "restricted-imports",
      modules: ["axios", "node:http"],
      reason: "Network access must use the project network wrapper.",
      suggestion: "Import the approved network client instead.",
    } satisfies PolicyRule,
  },
  {
    kind: "restricted-api",
    description: "Disallow statically identified global and imported API calls and value references, respecting local shadowing and CommonJS bindings.",
    optionsSchema: optionsSchema("restrictedApi"),
    example: {
      id: "approved-network-api",
      kind: "restricted-api",
      globals: ["fetch", "XMLHttpRequest"],
      reason: "Use the project network wrapper.",
      suggestion: "Call the approved client from the network layer.",
    } satisfies PolicyRule,
  },
  {
    kind: "import-boundaries",
    description: "Limit which resolved project files or external modules a source file may import.",
    optionsSchema: optionsSchema("importBoundaries"),
    example: {
      id: "ui-does-not-import-server",
      kind: "import-boundaries",
      from: ["src/ui/**"],
      disallow: ["src/server/**"],
      reason: "The UI must use the public service layer.",
      suggestion: "Import a service interface instead of a server implementation.",
    } satisfies PolicyRule,
  },
  {
    kind: "restricted-ui",
    description: "Disallow explicit UI tags, imported components, attributes or framework-equivalent features.",
    optionsSchema: optionsSchema("restrictedUi"),
    example: {
      id: "design-system-ui",
      kind: "restricted-ui",
      tags: ["button"],
      features: ["inline-style"],
      reason: "Use the project's design system components and styles.",
      suggestion: "Use the shared Button and approved style tokens.",
    } satisfies PolicyRule,
  },
  {
    kind: 'restricted-syntax',
    description: 'Reject nodes matching validated ESLint/esquery selectors, including TypeScript syntax.',
    optionsSchema: optionsSchema('restrictedSyntax'),
    example: {
      id: 'no-explicit-any', kind: 'restricted-syntax', selectors: ['TSAnyKeyword'],
      reason: 'Public application types must describe their data explicitly.',
      suggestion: 'Use a concrete type or unknown and narrow it before use.',
    } satisfies PolicyRule,
  },
  {
    kind: 'file-conventions',
    description: 'Require a filename case or suffix and limit physical source lines and UTF-8 bytes.',
    optionsSchema: optionsSchema('fileConventions'),
    example: {
      id: 'service-files', kind: 'file-conventions', files: ['src/services/**'],
      nameCase: 'kebab', suffixes: ['.ts', '.js'], maxLines: 400, maxBytes: 30000,
      reason: 'Services follow a predictable filename and stay small enough to review.',
    } satisfies PolicyRule,
  },
  {
    kind: 'export-contracts',
    description: 'Require explicit named exports and forbid default or star exports without resolving arbitrary module graphs.',
    optionsSchema: optionsSchema('exportContracts'),
    example: {
      id: 'route-exports', kind: 'export-contracts', files: ['src/routes/**'],
      requireNamed: ['handler'], forbidDefault: true, forbidStar: true,
      reason: 'Each route exposes the same explicit entry point.',
    } satisfies PolicyRule,
  },
  {
    kind: 'function-limits',
    description: 'Limit function parameters, lines, statements, nesting depth and cyclomatic complexity; nested functions have independent limits.',
    optionsSchema: optionsSchema('functionLimits'),
    example: {
      id: 'reviewable-functions', kind: 'function-limits', maxParams: 4, maxLines: 80,
      maxStatements: 30, maxDepth: 4, maxComplexity: 12,
      reason: 'Keep each function focused enough to inspect and test independently.',
    } satisfies PolicyRule,
  },
  {
    kind: 'component-contracts',
    description: 'Require or forbid props and validate present static values on selected tags or imported components in JSX, Vue and Svelte.',
    optionsSchema: optionsSchema('componentContracts'),
    example: {
      id: 'explicit-button-contract', kind: 'component-contracts', tags: ['button'],
      requiredProps: ['type', 'aria-label'], nonEmptyProps: ['aria-label'],
      propValues: { type: ['button', 'submit', 'reset'] },
      reason: 'Buttons declare their behavior and accessible name.',
      suggestion: 'Set an explicit type and a nonempty aria-label.',
    } satisfies PolicyRule,
  },
] as const;

const metadataKo: Readonly<Record<string, string>> = {
  'GoodUI policy': 'GoodUI 정책',
  'Optional source checks for repeated AI-generated design patterns, stock UI copy and placeholder content.': '반복되는 AI 생성 디자인 패턴, 상투적인 UI 문구, 임시 콘텐츠를 선택적으로 검사하는 소스 규칙입니다.',
  'Optional source checks for repeated AI-generated design patterns. Configuration alone does not enable the group.': '반복되는 AI 생성 디자인 패턴을 선택적으로 검사하는 소스 규칙입니다. 설정만 추가하면 그룹은 활성화되지 않습니다.',
  'Explicitly enable or disable the group, overriding the ai-slop preset. Existing policies remain disabled unless opted in.': '그룹의 활성 여부를 명시합니다. ai-slop preset보다 우선하며 기존 정책은 직접 활성화하기 전까지 꺼진 상태를 유지합니다.',
  'Boolean overrides for individual checks. The first ten checks default to enabled; nested cards, oversized radius and generic fonts are opt-in.': '개별 검사에 적용할 boolean 설정입니다. 앞의 10개 검사는 기본으로 활성화되며 중첩 카드, 과도한 모서리 반경, 일반적인 글꼴은 선택적으로 활성화합니다.',
  'Project-relative source globs checked by this group, within the global policy file scope.': '전체 정책의 파일 범위 안에서 이 그룹이 검사할 프로젝트 기준 상대 경로 glob입니다.',
  'Project-relative source globs excluded from this group.': '이 그룹의 검사에서 제외할 프로젝트 기준 상대 경로 glob입니다.',
  "Explicit class patterns allowed by the group's class-based checks.": '그룹의 클래스 기반 검사에서 명시적으로 허용할 클래스 패턴입니다.',
  'Explicit phrases allowed by text checks; project-authored values are preserved without translation.': '텍스트 검사에서 명시적으로 허용할 표현입니다. 프로젝트에서 작성한 값은 번역하지 않고 보존합니다.',
  'Explicit font-family names allowed by the generic-font check.': '일반적인 글꼴 검사에서 명시적으로 허용할 font-family 이름입니다.',
  'Deterministic project contracts shared by GoodUI CLI, ESLint and MCP.': 'GoodUI CLI, ESLint, MCP가 함께 검증하는 프로젝트 규약입니다.',
  'Native GoodUI Tailwind token and design-system contracts with framework-aware source diagnostics.': '프레임워크 구문을 분석해 Tailwind 토큰과 디자인 시스템 규약을 검사하는 GoodUI 자체 엔진입니다.',
  'Disallow configured module specifiers in imports, exports, require and static dynamic imports.': 'import, export, require, 정적으로 확인 가능한 동적 import에서 지정한 모듈을 금지합니다.',
  'Network access must use the project network wrapper.': '네트워크 접근에는 프로젝트의 네트워크 래퍼를 사용해야 합니다.',
  'Import the approved network client instead.': '승인된 네트워크 클라이언트를 import하세요.',
  'Disallow statically identified global and imported API calls and value references, respecting local shadowing and CommonJS bindings.': '지역 변수의 이름 가림과 CommonJS 바인딩을 구분해, 정적으로 확인 가능한 전역·import API 호출과 값 참조를 금지합니다.',
  'Use the project network wrapper.': '프로젝트의 네트워크 래퍼를 사용하세요.',
  'Call the approved client from the network layer.': '네트워크 계층에서 승인된 클라이언트를 호출하세요.',
  'Limit which resolved project files or external modules a source file may import.': '소스 파일이 import할 수 있는 프로젝트 파일과 외부 모듈의 범위를 제한합니다.',
  'The UI must use the public service layer.': 'UI는 공개 서비스 계층을 사용해야 합니다.',
  'Import a service interface instead of a server implementation.': '서버 구현 대신 서비스 인터페이스를 import하세요.',
  'Disallow explicit UI tags, imported components, attributes or framework-equivalent features.': '지정한 UI 태그, import한 컴포넌트, 속성, 프레임워크별 대응 기능을 금지합니다.',
  "Use the project's design system components and styles.": '프로젝트 디자인 시스템의 컴포넌트와 스타일을 사용하세요.',
  'Use the shared Button and approved style tokens.': '공용 Button과 승인된 스타일 토큰을 사용하세요.',
  'Reject nodes matching validated ESLint/esquery selectors, including TypeScript syntax.': 'TypeScript 구문을 포함해 검증된 ESLint/esquery selector와 일치하는 구문을 금지합니다.',
  'Public application types must describe their data explicitly.': '공개 애플리케이션 타입은 데이터 구조를 명확히 표현해야 합니다.',
  'Use a concrete type or unknown and narrow it before use.': '구체적인 타입이나 unknown을 사용하고 사용 전에 타입을 좁히세요.',
  'Require a filename case or suffix and limit physical source lines and UTF-8 bytes.': '파일 이름의 대소문자 규칙이나 접미사를 지정하고 실제 소스 줄 수와 UTF-8 바이트 수를 제한합니다.',
  'Services follow a predictable filename and stay small enough to review.': '서비스는 예측 가능한 파일 이름을 사용하고 검토하기 쉬운 크기를 유지해야 합니다.',
  'Require explicit named exports and forbid default or star exports without resolving arbitrary module graphs.': '임의의 모듈 그래프를 추적하지 않고 명시적 named export를 요구하거나 default·star export를 금지합니다.',
  'Each route exposes the same explicit entry point.': '각 라우트는 동일한 명시적 진입점을 공개해야 합니다.',
  'Limit function parameters, lines, statements, nesting depth and cyclomatic complexity; nested functions have independent limits.': '함수의 매개변수, 줄 수, 문장 수, 중첩 깊이, 순환 복잡도를 제한합니다. 중첩 함수는 별도로 계산합니다.',
  'Keep each function focused enough to inspect and test independently.': '각 함수를 독립적으로 검토하고 테스트할 수 있도록 역할을 좁게 유지하세요.',
  'Require or forbid props and validate present static values on selected tags or imported components in JSX, Vue and Svelte.': 'JSX, Vue, Svelte에서 선택한 태그나 import한 컴포넌트의 prop을 필수·금지로 지정하고 정적인 값을 검증합니다.',
  'Buttons declare their behavior and accessible name.': '버튼은 동작과 접근 가능한 이름을 명시해야 합니다.',
  'Set an explicit type and a nonempty aria-label.': 'type과 비어 있지 않은 aria-label을 명시하세요.',
  'Native GoodUI design-system checks. Defaults to color, arbitrary-value, inline-style and unknown-class checks.': 'GoodUI 자체 디자인 시스템 검사입니다. 기본으로 색상, 임의 값, 인라인 스타일, 알 수 없는 클래스를 검사합니다.',
  'Case of the filename stem after removing the source extension and repeated .test/.spec/.d/.svelte suffixes.': '소스 확장자와 반복되는 .test/.spec/.d/.svelte 접미사를 제거한 파일 이름의 대소문자 규칙입니다.',
  'Case-sensitive literal endings of the original basename; no implicit dots or globs.': '원래 파일 이름의 끝부분을 대소문자를 구분해 비교합니다. 점이나 glob을 자동으로 추가하지 않습니다.',
  'Maximum physical source lines. Empty source has zero lines; a final newline does not add a line.': '실제 소스 줄 수의 상한입니다. 빈 소스는 0줄이며 마지막 줄바꿈은 줄 수를 늘리지 않습니다.',
  'Maximum UTF-8 source bytes, including a leading BOM.': '파일 앞의 BOM을 포함한 UTF-8 소스 바이트 수의 상한입니다.',
  'Required explicit ESM export names. Bare export-star does not prove required names.': '필수로 공개해야 하는 명시적 ESM export 이름입니다. 단순 export *는 필수 이름을 증명하지 못합니다.',
  'Maximum parameters in a function signature, including rest/default parameters.': '나머지 매개변수와 기본값 매개변수를 포함한 함수 매개변수 수의 상한입니다.',
  'Maximum inclusive source lines for the function node, including its signature.': '함수 시그니처를 포함한 함수 구문 전체 줄 수의 상한입니다.',
  'Maximum statements in this function body, excluding nested function bodies.': '중첩 함수 본문을 제외한 현재 함수 본문의 문장 수 상한입니다.',
  'Maximum nested if/loop/switch/try/with depth; ordinary braces do not increase depth.': 'if·반복문·switch·try·with의 중첩 깊이 상한입니다. 일반 중괄호는 깊이를 늘리지 않습니다.',
  'Cyclomatic base 1 plus branching, logical/default/optional-chain decisions; nested functions are measured independently.': '기본값 1에 분기, 논리식, 기본값, 선택적 체인의 결정 지점을 더합니다. 중첩 함수는 별도로 계산합니다.',
  'Props that must be present on each targeted component.': '대상 컴포넌트마다 반드시 있어야 하는 prop입니다.',
  'If present, values must be nonblank strings or finite numbers. Combine with requiredProps to require presence.': '값이 있으면 공백만 있는 문자열이 아니거나 유한한 숫자여야 합니다. 존재도 필수로 하려면 requiredProps와 함께 사용하세요.',
  'Allowed typed primitive values for present props. Combine with requiredProps to require presence.': '값이 있는 prop에 허용할 원시 값입니다. 값의 타입도 구분합니다. 존재도 필수로 하려면 requiredProps와 함께 사용하세요.',
  'Allow unknown checked values and spreads. Unknown spreads may supply otherwise missing required props.': '확인할 수 없는 값과 spread를 허용합니다. 알 수 없는 spread에 누락된 필수 prop이 있다고 간주할 수 있습니다.',
};

/** This is only applied to immutable built-in metadata, never to project policy data. */
function translateMetadata(value: unknown, locale: Locale): unknown {
  if (Array.isArray(value)) return value.map(child => translateMetadata(child, locale));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    locale === 'ko' && ['title', 'description', 'reason', 'suggestion'].includes(key) && typeof child === 'string'
      ? metadataKo[child] ?? child : translateMetadata(child, locale),
  ]));
}

export interface RuleCatalogEntry { kind: PolicyRule['kind']; description: string; optionsSchema: Record<string, unknown>; example: PolicyRule }
export interface PresetCatalogEntry { name: 'tailwind' | 'ai-slop'; engine: 'native'; description: string; setup: string; defaultRules: readonly string[]; availableRules: readonly string[]; example?: Policy }

export function getRuleCatalog(locale: Locale = 'en'): RuleCatalogEntry[] {
  return translateMetadata(ruleCatalog, locale) as RuleCatalogEntry[];
}

export function getPresetCatalog(locale: Locale = 'en'): PresetCatalogEntry[] {
  return translateMetadata(presetCatalog, locale) as PresetCatalogEntry[];
}

export function getPolicySchema(locale: Locale = 'en'): Record<string, unknown> {
  return translateMetadata(policySchema, locale) as Record<string, unknown>;
}
