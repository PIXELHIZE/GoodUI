import { localizeMessage, resolveLocale, type LocaleInput } from '@pixelhize/goodui-core';

const messages: Record<string, string> = {
  'Package manager must be npm, pnpm, yarn, or bun.': '패키지 매니저는 npm, pnpm, yarn, bun 중 하나여야 합니다.',
  'Install mode must be lint, agent, all, or config.': '설치 모드는 lint, agent, all, config 중 하나여야 합니다.',
  'Non-interactive init requires --yes or --mode lint|agent|all|config.': '비대화형 init에는 --yes 또는 --mode lint|agent|all|config가 필요합니다.',
  'How would you like to set up GoodUI?': 'GoodUI를 어떻게 설정할까요?',
  'Lint': '린트 검사',
  'Local checks, editor integration, and CI': '로컬 검사, 에디터 연동, CI',
  'AI agent': 'AI 에이전트',
  'CLI and MCP tools': 'CLI와 MCP 도구',
  'Lint + AI agent': '린트 검사 + AI 에이전트',
  'Editor, CI, and MCP tools': '에디터, CI, MCP 도구',
  'Configuration only': '설정만 생성',
  'Skip dependency installation': '의존성 설치 생략',
  'Cannot read the project package.json.': '프로젝트의 package.json을 읽을 수 없습니다.',
  'The project package.json must contain valid JSON.': '프로젝트의 package.json에 유효한 JSON이 필요합니다.',
  'The project package.json must contain an object.': '프로젝트의 package.json은 객체여야 합니다.',
  'Unsupported package.json packageManager field. Set --package-manager npm|pnpm|yarn|bun explicitly.': 'package.json의 packageManager 필드를 지원하지 않습니다. --package-manager npm|pnpm|yarn|bun을 명시하세요.',
  'Multiple package manager lockfiles were found. Set --package-manager npm|pnpm|yarn|bun explicitly.': '여러 패키지 매니저의 lockfile이 있습니다. --package-manager npm|pnpm|yarn|bun을 명시하세요.',
  'Preset must be project, development, tailwind, or full.': 'preset은 project, development, tailwind, full 중 하나여야 합니다.',
  'The GoodUI installer version must be an exact semantic version.': 'GoodUI 설치기 버전은 정확한 시맨틱 버전이어야 합니다.',
  'Install commands must use the planned package manager, argument array, and project root.': '설치 명령은 계획된 패키지 매니저, 인수 배열, 프로젝트 루트를 사용해야 합니다.',
  'The reserved .goodui/schema.json path contains a different file. Move it before setting up GoodUI.': '예약된 .goodui/schema.json 경로에 다른 파일이 있습니다. GoodUI를 설정하기 전에 해당 파일을 옮기세요.',
  'Existing ESLint configuration is preserved. Add the returned integration snippet to enable GoodUI in your editor; goodui check already works independently.': '기존 ESLint 설정을 보존했습니다. 반환된 통합 코드를 추가하면 에디터에서 GoodUI를 사용할 수 있습니다. goodui check는 독립적으로 실행됩니다.',
  'package.json scripts must be an object.': 'package.json의 scripts는 객체여야 합니다.',
  'Existing lint:goodui script is preserved; run goodui check directly.': '기존 lint:goodui 스크립트를 보존했습니다. goodui check를 직접 실행하세요.',
  'A custom policy path is in use. Run goodui check with --policy; add a matching project script if needed.': '사용자 지정 정책 경로를 사용합니다. goodui check에 --policy를 전달하고 필요하면 해당 경로를 사용하는 프로젝트 스크립트를 추가하세요.',
  'package.json changed while setting up scripts. Run init again.': '스크립트 설정 중 package.json이 변경되었습니다. init을 다시 실행하세요.',
  'The generated schema changed during setup. Run init again.': '설정 중 생성 스키마가 변경되었습니다. init을 다시 실행하세요.',
  'An ESLint config was created concurrently and was preserved. Add the integration snippet manually.': '동시에 생성된 ESLint 설정을 보존했습니다. 통합 코드를 직접 추가하세요.',
  'Existing explicit tailwind.rules were preserved; the full preset did not replace or enable additional style rules.': '명시된 기존 tailwind.rules를 보존했습니다. full preset은 디자인 규칙을 교체하거나 추가로 활성화하지 않았습니다.',
  'Do not execute strings as code.': '문자열을 코드로 실행하지 마세요.',
  'Use explicit function calls or parse data with JSON.parse instead.': '명시적인 함수 호출을 사용하거나 JSON.parse로 데이터를 해석하세요.',
  'Use explicit TypeScript types and checked nullable values.': '명확한 TypeScript 타입을 사용하고 null 가능성을 확인하세요.',
  'Replace any with a specific type or unknown, and narrow null or undefined before use.': 'any 대신 구체적인 타입이나 unknown을 사용하고 사용 전에 null 또는 undefined를 확인하세요.',
  'Keep functions small enough to review and test.': '함수를 검토하고 테스트하기 쉬운 크기로 유지하세요.',
  'Extract focused functions or simplify parameters and branching while preserving behavior.': '동작을 유지하면서 역할별 함수를 분리하거나 인자와 분기를 단순화하세요.',
  'Keep source files focused and reviewable.': '소스 파일의 역할을 명확히 하고 검토하기 쉬운 크기로 유지하세요.',
  'Split independent responsibilities into focused modules while preserving their public interfaces.': '공개 인터페이스를 유지하면서 독립적인 역할을 별도 모듈로 분리하세요.',
  'Buttons must declare their intended browser behavior.': '버튼의 브라우저 동작을 명시하세요.',
  'Set type to button, submit, or reset to match the action.': '동작에 맞게 type을 button, submit, reset 중 하나로 설정하세요.',
  'Images must declare an alternative for assistive technologies.': '보조 기술을 위한 이미지 대체 텍스트를 명시하세요.',
  'Add descriptive alt text, or alt="" for a decorative image.': '이미지를 설명하는 alt 텍스트를 추가하고 장식용 이미지에는 alt=""를 사용하세요.',
};

