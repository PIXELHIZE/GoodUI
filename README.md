# GoodUI

AI가 작성한 코드에 프로젝트 지침을 반복 적용하는 JS·TS 린트 도구입니다. 지침을 `goodui.policy.json`에 저장하고 에디터·CLI·CI·MCP에서 같은 검사기로 확인합니다. 검사에 모델 API 키나 AI 호출은 필요하지 않습니다.

금지 import와 API, 폴더 경계, 파일·함수 규약, 컴포넌트 props, 디자인 토큰을 검사합니다. 일반 계약 9종, 네이티브 디자인 규칙 6종, AI Slop 검사 13종을 제공합니다. 이유와 수정 방향이 있는 진단을 반환하며, 활성화할 계약은 프로젝트가 선택합니다.

현재 저장소의 소스 버전은 **0.4.0**이며 npm 0.4.0은 아직 공개하지 않았습니다. 아래 npx 설치 예제는 npm 공개 후 사용하는 명령입니다. 현재 소스는 다음과 같이 실행하고 검증할 수 있습니다.

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js --help
pnpm check
```

## 한 명령으로 시작하기

검사할 프로젝트에서 실행합니다. 터미널에서는 방향키와 Enter로 설치 모드와 preset을 선택합니다. 취소하면 설치나 파일 생성을 시작하지 않습니다.

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init
```

한국어 안내를 명시하려면 `init --locale ko`, 영어는 `--locale en`을 사용합니다. 기본 `auto`는 환경·시스템 언어를 따릅니다. 설치 마법사·내장 설명·진단의 언어를 선택하며 기존 정책의 문구는 보존합니다. [언어 설정](docs/language.md)을 참고하세요.

직접 설치하는 GoodUI 패키지는 `@pixelhize/goodui-cli` 하나입니다. 정책 코어·프레임워크 어댑터·MCP·네이티브 디자인 엔진은 함께 제공됩니다. lint·all 모드에서는 필요한 프로젝트 ESLint도 준비합니다. 이미 호환되는 ESLint 9·10이 있으면 유지합니다.

```sh
npm exec -- goodui doctor
npm exec -- goodui policy validate
npm exec -- goodui check
```

기본 project preset은 `eval` 금지 예제와 AI Slop 기본 10개 검사로 시작합니다. 프로젝트 지침에 맞게 정책을 추가하세요. `init`은 기존 정책과 ESLint 설정을 보존하고, 기존 `lint`·`typecheck`를 대체하지 않습니다. lint·all 모드는 별도 `lint:goodui` 스크립트를 추가하며 같은 이름이 있으면 유지합니다.

| 모드 | 준비하는 항목 |
| --- | --- |
| `lint` | 프로젝트 정책, 에디터 연결, 별도 검사 스크립트 |
| `agent` | 정책과 MCP 실행 설정 예제 |
| `all` | lint와 agent 항목 모두 |
| `config` | 의존성 설치 없이 설정 생성. `--no-install`과 같은 용도 |

모든 모드가 오프라인 에디터 자동완성용 `.goodui/schema.json`을 준비합니다. 기존 생성 스키마는 갱신할 수 있지만 같은 경로의 다른 파일은 덮어쓰지 않습니다. agent·all 모드는 MCP 클라이언트 설정 예제를 출력하며 호스트 설정 파일을 직접 변경하지 않습니다.

설치 preset은 초기 계약을 고르는 템플릿입니다. 아래는 **새 정책 기준**입니다. 기존 같은 ID의 계약·비활성화·예외·명시적 디자인 규칙 선택은 보존합니다.

| `--preset` | 초기 계약 |
| --- | --- |
| `project` | `eval` 금지 예제 + AI Slop 기본 10개 |
| `development` | project + TS any·non-null 제한, 함수 지표, 파일 크기 |
| `tailwind` | project + 네이티브 디자인 기본 네 규칙 |
| `full` | development + 네이티브 여섯 규칙 + button type·img alt 계약 |

development의 기본 한계는 함수 인자 5·100줄·30문장·깊이 4·복잡도 15, 파일 400줄·48,000바이트입니다. full의 img alt는 존재를 요구하며 장식용 빈 문자열은 허용합니다. 파일 이름과 export 방식은 프레임워크 차이가 있어 전역 기본 강제하지 않습니다.

추가된 계약은 `strict-ts-syntax`, `function-budget`, `file-budget`, `button-intent`, `image-alternatives` ID로 조정할 수 있습니다. full의 검사 대상 props도 기본 정적 값 기준이므로 데이터에서 오는 alt 등을 허용하려면 해당 계약의 `allowDynamicProps`를 명시적으로 선택합니다.

CLI의 `--preset development|full`은 정책 템플릿 선택입니다. 정책 JSON의 `presets`는 `tailwind`·`ai-slop` 검사군을 선택합니다. AI Slop은 `aiSlop.enabled`로도 켜거나 끌 수 있으며 이 값이 preset보다 우선합니다. full도 AI Slop의 선택 항목 세 개를 자동으로 켜지는 않습니다.

