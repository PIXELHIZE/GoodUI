# 정책 명세

정책 원본은 프로젝트 루트의 `goodui.policy.json`입니다. CLI의 `--policy` 또는 API의 `policyPath`로 다른 프로젝트 내부 경로를 선택할 수 있습니다. 실행 가능한 JS·TS 설정을 정책 원본으로 읽지 않습니다.

`init`은 스키마 자동완성을 설정하고 `.goodui/schema.json`을 생성합니다. 이 로컬 사본을 사용하면 node_modules 디렉터리가 없는 설치 방식이나 설정만 생성하는 실행에서도 에디터가 스키마를 읽을 수 있습니다. 정책은 `goodui.policy.json`에서 편집하며 생성된 스키마는 정책 대신 편집하는 파일이 아닙니다. 직접 통합하는 도구에는 `@pixelhize/goodui-cli/schema.json` export도 제공합니다.

기존 스키마 사본은 GoodUI가 생성한 것으로 식별되는 경우에만 갱신합니다. 같은 경로에 다른 파일이 있으면 덮어쓰지 않고 충돌을 보고합니다. 스키마 생성·갱신 경로도 dry-run의 변경 파일 목록에 포함됩니다.

## 공통 필드

| 필드 | 의미 |
| --- | --- |
| `$schema` | 선택 사항. 에디터 자동완성용 스키마 경로. 검사기는 패키지에 포함된 로컬 스키마를 사용합니다. |
| `version` | 필수. 현재 `1`만 지원합니다. |
| `files` | 선택 사항. 검사할 프로젝트 상대 파일 glob 목록. 생략 시 지원 확장자 전체를 선택합니다. |
| `ignores` | 선택 사항. 기본 제외 경로에 추가할 glob 목록. |
| `presets` | 선택 사항. `tailwind`·`ai-slop` 검사군을 활성화합니다. |
| `aiSlop` | 선택 사항. 전체 enabled·개별 boolean 규칙·범위·허용 목록·메모입니다. |
| `tailwind` | 선택 사항. 규칙·테마·클래스·함수·컴포넌트 출처 설정. preset 활성화가 필요합니다. |
| `rules` | 필수. 일반 프로젝트 계약 목록. 활성 preset이 없으면 활성 일반 계약이 하나 이상 필요합니다. |
| `exceptions` | 선택 사항. `{ "ruleId", "files", "reason" }` 목록. 지정 계약을 지정 파일에서 제외합니다. |

일반 계약은 `id`, `kind`, `reason`이 필요합니다. `id`는 정책 안에서 고유해야 합니다. `enabled`는 생략하면 활성이고 `false`이면 비활성입니다. 계약별 `files`는 해당 계약이 적용되는 파일을 추가로 제한합니다. `suggestion`에는 진단에 표시할 수정 방향을 적습니다. 네이티브 디자인 예외는 `goodui/규칙이름`을 사용합니다. [Tailwind 설정](tailwind.md)을 참고하세요.

CLI 설치 템플릿 `--preset project|development|tailwind|full`과 이 JSON의 `presets`는 구분합니다. 정책 `presets`에는 `tailwind`·`ai-slop`을 사용할 수 있습니다. AI Slop은 명시적 `aiSlop.enabled`가 preset보다 우선하며 기존 정책에서 두 설정이 모두 없으면 비활성입니다.

스키마에 없는 필드, 잘못된 옵션, 빈 이유, 존재하지 않는 계약을 가리키는 예외는 거부됩니다. 필드가 요구하는 패턴 목록은 하나 이상의 항목이 있어야 합니다. 예외의 `reason`도 필수입니다.

지원 확장자는 `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.cts`, `.vue`, `.svelte`입니다. `.svelte.js`·`.svelte.ts`에는 Svelte parser를 적용합니다. 기본 제외 경로는 `**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/coverage/**`입니다. 생성물의 다른 경로는 프로젝트의 `ignores`에 추가합니다.

## 패턴 매칭

