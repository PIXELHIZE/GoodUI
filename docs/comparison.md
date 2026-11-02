# 디자인 린터와 GoodUI의 범위

비교 참고 자료는 `shadcn-ui/lint`의 `db0a9a90` 커밋입니다. 해당 프로젝트는 Tailwind v4 디자인 규칙을 제공하며 React·Vue·Svelte와 ESLint·Oxlint를 지원합니다. [공식 README](https://github.com/shadcn-ui/lint/blob/db0a9a90/README.md)

GoodUI 0.4는 자체 클래스 lexer·값 분석·토큰 수집·컴포넌트 인식·진단을 구현합니다. 다른 린터의 설정이나 진단을 전달하는 구조가 아닙니다. 실제 utility 생성 여부에는 공식 Tailwind 컴파일러 primitive를 사용합니다.

| 항목 | 참고 프로젝트 | GoodUI 0.4 |
| --- | --- | --- |
| 주 대상 | Tailwind 디자인 시스템 | 일반 JS·TS 계약 9종, 네이티브 디자인 규칙 6종, AI Slop 13종 |
| 실행기 | ESLint·Oxlint | ESLint 9·10, CLI·MCP |
| 설정 | 자체 규칙·설정 인터페이스 | 단일 JSON 정책·오프라인 스키마·중앙 예외 |
| 설치 | 프로젝트별 linter 구성 | 메인 CLI 하나, 키보드 선택·자동화 flags·dry-run |
| AI 작업 | 디자인 진단·설정 안내 | 정책 조회·후보 검증·미리 검사·revision 기반 저장 |

규칙 이름이 비슷해도 옵션·인식 범위·분류 기준은 독립적입니다. 참고 프로젝트의 벤치마크나 평가 결과를 GoodUI의 정확성·성능 결과로 사용하지 않습니다. GoodUI가 모든 wrapper 흐름, 모든 CSS 조합, 다른 엔진의 고급 옵션을 동등하게 구현했다고 주장하지 않습니다.

GoodUI에서 지원하는 실제 옵션은 [정책](policy.md), [개발 규약](development.md), [네이티브 디자인 규칙](tailwind.md), [AI Slop 패턴과 출처](ai-slop.md)를 기준으로 확인하세요. 기존 린트·타입 검사·스타일 검사가 수행하는 다른 역할은 기존 명령과 함께 유지합니다.