## AI와 자동화에서 설치하기

비대화형 실행에는 `--yes` 또는 명시적 `--mode`를 사용합니다. `--yes` 기본값은 lint·project입니다. npm·pnpm·Yarn·Bun을 감지하며 `--package-manager`로 지정할 수도 있습니다.

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode all --preset project --package-manager npm --dry-run --format json
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode all --preset project --package-manager npm --format json
```

dry-run은 설치 명령·변경 파일과 `enabledContracts`·`designRules`·`aiSlopRules`의 실제 활성 검사를 보여 주며 대상 프로젝트를 변경하지 않습니다. 실행기를 다운로드하는 npx 캐시는 별개입니다. AI용 절차는 [SETUP.md](SETUP.md)를 참고하세요.

개발 규약이나 디자인까지 함께 준비하려면 원하는 템플릿을 명시합니다. full은 실제 Tailwind entry가 있는 프로젝트에 사용합니다.

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode lint --preset development --dry-run --format json
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode all --preset full --dry-run --format json
```

## 개발·디자인 검사 15종

일반 계약에는 `id`, `kind`, `reason`과 해당 검사 옵션을 지정합니다. 디자인 규칙은 `presets: ["tailwind"]`로 활성화합니다. 내장 `parse-integrity` 보조 검사는 아래 15종에 포함하지 않습니다.

| 계약·규칙 | 검사하는 내용 |
| --- | --- |
| `restricted-imports` | 금지 모듈 import·reexport·require·동적 import |
| `restricted-api` | 금지 전역·import API의 호출과 값 참조 |
| `import-boundaries` | 파일·모듈 사이의 허용·금지 의존 경계 |
| `restricted-ui` | 금지 태그·컴포넌트·속성·UI 기능 |
| `restricted-syntax` | ESLint/esquery selector로 지정한 JS·TS 구문 |
| `file-conventions` | 파일 이름 case·접미사·줄 수·UTF-8 크기 |
| `export-contracts` | 필수 named export와 default·star export 제한 |
| `function-limits` | 함수 인자·줄·문장·중첩·복잡도 제한 |
| `component-contracts` | 필수·금지 props, 빈 값, 허용 값 |
| `no-raw-colors` | 의미 토큰 대신 직접 적은 색상 — Tailwind 기본 |
| `no-arbitrary-values` | 허용하지 않은 임의 클래스 값 — Tailwind 기본 |
| `no-inline-styles` | inline style과 지역 style block — Tailwind 기본 |
| `no-unknown-classes` | 테마 컴파일러가 생성하지 못하는 클래스 — Tailwind 기본 |
| `no-restyle` | 인식한 디자인 컴포넌트의 표현 변경 — 명시적 선택 |
| `require-static-classes` | UI 요소·클래스 helper의 확인 불가능한 동적 클래스 — 명시적 선택 |

필요한 설명만 조회할 수 있습니다.

```sh
npm exec -- goodui rules --format json
npm exec -- goodui explain component-contracts --format json
npm exec -- goodui explain goodui/no-restyle --format json
npm exec -- goodui explain no-eval --format json
```

`rules`는 간결한 목록을, `explain`은 내장 kind·규칙 ID 또는 현재 정책의 사용자 ID에 대한 옵션과 예제를 반환합니다. 세부 옵션은 [정책 명세](docs/policy.md)와 [개발 규약](docs/development.md)을 참고하세요.

## AI Slop 검사 켜기·끄기

공개 디자인 패턴 자료를 참고해 코드로 확인할 수 있는 13개 검사를 자체 구현했습니다. 새 정책은 기본 10개가 켜집니다. 기존 정책은 자동으로 활성화하지 않으며 `--ai-slop`으로 명시적으로 추가합니다. AI Slop 검사에는 Tailwind, 외부 린터, AI 호출이 필요 없습니다.

```sh
goodui init --yes --ai-slop
goodui init --yes --no-ai-slop
goodui init --yes --ai-slop-rules no-gradient-text,no-emoji-icons
goodui policy disable no-emoji-icons
goodui policy enable no-nested-cards
goodui policy disable ai-slop
goodui policy enable ai-slop
goodui explain ai-slop --format json
```

터미널 마법사에서 전체 켜기·끄기 또는 항목별 체크박스를 선택할 수 있습니다. `--ai-slop-rules`는 지정한 검사만 켜고 나머지는 끕니다. 전체를 껐다 다시 켜도 개별 설정과 예외는 보존됩니다. 개별 `enable` 명령은 그룹도 켜며 기본 검사와 기존 선택을 함께 적용합니다.

```json
{
  "version": 1,
  "aiSlop": {
    "enabled": true,
    "rules": {
      "no-emoji-icons": false,
      "no-nested-cards": true
    }
  },
  "rules": []
}
```