파일 패턴은 프로젝트 루트를 기준으로 하며 `/`를 경로 구분자로 사용합니다. Windows 파일 경로도 `/`로 정규화합니다. 패턴은 minimatch glob이며 여러 항목 중 하나가 일치하면 매칭됩니다. `*`는 한 경로 단계, `**`는 여러 경로 단계에 사용할 수 있습니다. `!`를 제외 연산자로 사용하지 말고 `ignores`나 `disallow`에 명시하세요.

```json
{
  "files": ["src/**/*.{js,ts,jsx,tsx,vue,svelte}"],
  "ignores": ["src/generated/**"]
}
```

위 조각은 전체 정책이 아닙니다. 최상위 필드와 계약별 옵션을 한 JSON 문서에 작성합니다. 계약의 `reason`·`suggestion`은 설명용이며 자연어 자체가 검사 조건으로 해석되지는 않습니다.

## 일반 계약

일반 계약은 아래 다섯 종류와 [구문·파일·export·함수 규약 네 종류](development.md)를 합쳐 9종입니다. `goodui rules --format json`으로 디자인 규칙 6종과 AI Slop 검사 13종까지 포함한 28종 목록을 보고 `goodui explain kind`로 필요한 세부 옵션만 확인할 수 있습니다. [AI Slop](ai-slop.md)은 `aiSlop.enabled`와 `aiSlop.rules`로 전체·개별 항목을 제어하며 Tailwind 설정 없이도 동작합니다.

### `restricted-imports`

`modules: string[]`에 금지할 모듈 지정자 패턴을 적습니다.

```json
{
  "id": "approved-http-client",
  "kind": "restricted-imports",
  "modules": ["axios", "legacy-network/**"],
  "reason": "네트워크 접근은 공용 클라이언트를 사용합니다.",
  "suggestion": "프로젝트의 network 모듈을 import하세요."
}
```

정적 `import`, source가 있는 `export`, 전역 `require()`, `import()`, TS import-equals 선언과 `type T = import('module').T` 타입 참조를 검사합니다. 매칭 대상은 선언에 적힌 모듈 문자열입니다. 이 계약에서 별칭을 실제 파일 경로로 바꾸어 매칭하지는 않습니다. 폴더 간 의존성을 제한하려면 `import-boundaries`를 사용합니다.

리터럴·보간 없는 template literal·정적 문자열 연결은 해석합니다. 활성 import 계약이 있는데 `import(variable)`처럼 모듈을 해석할 수 없으면 진단을 반환합니다. 지역 함수로 가려진 `require`는 전역 모듈 로더로 취급하지 않습니다.

### `restricted-api`

`globals` 또는 `imports` 중 하나 이상을 지정합니다. `globals`는 전역 API 경로 패턴입니다. `imports`는 `{ "source": "모듈 패턴", "names": ["export 경로 패턴"] }` 목록입니다.

```json
{
  "id": "network-api",
  "kind": "restricted-api",
  "globals": ["fetch", "XMLHttpRequest", "Math.random"],
  "imports": [{ "source": "legacy-client", "names": ["request", "default.get"] }],
  "reason": "승인된 프로젝트 API를 사용합니다."
}
```

정적으로 식별한 API 참조 사용을 검사하므로 함수·생성자 호출뿐 아니라 callback 전달과 별칭 대입도 진단 대상입니다. `fetch()`·`globalThis.fetch()` 같은 명시적 전역 접근, `.call`·`.apply`·`.bind` 사용, import 별칭, namespace member, CommonJS 바인딩, 일부 `const` 별칭·구조 분해를 추적합니다. 지역 변수나 인자로 가려진 이름은 같은 이름의 전역 API로 판정하지 않습니다.

named import는 export 이름, default import는 `default`, namespace import의 member는 해당 member 경로를 사용합니다. default import의 member 호출에는 `default.get`과 `get` 형태를 모두 매칭합니다. `source`는 import에 적힌 모듈 문자열입니다.

### `import-boundaries`

`from`에 출발 파일 패턴을 지정하고 `allow` 또는 `disallow` 중 하나 이상을 지정합니다.

```json
{
  "id": "ui-boundary",
  "kind": "import-boundaries",
  "from": ["src/ui/**"],
  "allow": ["src/ui/**", "src/shared/**", "react", "react/**"],
  "disallow": ["src/shared/server-only/**"],
  "reason": "UI는 공개된 공용 계층에만 의존합니다."
}
```

