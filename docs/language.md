# 한국어와 영어 선택

GoodUI는 `--locale ko|en|auto`로 CLI 안내와 GoodUI가 만드는 진단의 언어를 선택합니다. `init`, `check`, `rules`, `explain`, `doctor`, `policy validate`, `mcp`에서 사용할 수 있습니다.

```sh
npx --yes @pixelhize/goodui-cli@0.4.0 init --locale ko
npm exec -- goodui check --locale ko
npm exec -- goodui rules --locale ko --format json
npm exec -- goodui doctor --locale en --format json
```

생략하거나 `auto`를 지정하면 `GOODUI_LOCALE` → `LC_ALL` → `LC_MESSAGES` → `LANG` → 시스템 언어 순서로 확인합니다. 선택된 언어가 한국어이면 한국어를 사용하고 그 외에는 영어를 사용합니다. 명시적인 `--locale ko` 또는 `--locale en`이 환경 설정보다 우선합니다. `GOODUI_LOCALE=auto`는 다음 환경 설정으로 넘어갑니다.

`C`, `POSIX`, `C.UTF-8` 같은 locale 환경 값은 영어를 선택합니다. 예를 들어 시스템 언어가 한국어여도 `LC_ALL=C.UTF-8`이면 기본 감지는 영어입니다. 한국어를 고정하려면 `--locale ko` 또는 `GOODUI_LOCALE=ko`를 사용하세요.

PowerShell에서 세션 기본 언어를 지정할 수도 있습니다.

```powershell
$env:GOODUI_LOCALE = 'ko'
npm exec -- goodui check
```

## 설치와 기존 정책

설치 마법사의 모드·preset 안내, 설치기 오류·보존 안내를 선택한 언어로 표시합니다. 새 정책의 `no-eval`과 새로 추가하는 내장 계약의 `reason`·`suggestion`도 선택한 언어로 생성합니다. `.goodui/schema.json`의 내장 옵션 설명도 선택 언어로 준비하며 스키마 키와 검증 조건은 유지합니다.

기존 정책의 `reason`, `suggestion`, 예외 사유, 사용자 메모는 번역하거나 덮어쓰지 않습니다. 기존 영문 정책에 `--locale ko --preset development`를 적용하면 기존 문구는 영문 그대로 두고 새 계약만 한국어로 추가합니다. 반대로 언어를 바꿔 재실행해도 이미 저장된 문구를 다시 번역하지 않습니다.

JSON 키·enum·규칙 ID·정책 ID·명령·옵션·파일 경로와 종료 코드는 언어에 따라 바뀌지 않습니다. `--format json`에서도 사람이 읽는 설명과 진단 문구만 선택한 언어로 반환하므로 자동화는 `code`, `ruleId`, `policyId` 같은 구조화 필드를 사용하세요. 외부 parser·패키지 매니저·운영체제가 만든 오류와 로그는 원래 언어로 남을 수 있습니다.

## 에디터와 MCP

`init --locale ko`는 새 ESLint 설정에 `locale: 'ko'`를 명시합니다. 자동 감지로 설치했을 때도 감지된 `ko` 또는 `en`을 기록하므로 에디터 프로세스의 환경이 달라도 같은 언어를 사용합니다. 기존 ESLint 설정은 보존하며 출력된 통합 코드에 선택 언어가 포함됩니다.

```js
import { createConfig } from '@pixelhize/goodui-cli/config';

export default await createConfig({
  rootDir: import.meta.dirname,
  locale: 'ko',
});
```

언어를 바꾼 뒤에는 에디터의 ESLint 서버를 다시 로드합니다. `locale`은 표시 언어를 선택하며 검사 대상이나 계약의 강도를 바꾸지 않습니다.

agent·all 모드의 MCP 실행 예제에도 같은 `--locale ko` 또는 `--locale en`이 포함됩니다. 수동 연결에서는 다음처럼 지정합니다.

```sh
npm exec -- goodui mcp --root /absolute/project --policy goodui.policy.json --locale ko
```

MCP 연결 시 사용할 서버 언어를 고정합니다. 도구 결과의 키와 정책 내용은 유지하며 GoodUI의 설명·진단·오류를 선택한 언어로 표시합니다.
