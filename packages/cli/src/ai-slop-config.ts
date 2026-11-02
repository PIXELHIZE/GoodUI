import { isCancel, multiselect, select } from '@clack/prompts';
import {
  AI_SLOP_RULE_NAMES, getAiSlopRuleCatalog, getAiSlopRules, PolicyError, readPolicy, writePolicy,
  type AiSlopRuleName, type Locale, type Policy,
} from '@pixelhize/goodui-core';
import { text } from './ui-text.js';

export interface AiSlopChoices { enabled?: boolean; rules?: AiSlopRuleName[] }

export function aiSlopEnabled(policy: Policy): boolean {
  return policy.aiSlop?.enabled ?? policy.presets?.includes('ai-slop') ?? false;
}

export function parseAiSlopNames(value: string, locale: Locale): AiSlopRuleName[] {
  const names = value.split(',').map(name => name.trim().replace(/^goodui\//, ''));
  for (const name of names) if (!(AI_SLOP_RULE_NAMES as readonly string[]).includes(name)) {
    throw new PolicyError('UNKNOWN_AI_SLOP_RULE', text(locale, `Unknown AI Slop check: ${name}. Run goodui rules.`, `알 수 없는 AI Slop 검사: ${name}. goodui rules로 목록을 확인하세요.`));
  }
  return [...new Set(names)] as AiSlopRuleName[];
}

/** An absent selection preserves existing settings, including an explicit opt-out. */
export function applyAiSlopChoices(input: Policy, choices: AiSlopChoices, locale: Locale = 'en'): Policy {
  const policy = structuredClone(input);
  if (choices.enabled === undefined && choices.rules === undefined) return policy;
  if (choices.enabled === false && choices.rules !== undefined) throw new PolicyError('AI_SLOP_CONFLICT', text(locale, 'Cannot combine --no-ai-slop and --ai-slop-rules.', '--no-ai-slop과 --ai-slop-rules를 함께 사용할 수 없습니다.'));
  const current = { ...policy.aiSlop };
  if (choices.rules !== undefined) {
    if (!Array.isArray(choices.rules) || choices.rules.some(name => !(AI_SLOP_RULE_NAMES as readonly string[]).includes(name))) {
      throw new PolicyError('UNKNOWN_AI_SLOP_RULE', text(locale, 'Unknown AI Slop check in setup options.', '설치 옵션에 알 수 없는 AI Slop 검사 항목이 있습니다.'));
    }
    const selected = new Set(choices.rules);
    current.rules = Object.fromEntries(AI_SLOP_RULE_NAMES.map(name => [name, selected.has(name)]));
  }
  if (choices.enabled !== undefined) current.enabled = choices.enabled;
  else if (choices.rules !== undefined) current.enabled = true;
  policy.aiSlop = current;
  return policy;
}

export async function chooseAiSlop(policy: Policy, locale: Locale): Promise<AiSlopChoices | null> {
  const enabled = aiSlopEnabled(policy);
  const selection = await select({
    message: text(locale, 'Configure built-in AI Slop checks', '내장 AI Slop 검사를 설정하세요\n↑/↓ 이동 · Enter 선택'),
    showInstructions: locale !== 'ko', initialValue: enabled ? 'on' : 'off',
    options: [
      { value: 'on', label: text(locale, 'Enable AI Slop checks', 'AI Slop 검사 켜기'), hint: text(locale, 'Keep individual choices; ten checks are enabled by default', '기존 항목 선택 유지 · 기본 10개 검사') },
      { value: 'custom', label: text(locale, 'Choose individual checks', '항목별로 선택'), hint: text(locale, 'Toggle each of the thirteen checks', '13개 검사를 각각 켜거나 끄기') },
      { value: 'off', label: text(locale, 'Disable AI Slop checks', 'AI Slop 검사 끄기'), hint: text(locale, 'Preserve individual choices for later', '세부 설정을 보존하며 전체 끄기') },
    ],
  });
  if (isCancel(selection)) return null;
  if (selection !== 'custom') return { enabled: selection === 'on' };
  const catalogue = getAiSlopRuleCatalog(locale);
  const effective = getAiSlopRules({ ...policy, aiSlop: { ...policy.aiSlop, enabled: true } });
  const chosen = await multiselect({
    message: text(locale, 'Choose AI Slop checks (Space toggles, Enter confirms)', 'AI Slop 검사 항목을 선택하세요\n↑/↓ 이동 · Space 선택/해제 · Enter 완료'),
    showInstructions: locale !== 'ko', required: false,
    initialValues: [...effective],
    options: catalogue.map(rule => ({ value: rule.name, label: rule.name, hint: rule.description })),
  });
  if (isCancel(chosen)) return null;
  return { enabled: true, rules: chosen as AiSlopRuleName[] };
}

export async function changeAiSlop(rootDir: string, policyPath: string, target: string, enabled: boolean, locale: Locale) {
  const snapshot = await readPolicy(rootDir, policyPath, { locale });
  const policy = structuredClone(snapshot.policy);
  if (target === 'ai-slop') {
    policy.aiSlop = { ...policy.aiSlop, enabled };
  } else {
    const names = parseAiSlopNames(target, locale);
    if (names.length !== 1) throw new PolicyError('INVALID_AI_SLOP_TARGET', text(locale, 'Specify one check per enable/disable command.', '켜기·끄기 명령에는 검사 항목 하나를 지정하세요.'));
    policy.aiSlop = {
      ...policy.aiSlop,
      enabled: enabled ? true : aiSlopEnabled(policy),
      rules: { ...policy.aiSlop?.rules, [names[0]!]: enabled },
    };
  }
  const saved = await writePolicy(rootDir, policy, { policyPath, expectedRevision: snapshot.revision, locale });
  return { ...saved, target, enabled, aiSlopEnabled: aiSlopEnabled(policy), activeRules: [...getAiSlopRules(policy)] };
}
