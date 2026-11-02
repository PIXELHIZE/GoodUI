# Set up GoodUI

사용자가 지정한 프로젝트에 GoodUI를 설치하는 AI용 절차입니다. 설치 진입점은 `@pixelhize/goodui-cli@0.4.0` 하나입니다. 내부 core·plugin·MCP 패키지를 각각 직접 의존성으로 추가할 필요가 없습니다.

## 프로젝트와 목표 확인

- 프로젝트 루트, packageManager·lockfile, 기존 정책·ESLint 설정·lint·typecheck를 읽습니다. 모노레포는 설정을 소유할 패키지를 대상으로 선택합니다.
- `lint`, `agent`, `all`, `config` 중 요청에 맞는 모드를 고릅니다. `--yes` 기본값은 lint·project입니다. `config`와 `--no-install`은 의존성 설치를 생략합니다.
- Tailwind v4 프로젝트에서 디자인 검사가 필요하면 `--preset tailwind`를 사용합니다. 네이티브 엔진이 포함되어 있으며 별도 린터를 설치하지 않습니다. Tailwind·프레임워크 자체도 설치·업그레이드하지 않습니다.
- 지침을 검사 가능한 계약으로 바꿉니다. 실제 VPN 상태나 화면 품질 같은 요구를 단순히 `reason`에 적고 검사한다고 설명하지 않습니다.
- 사용자가 원하는 언어를 `--locale ko|en`으로 지정합니다. 생략한 `auto`는 `GOODUI_LOCALE`·locale 환경·시스템 언어 순서로 감지합니다. 새 내장 계약만 선택한 언어로 생성하며 기존 정책 문구는 번역하지 않습니다. 명령·옵션·JSON 키·ID는 그대로 사용합니다.

설치 profile은 `project`, `development`, `tailwind`, `full` 중 선택합니다. project는 no-eval 예제, development는 TS any·non-null과 함수·파일 한계, tailwind는 기본 네 디자인 규칙, full은 development·네이티브 여섯 규칙·button type·img alt 계약을 준비합니다. 새 정책은 모든 profile에서 AI Slop 기본 10개도 켭니다. 기존 같은 ID의 계약·비활성화·예외·명시적 선택은 보존합니다. 정책 JSON의 `presets`에는 설치 profile 이름을 복사하지 않고 `tailwind`·`ai-slop` 검사군 이름만 사용합니다. AI Slop은 `aiSlop.enabled`로 직접 제어할 수도 있습니다.

## 변경 계획 확인

AI·CI는 키보드 입력에 의존하지 않고 모드·preset을 명시합니다.

```sh
npm exec --yes --package=@pixelhize/goodui-cli@0.4.0 -- goodui init --root /absolute/project --yes --mode lint --preset development --dry-run --format json
npm exec --yes --package=@pixelhize/goodui-cli@0.4.0 -- goodui init --root /absolute/project --yes --mode all --preset full --dry-run --format json
```

full은 실제 Tailwind entry가 있는 프로젝트에 사용합니다. 아래 project 예제처럼 설치 매니저도 고정할 수 있습니다.

```sh
npm exec --yes --package=@pixelhize/goodui-cli@0.4.0 -- goodui init --root /absolute/project --yes --mode all --preset project --package-manager npm --dry-run --format json
```

한국어로 고정하려면 계획과 실행에 모두 `--locale ko`를 추가합니다. 새 에디터 설정과 MCP 실행 예제에도 같은 언어가 기록됩니다. 기존 ESLint 설정은 보존하며 반환된 통합 코드를 적용합니다. [언어 설정](docs/language.md)에 환경 변수와 표시 범위를 설명합니다.

`installation`의 명령과 `configuration`의 변경 파일·경고를 확인합니다. `enabledContracts`·`designRules`로 기존 선택을 병합한 실제 활성 검사를 확인하세요. dry-run은 대상 프로젝트를 변경하지 않으며 실행기를 위한 npm 캐시 다운로드는 별개입니다. 변경 범위가 요청에 맞으면 같은 옵션에서 `--dry-run`만 제거합니다.

```sh
npm exec --yes --package=@pixelhize/goodui-cli@0.4.0 -- goodui init --root /absolute/project --yes --mode all --preset project --package-manager npm --format json
```

npm·pnpm·Yarn·Bun을 지원합니다. 명시 옵션이 packageManager 필드와 lockfile보다 우선합니다. 여러 매니저의 lockfile로 모호하면 `--package-manager`를 지정합니다. pnpm workspace 루트 설치는 루트 플래그를 사용하며 하위 패키지를 선택했다고 설치 위치를 루트로 바꾸지 않습니다.

