# 정책 예제

아래 JSON은 스키마로 검증할 수 있는 계약 예제입니다. source 폴더·모듈·컴포넌트 API·CSS entry를 실제 프로젝트에 맞게 바꾸세요. 이름이나 한계를 그대로 적용하는 공통 권장 정책은 아닙니다.

| 파일 | 용도 |
| --- | --- |
| [network-policy.json](network-policy.json) | 직접 통신 API와 라이브러리, UI→서버 의존 경계 |
| [design-system-policy.json](design-system-policy.json) | native 요소·inline style·raw HTML·기존 UI 출처 제한 |
| [development-policy.json](development-policy.json) | AST 구문, 파일 이름·크기, export, 함수 지표 |
| [component-policy.json](component-policy.json) | 버튼 필수 props와 공용 컴포넌트 variant·size |
| [tailwind-policy.json](tailwind-policy.json) | 네이티브 여섯 디자인 규칙과 프로젝트 토큰 |
| [ai-slop-policy.json](ai-slop-policy.json) | AI Slop 전체·개별 선택, 브랜드 허용 목록, 예제 파일 예외 |

초기화한 프로젝트의 `goodui.policy.json`으로 복사할 때 `$schema`는 `./.goodui/schema.json`을 사용합니다. `init`이 오프라인 스키마를 생성합니다. 예제의 상대 `$schema`는 GoodUI 저장소 안에서 검증하기 위한 경로이며 검사기는 이 필드를 원격으로 읽지 않습니다.

```sh
node packages/cli/dist/index.js policy validate --policy examples/development-policy.json
node packages/cli/dist/index.js policy validate --policy examples/component-policy.json
node packages/cli/dist/index.js policy validate --policy examples/tailwind-policy.json
```

Tailwind 예제는 기존 Tailwind v4 프로젝트가 필요합니다. [tailwind-theme.css](tailwind-theme.css)를 원하는 CSS entry로 옮기고 `themeFiles`를 그 경로로 바꾸거나 기존 entry를 사용하세요. 메인 설치기는 Tailwind CSS 자체를 설치하지 않습니다. JSON 정책이 유효하다는 사실만으로 테마·import 경로가 준비됐다는 뜻은 아닙니다.

```sh
npm exec -- goodui doctor --format json
npm exec -- goodui check --format json
```

컴포넌트 예제의 `@app/ui`·variant·size는 예시 API입니다. native 버튼의 aria-label 계약은 프로젝트 선택이며 모든 접근성 패턴을 평가하지 않습니다. 네트워크 예제도 호출 경로만 검사하며 실제 Tailscale 접속·ACL·DNS·서비스 인증 상태는 확인하지 않습니다.
