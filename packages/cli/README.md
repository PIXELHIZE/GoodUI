# @pixelhize/goodui-cli

JS·TS, JSX·TSX, Vue, Svelte 프로젝트 계약 검사의 단일 설치 진입점입니다. Node.js `^22.13.0` 또는 `>=24`에서 사용합니다. 검사할 프로젝트에서 실행하면 터미널 키보드로 설치 모드와 preset을 선택합니다.

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init
npm exec -- goodui policy validate
npm exec -- goodui check
npm exec -- goodui check src --format json
npm exec -- goodui check --root /path/to/project --policy goodui.policy.json
```

한국어는 `--locale ko`, 영어는 `--locale en`으로 선택합니다. 기본 `auto`는 `GOODUI_LOCALE` → `LC_ALL` → `LC_MESSAGES` → `LANG` → 시스템 언어 순서로 감지합니다. 한국어가 아니면 영어를 사용합니다. 새 내장 계약만 선택한 언어로 생성하고 기존 정책 문구는 보존합니다. 새 에디터 설정과 MCP 실행 예제에도 선택 언어를 명시합니다. 명령·옵션·JSON 키·ID는 바뀌지 않습니다. [언어 설정](docs/language.md)을 참고하세요.

메인 패키지가 core·plugin·MCP·네이티브 디자인 엔진을 자동으로 연결하므로 GoodUI 패키지를 각각 직접 설치하지 않아도 됩니다. lint·all 모드는 필요한 프로젝트 ESLint를 준비합니다. Tailwind preset에 별도 린터는 필요하지 않으며 Tailwind CSS나 UI 프레임워크 자체를 설치·업그레이드하지도 않습니다.

AI·자동화에는 모드와 preset을 명시하고 먼저 JSON 계획을 확인합니다.

AI용 상세 절차는 이 패키지에 포함된 [SETUP.md](SETUP.md)에서도 확인할 수 있습니다. [정책 명세](docs/policy.md), [개발 규약](docs/development.md), [디자인 규칙](docs/tailwind.md)과 [예제](examples/README.md)도 함께 제공하므로 설치 후 오프라인에서 읽을 수 있습니다.

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode all --preset project --package-manager npm --dry-run --format json
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode all --preset project --package-manager npm --format json
```

`--mode`는 `lint`, `agent`, `all`, `config`, `--preset`은 `project`, `development`, `tailwind`, `full`입니다. `--package-manager`는 `npm`, `pnpm`, `yarn`, `bun`을 받습니다. `--yes` 기본값은 lint·project입니다. non-TTY 실행은 `--yes`나 명시적 모드가 필요합니다. `--mode config` 또는 `--no-install`은 설치 없이 설정만 생성합니다. `--dry-run`은 대상 프로젝트를 변경하지 않습니다.

project preset은 `eval`을 금지하는 예제와 AI Slop 기본 10개로 시작합니다. lint·all·config 모드는 기존 파일이 없을 때 에디터 설정도 만듭니다. 기존 정책·ESLint 설정·`lint`·`typecheck`는 보존하며, lint·all은 별도 `lint:goodui` 스크립트를 추가합니다. 같은 이름이 이미 있으면 보존하고 경고합니다. Tailwind preset은 기존 일반 계약을 유지하면서 preset을 추가합니다.

development는 TS any·non-null 제한과 함수·파일 한계를 추가합니다. full은 새 정책에 development·네이티브 여섯 규칙·button type·img alt 계약을 준비합니다. 기존 같은 ID의 계약·비활성화·예외·명시적 디자인 규칙 선택은 유지합니다. CLI profile과 정책 JSON의 `presets: ["tailwind"]`는 서로 다른 필드입니다.

