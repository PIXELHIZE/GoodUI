# 파일·구문·export·함수 규약

아래 네 계약은 JS·TS 소스를 검사하며 Vue·Svelte의 파싱된 script에도 적용됩니다. 각 계약의 `id`, `files`, `reason`, `suggestion`, 사유 있는 `exceptions`는 다른 일반 계약과 같습니다. 하나 이상의 실질적인 검사 옵션이 필요합니다.

`goodui init --yes --preset development`는 any·non-null 구문, 함수 인자 5·100줄·30문장·깊이 4·복잡도 15, 파일 400줄·48,000바이트를 초기 계약으로 준비합니다. 파일 이름과 export는 전역 기본으로 강제하지 않습니다. 아래 개별 옵션과 예제는 프로젝트별로 더 세밀하게 선택하는 방법입니다. full profile은 development와 디자인·기본 UI 계약을 함께 준비합니다.

```sh
npm exec -- goodui explain restricted-syntax --format json
npm exec -- goodui explain file-conventions --format json
npm exec -- goodui explain export-contracts --format json
npm exec -- goodui explain function-limits --format json
```

## `restricted-syntax`

`selectors: string[]`에 ESLint/esquery AST selector를 적습니다. 잘못된 selector 문법은 소스 검사 전에 정책 검증에서 거부합니다.

```json
{
  "id": "explicit-types",
  "kind": "restricted-syntax",
  "files": ["src/**/*.ts", "src/**/*.tsx"],
  "selectors": ["TSAnyKeyword", "TSEnumDeclaration"],
  "reason": "데이터 타입을 명시하고 프로젝트의 표현 방식을 사용합니다.",
  "suggestion": "구체적인 타입 또는 unknown과 narrowing을 사용하세요."
}
```

selector는 구문 조건입니다. 문법이 유효하다는 사실이 모든 파일에 매칭된다는 뜻은 아닙니다. 이름을 식별하는 타입 추론이나 모든 API 별칭 검사가 필요하면 이 계약만으로 대신하지 마세요. 함수명 문자열을 selector로 제한하면 지역 shadowing도 같은 구문으로 매칭할 수 있습니다.

## `file-conventions`

| 옵션 | 기준 |
| --- | --- |
| `nameCase` | `kebab`, `camel`, `pascal`, `snake` 중 하나 |
| `suffixes` | 원래 basename이 끝나야 할 literal 문자열 중 하나 |
| `maxLines` | 양의 정수. 물리 줄 수 제한 |
| `maxBytes` | 양의 정수. UTF-8 원문 크기 제한 |

case는 최종 소스 확장자와 반복되는 `.test`·`.spec`·`.d`·`.svelte`를 제거한 stem을 검사합니다. `my-widget.spec.d.ts`, `my-widget.test.tsx`, `my-widget.svelte.ts`는 모두 `my-widget`입니다. 다른 점 접미사는 남으므로 `my-widget.service.ts`의 stem은 `my-widget.service`입니다.

`suffixes`는 원래 파일명에 대한 대소문자 구분 `endsWith`이며 점이나 glob을 자동으로 추가하지 않습니다. `.service.ts` 파일을 요구하려면 `".service.ts"`를 적습니다. case와 접미사를 동시에 사용할 때 두 기준이 서로 맞는지 확인하세요.

```json
{
  "id": "test-file-names",
  "kind": "file-conventions",
  "files": ["tests/**"],
  "nameCase": "kebab",
  "suffixes": [".test.ts", ".spec.ts"],
  "maxLines": 400,
  "maxBytes": 30000,
  "reason": "테스트 파일의 이름과 크기를 예측 가능하게 유지합니다."
}
```

줄은 LF·CRLF·CR·Unicode line separator 기준으로 셉니다. 마지막 종결 개행은 새 빈 줄로 세지 않으며 빈 파일은 0줄입니다. 바이트 수는 BOM이 있으면 그 3바이트도 포함합니다. Vue·Svelte 파일 크기는 script만이 아니라 전체 소스 기준입니다.

## `export-contracts`

`requireNamed`, `forbidDefault: true`, `forbidStar: true` 중 하나 이상의 실제 조건을 지정합니다. false 옵션만 있는 계약은 거부됩니다.

```json
{
  "id": "route-entry",
  "kind": "export-contracts",
  "files": ["src/routes/**/*.{js,ts}"],
  "requireNamed": ["handler"],
  "forbidDefault": true,
  "forbidStar": true,
  "reason": "라우트는 명시적인 handler entry를 제공합니다."
}
```

명시된 함수·class·변수·type·interface export, export specifier·alias·명시적 reexport·namespace alias·TS export import를 검사합니다. default 선언의 지역 이름은 별도 named export로 세지 않습니다. TS `export =`는 default 방식으로 취급합니다.

이름 없는 `export *`로 `requireNamed`를 증명할 수 없으면 진단합니다. 임의 모듈 그래프를 실행하거나 CommonJS `module.exports`·`exports.x` assignment에서 export를 추론하지는 않습니다. requireNamed는 정적으로 드러난 ESM 계약에 사용하세요.

## `function-limits`

`maxParams`, `maxLines`, `maxStatements`, `maxDepth`, `maxComplexity` 중 하나 이상을 양의 정수로 지정합니다.

```json
{
  "id": "reviewable-functions",
  "kind": "function-limits",
  "maxParams": 4,
  "maxLines": 80,
  "maxStatements": 30,
  "maxDepth": 4,
  "maxComplexity": 12,
  "reason": "함수 하나를 독립적으로 읽고 검증할 수 있게 유지합니다."
}
```

함수 선언·표현식·arrow·메서드를 검사하고 body 없는 TS overload는 제외합니다. 기본·rest 매개변수도 인자 수에 포함합니다. 함수 줄 수는 시그니처를 포함한 AST 시작·끝 범위입니다.

문장·깊이·복잡도는 중첩 함수 body와 분리합니다. 중첩 함수 선언 자체는 바깥 함수의 문장 하나로 셉니다. 깊이는 if·loop·switch·try·with를 세며 단순 중괄호는 세지 않습니다. else-if·catch·finally는 같은 부모 깊이를 사용합니다.

복잡도는 기본 1에 if·조건식·loop·catch·default가 아닌 switch case·논리식·기본값 대입 패턴·논리 대입·각 optional member/call마다 1을 더합니다. 다른 도구의 복잡도 수치와 완전히 같다고 가정하지 마세요. 이 기준은 코드의 실행 성능이나 테스트 충분성을 보증하지 않습니다.

[전체 개발 정책 예제](../examples/development-policy.json)의 경로와 한계를 프로젝트에 맞게 조정해 사용하세요. Props 계약은 [정책 명세](policy.md#component-contracts)를 참고하세요.
