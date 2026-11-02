# @pixelhize/goodui-mcp

GoodUI 정책을 AI 도구에서 읽고 설정하며 JS·TS·React·Vue·Svelte 소스를 검사하는 내부 로컬 MCP 서버입니다. 일반 프로젝트는 메인 `@pixelhize/goodui-cli` 하나를 설치하고 `goodui mcp`로 실행합니다. 이 패키지를 별도 직접 설치할 필요는 없습니다. 자체 LLM이나 API 키가 필요하지 않습니다. 사용자의 AI가 자연어 지침을 지원되는 정책으로 변환하고 서버는 검증·저장·검사를 수행합니다.

Node.js 22.13 이상인 22 버전 또는 Node.js 24 이상을 사용합니다.

## 실행

대상 프로젝트에 메인 CLI의 agent 모드를 설정한 뒤 실행합니다.

```sh
npx --yes @pixelhize/goodui-cli@0.3.0 init --yes --mode agent --preset project
npm exec -- goodui mcp --root /absolute/path/to/project
npm exec -- goodui mcp --help
```

프로젝트에 설치하지 않고 실행하려면 npm 패키지 이름과 실행 파일 이름을 명시합니다.

```sh
npm exec --yes --package=@pixelhize/goodui-cli@0.3.0 -- goodui mcp --root /absolute/path/to/project
```

에디터 검사도 함께 준비하려면 all 모드를 사용합니다. 필요한 ESLint는 설치기가 확인합니다.

```sh
npx --yes @pixelhize/goodui-cli@0.3.0 init --yes --mode all --preset project
```

`--root`를 생략하면 현재 디렉터리가 프로젝트 루트가 됩니다. 기본 정책은 `goodui.policy.json`이며 `--policy .config/goodui.policy.json`으로 프로젝트 내부의 다른 경로를 지정할 수 있습니다. 서버는 표준 입출력으로 MCP 메시지를 주고받으며 별도 HTTP 포트를 열지 않습니다. 실행 오류는 표준 오류로 출력합니다. `--help`는 사용법을 출력하고 종료합니다.

## MCP 호스트 연결

agent·all 모드는 선택한 패키지 매니저용 실행 명령과 범용 설정 예제를 출력합니다. 호스트 설정 파일을 자동으로 변경하지 않습니다. 로컬 stdio 서버를 지원하는 호스트에 출력 예제를 적용하세요. 다음은 npm 프로젝트의 예이며 경로는 대상 프로젝트의 절대 경로로 바꿉니다.

```json
{
  "mcpServers": {
    "goodui": {
      "command": "npm",
      "args": [
        "--prefix",
        "E:/coding/my-project",
        "exec",
        "--",
        "goodui",
        "mcp",
        "--root",
        "E:/coding/my-project",
        "--policy",
        "goodui.policy.json"
      ]
    }
  }
}
```

호스트별 설정 형식은 다를 수 있습니다. 서버 인수에 지정한 프로젝트 하나만 읽거나 변경할 수 있으며 도구 호출로 루트를 바꿀 수 없습니다.

SDK v2 클라이언트를 별도 설치한 환경에서는 다음과 같이 연결할 수 있습니다.

```ts
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const client = new Client({ name: 'my-goodui-client', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: ['/absolute/path/to/project/node_modules/@pixelhize/goodui-cli/dist/index.js', 'mcp', '--root', '/absolute/path/to/project'],
}));

try {
  const catalog = await client.callTool({ name: 'get_rule_catalog', arguments: {} });
  console.log(catalog.structuredContent);
} finally {
  await client.close();
}
```

자체 호스트나 테스트는 `createGooduiServer({ rootDir, policyPath? })`를 import해 전송 계층을 직접 연결할 수도 있습니다. 팩토리는 전송 계층을 열지 않습니다. 사용자 지정 기본 정책도 프로젝트 내부 경로여야 합니다.

저장소에서 개발할 때는 `pnpm install`, `pnpm build` 후 `node packages/cli/dist/index.js mcp --root /absolute/path/to/project`로 실행할 수 있습니다. 별도 호스트 구현에는 이 패키지의 `createGooduiServer` API를 직접 사용할 수도 있습니다.

## 도구

모든 경로는 지정 프로젝트 루트 안에 있어야 합니다. 도구의 `policyPath`를 생략하면 서버 시작 시 지정한 `--policy` 또는 기본 `goodui.policy.json`을 사용합니다.

