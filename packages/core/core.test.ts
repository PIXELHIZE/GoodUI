import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Ajv } from 'ajv';
import {
  definePolicy,
  isRuleApplicable,
  matchesFile,
  matchesPattern,
  readPolicy,
  readPolicySync,
  resolveProjectPath,
  resolveProjectPathSync,
  ruleCatalog,
  DEFAULT_TAILWIND_RULES,
  getTailwindRules,
  TAILWIND_RULE_NAMES,
  validatePolicy,
  writePolicy,
  type Policy,
} from "./src/index.js";

const roots: string[] = [];
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "goodui-core-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function validPolicy(): Policy {
  return {
    version: 1,
    rules: [{ id: "network", kind: "restricted-api", globals: ["fetch"], reason: "Use the network layer." }],
  };
}

describe("policy validation", () => {
  it("accepts every catalog example and an editor schema reference", () => {
    const ajv = new Ajv({ strict: false });
    for (const entry of ruleCatalog) {
      expect(validatePolicy({ $schema: "./node_modules/@pixelhize/goodui-core/schema.json", version: 1, rules: [entry.example] })).toMatchObject({ valid: true, errors: [] });
      expect(ajv.compile(entry.optionsSchema)(entry.example), `Standalone schema for ${entry.kind}`).toBe(true);
    }
  });

  it("rejects absent policies, empty or disabled rules, and unknown fields", () => {
    for (const value of [undefined, {}, { version: 1, rules: [] }, { ...validPolicy(), extra: true }]) {
      expect(validatePolicy(value).valid).toBe(false);
    }
    const policy = validPolicy();
    policy.rules[0]!.enabled = false;
    expect(validatePolicy(policy).errors).toContain("Policy must contain at least one enabled rule.");
    expect(validatePolicy({ version: 1, rules: [{ ...validPolicy().rules[0], unexpected: "value" }] }).valid).toBe(false);
  });

  it("rejects duplicate ids, unknown exceptions, blank reasons and empty rule targets", () => {
    const policy = validPolicy();
    policy.rules.push({ ...policy.rules[0]! });
    expect(validatePolicy(policy).errors).toContain("Duplicate rule id: network");
    expect(validatePolicy({ ...validPolicy(), exceptions: [{ ruleId: "missing", files: ["**"], reason: "Legacy code." }] }).valid).toBe(false);
    expect(validatePolicy({ version: 1, rules: [{ ...validPolicy().rules[0], reason: "  " }] }).valid).toBe(false);
    expect(validatePolicy({ version: 1, rules: [{ id: "empty", kind: "restricted-api", reason: "Target required." }] }).valid).toBe(false);
    expect(validatePolicy({ ...validPolicy(), exceptions: [{ ruleId: "network", files: ["**"], reason: "\n" }] }).valid).toBe(false);
    expect(() => definePolicy({ version: 1, rules: [] })).toThrow("fewer");
  });

  it("normalizes Windows paths and applies centralized, reasoned exceptions", () => {
    const policy = validPolicy();
    policy.files = ["src/**"];
    policy.ignores = ["**/*.generated.ts"];
    policy.rules[0]!.files = ["**/*.ts"];
    policy.exceptions = [{ ruleId: "network", files: ["src/legacy/**"], reason: "Pending migration." }];
    const rule = policy.rules[0]!;
    expect(matchesFile("src\\ui\\app.ts", ["src/**/*.ts"])).toBe(true);
    expect(matchesFile(".hidden/file.ts", ["**/*.ts"])).toBe(true);
    expect(matchesPattern('./Button', ['./Button'])).toBe(true);
    expect(matchesPattern('Button', ['./Button'])).toBe(false);
    expect(isRuleApplicable(policy, rule, "src/app.ts")).toBe(true);
    for (const path of ["src/app.js", "test/app.ts", "src/app.generated.ts", "src/legacy/app.ts"]) {
      expect(isRuleApplicable(policy, rule, path)).toBe(false);
    }
  });

  it('accepts explicitly enabled Tailwind-only policies and preserves opt-in defaults', () => {
    const policy: Policy = { version: 1, rules: [], presets: ['tailwind'] };
    expect(validatePolicy(policy)).toMatchObject({ valid: true, errors: [] });
    expect(getTailwindRules(policy)).toEqual(DEFAULT_TAILWIND_RULES);
    expect(getTailwindRules(policy)).not.toContain('no-restyle');
    expect(getTailwindRules(policy)).not.toContain('require-static-classes');
    expect(getTailwindRules(validPolicy())).toEqual([]);
    expect(validatePolicy({ ...policy, tailwind: { rules: ['no-restyle'], themeFiles: ['src/theme.css'], componentImports: ['@acme/ui/**'], allowClasses: ['app-shell'], denyClasses: ['legacy-*'], allowArbitrary: ['w-[--sidebar-width]'], classFunctions: ['cn'], variantFunctions: ['cva'], ignoreImports: ['@vendor/**'], note: 'Follow DESIGN.md.' } }).valid).toBe(true);
  });

  it('rejects empty/duplicate/unknown preset rules, settings typos, and inactive Tailwind configuration', () => {
    const policy = { version: 1, rules: [], presets: ['tailwind'] };
    for (const value of [
      { ...policy, presets: [] }, { ...policy, presets: ['tailwind', 'tailwind'] }, { ...policy, presets: ['unknown'] },
      { ...policy, tailwind: { rules: [] } }, { ...policy, tailwind: { rules: ['no-restyle', 'no-restyle'] } },
      { ...policy, tailwind: { rules: ['no-typo'] } }, { ...policy, tailwind: { unknown: true } },
      { ...policy, tailwind: { settings: { componentImport: '^@acme/ui' } } },
      { ...validPolicy(), tailwind: {} },
    ]) expect(validatePolicy(value).valid).toBe(false);
  });

  it('accepts reasoned native rule exceptions only with the preset enabled', () => {
    const policy: Policy = { version: 1, rules: [], presets: ['tailwind'], exceptions: TAILWIND_RULE_NAMES.map(name => ({ ruleId: `goodui/${name}`, files: ['legacy/**'], reason: 'Pending token migration.' })) };
    expect(validatePolicy(policy).valid).toBe(true);
    expect(validatePolicy({ ...validPolicy(), exceptions: policy.exceptions }).valid).toBe(false);
    expect(validatePolicy({ ...policy, exceptions: [{ ruleId: 'goodui/no-typo', files: ['**'], reason: 'Wrong rule.' }] }).valid).toBe(false);
    expect(validatePolicy({ ...policy, exceptions: [{ ruleId: 'shadcn/no-inline-styles', files: ['**'], reason: 'Old external engine.' }] }).valid).toBe(false);
    expect(validatePolicy({ ...policy, exceptions: [{ ruleId: 'goodui/no-inline-styles', files: ['**'], reason: ' ' }] }).valid).toBe(false);
  });

  it('validates syntax selectors before a lint run', () => {
    const rule = { id: 'syntax', kind: 'restricted-syntax', reason: 'Use explicit types.', selectors: ['TSAnyKeyword', 'CallExpression[callee.name="eval"]'] };
    expect(validatePolicy({ version: 1, rules: [rule] }).valid).toBe(true);
    expect(validatePolicy({ version: 1, rules: [{ ...rule, selectors: ['CallExpression['] }] }).errors).toContain('Rule syntax: invalid AST selector "CallExpression[".');
  });

  it('rejects empty, contradictory, or uncheckable new contracts', () => {
    const common = { id: 'contract', reason: 'Enforce the project contract.' };
    const invalid = [
      { ...common, kind: 'restricted-syntax', selectors: [] },
      { ...common, kind: 'file-conventions' },
      { ...common, kind: 'file-conventions', maxLines: 0 },
      { ...common, kind: 'file-conventions', nameCase: 'unknown' },
      { ...common, kind: 'export-contracts', forbidDefault: false, forbidStar: false },
      { ...common, kind: 'export-contracts', requireNamed: [] },
      { ...common, kind: 'function-limits' },
      { ...common, kind: 'function-limits', maxParams: 1.5 },
      { ...common, kind: 'component-contracts', requiredProps: ['type'] },
      { ...common, kind: 'component-contracts', tags: ['button'] },
      { ...common, kind: 'component-contracts', tags: [], requiredProps: ['type'] },
      { ...common, kind: 'component-contracts', components: [{ source: '@app/ui', names: [] }], requiredProps: ['type'] },
      { ...common, kind: 'component-contracts', tags: ['button'], allowDynamicProps: true },
      { ...common, kind: 'component-contracts', tags: ['button'], propValues: {} },
      { ...common, kind: 'component-contracts', tags: ['button'], propValues: { type: [] } },
      { ...common, kind: 'component-contracts', tags: ['button'], propValues: { type: [{}] } },
      { ...common, kind: 'component-contracts', tags: ['button'], requiredProps: ['type'], forbiddenProps: ['type'] },
    ];
    for (const rule of invalid) expect(validatePolicy({ version: 1, rules: [rule] }).valid, JSON.stringify(rule)).toBe(false);
  });
});