full의 img alt는 빈 문자열을 허용하지만 동적 값은 props 계약의 기본 정적 검사 대상입니다. 프로젝트 요구에 맞게 해당 계약의 `allowDynamicProps`를 선택하세요. 이름·export 규약은 전역 기본으로 강제하지 않습니다.

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode lint --preset development --dry-run --format json
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode all --preset full --dry-run --format json
```

`check`는 프로젝트의 실행 가능한 ESLint 설정을 불러오지 않고 공통 정책 설정 생성기를 사용합니다. 에디터는 생성된 `createConfig` 연결을 사용합니다. 정책·테마·읽힌 컴포넌트를 수정한 후에는 에디터의 ESLint 서버를 다시 로드하세요. 디자인 입력이 바뀐 채 이전 엔진을 사용하면 `DESIGN_ENGINE_STALE`로 알립니다.

`check` 종료 코드: 통과 `0`, 위반 `1`, 설정·실행 오류 `2`. 정책 누락·활성 규칙 없음·검사할 소스 없음은 설정 오류입니다. 설정 wizard 취소는 `130`입니다. `--format json`은 진단 또는 구조화 오류를 stdout으로 반환하며 의존성 설치 로그는 stderr로 보냅니다.

일반 9종, 네이티브 디자인 6종, AI Slop 13종을 제공합니다. 새 정책은 AI Slop 기본 10개가 켜지며 기존 정책은 자동으로 켜지지 않습니다. 목록에는 옵션 스키마를 반복해서 넣지 않으며 필요한 설명만 조회할 수 있습니다.

터미널 마법사에서 AI Slop 전체와 각 항목을 선택할 수 있습니다. `init --ai-slop`·`--no-ai-slop`으로 전체를, `--ai-slop-rules no-gradient-text,no-emoji-icons`로 지정 항목만 켭니다. 저장된 설정은 `policy enable|disable ai-slop|CHECK_ID`로 변경할 수 있습니다. [검사 조건과 출처](docs/ai-slop.md)를 참고하세요.

```sh
npm exec -- goodui rules --format json
npm exec -- goodui explain component-contracts --format json
npm exec -- goodui explain function-limits --format json
npm exec -- goodui explain goodui/no-restyle --format json
npm exec -- goodui doctor --format json
```

`explain`은 내장 kind·규칙 ID 또는 현재 정책의 사용자 ID를 받습니다. `doctor`는 Node·manifest·설치 선언·정책·스키마·엔진 설정을 읽기 전용으로 확인합니다. 경고만 있으면 0, 오류가 있으면 2이며 소스 계약 통과를 대신하지 않습니다.

Tailwind 기본 네 규칙은 색상·임의 값·inline style·unknown class 검사이며 컴포넌트 재스타일·정적 클래스 규칙은 명시적 선택입니다. unknown-class에는 실제 CSS entry가 필요하므로 `tailwind.themeFiles`나 `components.json`의 `tailwind.css`를 확인하세요. 일반 계약은 import·API·경계·UI·AST·파일·export·함수·props를 다룹니다. 타입 검사·최종 화면·임의 wrapper 흐름 전체를 보장하지 않습니다.

에디터는 `@pixelhize/goodui-cli/config`의 비동기 `createConfig`를 사용합니다. `init`은 `.goodui/schema.json`을 생성해 정책의 스키마 자동완성을 설정하며 설정만 생성하는 실행에서도 사용할 수 있습니다. 직접 통합용 `@pixelhize/goodui-cli/schema.json` export도 제공합니다. 검사기는 패키지에 포함된 스키마로 검증합니다.

MCP는 같은 CLI에서 실행합니다. agent·all은 범용 호스트 설정 예제를 출력하며 호스트의 설정 파일을 자동으로 덮어쓰지 않습니다.

```sh
npm exec -- goodui mcp --root /path/to/project
npm exec -- goodui mcp --root /path/to/project --policy .config/goodui.policy.json
```

일회성 검사만 필요하면 `npm exec --yes --package=@pixelhize/goodui-cli@0.4.0 -- goodui check --root /path/to/project`로 실행할 수 있습니다. 이 명령은 대상 프로젝트에 에디터용 의존성을 설치하지 않습니다.
