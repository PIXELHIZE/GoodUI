import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  PolicyError,
  readPolicy,
  resolveProjectPath,
  resolveProjectPathSync,
  getRuleCatalog,
  getAiSlopRuleCatalog,
  AI_SLOP_RULE_NAMES,
  getPresetCatalog,
  getPolicySchema,
  localizeMessage,
  resolveLocale,
  validatePolicy,
  writePolicy,
  type Locale,
  type LocaleInput,
} from '@pixelhize/goodui-core';
import { lintProject } from '@pixelhize/eslint-plugin-goodui';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

export interface GooduiServerOptions {
  /** The only project this server can read or change. */
  rootDir: string;
  /** Default project policy for tools that do not supply their own policyPath. */
  policyPath?: string;
  /** Language for tool descriptions and built-in diagnostics; policy text stays intact. */
  locale?: LocaleInput;
}

const pathOption = z.string().min(1).optional();
const snapshotSchema = z.object({
  policy: z.unknown(),
  revision: z.string(),
  path: z.string(),
});
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

function standaloneOptions(schema: Record<string, unknown>, property: string): Record<string, unknown> {
  const body = (schema.properties as Record<string, Record<string, unknown>>)[property]!;
  const definitions = schema.definitions as Record<string, unknown>;
  const selected = new Set<string>();
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const reference = (value as { $ref?: unknown }).$ref;
    if (typeof reference === 'string' && reference.startsWith('#/definitions/')) {
      const name = reference.slice('#/definitions/'.length);
      if (!selected.has(name) && Object.hasOwn(definitions, name)) { selected.add(name); visit(definitions[name]); }
    }
    Object.values(value).forEach(visit);
  }
  visit(body);
  return { ...body, ...(selected.size ? { definitions: Object.fromEntries([...selected].map(name => [name, definitions[name]])) } : {}) };
}

function result(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function toolError(error: unknown, locale: Locale): CallToolResult {
  const original = error instanceof Error ? error.message : String(error);
  const message = localizeMessage(original, locale);
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : 'GOODUI_ERROR';
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: {
      error: { code, message, ...(error instanceof PolicyError && error.details ? { details: error.details } : {}) },
    },
  };
}

async function safely(action: () => Promise<Record<string, unknown>>, locale: Locale): Promise<CallToolResult> {
  try {
    return result(await action());
  } catch (error) {
    return toolError(error, locale);
  }
}