describe("policy persistence", () => {
  it("creates, reads and updates using raw-byte SHA256 revisions", async () => {
    const root = await temporaryRoot();
    const created = await writePolicy(root, validPolicy(), { expectedRevision: null });
    const raw = await readFile(created.path);
    expect(created.revision).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(await readPolicy(root)).toEqual(created);
    expect(readPolicySync(root)).toEqual(created);
    const policy = validPolicy();
    policy.rules[0]!.reason = "Use the approved client.";
    const updated = await writePolicy(root, policy, { expectedRevision: created.revision });
    expect(updated.revision).not.toBe(created.revision);
    expect((await readPolicy(root)).policy).toEqual(policy);
    expect(await readdir(root)).toEqual(["goodui.policy.json"]);
  });

  it("preserves the file on invalid writes, stale revisions and create-only conflicts", async () => {
    const root = await temporaryRoot();
    const created = await writePolicy(root, validPolicy(), { expectedRevision: null });
    const before = await readFile(created.path, "utf8");
    await expect(writePolicy(root, { version: 1, rules: [] }, { expectedRevision: created.revision })).rejects.toMatchObject({ code: "INVALID_POLICY" });
    await expect(writePolicy(root, validPolicy(), { expectedRevision: "stale" })).rejects.toMatchObject({ code: "POLICY_CONFLICT" });
    await expect(writePolicy(root, validPolicy(), { expectedRevision: null })).rejects.toMatchObject({ code: "POLICY_CONFLICT" });
    expect(await readFile(created.path, "utf8")).toBe(before);
    expect(await readdir(root)).toEqual(["goodui.policy.json"]);
  });

  it("detects manual formatting changes and retains recovery revisions for invalid JSON", async () => {
    const root = await temporaryRoot();
    const created = await writePolicy(root, validPolicy(), { expectedRevision: null });
    await writeFile(created.path, JSON.stringify(created.policy));
    await expect(writePolicy(root, validPolicy(), { expectedRevision: created.revision })).rejects.toMatchObject({ code: "POLICY_CONFLICT" });
    await writeFile(created.path, "{invalid}");
    await expect(readPolicy(root)).rejects.toMatchObject({ code: "INVALID_POLICY", details: { revision: expect.any(String) } });
    await expect(readPolicy(await temporaryRoot())).rejects.toMatchObject({ code: "POLICY_NOT_FOUND" });
  });

  it("serializes concurrent writers so exactly one revision wins", async () => {
    const root = await temporaryRoot();
    const created = await writePolicy(root, validPolicy(), { expectedRevision: null });
    const first = validPolicy();
    const second = validPolicy();
    first.rules[0]!.reason = "First update.";
    second.rules[0]!.reason = "Second update.";
    const outcomes = await Promise.allSettled([
      writePolicy(root, first, { expectedRevision: created.revision }),
      writePolicy(root, second, { expectedRevision: created.revision }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "POLICY_CONFLICT" } });
    expect(await readdir(root)).toEqual(["goodui.policy.json"]);
  });
});

