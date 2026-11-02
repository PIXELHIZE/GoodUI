# 에디터와 CI 연결

GoodUI 계약은 `goodui.policy.json`에서 관리하고, 에디터·CLI·MCP에 같은 `createConfig`를 사용합니다. CLI 검사는 소비자 프로젝트의 임의 ESLint·Svelte 설정 코드를 실행하지 않습니다. 기존 ESLint 스타일 규칙까지 실행하려면 프로젝트의 기존 lint 명령도 함께 사용하세요.

## 에디터

대상 프로젝트에서 lint 설치 모드를 실행합니다. GoodUI의 직접 의존성은 메인 CLI 하나이며, 설치기가 에디터에 필요한 ESLint를 확인하고 없으면 추가합니다. 아래 설치·CI 예제는 npm과 `package-lock.json`을 사용하는 프로젝트 기준입니다. 다른 패키지 매니저는 프로젝트의 설치·실행 명령에 맞춥니다.

```powershell
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode lint --preset project --package-manager npm
```

`init`은 기존 ESLint 설정이 없을 때 다음과 같은 `eslint.config.mjs`를 생성합니다.

```js
import { fileURLToPath } from 'node:url';
import { createConfig } from '@pixelhize/goodui-cli/config';

export default await createConfig({
  rootDir: fileURLToPath(new URL('.', import.meta.url)),
  policyPath: 'goodui.policy.json',
  locale: 'ko',
});
```

`createConfig`는 비동기 함수이며 flat config 배열을 반환합니다. 기존 설정이 있으면 `init`은 덮어쓰지 않고 통합 코드를 출력합니다. 기존 배열 뒤에 GoodUI 설정을 추가할 수 있습니다.

`init --locale ko`는 새 설정에 한국어를 명시합니다. 영어는 `en`을 사용하며 자동 감지로 설치해도 감지된 언어를 기록합니다. 기존 설정에서 언어를 바꾸려면 `createConfig`의 `locale`을 지정하고 ESLint 서버를 다시 로드하세요. 정책에 저장한 사유·수정 방향은 번역하지 않습니다. [언어 선택](language.md)을 참고하세요.

```js
import { fileURLToPath } from 'node:url';
import { createConfig } from '@pixelhize/goodui-cli/config';

const existingConfig = [/* 프로젝트의 기존 flat config */];

export default [
  ...existingConfig,
  ...await createConfig({ rootDir: fileURLToPath(new URL('.', import.meta.url)) }),
];
```

GoodUI 뒤에서 parser·GoodUI 규칙·`noInlineConfig`를 다시 덮어쓰면 공통 검사 구성과 달라질 수 있습니다. 에디터의 ESLint 확장에서 JS·TS 및 사용할 Vue·Svelte 언어 검사를 활성화하세요. 정책 JSON을 변경한 후에는 ESLint 서버나 프로젝트 검사를 다시 로드합니다. 네이티브 디자인 엔진이 읽은 CSS·components.json·컴포넌트가 바뀌면 `DESIGN_ENGINE_STALE`로 재로드를 요청합니다. CLI·MCP는 호출마다 현재 정책과 디자인 소스를 준비합니다.

```sh
npm exec -- goodui doctor --format json
```

`doctor`는 설정을 고치지 않는 읽기 전용 점검입니다. Node·설치 선언·정책·오프라인 스키마·엔진 준비 상태를 보여 줍니다. 경고만 있으면 종료 코드 0일 수 있으며 소스 계약 통과를 뜻하지는 않습니다. 실제 소스는 `check`로 검사합니다.

## CI

lint·all 모드는 소비자 프로젝트의 `package.json`에 다음 스크립트를 추가합니다. 기존 `lint`·`typecheck`는 그대로 둡니다. `lint:goodui`가 이미 있으면 덮어쓰지 않으므로 출력된 경고를 확인하고 실제 명령을 점검하세요.

```json
{
  "scripts": {
    "lint:goodui": "goodui check"
  }
}
```

패키지가 설치된 CI에서 기존 lint·타입 검사와 함께 `npm run lint:goodui`를 실행합니다. 정책 검사의 종료 코드를 무시하거나 실패를 허용하지 마세요.

위 npm 설치로 갱신된 `package.json`과 `package-lock.json`, 프로젝트의 `goodui.policy.json`, `.goodui/schema.json`, 에디터 설정을 커밋합니다. CI는 `npm ci`로 잠긴 버전의 공개 패키지를 설치합니다. 정책 검사에 MCP 서버 실행은 필요하지 않습니다.

개발용 tarball을 시험하는 CI라면 해당 tarball도 접근 가능해야 합니다. 소비자 프로젝트의 `vendor/`에 파일을 넣고 상대 경로로 설치한 뒤 tarball과 lockfile을 함께 커밋할 수 있습니다. 개발 PC의 절대 파일 경로만 참조하는 lockfile은 다른 CI 환경에서 설치할 수 없습니다.

GitHub Actions를 사용하는 소비자 저장소의 `.github/workflows/goodui-policy.yml` 예제입니다.

```yaml
name: GoodUI contracts

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  policy-contracts:
    name: GoodUI policy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run lint:goodui
```

기본 브랜치 이름이 다르면 `main`을 바꾸세요. 저장소의 ruleset 또는 branch protection에서 **`GoodUI policy` 상태 검사**를 필수 조건으로 지정합니다. workflow 파일을 추가하는 것만으로 필수 병합 조건이 설정되지는 않습니다.

| 종료 코드 | 의미 |
| --- | --- |
| `0` | 검사 성공 |
| `1` | 소스의 계약·구문 진단에 오류가 있음 |
| `2` | 정책·인수·파일 선택 등 구성 또는 실행 오류 |

CI 상태 검사를 저장소의 필수 병합 조건으로 지정하면 계약 위반이 있는 변경의 병합을 막을 수 있습니다. 정책·예외·ESLint 구성·CI workflow·lockfile 변경에는 저장소의 리뷰·변경 보호 규칙을 적용하세요. 이 설정은 사용 중인 Git 호스팅에서 구성하며 GoodUI가 자동 변경하지 않습니다.

GoodUI는 `eslint-disable`로 계약을 숨기지 못하게 구성합니다. 파일 자체의 정책을 바꾸거나 필수 CI 검사를 제거할 권한까지 통제하는 도구는 아니므로 저장소 보호 설정과 함께 사용합니다.

## 검사 명령

```powershell
# 설치된 소비자 프로젝트 안에서 실행
npm exec -- goodui policy validate
npm exec -- goodui check
npm exec -- goodui check src --format json
```

명시한 파일·디렉터리는 프로젝트 루트 안에 있어야 합니다. 소스 파일을 수정하지 않으며 자동 수정 옵션은 제공하지 않습니다. 정책이 없거나 유효하지 않을 때, 검사할 파일이 없을 때, 활성 계약이 선택한 파일에 전혀 적용되지 않을 때도 실패를 반환합니다.