기존 정책·ESLint 설정·lint·typecheck를 유지합니다. lint·all은 별도 `lint:goodui`를 추가하며 같은 이름이 있으면 보존합니다. 설정 파일이 이미 있으면 출력된 `@pixelhize/goodui-cli/config` 통합 코드를 검토해 연결합니다. `.goodui/schema.json`은 생성 스키마이며 다른 파일이 해당 경로를 차지하면 충돌을 해결한 뒤 다시 실행합니다.

## 정책 구체화

```sh
npm exec -- goodui rules --format json
npm exec -- goodui explain function-limits --format json
npm exec -- goodui explain component-contracts --format json
```

28개 내장 검사 중 필요한 계약을 정책에 추가합니다. 새 project 정책은 `no-eval`과 AI Slop 기본 10개 검사로 시작합니다. 기존 정책은 AI Slop을 자동 활성화하지 않습니다. development는 함수 인자 5·100줄·30문장·깊이 4·복잡도 15, 파일 400줄·48,000바이트를 기본으로 둡니다. 파일 이름·export 방식은 전역 강제하지 않습니다. Tailwind profile은 기본 네 디자인 규칙이며 full은 새 정책에 여섯 규칙을 모두 선택합니다. full의 img alt는 장식용 빈 문자열을 허용합니다.

AI Slop을 기존 정책에 추가할 때는 `init --yes --ai-slop`을 명시합니다. `--no-ai-slop`은 전체를 끄며 기존 개별 선택을 보존합니다. `--ai-slop-rules no-gradient-text,no-emoji-icons`는 지정한 항목만 켭니다. `policy enable|disable ai-slop|검사ID`로 저장된 선택을 변경할 수도 있습니다. 세부 설정은 `aiSlop.rules`의 boolean map이며 `aiSlop.enabled`가 전체 활성 상태를 결정합니다. 기본 해제인 중첩 카드·큰 모서리·일반 서체를 무조건 켜지 말고 프로젝트의 의도에 따라 선택하세요. [AI Slop 조건과 출처](docs/ai-slop.md)를 확인하고 화면 품질이나 AI 작성 여부를 보장한다고 설명하지 않습니다.

Tailwind 정책에는 실제 CSS entry를 `tailwind.themeFiles`로 지정하거나 `components.json`의 `tailwind.css`를 확인합니다. 기본 unknown-class 검사에 entry가 없으면 설정 오류입니다. 프로젝트의 실제 파일을 사용하세요.

기존 스키마는 `init --no-install`로 갱신할 수 있습니다. 정확한 옵션은 [정책](docs/policy.md), [개발 규약](docs/development.md), [Tailwind](docs/tailwind.md)를 참고하세요. full의 동적 alt 같은 값은 해당 props 계약의 기본 정적 검사를 통과하지 못할 수 있으므로 프로젝트 요구에 맞게 `allowDynamicProps`를 명시적으로 선택합니다.

## 검증과 전달

```sh
npm exec -- goodui doctor --format json
npm exec -- goodui policy validate --format json
npm exec -- goodui check --format json
```

`doctor`는 읽기 전용 설정 점검이며 경고만 있으면 0, 오류가 있으면 2입니다. `check`는 통과 0, 소스 위반 1, 설정·실행 오류 2입니다. 소스가 없는 프로젝트는 `check`가 설정 오류를 반환합니다. 설치 성공과 기존 소스의 규칙 통과를 구분하고 기존 lint·typecheck도 실행합니다.

agent·all은 MCP 클라이언트 설정 예제를 출력합니다. 사용자의 호스트에 예제를 적용하고 연결합니다. 사용자 지정 정책을 사용했다면 서버에도 같은 `--policy`를 전달합니다.

```sh
npm exec -- goodui mcp --root /absolute/project --policy goodui.policy.json
```

연결한 AI는 `get_rule_catalog`의 `kind`·`includeSchema:false`로 필요한 정보만 읽고 후보 정책을 검증·미리 검사한 뒤 저장할 수 있습니다. 기존 파일을 갱신할 때는 `get_policy`에서 읽은 revision을 유지합니다.

완료 시 설치·변경·보존 파일, 활성 계약, 검사 결과, 남은 에디터·MCP·CI 연결을 설명합니다. 읽을 수 없는 동적 값이나 지원 범위 밖의 요구를 조용히 생략하지 않습니다. 에디터의 정책·테마·읽힌 컴포넌트 변경은 ESLint 재로드가 필요합니다.
