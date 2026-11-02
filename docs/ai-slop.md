# AI-slop 패턴 검사

반복적으로 나타나는 UI 표현을 소스에서 확인 가능한 계약으로 검사합니다. GoodUI가 자체 AST 분석과 진단을 구현하며 외부 린터·모델 API를 호출하지 않습니다. 사람과 AI 중 누가 코드를 작성했는지 판정하는 기능은 아닙니다.

## 활성화와 선택

정책에서 `aiSlop.enabled: true` 또는 `presets: ["ai-slop"]`로 활성화합니다. 명시적인 `enabled: false`가 preset보다 우선합니다. 두 활성화 방식 모두 없으면 검사하지 않습니다.

```json
{
  "$schema": "./.goodui/schema.json",
  "version": 1,
  "rules": [],
  "aiSlop": {
    "enabled": true,
    "rules": {
      "no-emoji-icons": false,
      "no-nested-cards": true
    },
    "files": ["src/**"],
    "ignores": ["src/generated/**"],
    "allowClasses": ["brand-gradient-*"],
    "allowPhrases": ["Unlock your potential"],
    "allowFonts": ["Inter"],
    "note": "브랜드에서 승인한 표현을 기준으로 검토합니다."
  }
}
```

`aiSlop.rules`는 규칙 이름과 boolean을 연결하는 객체입니다. 명시하지 않은 규칙은 아래 기본값을 따릅니다. `rules: { "no-emoji-icons": false }`는 해당 규칙 하나만 끄며 나머지 기본 규칙을 유지합니다. 최상위 `rules`는 일반 프로젝트 계약의 배열이므로 서로 구분하세요.

| 규칙 | 기본값 | 확인하는 패턴 |
| --- | --- | --- |
| `no-gradient-text` | 켜짐 | 명시적인 그라디언트 텍스트 |
| `no-purple-gradients` | 켜짐 | 명시적인 보라색 계열 그라디언트 |
| `no-glassmorphism` | 켜짐 | 반투명 표면과 backdrop blur의 조합 |
| `no-decorative-blobs` | 켜짐 | 확인 가능한 장식용 블롭 스타일 |
| `no-hover-lift` | 켜짐 | hover에서 요소를 띄우거나 확대하는 스타일 |
| `no-bounce-animation` | 켜짐 | 명시적인 바운스 애니메이션 |
| `no-emoji-icons` | 켜짐 | 정적 UI 텍스트의 이모지 표현 |
| `no-generic-copy` | 켜짐 | 정해진 네 가지 상투 문구 |
| `no-placeholder-copy` | 켜짐 | 명시적인 임시 문구·브랜드 마커 |
| `no-placeholder-links` | 켜짐 | 비어 있거나 동작 없는 정적 링크 대상 |
| `no-nested-cards` | 꺼짐 | 명시적인 Card 또는 card 클래스의 중첩 |
| `no-oversized-radius` | 꺼짐 | 정해진 큰 모서리 반경 토큰·수치 |
| `no-generic-fonts` | 꺼짐 | 정해진 네 가지 글꼴의 명시적 선택 |

디자인 선택의 맥락을 소스만으로 확정하기 어려운 마지막 세 규칙은 프로젝트에서 선택합니다. 필요한 브랜드 표현은 허용 목록이나 사유 있는 정책 예외로 관리하세요.

## 스타일 6종의 실제 조건

JSX·Vue·Svelte의 정적으로 읽을 수 있는 클래스·인라인 스타일과 파일 안의 `<style>` 블록을 확인합니다. 여러 조건이 필요한 규칙은 같은 요소의 클래스 선택지 또는 한 CSS 규칙 안에서 증거가 모여야 합니다. 서로 배타적인 완전한 클래스 문자열 분기를 합쳐 위반을 만들지는 않습니다.

