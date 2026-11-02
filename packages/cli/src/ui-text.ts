import { resolveLocale, type Locale, type LocaleInput } from '@pixelhize/goodui-core';

export const text = (locale: Locale, en: string, ko: string): string => locale === 'ko' ? ko : en;

/** Read this global flag before command/help dispatch, including `mcp`. */
export function localeArguments(argv: string[], fallback: Locale): { argv: string[]; locale: Locale } {
  const remaining: string[] = [];
  let selected: LocaleInput | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--') { remaining.push(...argv.slice(index)); break; }
    if (arg !== '--locale' && !arg.startsWith('--locale=')) { remaining.push(arg); continue; }
    const value = arg === '--locale' ? argv[++index] : arg.slice('--locale='.length);
    const diagnosticLocale = selected === undefined ? fallback : resolveLocale(selected);
    if (!value || !['ko', 'en', 'auto'].includes(value)) {
      throw Object.assign(new Error(text(diagnosticLocale, '--locale must be ko, en, or auto.', '--locale에는 ko, en, auto 중 하나를 지정하세요.')), { code: 'INVALID_LOCALE' });
    }
    if (selected !== undefined && selected !== value) {
      throw Object.assign(new Error(text(diagnosticLocale, 'Conflicting --locale values.', '--locale 값이 서로 충돌합니다.')), { code: 'INVALID_LOCALE' });
    }
    selected = value as LocaleInput;
  }
  return { argv: remaining, locale: selected === undefined ? fallback : resolveLocale(selected) };
}

export function helpText(locale: Locale, english: string): string {
  return locale === 'en' ? english : `GoodUI — JavaScript·TypeScript 프로젝트 규칙 검사

사용법:
  goodui init                              키보드 설치 마법사
  goodui init --yes --mode lint            프로젝트 검사 설치와 설정
  goodui init --yes --mode all --preset tailwind
  goodui init --dry-run --format json       파일을 바꾸지 않고 변경 계획 확인
  goodui init --no-install                  설치 없이 설정만 생성
  goodui check [FILE_OR_DIR ...] [--root DIR] [--policy FILE] [--format text|json]
  goodui policy validate [--root DIR] [--policy FILE] [--format text|json]
  goodui policy enable|disable ai-slop|CHECK_ID [--format json]
  goodui rules [--format json]             내장 규칙과 프리셋 목록
  goodui explain RULE_OR_POLICY_ID [--format json]
  goodui doctor [--root DIR] [--policy FILE] [--format json]
  goodui mcp [--root DIR] [--policy FILE]    포함된 MCP 서버 실행

설치 옵션:
  --mode lint|agent|all|config              --yes의 기본값: lint
  --preset project|development|tailwind|full --yes의 기본값: project
  --package-manager npm|pnpm|yarn|bun        생략하면 프로젝트에서 감지
  -y, --yes                                기본값으로 비대화형 실행
  --dry-run                                설치 명령과 변경 파일 미리 보기
  --no-install                             --mode config와 같은 기능
  --ai-slop / --no-ai-slop                  내장 AI Slop 검사 전체 켜기·끄기
  --ai-slop-rules CHECK_1,CHECK_2            지정한 AI Slop 검사만 켜기

언어:
  --locale ko|en|auto                       모든 명령에서 언어 선택 (기본값: auto)
  GOODUI_LOCALE=ko|en                       환경 변수로 언어 고정
  자동 감지: GOODUI_LOCALE → LC_ALL → LC_MESSAGES → LANG → 시스템 언어

메인 패키지는 @pixelhize/goodui-cli 하나이며 코어·플러그인·MCP가 함께 제공됩니다.
Tailwind v4 모드는 GoodUI 자체 디자인 시스템 규칙을 활성화합니다.
기존 lint·typecheck 명령을 보존합니다.
JS·TS·JSX·TSX·Vue·Svelte를 지원하며 검사 중 소스 파일을 수정하지 않습니다.
종료 코드: 0 통과, 1 위반, 2 설정·실행 오류, 130 취소.
  -h, --help     도움말
  -v, --version  버전
`;
}