describe("project path confinement", () => {
  it("rejects lexical escapes and allows missing paths only when requested", async () => {
    const root = await temporaryRoot();
    expect(() => resolveProjectPathSync(root, "../escaped.json", { allowMissing: true })).toThrow("outside");
    await expect(resolveProjectPath(root, "missing.json")).rejects.toMatchObject({ code: "PATH_NOT_FOUND" });
    expect(resolveProjectPathSync(root, "nested/missing.json", { allowMissing: true })).toBe(join(root, "nested", "missing.json"));
    await expect(writePolicy(root, validPolicy(), { policyPath: "../escaped.json", expectedRevision: null })).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
  });

  it("rejects existing and missing paths below a symlink pointing outside the root", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await writeFile(join(outside, "existing.json"), "{}");
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    for (const candidate of ["escape/existing.json", "escape/missing.json", "escape/nested/missing.json"]) {
      expect(() => resolveProjectPathSync(root, candidate, { allowMissing: true })).toThrow("outside");
    }
    await expect(writePolicy(root, validPolicy(), { policyPath: "escape/policy.json", expectedRevision: null })).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
    expect(await readdir(outside)).toEqual(["existing.json"]);
    await symlink(join(outside, "not-created"), join(root, "dangling"), process.platform === "win32" ? "junction" : "dir");
    expect(() => resolveProjectPathSync(root, "dangling/policy.json", { allowMissing: true })).toThrow();
  });
});