- `no-gradient-text`: 그라디언트 배경과 `bg-clip-text`, `text-transparent`의 조합을 확인합니다. CSS의 `background-clip: text`·투명 글자색과 대응하는 WebKit 속성도 같은 조건으로 봅니다. 투명 글자색이나 그라디언트 하나만으로는 실패하지 않습니다.
- `no-purple-gradients`: 그라디언트 배경에 `from`·`via`·`to`의 `purple`·`violet`·`fuchsia`·`indigo` 계열 색상이 명시되었거나, 지원되는 정적 CSS 색값에서 보라색 계열을 확인한 경우입니다. 단색 `bg-indigo-500`은 허용합니다.
- `no-glassmorphism`: backdrop blur와 0보다 크고 1보다 작은 배경 알파 값의 조합입니다. 예를 들어 `backdrop-blur-md bg-white/10`을 검사하며, 불투명 배경과 blur만 있는 조합은 허용합니다. CSS 변수의 실제 색·알파는 추정하지 않습니다.
- `no-decorative-blobs`: absolute/fixed 배치, 완전히 둥근 모양, 강한 blur, 큰 가로·세로, 색상 배경이 함께 있어야 합니다. 여기에 빈 요소·`aria-hidden`·`pointer-events-none` 같은 장식 근거도 필요합니다. 크기는 `w-32`·`h-32` 이상 계열 또는 명시적인 128px·8rem 이상 수치(rem은 16px 기준)를 확인하며, 일반 둥근 아바타는 이 조합에 해당하지 않습니다. CSS 블록에서는 `blob`·`orb`·`glow` 선택자나 `pointer-events: none`을 장식 근거로 봅니다.
- `no-hover-lift`: 실제 hover 상태의 위쪽 이동과 1보다 큰 정적 확대를 검사합니다. `hover:-translate-y-1`, `hover:scale-105`, `hover:scale-[1.1]`, `hover:scale-[105%]`, `:hover { transform: scale(1.1) }` 등이 대상입니다. 확대 없는 95/100 값, `var()`처럼 확인할 수 없는 값, hover 없는 기본 상태, `:not(:hover)`는 허용합니다. 대괄호 선택자 variant도 양의 `:hover`가 있는지 분석합니다.
- `no-bounce-animation`: `animate-bounce`, `animate-[bounce_1s_infinite]` 같은 명시적인 bounce 클래스나, 정적 `animation`·`animation-name`에 지정한 bounce 계열 이름을 확인합니다. 임의의 keyframes가 시각적으로 튀는 동작인지는 추정하지 않습니다.

프로젝트 밖의 CSS 전체, 최종 CSS cascade, 런타임 변수와 화면 기하를 계산하는 검사는 아닙니다. Tailwind 테마나 컴파일러 없이도 이 검사군만 독립 실행할 수 있습니다.

## 문구 검사 범위

JSX·Vue·Svelte의 텍스트 노드, 직접 렌더링하는 정적 문자열 표현식, `title`·`aria-label`·`placeholder`의 정적 값을 검사합니다. 한 단계의 `const` 값과 유한한 리터럴 선택지는 기존 정적 값 분석으로 확인할 수 있습니다.

일반 코드 문자열·주석·`data-*` 속성과 번역 함수의 인수는 문구 검사 대상이 아닙니다. `t("Lorem ipsum")` 같은 호출의 반환값은 추정하지 않습니다. `script`·`style`·`pre`·`code` 아래의 텍스트와 정적으로 숨김이 확정되는 `hidden` 아래의 문구는 제외합니다. `aria-hidden="true"`는 화면에서 숨기는 속성이 아니므로 검사합니다. 동적 숨김 상태나 CSS의 최종 표시 여부는 계산하지 않습니다.

`no-emoji-icons`는 Unicode `Emoji_Presentation` 문자 또는 이모지 문자와 VS16의 조합을 확인합니다. 일반 `©`·`™`·텍스트형 하트는 허용하고 이모지 표시를 명시한 `❤️`는 검사합니다. 이모지가 실제 아이콘 역할인지, 의도한 브랜드 표현인지까지 판단하지 않습니다.

`no-generic-copy`는 다음 네 구절만 검사합니다. 단어 `unlock`, `workflow`, `혁신` 하나만으로는 실패하지 않습니다.

- `Unlock your potential`
- `Revolutionize your workflow`
- `혁신적인 솔루션`
- `무한한 가능성`

`no-placeholder-copy`는 `Lorem ipsum`, `[Your Brand]`, `[Company Name]`, `[Your Company]`, `[Your Product]`, `[Insert Text]`, `[Placeholder]`, `[회사명]`, `[브랜드명]`, `[제품명]`을 검사합니다.

문구 매칭은 앞뒤 공백을 제거하고 연속 공백을 하나로 합치며 대소문자를 구분하지 않습니다. `allowPhrases`는 이 방식으로 정규화한 **전체 텍스트**와 정확히 일치해야 합니다. 예를 들어 `Unlock your potential`을 허용해도 `Unlock your potential today`까지 허용하지는 않습니다. 해당 허용 목록은 위 세 문구 규칙에만 적용합니다.