`from`에 해당하는 파일의 모듈 참조를 검사합니다. 프로젝트 안의 대상은 symlink를 해석한 실제 파일의 프로젝트 상대 경로로, 외부 의존성은 모듈 문자열로 매칭합니다. 상대 경로와 루트 `tsconfig.json`·`jsconfig.json`의 별칭을 해석합니다. **`disallow`가 우선**이며, 금지 항목이 아니어도 `allow`가 있으면 그중 하나에 포함되어야 합니다.

해석하지 못한 상대 import나 설정된 별칭, 정적으로 알 수 없는 동적 import는 진단을 반환합니다. 타입 검사 전체를 수행하거나 번들러의 모든 별칭 플러그인을 실행하지는 않습니다. 선언된 별칭을 설정 파일에 명시하세요. 컴파일러 설정의 `extends`는 프로젝트 밖의 임의 파일을 읽지 않으며 `node_modules`의 설정 패키지는 허용합니다.

### `restricted-ui`

`tags`, `components`, `attributes`, `features` 중 하나 이상을 지정합니다.

```json
{
  "id": "design-system",
  "kind": "restricted-ui",
  "tags": ["button"],
  "components": [{ "source": "@legacy/ui", "names": ["Button", "default"] }],
  "attributes": ["data-legacy-*"],
  "features": ["inline-style", "raw-html"],
  "reason": "승인된 디자인 시스템으로 UI를 구성합니다."
}
```

| 옵션 | 매칭 대상 |
| --- | --- |
| `tags` | 소스에 명시된 요소·컴포넌트 태그 이름 패턴 |
| `components` | import source와 export 이름. 로컬 import 별칭을 추적합니다. |
| `attributes` | 프레임워크 차이를 정규화한 속성 이름 패턴 |
| `features: ["inline-style"]` | React `style`, Vue `style`·`:style`, Svelte `style`·`style:` directive |
| `features: ["raw-html"]` | React `dangerouslySetInnerHTML`, Vue `v-html`, Svelte `{@html ...}` |

속성 이름은 React `className`을 `class`, `htmlFor`를 `for`로 정규화합니다. React `onClick`, Vue `@click`·`v-on:click`, Svelte `on:click`·`onclick`은 `on:click`으로 매칭합니다. Vue의 정적인 `v-bind:속성`도 해당 속성 이름으로 매칭합니다.

script뿐 아니라 JSX 표현식, Vue template 표현식, Svelte 표현식의 API 사용도 검사합니다. Vue에서는 표준 HTML template과 JS·TS script를 지원합니다. Pug 같은 template 전처리 언어, 외부 `<script src>`·`<template src>`는 지원되지 않는 구문으로 보고합니다.

### `component-contracts`

`tags` 또는 `components` 중 하나 이상의 대상과 아래 실제 검사 옵션 중 하나 이상이 필요합니다. `components`는 `{ "source", "names" }` 목록이며 import 별칭·namespace와 제한된 const 별칭을 추적합니다. 지역 변수로 가려진 import 이름은 같은 컴포넌트로 취급하지 않습니다.

| 옵션 | 의미 |
| --- | --- |
| `requiredProps: string[]` | 대상마다 존재해야 할 속성 |
| `forbiddenProps: string[]` | 명시적으로 사용할 수 없는 속성 |
| `nonEmptyProps: string[]` | 존재하면 공백뿐이지 않은 문자열 또는 숫자여야 하는 속성 |
| `propValues` | 존재하는 속성의 허용 값 배열. string·number·boolean·null을 타입별로 구분합니다. |
| `allowDynamicProps: boolean` | 기본 false. 확인할 수 없는 값·spread를 명시적으로 허용 |

```json
{
  "id": "explicit-button-props",
  "kind": "component-contracts",
  "tags": ["button"],
  "requiredProps": ["type", "aria-label"],
  "forbiddenProps": ["dangerouslySetInnerHTML"],
  "nonEmptyProps": ["aria-label"],
  "propValues": { "type": ["button", "submit", "reset"] },
  "reason": "버튼의 동작과 이름을 명시합니다."
}
```

