# @pixelhize/eslint-plugin-goodui

GoodUI의 일반 프로젝트 계약 9종·네이티브 디자인 규칙 6종·AI Slop 13종을 제공하는 ESLint flat-config 엔진입니다. JS·TS·JSX·TSX·Vue HTML SFC·Svelte와 rune 파일을 지원합니다. 일반 프로젝트는 메인 CLI만 직접 설치합니다. AI Slop은 Tailwind 없이 `aiSlop.enabled`·`aiSlop.rules`로 활성화와 개별 항목을 선택합니다.

```sh
npx --yes @pixelhize/goodui-cli@0.3.0 init --yes --mode lint --preset project
npm exec -- goodui rules --format json
npm exec -- goodui check
```

기존 ESLint 설정에는 메인 패키지의 공개 인터페이스를 연결합니다.

```js
import { fileURLToPath } from 'node:url';
import { createConfig } from '@pixelhize/goodui-cli/config';

export default await createConfig({
  rootDir: fileURLToPath(new URL('.', import.meta.url)),
  policyPath: 'goodui.policy.json',
});
```

직접 API 통합에는 이 패키지도 `createConfig`, `lintProject`, default plugin을 제공합니다. `createConfig({rootDir, policyPath?, policy?})`는 `Promise<Linter.Config[]>`를 반환하고 입력 `policy`가 `policyPath`보다 우선합니다. 디자인 규칙 준비와 parser 구성을 포함하므로 내장 규칙만 수동 등록하는 대신 factory를 사용하세요.

`lintProject({rootDir, policyPath?, policy?, files?})`는 `{diagnostics, errorCount, warningCount, filesChecked}`를 반환합니다. `files`는 프로젝트 내부의 실제 파일·디렉터리이며 `app/[id]/page.tsx` 같은 literal 경로를 지원합니다. glob은 정책의 `files`에 적습니다. 대상의 임의 ESLint·Svelte 설정 코드를 실행하거나 소스를 자동 수정하지 않습니다.

일반 계약은 import·API·의존 경계·금지 UI·AST selector·파일 규약·export·함수 지표·컴포넌트 props입니다. JSX·Vue·Svelte의 원래 위치를 유지하며 정적 값과 일부 const·import 별칭을 추적합니다. 계약마다 파일 범위·이유·수정 방향·중앙 예외를 지정합니다. 자세한 옵션은 `goodui explain component-contracts`처럼 필요한 kind를 조회하세요.

Tailwind preset에는 색상·임의 값·inline style·unknown class의 기본 네 규칙과 선택적 `no-restyle`·`require-static-classes`가 있습니다. 클래스 lexer·값 분석·토큰·컴포넌트 인식·진단은 자체 구현이며 실제 utility 생성 여부만 공식 Tailwind 컴파일러 primitive를 사용합니다. CSS는 PostCSS로 파싱합니다. 별도 외부 린터는 사용하지 않습니다.

디자인 설정은 `tailwind.rules`, `themeFiles`, `allowClasses`, `denyClasses`, `allowArbitrary`, `classFunctions`, `variantFunctions`, `componentImports`, `ignoreImports`, `note`입니다. unknown-class에는 실제 CSS entry가 필요합니다. `themeFiles`, `components.json`의 `tailwind.css`, 자동 탐색으로 확인하며 없거나 모호하면 설정 오류를 보고합니다. 디자인 규칙 ID와 예외는 `goodui/no-restyle` 형태입니다.

에디터는 준비한 정책과 디자인 소스를 유지하므로 변경 시 다시 로드해야 합니다. 읽힌 테마·컴포넌트가 바뀌면 `DESIGN_ENGINE_STALE`로 알립니다. CLI·MCP는 호출마다 새로 준비합니다. `goodui doctor --format json`은 소스를 고치지 않고 설정 준비 상태를 확인합니다.

기본 소스 확장자는 `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`, `.vue`, `.svelte`입니다. node_modules·.git·dist·coverage를 제외합니다. inline ESLint 지시문으로 계약을 끌 수 없으며 유효하지 않은 정책·빈 검사·적용할 계약이 없는 실행은 명시적으로 실패합니다.

지원 환경은 Node `^22.13 || >=24`, ESLint `^9.39 || ^10`입니다. 정적 타입 검사, 임의 실행 흐름·wrapper 전체, CSS 전체·최종 화면·실제 네트워크 상태는 보장하지 않습니다. 기존 lint·typecheck와 함께 사용하세요.
