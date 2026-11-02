# 네이티브 Tailwind·디자인 규칙

GoodUI가 클래스 lexer, JSX·Vue·Svelte 값 분석, 프로젝트 토큰 수집, 컴포넌트 인식과 진단을 구현합니다. CSS 파싱에는 PostCSS, 실제 utility 생성 여부에는 공식 Tailwind 컴파일러 primitive를 사용합니다. 별도 외부 린터는 포함하거나 연결하지 않습니다.

현재 검증한 컴파일러는 Tailwind 4.3.3입니다. 사용 중인 design-system primitive는 `__unstable__loadDesignSystem`이므로 필요한 API 존재를 런타임에 확인하고 호환되지 않으면 설정 오류를 반환합니다. Tailwind CSS나 UI 프레임워크 자체의 설치·업그레이드는 수행하지 않습니다.

utility 검증을 준비할 때 entry의 Tailwind import·plugin·config는 공식 컴파일러가 처리합니다. 일반 계약의 AST 검사와 함께 프로젝트의 CSS toolchain 정보를 사용하는 단계입니다.

## 시작과 기본 규칙

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode lint --preset tailwind
npm exec -- goodui doctor --format json
npm exec -- goodui check
```

정책에 `presets: ["tailwind"]`가 있으면 아래 기본 네 규칙을 켭니다. `tailwind.rules`를 지정하면 기본 목록에 추가하는 대신 해당 목록으로 교체합니다. 일반 계약은 함께 유지할 수 있고 `rules: []`인 Tailwind 전용 정책도 가능합니다.

CLI의 `--preset full`은 새 정책에 development 계약·기본 button/img 계약과 여섯 디자인 규칙을 함께 준비합니다. 기존 정책이 디자인 규칙을 명시적으로 골랐다면 그 선택을 보존합니다. JSON `presets`에는 `full`을 적지 않습니다.

| 규칙 ID | 의미 | 기본 |
| --- | --- | --- |
| `goodui/no-raw-colors` | 팔레트·hex·색상 함수 대신 프로젝트의 색상 토큰 사용 | 켜짐 |
| `goodui/no-arbitrary-values` | 클래스의 임의 값 사용 제한 | 켜짐 |
| `goodui/no-inline-styles` | inline style과 지역 style block 제한 | 켜짐 |
| `goodui/no-unknown-classes` | 실제 테마에서 생성되지 않는 클래스 검사 | 켜짐 |
| `goodui/no-restyle` | 인식한 디자인 컴포넌트의 표현 변경 제한 | 명시적 선택 |
| `goodui/require-static-classes` | UI 요소와 클래스 helper의 동적 값을 정적으로 확인할 수 있는지 검사 | 명시적 선택 |

## CSS entry와 토큰

권장 방식은 실제 Tailwind entry를 정책에 명시하는 것입니다.

```json
{
  "version": 1,
  "presets": ["tailwind"],
  "rules": [],
  "tailwind": {
    "themeFiles": ["src/styles/app.css"]
  }
}
```

```css
/* src/styles/app.css: 기존 Tailwind v4 프로젝트의 entry 예 */
@import "tailwindcss";