| 도구 | 입력 | 결과 |
| --- | --- | --- |
| `get_policy` | 선택적 `policyPath` | 검증된 `policy`, 파일 해시 `revision`, 절대 `path` |
| `get_rule_catalog` | 선택적 `kind`, `includeSchema` | 일반 계약 `rules`, 네이티브 `presets`, 선택적 전체 `schema` |
| `validate_policy` | `policy` | 저장 없이 `valid`, `errors`, 유효한 경우 `policy` |
| `set_policy` | `policy`, 필수 `expectedRevision`, 선택적 `policyPath` | 검증·저장 후 정책 스냅샷 |
| `lint` | 선택적 `policy` 또는 `policyPath`, 선택적 `files` | `diagnostics`, `errorCount`, `warningCount`, `filesChecked` |

`lint.files`에는 실제로 존재하는 파일·디렉터리 경로를 넣습니다. `**/*.ts` 같은 검색 패턴은 받지 않으며, `app/[id]/page.tsx` 같은 실제 파일명은 사용할 수 있습니다. 생략하면 프로젝트를 검사합니다. 검사 범위의 glob은 정책의 `files`에서 설정합니다. 후보 `policy`를 전달하면 저장하지 않고 검사하며 `policyPath`와 함께 전달할 수 없습니다. 소스 자동 수정은 수행하지 않습니다.

`get_rule_catalog({kind: "component-contracts", includeSchema: false})`처럼 필요한 계약만 요청할 수 있습니다. 일반 kind·`goodui/` 규칙 ID·`tailwind`·네이티브 규칙 이름·`ai-slop`을 필터로 받습니다. false는 전체 정책 `schema` 필드를 생략하며 선택한 계약의 옵션·예제는 유지합니다. 기본 `rules`는 일반 9개와 AI Slop 13개이며 네이티브 디자인 6개는 preset metadata에서 안내합니다. `kind: "ai-slop"`은 AI 13개만, AI 개별 ID는 해당 항목만 반환합니다. 실제 활성 검사는 정책이 결정합니다.

네이티브 엔진은 자체 클래스·값·토큰 분석과 공식 Tailwind 컴파일러 primitive를 사용합니다. 별도 린터 설치는 필요하지 않습니다. 기본 unknown-class 검사는 실제 CSS entry가 필요하므로 메인 CLI의 `doctor`로 설정 준비를 확인할 수 있습니다. CLI·MCP는 검사마다 준비하며 에디터의 오래된 디자인 설정은 재로드해야 합니다.

린트 위반은 정상 검사 결과이며 `isError`가 설정되지 않습니다. 통과 여부는 `errorCount`를 확인하세요. 잘못된 입력·잘못된 정책 파일·루트 밖 경로·저장 충돌 등 실행 실패에는 `isError: true`가 설정됩니다. 서버가 처리한 실행 오류에는 `structuredContent.error`의 `code`, `message`, 가능한 경우 `details`를 함께 제공합니다. MCP SDK의 입력 스키마 오류는 SDK 오류 응답으로 반환됩니다. `validate_policy`는 잘못된 후보를 `valid: false`로 반환합니다.

## 정책 저장과 동시 편집

기존 정책을 수정할 때는 `get_policy`가 반환한 `revision`을 `set_policy.expectedRevision`에 그대로 전달합니다. 새 파일을 만들 때만 `null`을 사용합니다.

```ts
const loaded = await client.callTool({ name: 'get_policy', arguments: {} });
if (loaded.isError) throw new Error('Read the tool error before editing the policy.');
const snapshot = loaded.structuredContent as { policy: unknown; revision: string };

const nextPolicy = snapshot.policy; // 사용자의 요청에 맞게 수정할 전체 정책
const validation = await client.callTool({ name: 'validate_policy', arguments: { policy: nextPolicy } });
if (!(validation.structuredContent as { valid: boolean }).valid) throw new Error('Invalid candidate policy.');
const saved = await client.callTool({
  name: 'set_policy',
  arguments: { policy: nextPolicy, expectedRevision: snapshot.revision },
});
```

사용자가 파일을 직접 편집한 뒤 오래된 AI 요청이 저장을 시도하면 `POLICY_CONFLICT`로 실패합니다. 현재 파일을 다시 읽어 변경을 반영한 후 재시도해야 합니다. 잘못된 정책과 충돌 요청은 기존 정책을 덮어쓰지 않습니다. 정책 파일은 JSON 데이터이며 서버는 임의 JS·TS 설정 코드를 실행해 정책을 읽지 않습니다.

지원 계약으로 표현할 수 없는 자연어 요구는 AI가 사용자에게 알려야 합니다. 실제 VPN 연결 상태, 최종 화면, 모든 동적 값과 wrapper 흐름은 이 서버의 정적 검사 결과로 보장하지 않습니다.
