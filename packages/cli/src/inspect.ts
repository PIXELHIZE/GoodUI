import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { satisfies, validRange } from 'semver';
import { PolicyError, policySchema, getPolicySchema, getPresetCatalog, getRuleCatalog, getAiSlopRuleCatalog, getAiSlopRules, AI_SLOP_RULE_NAMES, localizeMessage, readPolicy, resolveLocale, resolveProjectPath, type Locale, type LocaleInput } from '@pixelhize/goodui-core';
import { createConfig, plugin } from '@pixelhize/eslint-plugin-goodui';
import { version } from './version.js';

const descriptions: Record<string, string> = {
  'no-raw-colors': 'Use project color tokens instead of raw palette colors, hex values or color functions.',
  'no-arbitrary-values': 'Use approved design tokens instead of arbitrary utility values; allow explicit exceptions when needed.',
  'no-inline-styles': 'Keep component presentation in the approved design system instead of inline styles and style blocks.',
  'no-unknown-classes': 'Check candidate utilities against the project Tailwind compiler and allow/deny class policies.',
  'no-restyle': 'Keep recognized design-system components inside their presentation contract.',
  'require-static-classes': 'Require class expressions that can be statically checked, while inspecting known conditional branches.',
};

export interface RuleSummary { id: string; kind: string; description: string; preset?: string; defaultEnabled?: boolean }

export function listRules(locale?: LocaleInput): { version: string; rules: RuleSummary[]; presets: ReturnType<typeof getPresetCatalog> } {
  const selected = resolveLocale(locale);
  const presetCatalog = getPresetCatalog(selected);
  const aiSlopCatalogue = getAiSlopRuleCatalog(selected);
  const entries: RuleSummary[] = getRuleCatalog(selected).map(rule => ({ id: `goodui/${rule.kind}`, kind: rule.kind, description: rule.description }));
  for (const preset of presetCatalog) {
    for (const name of preset.availableRules) {
      const implementation = plugin.rules[name as keyof typeof plugin.rules] as { meta?: { docs?: { description?: string } } } | undefined;
      entries.push({
        id: `goodui/${name}`, kind: name,
        description: aiSlopCatalogue.find(rule => rule.name === name)?.description ?? localizeInspectMessage(descriptions[name] ?? implementation?.meta?.docs?.description ?? name, selected),
        preset: preset.name, defaultEnabled: (preset.defaultRules as readonly string[]).includes(name),
      });
    }
  }
  return { version, rules: entries, presets: presetCatalog };
}

function standaloneOptions(schema: unknown, locale: Locale): Record<string, unknown> {
  const definitions = getPolicySchema(locale).definitions as Record<string, unknown>;
  const needed: Record<string, unknown> = {};
  function collect(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(collect); return; }
    const object = value as Record<string, unknown>;
    if (typeof object.$ref === 'string' && object.$ref.startsWith('#/definitions/')) {
      const name = object.$ref.slice('#/definitions/'.length);
      if (!Object.hasOwn(needed, name) && Object.hasOwn(definitions, name)) { needed[name] = definitions[name]; collect(definitions[name]); }
    }
    Object.values(object).forEach(collect);
  }
  collect(schema);
  return { ...(schema as Record<string, unknown>), ...(Object.keys(needed).length ? { definitions: needed } : {}) };
}