/** Creates a server without opening transports, so hosts and tests can own its lifecycle. */
export function createGooduiServer(options: GooduiServerOptions): McpServer {
  const locale = resolveLocale(options.locale);
  const text = (en: string, ko: string) => locale === 'ko' ? ko : en;
  const root = resolve(options.rootDir);
  if (options.policyPath === '') throw new PolicyError('INVALID_POLICY_PATH', text('Policy path must not be empty.', '정책 파일 경로는 비어 있을 수 없습니다.'));
  const defaultPolicyPath = options.policyPath === undefined
    ? undefined
    : resolveProjectPathSync(root, options.policyPath, { allowMissing: true, locale });
  const server = new McpServer({ name: 'goodui', version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version });

  server.registerTool('get_policy', {
    description: text('Read the project policy and its revision. Use the revision for a later set_policy call.', '프로젝트 정책과 리비전을 읽습니다. 이후 set_policy를 호출할 때 이 리비전을 사용하세요.'),
    inputSchema: z.object({ policyPath: pathOption }).strict(),
    outputSchema: snapshotSchema,
    annotations: readOnly,
  }, async ({ policyPath }) => safely(async () => ({ ...await readPolicy(root, policyPath ?? defaultPolicyPath, { locale }) }), locale));

  server.registerTool('get_rule_catalog', {
    description: text('List supported policy rules and native presets. Use kind to request one rule or ai-slop for the AI design group, and includeSchema:false to omit the full policy schema. Translate instructions into deterministic contracts and report requirements that cannot be represented.', '지원하는 정책 규칙과 자체 프리셋을 조회합니다. kind로 개별 규칙을 선택하거나 ai-slop으로 AI 디자인 검사 그룹을 조회하고, includeSchema:false로 전체 정책 스키마를 생략할 수 있습니다. 지침을 결정적인 계약으로 옮기되 표현할 수 없는 요구 사항은 명시하세요.'),
    inputSchema: z.object({ kind: z.string().min(1).optional(), includeSchema: z.boolean().optional() }).strict(),
    outputSchema: z.object({ rules: z.unknown(), presets: z.unknown(), schema: z.unknown().optional() }),
    annotations: readOnly,
  }, async ({ kind, includeSchema }) => safely(async () => {
    const schema = getPolicySchema(locale);
    const aiOptions = standaloneOptions(schema, 'aiSlop');
    const aiRules = getAiSlopRuleCatalog(locale).map(rule => ({
      ...rule, kind: rule.name, optionsSchema: aiOptions,
      example: {
        version: 1, rules: [], aiSlop: {
          enabled: true,
          rules: Object.fromEntries(AI_SLOP_RULE_NAMES.map(name => [name, name === rule.name])),
        },
      },
    }));
    const ruleCatalog = [...getRuleCatalog(locale), ...aiRules];
    const presetCatalog = getPresetCatalog(locale);
    const name = kind?.replace(/^goodui\//, '');
    const selectedRules = name === 'ai-slop' ? aiRules : name ? ruleCatalog.filter(rule => rule.kind === name) : ruleCatalog;
    const selectedPresets = name ? presetCatalog.filter(preset => preset.name === name || (preset.availableRules as readonly string[]).includes(name)) : presetCatalog;
    if (name && selectedRules.length === 0 && selectedPresets.length === 0) throw new PolicyError('UNKNOWN_RULE', text(`Unknown rule or preset: ${kind}`, `알 수 없는 규칙 또는 프리셋입니다: ${kind}`));
    return { rules: selectedRules, presets: selectedPresets, ...(includeSchema === false ? {} : { schema }) };
  }, locale));

  server.registerTool('validate_policy', {
    description: text('Validate a candidate policy without saving it or changing the project. A valid policy can be passed to lint for a preview.', '정책을 저장하거나 프로젝트를 변경하지 않고 후보 정책을 검증합니다. 유효한 정책은 lint에 전달하여 미리 검사할 수 있습니다.'),
    inputSchema: z.object({ policy: z.unknown() }).strict(),
    outputSchema: z.object({ valid: z.boolean(), errors: z.array(z.string()), policy: z.unknown().optional() }),
    annotations: readOnly,
  }, async ({ policy }) => result({ ...validatePolicy(policy, { locale }) }));

  server.registerTool('set_policy', {
    description: text('Validate and save the complete policy within this project. Supply the revision from get_policy to update an existing file; use null only to create a missing file. A stale revision fails without overwriting changes.', '프로젝트 안에서 전체 정책을 검증하고 저장합니다. 기존 파일을 수정할 때는 get_policy의 리비전을 전달하고, 없는 파일을 만들 때만 null을 사용하세요. 오래된 리비전으로 요청하면 변경 내용을 덮어쓰지 않고 실패합니다.'),
    inputSchema: z.object({
      policy: z.unknown(),
      policyPath: pathOption,
      expectedRevision: z.string().min(1).nullable(),
    }).strict(),
    outputSchema: snapshotSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, async ({ policy, policyPath, expectedRevision }) => safely(async () => {
    const validation = validatePolicy(policy, { locale });
    if (!validation.valid || !validation.policy) {
      throw new PolicyError('INVALID_POLICY', text(`Invalid policy: ${validation.errors.join('; ')}`, `올바르지 않은 정책입니다: ${validation.errors.join('; ')}`), { errors: validation.errors });
    }
    return { ...await writePolicy(root, validation.policy, { policyPath: policyPath ?? defaultPolicyPath, expectedRevision, locale }) };
  }, locale));

  server.registerTool('lint', {
    description: text('Check project source files without modifying them. Nonzero errorCount means policy violations, returned as a successful tool result. Optional policy previews unsaved rules. files accepts explicit project file or directory paths, not globs; omit it to scan the project.', '프로젝트 소스 파일을 변경하지 않고 검사합니다. errorCount가 0보다 크면 정책 위반이며 도구 결과는 정상적으로 반환됩니다. policy로 저장하지 않은 규칙을 미리 검사할 수 있습니다. files에는 glob이 아닌 프로젝트 파일·디렉터리 경로를 지정하고, 전체 프로젝트를 검사하려면 생략하세요.'),
    inputSchema: z.object({
      policyPath: pathOption,
      policy: z.unknown().optional(),
      files: z.array(z.string().min(1)).min(1).optional(),
    }).strict(),
    outputSchema: z.object({
      diagnostics: z.array(z.object({
        filePath: z.string(), line: z.number(), column: z.number(),
        endLine: z.number().optional(), endColumn: z.number().optional(),
        ruleId: z.string().nullable(), policyId: z.string().optional(),
        severity: z.enum(['error', 'warning']), message: z.string(),
        reason: z.string().optional(), suggestion: z.string().optional(),
      })),
      errorCount: z.number(), warningCount: z.number(), filesChecked: z.number(),
    }),
    annotations: readOnly,
  }, async ({ policy, policyPath, files }) => safely(async () => {
    if (policy !== undefined && policyPath !== undefined) {
      throw new Error(text('Provide policy or policyPath, not both.', 'policy와 policyPath 중 하나만 지정하세요.'));
    }
    const validation = policy === undefined ? undefined : validatePolicy(policy, { locale });
    if (validation && (!validation.valid || !validation.policy)) {
      throw new PolicyError('INVALID_POLICY', text(`Invalid policy: ${validation.errors.join('; ')}`, `올바르지 않은 정책입니다: ${validation.errors.join('; ')}`), { errors: validation.errors });
    }
    // Resolve existing paths instead of treating glob metacharacters as invalid:
    // framework routes such as app/[id]/page.tsx are ordinary file paths.
    const paths = files && await Promise.all(files.map(file => resolveProjectPath(root, file, { locale })));
    return {
      ...await lintProject({ rootDir: root, policyPath: policy === undefined ? policyPath ?? defaultPolicyPath : undefined, policy: validation?.policy, files: paths, locale }),
    };
  }, locale));

  return server;
}
