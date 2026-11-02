# AI와 MCP로 정책 설정하기

GoodUI MCP는 연결된 AI가 정책을 읽고, 후보 정책을 검증하고, 검사 영향을 확인하고, 저장할 수 있게 합니다. 자연어 해석은 사용 중인 AI 클라이언트가 담당합니다. GoodUI는 자체 모델 제공자·API 키·프롬프트 실행기를 관리하지 않습니다.

## 서버 연결

한 서버는 시작할 때 지정한 프로젝트 루트 하나를 사용합니다. 서버는 로컬 stdio로 통신합니다. 별도 MCP 패키지를 직접 설치하지 않고 메인 CLI의 agent 모드로 준비합니다.

```powershell
npx --yes @pixelhize/goodui-cli@0.4.0 init --yes --mode agent --preset project
npm exec -- goodui mcp --root E:/coding/my-app
```

에디터 검사도 함께 준비하려면 `--mode all`을 사용합니다. agent·all 모드는 선택한 패키지 매니저에 맞는 MCP 실행 명령과 범용 설정 예제를 출력합니다. 호스트의 설정 파일을 임의로 수정하지 않습니다. 출력 예제를 클라이언트에 맞게 적용하고 재연결하세요. 아래는 npm 프로젝트의 command·args 예이며 감싸는 설정 형식은 호스트마다 다를 수 있습니다.

```json
{
  "command": "npm",
  "args": [
    "--prefix",
    "E:/coding/my-app",
    "exec",
    "--",
    "goodui",
    "mcp",
    "--root",
    "E:/coding/my-app",
    "--policy",
    "goodui.policy.json",
    "--locale",
    "ko"
  ]
}
```

프로젝트를 여러 개 관리할 때는 루트별 서버 항목을 따로 만듭니다. 실행 중인 서버의 프로젝트 루트를 도구 인수로 바꾸지는 않습니다. 메인 패키지 이름을 명시해 설치 없이 서버를 실행할 수도 있습니다.

```powershell
npm exec --yes --package=@pixelhize/goodui-cli@0.4.0 -- goodui mcp --root E:/coding/my-app
```

저장소에서 서버를 개발한다면 `pnpm build` 후 `node packages/cli/dist/index.js mcp --root E:/coding/my-app`으로 실행할 수 있습니다. 클라이언트 설정에서도 해당 빌드 파일의 절대 경로와 `mcp` 인수를 사용할 수 있습니다.

기본 정책 파일은 `goodui.policy.json`입니다. 초기화할 때 커스텀 `--policy`를 사용했다면 출력된 MCP 예제에도 그 경로가 포함됩니다. 서버를 수동으로 실행할 때도 같은 경로를 전달하세요. 도구의 개별 `policyPath` 인수가 없으면 이 서버 기본값을 사용합니다.

`--locale ko|en|auto`로 서버 안내·도구 설명·GoodUI 진단의 언어를 선택합니다. agent·all 초기화 예제에는 설치할 때 선택한 `ko` 또는 `en`이 명시됩니다. 기존 정책 내용과 도구 이름·인수·결과 키는 번역하지 않습니다. 자동 감지 순서는 [언어 설정](language.md)을 참고하세요.

```powershell
npm exec -- goodui mcp --root E:/coding/my-app --policy .config/goodui.policy.json
```

## 제공 도구

| 도구 | 입력 | 동작 |
| --- | --- | --- |
| `get_policy` | 선택적 `policyPath` | 현재 정책, raw-byte SHA256 `revision`, 파일 경로 반환 |
| `get_rule_catalog` | 선택적 `kind`, `includeSchema` | 일반 계약·네이티브 preset·옵션·예제 반환. kind로 필터하고 false로 전체 정책 schema를 생략 |
| `validate_policy` | `policy` | 저장하지 않고 검증 결과와 오류 반환 |
| `set_policy` | `policy`, `expectedRevision`, 선택적 `policyPath` | 전체 후보 정책을 검증한 뒤 저장 |
| `lint` | 선택적 `policy` 또는 `policyPath`, 선택적 `files` | 저장된 정책 또는 저장 전 후보 정책으로 소스 검사 |

`lint.files`는 프로젝트 안의 실제 파일·디렉터리 경로 목록입니다. glob을 받지 않습니다. 파일 패턴은 정책의 `files`에 설정합니다. `policy`와 `policyPath`를 한 검사에 동시에 지정할 수 없습니다.

