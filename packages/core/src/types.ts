import type { Locale } from './locale.js';

export interface CommonPolicyRule {
  id: string;
  enabled?: boolean;
  files?: string[];
  reason: string;
  suggestion?: string;
}

export interface RestrictedImportsRule extends CommonPolicyRule {
  kind: "restricted-imports";
  modules: string[];
}

export interface ImportedNames {
  source: string;
  names: string[];
}

export interface RestrictedApiRule extends CommonPolicyRule {
  kind: "restricted-api";
  globals?: string[];
  imports?: ImportedNames[];
}

export interface ImportBoundariesRule extends CommonPolicyRule {
  kind: "import-boundaries";
  from: string[];
  allow?: string[];
  disallow?: string[];
}

export interface RestrictedUiRule extends CommonPolicyRule {
  kind: "restricted-ui";
  tags?: string[];
  components?: ImportedNames[];
  attributes?: string[];
  features?: ("inline-style" | "raw-html")[];
}

export interface RestrictedSyntaxRule extends CommonPolicyRule {
  kind: 'restricted-syntax';
  selectors: string[];
}

export interface FileConventionsRule extends CommonPolicyRule {
  kind: 'file-conventions';
  nameCase?: 'kebab' | 'camel' | 'pascal' | 'snake';
  suffixes?: string[];
  maxLines?: number;
  maxBytes?: number;
}

export interface ExportContractsRule extends CommonPolicyRule {
  kind: 'export-contracts';
  requireNamed?: string[];
  forbidDefault?: boolean;
  forbidStar?: boolean;
}

export interface FunctionLimitsRule extends CommonPolicyRule {
  kind: 'function-limits';
  maxParams?: number;
  maxLines?: number;
  maxStatements?: number;
  maxDepth?: number;
  maxComplexity?: number;
}

export type StaticPropValue = string | number | boolean | null;

export interface ComponentContractsRule extends CommonPolicyRule {
  kind: 'component-contracts';
  tags?: string[];
  components?: ImportedNames[];
  requiredProps?: string[];
  forbiddenProps?: string[];
  nonEmptyProps?: string[];
  propValues?: Record<string, StaticPropValue[]>;
  /** Dynamic checked values and unknown spreads fail unless explicitly allowed. */
  allowDynamicProps?: boolean;
}

export type PolicyRule =
  | RestrictedImportsRule
  | RestrictedApiRule
  | ImportBoundariesRule
  | RestrictedUiRule
  | RestrictedSyntaxRule
  | FileConventionsRule
  | ExportContractsRule
  | FunctionLimitsRule
  | ComponentContractsRule;

export interface PolicyException {
  ruleId: string;
  files: string[];
  reason: string;
}

export const TAILWIND_RULE_NAMES = [
  'no-raw-colors', 'no-arbitrary-values', 'no-inline-styles',
  'no-unknown-classes', 'no-restyle', 'require-static-classes',
] as const;

export type TailwindRuleName = (typeof TAILWIND_RULE_NAMES)[number];

export const DEFAULT_TAILWIND_RULES: readonly TailwindRuleName[] = [
  'no-raw-colors', 'no-arbitrary-values', 'no-inline-styles', 'no-unknown-classes',
];

export interface TailwindPolicy {
  rules?: TailwindRuleName[];
  themeFiles?: string[];
  allowClasses?: string[];
  denyClasses?: string[];
  allowArbitrary?: string[];
  classFunctions?: string[];
  variantFunctions?: string[];
  componentImports?: string[];
  ignoreImports?: string[];
  note?: string;
}

export const AI_SLOP_RULE_NAMES = [
  'no-gradient-text', 'no-purple-gradients', 'no-glassmorphism', 'no-decorative-blobs',
  'no-hover-lift', 'no-bounce-animation', 'no-emoji-icons', 'no-generic-copy',
  'no-placeholder-copy', 'no-placeholder-links', 'no-nested-cards', 'no-oversized-radius',
  'no-generic-fonts',
] as const;

export type AiSlopRuleName = (typeof AI_SLOP_RULE_NAMES)[number];

export const DEFAULT_AI_SLOP_RULES: readonly AiSlopRuleName[] = AI_SLOP_RULE_NAMES.slice(0, 10);

export interface AiSlopPolicy {
  enabled?: boolean;
  rules?: Partial<Record<AiSlopRuleName, boolean>>;
  files?: string[];
  ignores?: string[];
  allowClasses?: string[];
  allowPhrases?: string[];
  allowFonts?: string[];
  note?: string;
}

export interface Policy {
  $schema?: string;
  version: 1;
  files?: string[];
  ignores?: string[];
  presets?: ('tailwind' | 'ai-slop')[];
  tailwind?: TailwindPolicy;
  aiSlop?: AiSlopPolicy;
  rules: PolicyRule[];
  exceptions?: PolicyException[];
}

export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  policy?: Policy;
}

export interface PolicySnapshot {
  policy: Policy;
  revision: string;
  path: string;
}

export interface PolicyWriteOptions {
  policyPath?: string;
  expectedRevision: string | null;
  locale?: Locale;
}

export interface ResolveProjectPathOptions {
  allowMissing?: boolean;
  locale?: Locale;
}