/** Translate GoodUI-owned CLI prose only; paths, commands and user policy text stay intact. */
export function localizeCliMessage(message: string, locale?: LocaleInput): string {
  if (resolveLocale(locale) !== 'ko') return message;
  if (Object.hasOwn(messages, message)) return messages[message]!;
  let match: RegExpExecArray | null;
  if ((match = /^package\.json (\S+) must map package names to string versions\.$/.exec(message))) return `package.json의 ${match[1]}는 패키지 이름과 문자열 버전을 연결하는 객체여야 합니다.`;
  if ((match = /^Detected (npm|pnpm|yarn|bun) from (.+); dependencies will be added to the selected project (.+)\.$/s.exec(message))) return `${match[2]}에서 ${match[1]}을 감지했습니다. 선택한 프로젝트 ${match[3]}에 의존성을 추가합니다.`;
  if ((match = /^Existing ESLint version range (.+) is not compatible with GoodUI \((.+)\)\. Update it explicitly or choose --mode agent\|config\.$/s.exec(message))) return `기존 ESLint 버전 범위 ${match[1]}는 GoodUI(${match[2]})와 호환되지 않습니다. 버전을 직접 변경하거나 --mode agent|config를 선택하세요.`;
  if ((match = /^Could not start (npm|pnpm|yarn|bun): (.*)$/s.exec(message))) return `${match[1]}을 시작할 수 없습니다: ${match[2]}`;
  if ((match = /^(npm|pnpm|yarn|bun) installation failed(?: \((.+)\)| with exit code (.+))\.$/s.exec(message))) return `${match[1]} 설치에 실패했습니다${match[2] ? ` (${match[2]})` : ` (종료 코드 ${match[3]})`}.`;
  if ((match = /^Dependency installation failed: (.*)$/s.exec(message))) return `의존성 설치에 실패했습니다: ${match[1]}`;
  if ((match = /^Existing policy id (.+) uses (.+) instead of preset kind (.+); the existing rule was preserved\.$/s.exec(message))) return `기존 정책 ID ${match[1]}는 preset의 ${match[3]} 대신 ${match[2]}를 사용합니다. 기존 규칙을 보존했습니다.`;
  return localizeMessage(message, 'ko');
}

export async function withCliLocale<T>(locale: LocaleInput | undefined, operation: () => Promise<T>): Promise<T> {
  const selected = resolveLocale(locale);
  try { return await operation(); }
  catch (error) {
    if (error instanceof Error) error.message = localizeCliMessage(error.message, selected);
    throw error;
  }
}