## 링크와 선택 규칙

`no-placeholder-links`는 정적 `<a>`·인식 가능한 Next 링크 별칭의 `href`, React Router `Link`·`NavLink`와 그 import 별칭의 `to`를 확인합니다. 출처가 정해지지 않은 `Link`·`*.Link` 이름에는 `href`·`to`를 확인합니다. 빈 문자열, `#`, `javascript:void(0)`만 검사하며 공백·대소문자·마지막 세미콜론 차이는 허용합니다. 실제 fragment인 `#pricing`, `/path`, 정상 URL은 통과합니다. 일반 `<a>`의 `to` 속성을 링크 대상으로 오해하지 않습니다. 링크가 네트워크에서 실제로 열리는지는 확인하지 않습니다.

`no-nested-cards`는 `Card`, `*.Card`, 이름 있는 `Card` import 별칭, 정확한 `card` 클래스가 다른 카드 아래에 있는 경우를 확인합니다. `CardHeader`, 임의의 `UserCard`, 일반 `article`만으로 카드라고 추정하지 않습니다. JSX prop 콜백에 들어 있는 요소도 바깥 카드의 렌더링 자식으로 취급하지 않습니다. 임의의 wrapper 컴포넌트를 실행하거나 파일 밖 구현을 따라가지 않습니다.

`no-oversized-radius`는 전체 모서리에 지정한 `rounded-3xl`부터 `rounded-9xl`, `rounded-[32px]`·`rounded-[2rem]` 이상의 명시적 수치, 같은 한계 이상의 인라인 `borderRadius`·`border-radius`를 검사합니다. React의 숫자 값은 px로 취급합니다. `rounded-full`, CSS 변수, `calc()`나 계산된 최종 크기는 추정하지 않습니다. 단위별 리터럴 한계이며 실제 root 글자 크기를 측정하지 않습니다.

`no-generic-fonts`는 `Inter`, `Arial`, `Helvetica`, `Roboto`를 인라인 `fontFamily`·`font-family`, `font-[Inter]` 같은 명시적 클래스나 `font-inter` 같은 이름으로 선택한 경우만 확인합니다. 글꼴 stack에서는 해당 이름 각각을 검사합니다. `font-sans`, `font-mono`, CSS 변수의 실제 글꼴은 추정하지 않습니다. `allowFonts`는 인용부호·앞뒤 공백을 제거하고 대소문자를 구분하지 않는 **단일 글꼴 이름의 정확한 일치**입니다. 해당 글꼴이 보편적으로 나쁘다는 판정은 아닙니다.

## 파일 범위와 예외

`aiSlop.files`는 최상위 `files` 안에서 이 검사군을 추가로 제한하며 `aiSlop.ignores`는 이 검사군에서 제외할 파일 glob입니다. `allowClasses`는 클래스 기반 검사에 적용합니다. `*`·`?`만 wildcard로 사용하고 대괄호는 리터럴로 취급하며 variant를 포함한 토큰과 기본 클래스 이름을 비교합니다. 인라인 스타일에는 이 클래스 허용 목록을 적용하지 않습니다.

정책의 중앙 예외는 다음과 같이 등록합니다. inline ESLint disable로 계약을 숨기는 방식은 지원하지 않습니다.

```json
{
  "ruleId": "goodui/no-placeholder-copy",
  "files": ["src/examples/**"],
  "reason": "문구 편집기의 예제 화면에서 의도적으로 사용합니다."
}
```

진단의 규칙 ID는 `goodui/no-generic-copy`처럼 고정됩니다. 한국어·영어는 `--locale`로 선택하고 사용자 `note`·기존 정책 사유는 원문을 유지합니다. CLI·MCP·에디터는 같은 정책 구성을 사용합니다.

```sh
npm exec -- goodui policy validate --locale ko
npm exec -- goodui check --locale ko
npm exec -- goodui explain goodui/no-generic-copy --locale ko --format json
```

이 검사는 UI의 최종 품질, 브랜드 적합성, 통계의 진위, 후기의 실존 여부, 제품 주장의 사실성, 런타임 텍스트나 임의의 컴포넌트 흐름을 보장하지 않습니다. 여러 텍스트 노드에 나뉜 문구를 최종 DOM처럼 합치지도 않습니다. 검사를 통과한 화면에도 실제 제품과 사용자를 기준으로 한 검토가 필요합니다. 참고한 패턴과 고정 커밋·라이선스 기록은 [출처](ai-slop-sources.md)에 남깁니다.
