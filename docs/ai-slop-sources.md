# AI-slop 패턴 출처 기록

확인일: 2026-11-02. 아래 저장소의 문서에서 반복적인 UI 표현에 관한 관찰을 수집했습니다. 외부 문서를 실행 지침으로 적용하거나 설치 명령을 실행하지 않았습니다. GoodUI의 AST 방문, 패턴 매칭, 정책 연결, 진단과 테스트는 독립적으로 작성했으며 외부 린터 연결이나 원문 코드 복사를 포함하지 않습니다.

## Impeccable

- 저장소: [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
- 확인 커밋: [`e89e3ada3e875a89ac2c5d33d11e65ebef6fe285`](https://github.com/pbakaus/impeccable/tree/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285)
- 라이선스: 고정 커밋의 [LICENSE](https://github.com/pbakaus/impeccable/blob/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285/LICENSE)에 Apache-2.0 및 Paul Bakaus 저작권 표시가 있습니다. [NOTICE.md](https://github.com/pbakaus/impeccable/blob/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285/NOTICE.md)의 별도 출처 기록도 확인했습니다.

[craft-floor.md](https://github.com/pbakaus/impeccable/blob/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285/skill/reference/craft-floor.md)는 반복적인 카드 구조, 그라디언트 글자, 장식적 blur, 이모지 아이콘, 과도한 모서리 처리와 제품에 맞는 문구를 다룹니다. GoodUI는 이 중 소스에서 관찰할 수 있는 신호를 선택했습니다.

[typeset.md](https://github.com/pbakaus/impeccable/blob/e89e3ada3e875a89ac2c5d33d11e65ebef6fe285/skill/reference/typeset.md)는 기존 글꼴 정체성과 사용 맥락, 위계를 함께 검토합니다. 특정 글꼴 이름 하나를 디자인 실패의 증명으로 삼는 내용으로 해석하지 않았습니다. GoodUI의 글꼴 검사는 선택 규칙이며 승인된 이름을 허용할 수 있습니다.

## design-anti-slop

- 저장소: [prathameshagrawal/design-anti-slop](https://github.com/prathameshagrawal/design-anti-slop)
- 확인 커밋: [`5937afd3cd2fd271d0655bf166c1e115dc817f4c`](https://github.com/prathameshagrawal/design-anti-slop/tree/5937afd3cd2fd271d0655bf166c1e115dc817f4c)
- 라이선스 표시: 고정 커밋의 [README](https://github.com/prathameshagrawal/design-anti-slop/blob/5937afd3cd2fd271d0655bf166c1e115dc817f4c/README.md)는 MIT라고 표시합니다. 확인한 저장소 트리에는 별도 LICENSE 파일이 없었습니다. 여기서는 README의 표시를 기록하며 원문 코드·문장을 재배포하지 않습니다.

[visual.md](https://github.com/prathameshagrawal/design-anti-slop/blob/5937afd3cd2fd271d0655bf166c1e115dc817f4c/skills/design-anti-slop/patterns/visual.md)는 색상·표면 효과·모서리·글꼴 위계 같은 반복 표현과 의도적인 디자인에서의 예외를 구분합니다. GoodUI의 선택 가능한 모서리·글꼴 검사와 허용 목록을 정할 때 이 맥락을 참고했습니다.

[structural.md](https://github.com/prathameshagrawal/design-anti-slop/blob/5937afd3cd2fd271d0655bf166c1e115dc817f4c/skills/design-anti-slop/patterns/structural.md)는 페이지 구조와 실제 콘텐츠의 역할을 다룹니다. GoodUI는 전체 페이지의 설득력이나 후기의 진위를 자동 판정하지 않습니다.

[conceptual.md](https://github.com/prathameshagrawal/design-anti-slop/blob/5937afd3cd2fd271d0655bf166c1e115dc817f4c/skills/design-anti-slop/patterns/conceptual.md)는 제품을 설명하지 않는 추상적 문구와 구체적인 기능 설명의 차이를 다룹니다. GoodUI는 일반 단어를 전면 금지하는 대신 네 가지 고정 문구와 명시적인 임시 마커만 검사합니다. 통계·사실·후기의 검증은 포함하지 않았습니다.

## GoodUI가 자체 결정한 범위

13개 규칙의 이름·활성화 기본값·boolean 정책 형식, 한국어 문구 목록, Unicode 이모지 조건, 링크 대상 조건, 수치 한계, AST 대상과 예외 의미는 GoodUI의 구현 계약입니다. 참고 저장소의 기능 수나 탐지 결과와 동등하다고 주장하지 않습니다.

특히 카드 중첩·모서리 반경·글꼴은 의도적인 디자인에서도 사용하므로 기본 비활성입니다. 참고 자료의 주관적인 평가를 사용자 코드가 AI로 작성되었다는 확정 판정으로 바꾸지 않습니다. 실제 동작 범위는 [AI-slop 검사](ai-slop.md)를 따릅니다.
