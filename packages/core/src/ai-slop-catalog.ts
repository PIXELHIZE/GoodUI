import { AI_SLOP_RULE_NAMES, DEFAULT_AI_SLOP_RULES, type AiSlopRuleName } from './types.js';
import type { Locale } from './locale.js';

export interface AiSlopRuleCatalogEntry {
  id: `goodui/${AiSlopRuleName}`;
  name: AiSlopRuleName;
  description: string;
  reason: string;
  suggestion: string;
  defaultEnabled: boolean;
  category: 'style' | 'motion' | 'content' | 'structure' | 'typography';
}

type Text = { description: string; reason: string; suggestion: string };
type Definition = { category: AiSlopRuleCatalogEntry['category']; en: Text; ko: Text };

const definitions: Record<AiSlopRuleName, Definition> = {
  'no-gradient-text': {
    category: 'style',
    en: { description: 'Flag recognizable gradient-filled text in source styles.', reason: 'Text should follow the project typography and color system.', suggestion: 'Use a solid project text color and communicate hierarchy through type and spacing.' },
    ko: { description: '소스 스타일에서 확인할 수 있는 그라디언트 텍스트를 검사합니다.', reason: '텍스트는 프로젝트의 글꼴과 색상 체계를 따라야 합니다.', suggestion: '프로젝트의 단색 텍스트 색상을 사용하고 글자 크기와 간격으로 위계를 표현하세요.' },
  },
  'no-purple-gradients': {
    category: 'style',
    en: { description: 'Flag recognizable purple or violet gradient decoration.', reason: 'Decorative gradients should express the project identity rather than a stock visual pattern.', suggestion: 'Use an approved brand surface or explicitly allow a gradient required by the design.' },
    ko: { description: '확인 가능한 보라색 계열의 장식용 그라디언트를 검사합니다.', reason: '장식용 그라디언트는 흔한 시각 패턴 대신 프로젝트의 정체성을 표현해야 합니다.', suggestion: '승인된 브랜드 배경을 사용하거나 디자인에 필요한 그라디언트를 명시적으로 허용하세요.' },
  },
  'no-glassmorphism': {
    category: 'style',
    en: { description: 'Flag recognizable glass-like combinations of translucent surfaces and backdrop blur.', reason: 'Surface treatment should follow the project design system.', suggestion: 'Use an approved opaque surface or explicitly allow a required translucent treatment.' },
    ko: { description: '반투명 배경과 backdrop blur를 결합한 유리 효과를 소스에서 확인해 검사합니다.', reason: '표면 표현은 프로젝트 디자인 시스템을 따라야 합니다.', suggestion: '승인된 불투명 배경을 사용하거나 필요한 반투명 표현을 명시적으로 허용하세요.' },
  },
  'no-decorative-blobs': {
    category: 'style',
    en: { description: 'Flag recognizable decorative blurred blob patterns.', reason: 'Decorative shapes should serve a specific purpose in the project design.', suggestion: 'Remove background blobs or replace them with purposeful project artwork.' },
    ko: { description: '확인 가능한 흐릿한 장식용 블롭 패턴을 검사합니다.', reason: '장식용 도형은 프로젝트 디자인에서 구체적인 목적을 가져야 합니다.', suggestion: '배경 블롭을 제거하거나 목적에 맞는 프로젝트 그래픽으로 교체하세요.' },
  },
  'no-hover-lift': {
    category: 'motion',
    en: { description: 'Flag recognizable hover effects that lift or enlarge an element.', reason: 'Hover feedback should match the element interaction and project motion system.', suggestion: 'Use restrained project hover states or explicitly allow a necessary transform.' },
    ko: { description: 'hover 시 요소를 띄우거나 확대하는 효과를 소스에서 확인해 검사합니다.', reason: 'hover 피드백은 요소의 상호작용과 프로젝트의 모션 체계에 맞아야 합니다.', suggestion: '프로젝트의 절제된 hover 상태를 사용하거나 필요한 transform을 명시적으로 허용하세요.' },
  },
  'no-bounce-animation': {
    category: 'motion',
    en: { description: 'Flag recognizable bounce animation declarations.', reason: 'Animation should communicate useful state or feedback.', suggestion: 'Remove decorative bouncing or use an approved motion pattern for the interaction.' },
    ko: { description: '확인 가능한 바운스 애니메이션 선언을 검사합니다.', reason: '애니메이션은 유용한 상태나 피드백을 전달해야 합니다.', suggestion: '장식용 바운스를 제거하거나 상호작용에 맞는 승인된 모션 패턴을 사용하세요.' },
  },
  'no-emoji-icons': {
    category: 'content',
    en: { description: 'Flag recognizable emoji used as UI icon decoration in static content.', reason: 'Interface icons should use a consistent project icon system.', suggestion: 'Use an approved icon component or meaningful text instead of a decorative emoji.' },
    ko: { description: '정적 UI 콘텐츠에서 아이콘 장식으로 사용한 이모지를 검사합니다.', reason: '인터페이스 아이콘은 일관된 프로젝트 아이콘 체계를 사용해야 합니다.', suggestion: '장식용 이모지 대신 승인된 아이콘 컴포넌트나 의미 있는 텍스트를 사용하세요.' },
  },
  'no-generic-copy': {
    category: 'content',
    en: { description: 'Flag recognized stock marketing phrases in static UI copy.', reason: 'Interface copy should explain the actual product and user task.', suggestion: 'Replace stock claims with concrete capabilities, evidence or actions; explicitly allow intentional phrases.' },
    ko: { description: '정적 UI 문구에서 미리 정의된 상투적 마케팅 표현을 검사합니다.', reason: '인터페이스 문구는 실제 제품과 사용자의 작업을 설명해야 합니다.', suggestion: '상투적인 주장 대신 구체적인 기능, 근거, 행동을 적고 의도한 표현은 명시적으로 허용하세요.' },
  },
  'no-placeholder-copy': {
    category: 'content',
    en: { description: 'Flag recognized placeholder phrases in static UI text.', reason: 'User-facing text should contain the intended content.', suggestion: 'Replace placeholder copy with reviewed content or explicitly allow an intentional example.' },
    ko: { description: '정적 UI 텍스트에서 미리 정의된 임시 문구를 검사합니다.', reason: '사용자에게 보이는 텍스트에는 의도한 실제 내용이 있어야 합니다.', suggestion: '임시 문구를 검토된 실제 내용으로 교체하거나 의도한 예제를 명시적으로 허용하세요.' },
  },
  'no-placeholder-links': {
    category: 'content',
    en: { description: 'Flag recognizable placeholder destinations on static UI links.', reason: 'Links should have an intentional destination or use an appropriate action control.', suggestion: 'Set a real destination, use a button for an action, or explicitly allow an intentional placeholder.' },
    ko: { description: '정적 UI 링크에서 확인 가능한 임시 목적지를 검사합니다.', reason: '링크에는 의도한 목적지가 있어야 하며 동작에는 적절한 컨트롤을 사용해야 합니다.', suggestion: '실제 목적지를 지정하거나 동작에는 버튼을 사용하고 의도한 임시 링크는 명시적으로 허용하세요.' },
  },
  'no-nested-cards': {
    category: 'structure',
    en: { description: 'Opt-in check for recognizable card containers nested inside other cards.', reason: 'Nested surface containers should reflect meaningful information hierarchy.', suggestion: 'Use spacing, separators or a simpler hierarchy instead of redundant card layers.' },
    ko: { description: '다른 카드 안에 중첩된 것으로 확인되는 카드 컨테이너를 선택적으로 검사합니다.', reason: '중첩된 표면 컨테이너는 의미 있는 정보 위계를 표현해야 합니다.', suggestion: '불필요한 카드 계층 대신 간격, 구분선, 단순한 정보 위계를 사용하세요.' },
  },
  'no-oversized-radius': {
    category: 'style',
    en: { description: 'Opt-in check for recognizable oversized corner-radius declarations.', reason: 'Corner radii should follow the project shape scale and component purpose.', suggestion: 'Use an approved radius token or explicitly allow a required pill or circular shape.' },
    ko: { description: '확인 가능한 과도한 모서리 반경 선언을 선택적으로 검사합니다.', reason: '모서리 반경은 프로젝트의 형태 체계와 컴포넌트 목적에 맞아야 합니다.', suggestion: '승인된 radius 토큰을 사용하거나 필요한 알약형·원형 모양을 명시적으로 허용하세요.' },
  },
  'no-generic-fonts': {
    category: 'typography',
    en: { description: 'Opt-in check for recognized stock font choices in source styles.', reason: 'Font selection should follow the project typography system.', suggestion: 'Use the project font or explicitly allow the intended font family.' },
    ko: { description: '소스 스타일에서 미리 정의된 흔한 글꼴 선택을 선택적으로 검사합니다.', reason: '글꼴 선택은 프로젝트의 타이포그래피 체계를 따라야 합니다.', suggestion: '프로젝트 글꼴을 사용하거나 의도한 글꼴 이름을 명시적으로 허용하세요.' },
  },
};

/** Fresh metadata per request; no user policy prose or global locale is changed. */
export function getAiSlopRuleCatalog(locale: Locale = 'en'): AiSlopRuleCatalogEntry[] {
  return AI_SLOP_RULE_NAMES.map(name => ({
    id: `goodui/${name}`, name, ...definitions[name][locale],
    defaultEnabled: DEFAULT_AI_SLOP_RULES.includes(name), category: definitions[name].category,
  }));
}