export async function explainRule(id: string, rootDir: string, policyPath = 'goodui.policy.json', locale?: LocaleInput): Promise<Record<string, unknown>> {
  const selected = resolveLocale(locale);
  const name = id.replace(/^goodui\//, '');
  const common = getRuleCatalog(selected).find(rule => rule.kind === name);
  if (common) return { id: `goodui/${name}`, ...common };
  const aiSlopCatalogue = getAiSlopRuleCatalog(selected);
  const aiSlop = aiSlopCatalogue.find(rule => rule.name === name);
  if (aiSlop || name === 'ai-slop') return {
    ...(aiSlop ?? { id: 'ai-slop', description: selected === 'ko' ? 'AI Slop 검사 묶음과 개별 설정입니다.' : 'Built-in AI Slop checks and individual settings.', checks: aiSlopCatalogue }),
    preset: 'ai-slop',
    example: { version: 1, rules: [], aiSlop: { enabled: true, ...(aiSlop ? { rules: Object.fromEntries(AI_SLOP_RULE_NAMES.map(check => [check, check === name])) } : {}) } },
    optionsSchema: standaloneOptions((getPolicySchema(selected).properties as Record<string, unknown>)?.aiSlop, selected),
    guidance: selected === 'ko' ? 'aiSlop.enabled로 전체 검사를, aiSlop.rules의 boolean 값으로 개별 항목을 조정합니다. goodui policy enable|disable ai-slop 또는 검사 ID를 사용할 수 있습니다.' : 'Set aiSlop.enabled for the group and aiSlop.rules booleans for individual checks. Use goodui policy enable|disable with ai-slop or a check ID.',
  };
  const native = listRules(selected).rules.find(rule => rule.kind === name);
  if (native) return {
    ...native,
    example: { version: 1, presets: ['tailwind'], rules: [], tailwind: { rules: [name] } },
    optionsSchema: standaloneOptions((getPolicySchema(selected).properties as Record<string, unknown>)?.tailwind, selected),
    guidance: localizeInspectMessage('Configure tokens, class helpers, component sources and exceptions in goodui.policy.json. Run goodui init --yes --preset tailwind to enable the preset.', selected),
  };
  try {
    const snapshot = await readPolicy(rootDir, policyPath, { locale: selected });
    const policyRule = snapshot.policy.rules.find(rule => rule.id === id);
    if (policyRule) return {
      policyId: id, ruleId: `goodui/${policyRule.kind}`, enabled: policyRule.enabled !== false,
      contract: policyRule, exceptions: snapshot.policy.exceptions?.filter(exception => exception.ruleId === id) ?? [],
    };
  } catch (error) {
    if (!(error instanceof PolicyError && error.code === 'POLICY_NOT_FOUND')) throw error;
  }
  throw new PolicyError('UNKNOWN_RULE', localizeInspectMessage(`Unknown rule or policy ID: ${id}. Run goodui rules to list built-in rules.`, selected));
}

export interface DoctorCheck { id: string; status: 'ok' | 'warning' | 'error'; message: string; hint?: string }
export interface DoctorReport { ok: boolean; version: string; rootDir: string; checks: DoctorCheck[] }

/** Diagnose local installation and policy health without modifying project files. */
export async function diagnose(rootDir: string, policyPath = 'goodui.policy.json', locale?: LocaleInput): Promise<DoctorReport> {
  const selected = resolveLocale(locale);
  const root = await resolveProjectPath(rootDir, '.', { locale: selected });
  const checks: DoctorCheck[] = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  const supported = major! >= 24 || major === 22 && minor! >= 13;
  checks.push({ id: 'node', status: supported ? 'ok' : 'error', message: `Node.js ${process.versions.node}`, ...(!supported ? { hint: 'Use Node.js 22.13 or newer in the 22 series, or Node.js 24+.' } : {}) });
  try {
    const path = await resolveProjectPath(root, 'package.json', { locale: selected });
    const manifest = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('package.json must contain an object.');
    if (manifest.scripts !== undefined && (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))) throw new Error('package.json scripts must be an object.');
    const declared = manifest.devDependencies?.['@pixelhize/goodui-cli'] ?? manifest.dependencies?.['@pixelhize/goodui-cli'];
    if (!declared) checks.push({ id: 'installation', status: 'warning', message: 'The main GoodUI package is not declared in this project.', hint: 'Run goodui init --yes to install the main package and configure the project.' });
    else if (validRange(declared) && !satisfies(version, declared)) checks.push({ id: 'installation', status: 'warning', message: `The project declares GoodUI ${declared}; this command runs ${version}.`, hint: 'Run the installed project CLI or update its dependency explicitly.' });
    else checks.push({ id: 'installation', status: 'ok', message: `Main package declared: ${declared}` });
    const require = createRequire(path);
    try {
      const eslint = require.resolve('eslint');
      checks.push({ id: 'editor-engine', status: 'ok', message: `Project ESLint resolves: ${eslint}` });
    } catch {
      checks.push({ id: 'editor-engine', status: 'warning', message: 'Project ESLint is not directly available for editor integration; CLI checks use the bundled engine.', hint: 'Run goodui init --yes --mode lint if you want editor integration.' });
    }
    if (Object.hasOwn(manifest.scripts ?? {}, 'lint:goodui')) checks.push({ id: 'script', status: 'ok', message: 'A lint:goodui script is present. Existing lint/typecheck commands remain separate.' });
  } catch (error) {
    if (error instanceof PolicyError && error.code === 'PATH_NOT_FOUND') checks.push({ id: 'installation', status: 'warning', message: 'No package.json is present; configuration-only or temporary CLI use is possible.', hint: 'Run goodui init --yes for a project installation.' });
    else checks.push({ id: 'installation', status: 'error', message: error instanceof Error ? error.message : String(error) });
  }
  try {
    const snapshot = await readPolicy(root, policyPath, { locale: selected });
    checks.push({ id: 'policy', status: 'ok', message: `Valid policy: ${snapshot.policy.rules.filter(rule => rule.enabled !== false).length} enabled project contracts; ${(snapshot.policy.presets ?? []).join(', ') || 'no style preset'}.` });
    const aiEnabled = snapshot.policy.aiSlop?.enabled ?? snapshot.policy.presets?.includes('ai-slop') ?? false;
    const aiCount = getAiSlopRules(snapshot.policy).length;
    checks.push({ id: 'ai-slop', status: 'ok', message: selected === 'ko' ? `AI Slop 검사 ${aiEnabled ? '켜짐' : '꺼짐'}; 활성 ${aiCount}개.` : `AI Slop group ${aiEnabled ? 'enabled' : 'disabled'}; ${aiCount} active checks.` });
    if (snapshot.policy.$schema) {
      if (/^https?:\/\//.test(snapshot.policy.$schema)) checks.push({ id: 'schema', status: 'warning', message: 'The editor schema uses a URL; its availability was not checked.', hint: 'Run goodui init --no-install to create an offline schema.' });
      else {
        try {
          const schemaPath = await resolveProjectPath(root, resolve(dirname(snapshot.path), snapshot.policy.$schema), { locale: selected });
          const installedSchema = JSON.parse((await readFile(schemaPath, 'utf8')).replace(/^\uFEFF/, ''));
          const serialized = JSON.stringify(installedSchema);
          const current = (['en', 'ko'] as const).some(language => serialized === JSON.stringify(getPolicySchema(language)));
          checks.push({ id: 'schema', status: current ? 'ok' : 'warning', message: current ? 'The offline editor schema matches this GoodUI version.' : 'The editor schema differs from this GoodUI version.', ...(!current ? { hint: 'Run goodui init --no-install to refresh the generated schema.' } : {}) });
        } catch (error) { checks.push({ id: 'schema', status: 'warning', message: `Cannot read the editor schema: ${error instanceof Error ? error.message : String(error)}`, hint: 'Run goodui init --no-install to generate an offline schema.' }); }
      }
    } else checks.push({ id: 'schema', status: 'warning', message: 'The policy has no editor schema reference.', hint: 'Run goodui init --no-install to configure schema completion.' });
    try {
      await createConfig({ rootDir: root, policy: snapshot.policy, locale: selected });
      checks.push({ id: 'engine', status: 'ok', message: 'Configured rule engines and project settings load successfully.' });
    } catch (error) { checks.push({ id: 'engine', status: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } catch (error) { checks.push({ id: 'policy', status: 'error', message: error instanceof Error ? error.message : String(error), hint: 'Run goodui init --yes to initialize a project, or repair the policy shown by policy validate.' }); }
  return { ok: checks.every(check => check.status !== 'error'), version, rootDir: root, checks: checks.map(check => ({ ...check, message: localizeInspectMessage(check.message, selected), ...(check.hint ? { hint: localizeInspectMessage(check.hint, selected) } : {}) })) };
}

const inspectKo: Readonly<Record<string, string>> = {
  'Use project color tokens instead of raw palette colors, hex values or color functions.': '기본 팔레트 색상, hex 값, 색상 함수 대신 프로젝트의 색상 토큰을 사용합니다.',
  'Use approved design tokens instead of arbitrary utility values; allow explicit exceptions when needed.': '임의 유틸리티 값 대신 승인된 디자인 토큰을 사용하고 필요한 예외를 명시합니다.',
  'Keep component presentation in the approved design system instead of inline styles and style blocks.': '인라인 스타일과 스타일 블록 대신 승인된 디자인 시스템으로 컴포넌트의 모양을 정의합니다.',
  'Check candidate utilities against the project Tailwind compiler and allow/deny class policies.': '프로젝트의 Tailwind 컴파일러와 클래스 허용·금지 정책으로 유틸리티를 검증합니다.',
  'Keep recognized design-system components inside their presentation contract.': '확인된 디자인 시스템 컴포넌트의 모양을 해당 컴포넌트의 규약 안에서 유지합니다.',
  'Require class expressions that can be statically checked, while inspecting known conditional branches.': '정적으로 검사할 수 있는 클래스 표현식을 요구하고 확인 가능한 조건 분기도 검사합니다.',
  'Configure tokens, class helpers, component sources and exceptions in goodui.policy.json. Run goodui init --yes --preset tailwind to enable the preset.': 'goodui.policy.json에서 토큰, 클래스 헬퍼, 컴포넌트 경로, 예외를 설정하세요. goodui init --yes --preset tailwind로 preset을 활성화할 수 있습니다.',
  'Use Node.js 22.13 or newer in the 22 series, or Node.js 24+.': 'Node.js 22.13 이상인 22 버전 또는 Node.js 24 이상을 사용하세요.',
  'package.json must contain an object.': 'package.json은 객체여야 합니다.',
  'package.json scripts must be an object.': 'package.json의 scripts는 객체여야 합니다.',
  'The main GoodUI package is not declared in this project.': '이 프로젝트에 GoodUI 메인 패키지가 선언되어 있지 않습니다.',
  'Run goodui init --yes to install the main package and configure the project.': 'goodui init --yes로 메인 패키지를 설치하고 프로젝트를 설정하세요.',
  'Run the installed project CLI or update its dependency explicitly.': '프로젝트에 설치된 CLI를 실행하거나 의존성 버전을 직접 갱신하세요.',
  'Project ESLint is not directly available for editor integration; CLI checks use the bundled engine.': '에디터 연동에 사용할 프로젝트 ESLint가 없습니다. CLI 검사는 내장 엔진을 사용합니다.',
  'Run goodui init --yes --mode lint if you want editor integration.': '에디터 연동이 필요하면 goodui init --yes --mode lint를 실행하세요.',
  'A lint:goodui script is present. Existing lint/typecheck commands remain separate.': 'lint:goodui 스크립트가 있습니다. 기존 lint/typecheck 명령은 별도로 유지됩니다.',
  'No package.json is present; configuration-only or temporary CLI use is possible.': 'package.json이 없습니다. 설정만 생성하거나 임시 CLI로 사용할 수 있습니다.',
  'Run goodui init --yes for a project installation.': '프로젝트에 설치하려면 goodui init --yes를 실행하세요.',
  'The editor schema uses a URL; its availability was not checked.': '에디터 스키마가 URL을 사용합니다. 해당 URL의 접근 가능 여부는 확인하지 않았습니다.',
  'Run goodui init --no-install to create an offline schema.': 'goodui init --no-install로 오프라인 스키마를 생성하세요.',
  'The offline editor schema matches this GoodUI version.': '오프라인 에디터 스키마가 현재 GoodUI 버전과 일치합니다.',
  'The editor schema differs from this GoodUI version.': '에디터 스키마가 현재 GoodUI 버전과 다릅니다.',
  'Run goodui init --no-install to refresh the generated schema.': 'goodui init --no-install로 생성된 스키마를 갱신하세요.',
  'Run goodui init --no-install to generate an offline schema.': 'goodui init --no-install로 오프라인 스키마를 생성하세요.',
  'The policy has no editor schema reference.': '정책에 에디터 스키마 참조가 없습니다.',
  'Run goodui init --no-install to configure schema completion.': 'goodui init --no-install로 스키마 자동 완성을 설정하세요.',
  'Configured rule engines and project settings load successfully.': '규칙 엔진과 프로젝트 설정을 정상적으로 불러왔습니다.',
  'Run goodui init --yes to initialize a project, or repair the policy shown by policy validate.': 'goodui init --yes로 프로젝트를 초기화하거나 policy validate에 표시된 정책 오류를 수정하세요.',
};

function localizeInspectMessage(message: string, locale: Locale): string {
  if (locale === 'en') return message;
  if (Object.hasOwn(inspectKo, message)) return inspectKo[message]!;
  let match: RegExpExecArray | null;
  if ((match = /^Unknown rule or policy ID: ([\s\S]*)\. Run goodui rules to list built-in rules\.$/.exec(message))) return `알 수 없는 규칙 또는 정책 ID입니다: ${match[1]}. goodui rules로 내장 규칙을 확인하세요.`;
  if ((match = /^The project declares GoodUI ([\s\S]*); this command runs ([\s\S]*)\.$/.exec(message))) return `프로젝트는 GoodUI ${match[1]}을 선언하지만 이 명령은 ${match[2]}을 실행합니다.`;
  if ((match = /^Main package declared: ([\s\S]*)$/.exec(message))) return `선언된 메인 패키지: ${match[1]}`;
  if ((match = /^Project ESLint resolves: ([\s\S]*)$/.exec(message))) return `프로젝트 ESLint 경로: ${match[1]}`;
  if ((match = /^Valid policy: (\d+) enabled project contracts; ([\s\S]*)\.$/.exec(message))) return `유효한 정책: 활성 프로젝트 규약 ${match[1]}개; ${match[2] === 'no style preset' ? '스타일 preset 없음' : match[2]}.`;
  if ((match = /^Cannot read the editor schema: ([\s\S]*)$/.exec(message))) return `에디터 스키마를 읽을 수 없습니다: ${localizeMessage(match[1]!, locale)}`;
  return localizeMessage(message, locale);
}
