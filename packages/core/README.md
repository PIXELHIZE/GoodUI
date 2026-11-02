# @pixelhize/goodui-core

GoodUI의 정책 타입, JSON Schema, 검증, 파일 매칭, 리비전 기반 저장을 공유하는 내부 ESM 패키지입니다. Node.js `^22.13.0` 또는 `>=24`에서 사용합니다. 프로젝트에 GoodUI를 설정할 때는 메인 CLI 하나를 진입점으로 사용하세요.

```sh
npx --yes @pixelhize/goodui-cli@0.3.0 init
```

core API를 직접 사용하는 프로그램을 작성할 때만 이 패키지를 별도 설치합니다.

```sh
npm install --save-dev @pixelhize/goodui-core
```

```ts
import { definePolicy, readPolicy, writePolicy } from '@pixelhize/goodui-core';

const policy = definePolicy({
  version: 1,
  rules: [{
    id: 'no-eval',
    kind: 'restricted-api',
    globals: ['eval'],
    reason: '문자열을 코드로 실행하지 않습니다.',
  }],
});

// 새 파일을 만들 때만 expectedRevision: null을 사용합니다.
await writePolicy('/absolute/project', policy, { expectedRevision: null });

// 기존 파일은 읽은 리비전으로 갱신합니다.
const current = await readPolicy('/absolute/project');
await writePolicy('/absolute/project', policy, { expectedRevision: current.revision });
```

기본 경로는 `goodui.policy.json`입니다. `readPolicy(root, policyPath?)`, `readPolicySync(root, policyPath?)`와 `writePolicy`의 `policyPath` 옵션으로 다른 프로젝트 내부 경로를 사용할 수 있습니다.

| Export | 역할 |
| --- | --- |
| `Policy`, `PolicyRule`, 개별 계약 타입 | JS·TS API에서 사용하는 정책 계약 |
| `validatePolicy(value)` | `{ valid, errors, policy? }` 반환 |
| `definePolicy(policy)` | 런타임 검증 후 정책 반환, 실패 시 `PolicyError` |
| `policySchema` | 패키지에 포함된 JSON Schema 객체 |
| `ruleCatalog` | 아홉 계약의 설명·독립 검증 가능한 옵션 스키마·예제 |
| `presetCatalog`, `getTailwindRules` | 명시적으로 활성화한 네이티브 디자인 규칙 정보 |
| `readPolicy`, `readPolicySync` | `{ policy, revision, path }` 반환 |
| `writePolicy` | 검증·리비전 확인·잠금 후 원자적으로 저장 |
| `matchesFile`, `matchesPattern`, `isRuleApplicable` | 파일·원문 이름 패턴과 사유 있는 예외를 포함한 적용 판정 |
| `resolveProjectPath`, `resolveProjectPathSync` | 프로젝트 내부 경로 확인, 외부·symlink 탈출 거부 |

Schema는 core의 `schema.json` subpath와 메인 CLI의 `@pixelhize/goodui-cli/schema.json`에서 제공됩니다. 일반 프로젝트는 `init`이 생성하는 `.goodui/schema.json`으로 자동완성을 설정합니다. 이 로컬 사본은 node_modules 디렉터리가 없는 설치 방식에도 사용할 수 있습니다. 검사 중 스키마를 원격으로 가져오지 않습니다.

저장할 때 `expectedRevision`은 필수입니다. 리비전은 파일의 원본 바이트에 대한 SHA256입니다. 기존 파일에 `null`을 전달하거나 이전 리비전을 전달하면 `POLICY_CONFLICT`가 발생합니다. 유효하지 않은 정책은 `INVALID_POLICY`, 누락 파일은 `POLICY_NOT_FOUND`로 보고합니다. `PolicyError`는 `code`와 선택적 `details`를 제공합니다.

검증 실패·충돌에서는 기존 파일을 보존합니다. GoodUI 쓰기 작업은 잠금 파일로 직렬화합니다. 비정상 종료 후 `.lock`이 남아 `POLICY_LOCKED`가 발생하면 해당 파일을 사용하는 쓰기 프로세스가 종료됐는지 먼저 확인해야 합니다.

일반 계약은 금지 import, 금지 API, import 경계, 금지 UI, AST 구문 제한, 파일 규약, export 규약, 함수 크기 제한, 컴포넌트 props 규약을 지원합니다. `restricted-syntax.selectors`는 ESLint/esquery 구문이며 정책 검증에서 잘못된 selector를 거부합니다. 각 계약은 검사할 옵션이나 대상이 필요하며 빈 계약은 유효하지 않습니다.

파일 이름의 case는 최종 소스 확장자와 반복되는 `.test`·`.spec`·`.d`·`.svelte` 접미사를 제거한 stem에 적용합니다. 따라서 `my-widget.spec.d.ts`의 stem은 `my-widget`입니다. `suffixes`는 원래 basename의 문자 그대로의 끝부분을 검사하며 점이나 glob을 자동으로 추가하지 않습니다. `maxLines`는 마지막 종결 개행을 추가 줄로 세지 않는 물리 줄 수이며 빈 파일은 0줄입니다. `maxBytes`는 BOM을 포함한 UTF-8 원문 바이트입니다.

Export 계약은 명시적인 ESM 선언·타입·alias·reexport를 검사합니다. 이름 없는 `export *`로 필수 이름의 존재를 증명할 수 없으며 CommonJS assignment의 export는 추론하지 않습니다. 함수의 줄 수는 시그니처를 포함한 AST 범위이고 중첩 함수의 body 지표는 분리합니다. 복잡도는 기본 1에 if·조건식·loop·catch·기본이 아닌 switch case·논리식·기본 매개변수·논리 대입·optional member/call마다 1을 더합니다. 깊이는 if·loop·switch·try·with를 세며 단순 중괄호는 제외합니다.

`component-contracts`는 `tags` 또는 출처와 export 이름을 지정한 `components`를 대상으로 합니다. `requiredProps`는 존재를 요구하고 `nonEmptyProps`와 `propValues`는 존재하는 값을 검사합니다. 필수이면서 비어 있지 않아야 하는 props는 두 옵션에 모두 넣습니다. `nonEmptyProps`는 공백뿐인 문자열·null·boolean을 거부하고 문자열 또는 숫자 값을 받습니다. 검사 대상 props의 동적 값과 알 수 없는 spread는 기본적으로 오류이며 `allowDynamicProps: true`로 허용할 수 있습니다. 동적 spread를 허용하면 그 안의 필수 props 존재도 런타임에 맡깁니다.

Tailwind 검사는 외부 린트 플러그인 없이 GoodUI 네이티브 엔진을 사용합니다. `presets: ["tailwind"]`로 활성화하고 `tailwind`에서 `rules`, `themeFiles`, `allowClasses`, `denyClasses`, `allowArbitrary`, `classFunctions`, `variantFunctions`, `componentImports`, `ignoreImports`, `note`를 설정합니다. 네이티브 예외 ID는 `goodui/no-raw-colors`처럼 `goodui/`로 시작하며, 일반 계약은 사용자가 지정한 `id`를 예외에 사용합니다.