AI는 처음부터 전체 스키마를 반복해서 읽기보다 필요한 계약을 선택할 수 있습니다. `kind`는 일반 kind, `goodui/` 접두사가 있는 규칙 ID, `tailwind`, 네이티브 규칙 이름을 받습니다. `includeSchema: false`는 전체 정책의 `schema` 필드를 생략하며 선택한 계약의 옵션 스키마와 예제는 유지합니다.

```json
{ "kind": "component-contracts", "includeSchema": false }
```

CLI에서도 `goodui rules --format json`, `goodui explain component-contracts --format json`, `goodui doctor --format json`으로 필요한 정보와 설정 상태를 확인할 수 있습니다. 카탈로그는 일반 9종·네이티브 6종·AI Slop 13종을 안내하며 모든 규칙이 기본 활성이라는 뜻은 아닙니다. `get_rule_catalog({kind: "ai-slop", includeSchema: false})`로 AI 검사 13개의 이유·제안·옵션·예제를 조회하고 후보 정책의 개별 boolean 선택을 검증할 수 있습니다.

`set_policy` 외의 네 도구는 정책과 소스를 수정하지 않습니다. `set_policy`도 소스 코드를 고치거나 CI·ESLint 설정을 덮어쓰지 않습니다. 새로운 프로젝트의 에디터 연결에는 CLI의 `init` 또는 기존 설정에 대한 명시적인 통합 작업이 필요합니다.

## 자연어 설정 흐름

AI에 다음과 같이 요청할 수 있습니다.

> 이 프로젝트에서는 UI에서 fetch를 직접 호출하지 않고 src/network를 사용하도록 설정해 줘. 디자인 시스템 구현부 외에는 native button과 inline style을 금지해 줘.

연결된 AI는 다음 순서로 도구를 사용합니다.

1. `get_rule_catalog`와 `get_policy`로 지원 범위와 현재 정책을 읽습니다.
2. 지침을 지원하는 계약 필드로 옮기고 기존 계약·예외를 유지한 전체 후보 정책을 만듭니다.
3. `validate_policy`와 `lint({ policy: 후보 })`로 오류와 기존 소스에 미치는 영향을 확인합니다.
4. 요청 범위의 변경 내용과 표현할 수 없는 지침을 설명하고 `set_policy`로 저장합니다.
5. 저장된 정책으로 다시 `lint`하여 적용 결과를 확인합니다.

검사는 자연어를 매번 다시 해석하지 않습니다. 확정된 JSON 계약을 CLI·ESLint·MCP가 공유합니다. “Tailscale을 사용한다”처럼 런타임 상태를 요구하는 지침은 공용 네트워크 래퍼 사용 같은 정적 계약으로 표현 가능한 부분과 외부 검증이 필요한 부분을 구분합니다.

## 저장 리비전과 충돌

기존 파일을 변경할 때는 `get_policy`에서 받은 `revision`을 `expectedRevision`으로 그대로 전달합니다. 파일을 새로 만들 때만 `null`을 전달합니다. `set_policy`는 부분 patch가 아니라 **전체 정책**을 받습니다.

```json
{
  "policy": {
    "version": 1,
    "rules": [
      {
        "id": "no-eval",
        "kind": "restricted-api",
        "globals": ["eval"],
        "reason": "문자열을 코드로 실행하지 않습니다."
      }
    ]
  },
  "expectedRevision": null
}
```

다른 편집 이후 오래된 리비전으로 저장하면 `POLICY_CONFLICT`가 반환됩니다. 정책을 다시 읽고 변경 사항을 합친 뒤 새 리비전으로 저장합니다. 리비전은 파일의 원본 바이트 기준이므로 수동 들여쓰기 변경도 감지됩니다. 검증 실패·충돌 시 기존 정책을 보존하며 GoodUI 쓰기 작업끼리는 파일 잠금으로 직렬화합니다.

잘못된 JSON을 읽는 경우 오류의 `details`에 현재 파일 `revision`이 포함됩니다. 내용을 확인하고 유효한 전체 정책을 그 리비전으로 저장해 복구할 수 있습니다. 서버는 지정 프로젝트 밖의 정책 경로와 symlink 탈출을 거부합니다.

## 검사 결과

도구 결과는 구조화된 데이터와 텍스트 표현을 함께 제공합니다. `lint`는 `diagnostics`, `errorCount`, `warningCount`, `filesChecked`를 반환합니다. 진단에는 파일·줄·열·ESLint 규칙 ID가 포함되며, 프로젝트 계약 위반에는 `policyId`, `reason`, 선택적 `suggestion`도 포함됩니다.

후보 정책 검사가 성공하더라도 정책 저장과 에디터·CI 연결은 서로 다른 작업입니다. 실제 병합 관문은 [CI 연결](enforcement.md)에서 구성합니다.