`aiSlop.enabled`는 그룹 전체, `aiSlop.rules`는 항목별 boolean override입니다. 기본 10개는 그라데이션 제목·보라색 그라데이션·유리 효과·블러 장식·hover 이동/확대·바운스·이모지·상투 문구·임시 문구·임시 링크를 검사합니다. 중첩 카드·큰 모서리·일반 서체는 프로젝트 의도에 맞게 명시적으로 켭니다. 작성자가 AI인지 판정하는 기능은 아닙니다. [검사 조건과 출처](docs/ai-slop.md)를 확인하세요.

## 정책 예시

아래 계약은 버튼의 동작과 접근 가능한 이름을 명시하게 합니다. 접근성 전체를 검증하는 규칙은 아닙니다.

```json
{
  "$schema": "./.goodui/schema.json",
  "version": 1,
  "rules": [{
    "id": "explicit-button",
    "kind": "component-contracts",
    "tags": ["button"],
    "requiredProps": ["type", "aria-label"],
    "nonEmptyProps": ["aria-label"],
    "propValues": { "type": ["button", "submit", "reset"] },
    "reason": "버튼의 동작과 이름을 코드에 명시합니다."
  }]
}
```

금지 API와 UI, 새 개발 규약을 조합한 [정책 예제](examples/README.md)를 제공합니다. `eslint-disable` 대신 정책의 `exceptions`에 계약 ID·파일 패턴·사유를 등록합니다. 네이티브 디자인 예외는 `goodui/no-restyle`처럼 `goodui/` ID를 사용합니다.

## 네이티브 디자인 엔진

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode lint --preset tailwind
npm exec -- goodui doctor
```

GoodUI가 클래스 분리, AST 값 분석, 토큰 수집, 진단을 구현합니다. 실제 utility 생성 여부에는 공식 Tailwind 컴파일러 primitive를 사용하고 CSS는 PostCSS로 읽습니다. 별도 외부 린터를 설치하거나 연결하지 않습니다. Tailwind CSS와 UI 프레임워크 자체를 설치·업그레이드하지도 않습니다.

기본 `no-unknown-classes`에는 실제 Tailwind CSS entry가 필요합니다. `tailwind.themeFiles`, `components.json`의 `tailwind.css`, 또는 자동 탐색으로 entry를 찾습니다. 없거나 모호하면 설정 오류를 보고합니다. `doctor`와 [Tailwind 안내](docs/tailwind.md)로 경로를 확인하세요.

## 실행 범위와 연결

Node.js `^22.13.0 || >=24`, ESLint `^9.39 || ^10`에서 JS·TS·JSX·TSX·Vue HTML SFC·Svelte와 rune 파일을 지원합니다. CLI·MCP는 대상의 임의 ESLint·Svelte 설정을 실행하지 않고 공통 정책 구성을 사용합니다.

정적 구문과 제한된 별칭·값을 분석합니다. TypeScript 타입 검사는 기존 `tsc` 명령으로 실행하세요. 임의 런타임 흐름, 모든 wrapper 경유, 최종 CSS·화면 품질, 실제 Tailscale 연결·ACL 상태를 보장하지 않습니다. 에디터에서 정책·테마·읽힌 컴포넌트를 변경했다면 ESLint를 다시 로드해야 합니다. CLI·MCP는 호출마다 준비합니다.

- [AI 설치 절차](SETUP.md)
- [한국어·영어 선택](docs/language.md)
- [정책 필드와 예외](docs/policy.md)
- [파일·함수·export 규약](docs/development.md)
- [Tailwind 설정과 분석 범위](docs/tailwind.md)
- [MCP 정책 관리](docs/mcp.md)
- [에디터와 CI](docs/enforcement.md)
- [다른 디자인 린터와 비교](docs/comparison.md)

`doctor`는 Node·manifest·설치 선언·정책·스키마·엔진 설정을 읽기 전용으로 점검합니다. 경고만 있으면 종료 코드 0, 오류가 있으면 2입니다. 소스 계약 위반을 찾는 명령은 `check`이며 종료 코드는 통과 0·위반 1·설정 오류 2입니다.

MCP는 `npm exec -- goodui mcp --root /absolute/project`로 실행합니다. CI 병합 차단에는 소비자 저장소의 필수 상태 검사와 설정 변경 보호가 필요합니다. [연결 안내](docs/enforcement.md)를 참고하세요.

## 개발과 검증

```sh
pnpm install
pnpm check
pnpm test:consumer
```

소비자 검사는 내부 패키지를 pack한 뒤 CLI만 직접 설치해 npm·strict pnpm, ESLint 9·10, 설정·스키마·MCP를 확인합니다. 아직 공개하지 않은 변경은 이 로컬 소비자 검사로 검증합니다. `pnpm test:published`는 현재 manifest 버전이 레지스트리에 공개된 뒤 사용하는 별도 검증입니다.

```sh
pnpm build
node packages/cli/dist/index.js init --root /absolute/project --no-install --yes
node packages/cli/dist/index.js check --root /absolute/project --format json
```

배포 계획은 `pnpm release:plan`, 실제 배포는 `pnpm release:publish`로 실행합니다. 공개 다운로드와 소비자 검사 후 최신 태그를 승격하는 [배포 절차](docs/releasing.md)를 따릅니다.

MIT License.
