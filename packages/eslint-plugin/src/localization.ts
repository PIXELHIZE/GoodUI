import { localizeMessage, PolicyError, type Locale } from '@pixelhize/goodui-core';

/** Only GoodUI-owned prose is translated. Captured code, paths and user text stay intact. */
const literal: Record<string, string> = {
  'The dynamic module specifier cannot be checked statically; use a literal or a reasoned policy exception.': '동적 모듈 경로는 정적으로 검사할 수 없습니다. 문자열 리터럴을 사용하거나 사유가 있는 정책 예외를 지정하세요.',
  'The dynamic dependency cannot be checked against the import boundary.': '동적 의존성을 import 경계와 대조할 수 없습니다.',
  'The dependency cannot be resolved.': '의존성 경로를 확인할 수 없습니다.',
  'Inline styles are forbidden.': '인라인 스타일을 사용할 수 없습니다.',
  'Raw HTML insertion is forbidden.': 'HTML 문자열을 직접 삽입할 수 없습니다.',
  'Dynamic attributes cannot be checked against the UI attribute/feature contract; use explicit attributes or a reasoned policy exception.': '동적 속성을 UI 속성·기능 계약과 대조할 수 없습니다. 속성을 명시하거나 사유가 있는 정책 예외를 지정하세요.',
  'Default-style exports are forbidden; use explicit named exports.': '기본 내보내기를 사용할 수 없습니다. 이름 있는 내보내기를 명시하세요.',
  'Star exports are forbidden; list each public export explicitly.': '와일드카드 내보내기를 사용할 수 없습니다. 공개할 내보내기를 각각 명시하세요.',
  'Cannot verify this dynamic inline style. Use classes or an explicit object containing CSS custom properties only.': '동적 인라인 스타일을 검증할 수 없습니다. 클래스를 사용하거나 CSS 사용자 지정 속성만 담은 객체를 명시하세요.',
  'Local <style> elements/blocks are disallowed here. Use existing design-system classes or components.': '이 위치에서는 로컬 <style> 요소·블록을 사용할 수 없습니다. 기존 디자인 시스템 클래스나 컴포넌트를 사용하세요.',
  'Cannot parse this local CSS block to verify the design-system contract.': '로컬 CSS 블록을 분석할 수 없어 디자인 시스템 계약을 검증할 수 없습니다.',
  'External Vue script/template blocks are unsupported; inline the source so its contracts can be checked.': '외부 Vue script/template 블록은 지원하지 않습니다. 계약을 검사할 수 있도록 소스를 파일 안에 작성하세요.',
  'The explicit file list is empty.': '검사할 파일 목록이 비어 있습니다.',
  'No supported source files remain after applying the policy file patterns and ignores.': '정책의 파일 패턴과 제외 규칙을 적용한 뒤 검사할 지원 소스 파일이 없습니다.',
  'No enabled policy contract applies to the selected source files.': '선택한 소스 파일에 적용되는 활성 정책 계약이 없습니다.',
  'ESLint did not check any source files.': 'ESLint가 검사한 소스 파일이 없습니다.',
  'No CSS files match tailwind.themeFiles. Point it to the project Tailwind v4 entry stylesheet.': 'tailwind.themeFiles에 일치하는 CSS 파일이 없습니다. 프로젝트의 Tailwind v4 진입 스타일시트를 지정하세요.',
  'components.json is not valid JSON.': 'components.json이 올바른 JSON 형식이 아닙니다.',
  'The no-unknown-classes rule needs a Tailwind v4 CSS entry. Set tailwind.themeFiles or point components.json tailwind.css at it.': 'no-unknown-classes 규칙에는 Tailwind v4 진입 CSS가 필요합니다. tailwind.themeFiles 또는 components.json의 tailwind.css에 해당 파일을 지정하세요.',
  'GoodUI design rules need await createConfig({rootDir,...}). Reload the ESLint configuration to prepare the native engine.': 'GoodUI 디자인 규칙은 await createConfig({rootDir,...})로 준비해야 합니다. ESLint 설정을 다시 불러와 자체 엔진을 준비하세요.',
  'The installed compiler has no supported design-system API. GoodUI supports Tailwind v4.3+.': '설치된 컴파일러에 지원되는 디자인 시스템 API가 없습니다. GoodUI는 Tailwind v4.3 이상을 지원합니다.',
  'The installed compiler cannot validate candidates.': '설치된 컴파일러로 클래스 후보를 검증할 수 없습니다.',
};