`nonEmptyProps`·`propValues`는 존재하는 값만 검사합니다. 필수 값이면 `requiredProps`에도 넣습니다. 숫자 `1`과 문자열 `"1"`은 다릅니다. nonempty 검사에서 null·undefined·boolean·빈 문자열·공백 문자열은 실패합니다. 필수이면서 금지한 속성처럼 명시적으로 모순되는 계약은 정책 검증에서 거부합니다.

`tags`와 `components`의 출처·export 이름은 패턴으로 선택하고 props 옵션은 정규화한 정확한 속성 이름을 지정합니다. 예를 들어 `requiredProps: ["aria-label"]`을 사용하며 props 이름에 파일 glob을 넣지 않습니다.

JSX·Vue·Svelte 속성과 정적 객체 spread를 읽고 마지막 정적 속성의 값을 적용합니다. `className`→`class`, `htmlFor`→`for`, 각 프레임워크 event 표기를 공통 이름으로 정규화합니다. 확인할 수 없는 spread와 검사 대상 속성의 동적 값은 기본적으로 진단합니다. `allowDynamicProps: true`이면 미확인 부분을 허용하며 spread 안의 필수 속성 존재도 런타임에 맡깁니다. 이미 확인된 금지 값까지 허용하지는 않습니다.

임의 컴포넌트 등록·wrapper 반환값·동적 컴포넌트의 모든 대상을 추론하거나 접근성 전체를 검사하지 않습니다. [Props 예제](../examples/component-policy.json)를 프로젝트 API에 맞춰 조정하세요.

## 예외와 적용 순서

파일이 최상위 `files`에 포함되고 `ignores`에서 제외되어야 검사 대상입니다. 계약이 활성이고 계약별 `files`에도 포함되어야 적용됩니다. 그 뒤 일치하는 `exceptions`가 해당 계약만 제외합니다. import 경계 계약의 `from`은 그 안에서 출발 파일을 한 번 더 선택합니다.

```json
{
  "ruleId": "network-api",
  "files": ["src/network/**"],
  "reason": "실제 네트워크 API는 이 계층에서만 호출합니다."
}
```

예외는 코드 근처의 주석이 아니라 정책에 보관합니다. `eslint-disable`·inline ESLint 설정은 GoodUI 구성에서 효과가 없습니다. 정책에 활성 계약이 없거나 선택한 파일에 적용 가능한 계약이 전혀 없으면 CLI·MCP 검사는 실패합니다.

## 정적 분석의 경계

- 동적 import처럼 검사 대상임이 분명하지만 값을 해석할 수 없는 경우에는 해당 활성 계약의 진단을 반환합니다.
- UI 속성·기능 계약이 있으면, 정적으로 해석할 수 없는 spread나 동적 속성 이름도 진단을 반환합니다. 직접 적은 객체 리터럴의 속성은 검사합니다.
- 임의 실행 흐름, 반환값, 런타임 생성 코드, 복잡한 재대입을 모두 추적하지는 않습니다. API 제한은 완전한 런타임 샌드박스가 아닙니다.
- 동적 컴포넌트는 정적으로 식별되는 import 참조까지만 추적합니다. Vue 전역 등록·자동 import나 런타임에 선택되는 모든 컴포넌트를 알아내지는 못합니다.
- 디자인 preset은 지역 style block의 존재와 지원하는 색상·클래스 표현을 검사할 수 있지만 CSS 전체 의미, 최종 렌더링, 접근성·디자인 품질 전체를 검증하지는 않습니다.
- Tailscale 접속·ACL·DNS·실제 요청 목적지의 허용 여부는 별도 실행 환경에서 검증해야 합니다. 네트워크 래퍼 사용 계약이 그 상태를 보증하지는 않습니다.

AI가 지침을 계약으로 옮길 때 표현할 수 없는 요구는 별도로 알려야 합니다. 지원하지 않는 자연어 요구를 `reason`에 넣었다는 이유만으로 검사한다고 설명하지 마세요.