@theme {
  --color-brand: oklch(0.58 0.16 252);
  --color-surface: oklch(0.98 0.01 252);
  --color-content: oklch(0.22 0.03 252);
}
```

위 프로젝트에서는 `bg-brand`, `text-content` 같은 utility를 사용합니다. Tailwind의 `@theme`와 utility 관계는 [공식 theme 문서](https://tailwindcss.com/docs/theme)를 참고하세요. 정책은 프로젝트의 명시적인 `@theme` 색상 선언을 읽으며 변수의 최종 런타임 값을 모두 계산하지는 않습니다.

entry 탐색 순서는 다음과 같습니다.

1. `tailwind.themeFiles`에 지정한 프로젝트 내부 CSS glob
2. 생략한 경우 루트 `components.json`의 `tailwind.css`
3. 위 정보가 없으면 `@import "tailwindcss"`가 있는 CSS 자동 탐색

자동 탐색 결과가 여러 개면 `TAILWIND_THEME_AMBIGUOUS`로 명시 경로를 요청합니다. 기본 unknown-class 검사에 entry가 없으면 `TAILWIND_THEME_NOT_FOUND`입니다. 해당 규칙을 선택하지 않은 다른 검사만은 CSS 없이 실행할 수 있지만 색상 토큰 기반 안내는 제한됩니다.

명시한 entry가 여러 개면 토큰을 합치고 어느 컴파일러에서든 생성되는 클래스를 허용합니다. 앱별로 테마가 자동 분리되는 기능은 아니므로 서로 다른 앱의 정책과 `files`를 구분하세요. root 밖의 임의 CSS 경로를 정책에 지정할 수 없습니다.

## 설정 필드

`tailwind` 바로 아래에 필드를 적습니다. 이름 목록과 패턴 목록은 문자열 배열이며 비어 있는 배열은 받지 않습니다.

| 필드 | 해석 |
| --- | --- |
| `rules` | 사용할 여섯 내장 규칙 중 하나 이상의 이름 |
| `themeFiles` | 프로젝트 루트 기준 CSS entry glob |
| `allowClasses` | 허용할 클래스 패턴. 클래스 기반 디자인 진단을 건너뜁니다. |
| `denyClasses` | 금지할 클래스 패턴. allow보다 우선합니다. |
| `allowArbitrary` | arbitrary-value 검사에서만 허용할 클래스 패턴 |
| `classFunctions` | 추가로 인식할 클래스 조합 함수 이름 또는 import export 이름 |
| `variantFunctions` | 추가로 인식할 variant 함수 이름 또는 import export 이름 |
| `componentImports` | 디자인 컴포넌트로 인식할 import source 패턴 |
| `ignoreImports` | 컴포넌트 인식에서 제외할 import source 패턴. 인식보다 우선합니다. |
| `note` | 디자인 진단 끝에 붙일 프로젝트 안내 문자열 |

클래스 패턴은 `*`·`?`만 wildcard로 사용하며 `[]`는 문자 그대로입니다. 전체 token과 `hover:`·`md:` 등을 제거한 base class 양쪽에 매칭합니다. 따라서 `allowArbitrary: ["w-[var(--sidebar-width)]"]`는 해당 클래스의 반응형 표현에도 적용됩니다. `allowArbitrary`가 raw-color 검사까지 끄지는 않습니다.

import 패턴은 원문 모듈 이름에 대한 glob입니다. `componentImports`를 생략하면 발견한 `components.json`의 `aliases.ui`와 기본 `components/ui` 관례를 사용합니다. CSS 경로를 직접 지정하는 경우 사용자 지정 컴포넌트 출처도 `componentImports`에 명시하는 편이 분명합니다.

```json
{
  "version": 1,
  "presets": ["tailwind"],
  "rules": [],
  "tailwind": {
    "rules": ["no-raw-colors", "no-arbitrary-values", "no-inline-styles", "no-unknown-classes", "no-restyle", "require-static-classes"],
    "themeFiles": ["src/styles/app.css"],
    "componentImports": ["@/components/ui/**", "@acme/ui", "@acme/ui/**"],
    "ignoreImports": ["@vendor/chart/**"],
    "allowClasses": ["app-shell"],
    "denyClasses": ["legacy-*"],
    "allowArbitrary": ["w-[var(--sidebar-width)]"],
    "classFunctions": ["mergeClasses"],
    "variantFunctions": ["buttonVariants"],
    "note": "승인된 토큰과 컴포넌트 variant를 사용하세요."
  },
  "exceptions": [{
    "ruleId": "goodui/no-restyle",
    "files": ["src/components/ui/**"],
    "reason": "공용 컴포넌트 구현부에서 자체 표현을 정의합니다."
  }]
}
```

## 각 검사의 범위

`no-raw-colors`는 클래스의 직접 색상, 명시적 inline 색상, SVG 색상 속성을 검사합니다. 프로젝트가 직접 선언한 색상 이름은 토큰으로 취급합니다. `currentColor`·`var(...)` 같은 재사용 표현의 최종 런타임 색상은 계산하지 않습니다.

`no-inline-styles`는 CSS custom property만 적은 정적 inline 객체·문자열은 허용합니다. 동적 객체와 일반 CSS 속성, JSX의 `<style>`, Vue·Svelte의 지역 style block은 진단합니다. custom property의 직접 색상은 별도 raw-color 진단 대상일 수 있습니다. CSS 문서 전체를 검사하는 범용 스타일 린터는 아닙니다.

`no-unknown-classes`는 테마 컴파일러의 후보 생성 결과와 명시적으로 읽은 CSS 클래스를 사용합니다. `group`·`peer` marker는 별도 처리합니다. 허용·금지 클래스와 token이 먼저 적용되고, 생성되지 않는 후보에는 가까운 클래스 이름을 제안합니다.

`no-restyle`은 인식한 디자인 컴포넌트에서 padding·width·height·size, 색상·타이포그래피·표현 변경을 진단하고 알려진 `size`·`variant` 값을 안내합니다. margin·space·gap·배치 관련 클래스는 허용합니다. 모든 유틸리티를 디자인 의미로 분류하거나 모든 wrapper 경유를 추적하는 것은 아닙니다.

`require-static-classes`는 일반 UI 요소와 클래스 helper까지 검사합니다. 일반 문자열 리터럴, 가능한 리터럴 조건 분기, 배열·객체의 클래스 키, 한 단계 const, `cn`·`clsx`·`twMerge`·`cva`·`tv` 계열의 알려진 값을 읽습니다. 임의 함수 반환값과 런타임 조합 전체를 추론하지는 않습니다.

## 에디터 재로드와 오류 확인

CSS·읽힌 import·components.json·읽힌 컴포넌트 파일은 준비한 엔진의 변경 감지 대상입니다. 에디터가 이전 설정을 유지한 상태에서 파일이 바뀌면 `DESIGN_ENGINE_STALE`로 ESLint 재로드를 요청합니다. CLI·MCP 검사는 호출마다 새로 준비합니다.

```sh
npm exec -- goodui doctor --format json
npm exec -- goodui explain goodui/no-unknown-classes --format json
npm exec -- goodui check --format json
```

`doctor`는 테마 entry와 컴파일러 설정 준비 여부를 확인하지만 최종 화면이나 모든 CSS 조합의 정확성을 검증하지 않습니다. [완전한 JSON 예제](../examples/tailwind-policy.json)를 복사할 때는 source·theme·컴포넌트 경로를 실제 프로젝트에 맞게 바꾸세요.