const metric: Record<string, string> = { parameters: '매개변수 수', lines: '줄 수', statements: '문장 수', 'control nesting depth': '제어문 중첩 깊이', complexity: '복잡도' };
const category: Record<string, string> = { 'size and internal spacing': '크기와 내부 간격', 'color and typography': '색상과 글자 스타일', appearance: '외형' };
type Translation = [RegExp, (...parts: string[]) => string];
const patterns: Translation[] = [
  [/^Importing (.+) is forbidden\.$/, value => `${value}을(를) import할 수 없습니다.`],
  [/^Using global API (.+) is forbidden\.$/, value => `전역 API ${value}을(를) 사용할 수 없습니다.`],
  [/^Using ("(?:\\.|[^"\\])*") from ("(?:\\.|[^"\\])*") is forbidden\.$/, (name, source) => `${source}의 ${name}을(를) 사용할 수 없습니다.`],
  [/^Import from ("(?:\\.|[^"\\])*") to ("(?:\\.|[^"\\])*") violates the dependency boundary\.$/, (from, to) => `${from}에서 ${to}(으)로의 import가 의존성 경계를 위반합니다.`],
  [/^UI tag (.+) is forbidden\.$/, name => `UI 태그 ${name}을(를) 사용할 수 없습니다.`],
  [/^Component ("(?:\\.|[^"\\])*") from ("(?:\\.|[^"\\])*") is forbidden\.$/, (name, source) => `${source}의 컴포넌트 ${name}을(를) 사용할 수 없습니다.`],
  [/^UI attribute (.+) is forbidden\.$/, name => `UI 속성 ${name}을(를) 사용할 수 없습니다.`],
  [/^Syntax matching (.+) is forbidden\.$/, selector => `${selector}에 일치하는 구문을 사용할 수 없습니다.`],
  [/^Filename stem (.+) must use (.+) case\.$/, (name, convention) => `파일 이름의 기본 부분 ${name}은(는) ${convention} 형식을 따라야 합니다.`],
  [/^Filename (.+) must end with one of (.+)\.$/, (name, suffixes) => `파일 이름 ${name}은(는) 다음 접미사 중 하나로 끝나야 합니다: ${suffixes}.`],
  [/^File has (\d+) lines; maximum is (\d+)\.$/, (value, maximum) => `파일의 줄 수는 ${value}줄이며, 최댓값은 ${maximum}줄입니다.`],
  [/^File has (\d+) UTF-8 bytes; maximum is (\d+)\.$/, (value, maximum) => `파일의 UTF-8 크기는 ${value}바이트이며, 최댓값은 ${maximum}바이트입니다.`],
  [/^Required named export (.+) is missing\.$/, name => `필수 이름 있는 내보내기 ${name}이(가) 없습니다.`],
  [/^Required named export (.+) cannot be proven through a star export; export it explicitly\.$/, name => `와일드카드 내보내기로는 필수 내보내기 ${name}을(를) 확인할 수 없습니다. 이름을 명시하여 내보내세요.`],
  [/^Function (.+) has (\d+) (parameters|lines|statements|control nesting depth|complexity); maximum is (\d+)\.$/, (name, value, kind, maximum) => `함수 ${name}의 ${metric[kind]}은(는) ${value}이며, 최댓값은 ${maximum}입니다.`],
  [/^Dynamic prop spread on (.+) cannot be verified; use explicit props or allowDynamicProps\.$/, name => `${name}의 동적 prop 펼치기를 검증할 수 없습니다. prop을 명시하거나 allowDynamicProps 설정을 확인하세요.`],
  [/^Component (.+) requires prop (.+)\.$/, (name, prop) => `컴포넌트 ${name}에는 prop ${prop}이(가) 필요합니다.`],
  [/^Prop (.+) is forbidden on (.+)\.$/, (prop, name) => `${name}에서는 prop ${prop}을(를) 사용할 수 없습니다.`],
  [/^Dynamic value of prop (.+) cannot be verified; use a static value or allowDynamicProps\.$/, prop => `prop ${prop}의 동적 값을 검증할 수 없습니다. 정적 값을 사용하거나 allowDynamicProps 설정을 확인하세요.`],
  [/^Prop (.+) must contain a nonblank string or number\.$/, prop => `prop ${prop}에는 비어 있지 않은 문자열이나 숫자가 필요합니다.`],
  [/^Prop (.+) must be one of (.+)\.$/, (prop, values) => `prop ${prop}의 값은 ${values} 중 하나여야 합니다.`],
  [/^Cannot determine all classes on <(.+)>\. Use literal alternatives, a supported class helper, or a one-hop const value\.$/, name => `<${name}>의 모든 클래스를 확인할 수 없습니다. 리터럴로 선택지를 명시하거나 지원되는 클래스 도우미 함수 또는 한 단계 const 값을 사용하세요.`],
  [/^Cannot determine all classes in this helper call\. Use literal alternatives, a supported class helper, or a one-hop const value\.$/, () => '이 도우미 함수 호출의 모든 클래스를 확인할 수 없습니다. 리터럴로 선택지를 명시하거나 지원되는 클래스 도우미 함수 또는 한 단계 const 값을 사용하세요.'],
  [/^Class (.+) is forbidden by tailwind\.denyClasses\. Use an approved design token or component variant\.$/, token => `tailwind.denyClasses에서 클래스 ${token}을(를) 금지합니다. 승인된 디자인 토큰이나 컴포넌트 변형을 사용하세요.`],
  [/^("(?:\\.|[^"\\])*") hardcodes a color\. (.+)$/, (token, advice) => `${token}에 색상을 직접 지정했습니다. ${translatePluginMessage(advice, 'ko')}`],
  [/^Use a declared token such as (.+) from (.+)\.$/, (tokens, file) => `${file}에 선언된 토큰을 사용하세요. 사용 가능한 예: ${tokens}.`],
  [/^No approved color token is available in (.+); ask the project maintainer which existing treatment to use\.$/, file => `${file}에 승인된 색상 토큰이 없습니다. 사용할 기존 표현을 프로젝트 관리자에게 확인하세요.`],
  [/^(.+) embeds an arbitrary value\. Use a named theme token(?: or an approved (.+) scale utility)?\.$/, (token, scale) => `${token}에 임의의 값을 직접 지정했습니다. 이름 있는 테마 토큰${scale ? ` 또는 승인된 ${scale} 척도 유틸리티` : ''}를 사용하세요.`],
  [/^(.+) changes (size and internal spacing|color and typography|appearance) on <(.+)>\. (.+) Keep placement and outer spacing on the parent or margin utilities\.$/, (token, kind, name, advice) => `${token}은(는) <${name}>의 ${category[kind]}을(를) 변경합니다. ${advice} 배치와 바깥 간격은 부모 요소나 margin 유틸리티로 조정하세요.`],
  [/^Inline style sets (.+)\. Use a design-system class; reserve inline style objects for CSS custom properties\.$/, prop => `인라인 스타일에서 ${prop}을(를) 설정합니다. 디자인 시스템 클래스를 사용하고, 인라인 스타일 객체에는 CSS 사용자 지정 속성만 지정하세요.`],
  [/^Inline ("(?:\\.|[^"\\])*") hardcodes color ("(?:\\.|[^"\\])*")\. ([\s\S]+)$/, (prop, color, advice) => `인라인 ${prop}에 색상 ${color}을(를) 직접 지정했습니다. ${translatePluginMessage(advice, 'ko')}`],
  [/^(.+?)=("(?:\\.|[^"\\])*") hardcodes a color\. Use currentColor or a declared --color-\* variable\. ([\s\S]+)$/, (prop, color, advice) => `${prop}=${color}에 색상을 직접 지정했습니다. currentColor 또는 선언된 --color-* 변수를 사용하세요. ${translatePluginMessage(advice, 'ko')}`],
  [/^Local CSS (.+?) hardcodes ("(?:\\.|[^"\\])*")\. ([\s\S]+)$/, (prop, color, advice) => `로컬 CSS ${prop}에 ${color}을(를) 직접 지정했습니다. ${translatePluginMessage(advice, 'ko')}`],
  [/^Tailwind generates no CSS for (.+)\. Check spelling or use (.+)\.$/, (token, suggestions) => `Tailwind가 ${token}에 해당하는 CSS를 생성하지 않습니다. 철자를 확인하거나 ${suggestions}을(를) 사용하세요.`],
  [/^Tailwind generates no CSS for (.+)\. Use a class declared by the project theme\.$/, token => `Tailwind가 ${token}에 해당하는 CSS를 생성하지 않습니다. 프로젝트 테마에 선언된 클래스를 사용하세요.`],
  [/^Cannot resolve (import|configured alias) (.+) from (.+)\.$/, (kind, specifier, file) => `${file}에서 ${kind === 'import' ? 'import 경로' : '설정된 별칭'} ${specifier}을(를) 찾을 수 없습니다.`],
  [/^Compiler configuration extends a file outside the project: (.+)$/, file => `컴파일러 설정이 프로젝트 밖의 파일을 확장합니다: ${file}`],
  [/^Unsupported source file: (.+)$/, file => `지원하지 않는 소스 파일입니다: ${file}`],
  [/^Not a regular file or directory: (.+)$/, file => `일반 파일이나 디렉터리가 아닙니다: ${file}`],
  [/^Several Tailwind entries were found \((.+)\)\. Set tailwind\.themeFiles explicitly\.$/, files => `Tailwind 진입 파일이 여러 개 발견되었습니다(${files}). tailwind.themeFiles를 명시하세요.`],
  [/^Cannot prepare the Tailwind v4 compiler: (.+) Check tailwind\.themeFiles and the project Tailwind CSS imports\.$/s, original => `Tailwind v4 컴파일러를 준비할 수 없습니다: ${translatePluginMessage(original, 'ko')} tailwind.themeFiles와 프로젝트 Tailwind CSS import를 확인하세요.`],
  [/^Design source changed: (.+)\. Reload\/restart ESLint so createConfig can prepare the current theme; goodui check and MCP lint prepare it on each run\.$/, file => `디자인 소스가 변경되었습니다: ${file}. createConfig가 현재 테마를 준비할 수 있도록 ESLint를 다시 불러오거나 재시작하세요. goodui check와 MCP lint는 실행할 때마다 준비합니다.`],
  [/^Vue template parse error: (.+)$/s, original => `Vue 템플릿 분석 오류: ${original}`],
  [/^Unsupported Vue template language (.+)\. GoodUI requires an HTML template\.$/, language => `지원하지 않는 Vue 템플릿 언어 ${language}입니다. GoodUI에는 HTML 템플릿이 필요합니다.`],
  [/^Unsupported Vue script language (.+)\.$/, language => `지원하지 않는 Vue script 언어 ${language}입니다.`],
  [/^Invalid GoodUI policy: (.+)$/s, errors => `올바르지 않은 GoodUI 정책입니다: ${errors}`],
];

export function contextLocale(context: any): Locale { return context.settings?.gooduiLocale === 'ko' ? 'ko' : 'en'; }
export function translatePluginMessage(message: string, locale: Locale): string {
  if (locale === 'en') return message;
  if (literal[message]) return literal[message]!;
  for (const [pattern, translate] of patterns) { const match = pattern.exec(message); if (match) return translate(...match.slice(1)); }
  return localizeMessage(message, locale);
}
export function localizedError(error: unknown, locale: Locale): unknown {
  if (!(error instanceof Error) || locale === 'en') return error;
  let message = translatePluginMessage(error.message, locale);
  if (message === error.message && error instanceof PolicyError && ['INVALID_THEME_CSS', 'INVALID_COMPILER_CONFIG'].includes(error.code)) message = `${error.code === 'INVALID_THEME_CSS' ? '테마 CSS 분석 오류' : '컴파일러 설정 오류'}: ${message}`;
  return error instanceof PolicyError ? new PolicyError(error.code, message, error.details) : Object.assign(new Error(message, { cause: error }), { name: error.name, ...('code' in error ? { code: error.code } : {}) });
}
