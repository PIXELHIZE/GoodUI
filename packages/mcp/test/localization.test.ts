import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { AI_SLOP_RULE_NAMES, getAiSlopRules, validatePolicy, type Policy } from '@pixelhize/goodui-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createGooduiServer } from '../src/index.js';

const roots: string[] = [];
const clients: Client[] = [];
const servers: ReturnType<typeof createGooduiServer>[] = [];
const policy = {
  version: 1,
  rules: [{
    id: 'user-network-contract', kind: 'restricted-imports', modules: ['legacy-client'],
    // These intentionally match built-in prose: project-authored text must still be preserved.
    reason: 'Do not execute strings as code.',
    suggestion: 'Import the approved network client instead.',
  }],
  exceptions: [{ ruleId: 'user-network-contract', files: ['legacy/**'], reason: 'Keep this English exception unchanged.' }],
};

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'goodui-mcp-locale-'));
  roots.push(root);
  return root;
}

async function memoryClient(rootDir: string, locale: 'en' | 'ko') {
  const server = createGooduiServer({ rootDir, locale });
  servers.push(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: `goodui-locale-${locale}`, version: '1.0.0' });
  clients.push(client);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function mainCliClient(root: string, locale: 'en' | 'ko') {
  const client = new Client({ name: `goodui-main-locale-${locale}`, version: '1.0.0' });
  clients.push(client);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url)), 'mcp', '--root', root, '--locale', locale],
    cwd: root,
  }));
  return client;
}

async function data<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent as T;
}

function withoutProse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutProse);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['description', 'title', 'reason', 'suggestion'].includes(key)).map(([key, child]) => [key, withoutProse(child)]));
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()));
  await Promise.all(servers.splice(0).map(server => server.close()));
  // Every path comes directly from mkdtemp under the dedicated test prefix.
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), 'goodui-mcp-locale-'))) throw new Error('Unexpected test cleanup path.');
    await rm(root, { recursive: true, force: true });
  }
});

describe('MCP request-scoped localization', () => {
  it('forwards explicit locale through the built main CLI stdio transport without changing tool schemas', async () => {
    const root = await project();
    const english = await mainCliClient(root, 'en');
    const korean = await mainCliClient(root, 'ko');
    const en = await english.listTools(), ko = await korean.listTools();
    expect(en.tools).toHaveLength(5);
    expect(ko.tools.map(tool => tool.name)).toEqual(en.tools.map(tool => tool.name));
    for (let index = 0; index < en.tools.length; index++) {
      expect(en.tools[index]!.description).not.toMatch(/[가-힣]/);
      expect(ko.tools[index]!.description).toMatch(/[가-힣]/);
      expect(ko.tools[index]!.inputSchema).toEqual(en.tools[index]!.inputSchema);
      expect(ko.tools[index]!.outputSchema).toEqual(en.tools[index]!.outputSchema);
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('localizes factory catalogs and validation errors while preserving all machine options', async () => {
    const root = await project();
    const english = await memoryClient(root, 'en');
    const korean = await memoryClient(root, 'ko');
    type Catalog = { rules: { kind: string; description: string; reason?: string; example: { id?: string; reason?: string } }[]; presets: { description: string }[]; schema: Record<string, unknown> };
    const en = await data<Catalog>(english, 'get_rule_catalog');
    const ko = await data<Catalog>(korean, 'get_rule_catalog');
    expect(ko.rules).toHaveLength(22);
    expect(ko.rules.every(rule => /[가-힣]/.test(rule.description) && /[가-힣]/.test(rule.reason ?? rule.example.reason ?? ''))).toBe(true);
    expect(ko.presets.every(preset => /[가-힣]/.test(preset.description))).toBe(true);
    expect(ko.schema.title).toBe('GoodUI 정책');
    expect(withoutProse(ko)).toEqual(withoutProse(en));
    const compact = await data<{ rules: { kind: string }[] }>(korean, 'get_rule_catalog', { kind: 'goodui/component-contracts', includeSchema: false });
    expect(compact.rules).toHaveLength(1);
    expect(compact.rules[0]!.kind).toBe('component-contracts');
    expect(compact).not.toHaveProperty('schema');

    const enInvalid = await data<{ valid: boolean; errors: string[] }>(english, 'validate_policy', { policy: { version: 99 } });
    const koInvalid = await data<{ valid: boolean; errors: string[] }>(korean, 'validate_policy', { policy: { version: 99 } });
    expect(enInvalid.valid).toBe(false);
    expect(koInvalid.valid).toBe(false);
    expect(koInvalid.errors).toHaveLength(enInvalid.errors.length);
    expect(enInvalid.errors.every(message => message.includes('must'))).toBe(true);
    expect(koInvalid.errors.every(message => /[가-힣]/.test(message))).toBe(true);
    const valid = await data<{ valid: boolean; policy: unknown }>(korean, 'validate_policy', { policy });
    expect(valid).toMatchObject({ valid: true, policy });
    // Selecting Korean on another factory must not change the existing English server.
    expect((await data<Catalog>(english, 'get_rule_catalog')).rules[0]!.description).toBe(en.rules[0]!.description);
    expect(await readdir(root)).toEqual([]);
  });

  it('keeps policy bytes, revisions and user prose stable across save/read languages and stale writes', async () => {
    const root = await project();
    const english = await memoryClient(root, 'en');
    const korean = await memoryClient(root, 'ko');
    type Snapshot = { policy: unknown; revision: string; path: string };
    const created = await data<Snapshot>(english, 'set_policy', { policy, expectedRevision: null });
    const before = await readFile(join(root, 'goodui.policy.json'));
    expect(created.policy).toEqual(policy);
    expect(created.revision).toBe(createHash('sha256').update(before).digest('hex'));
    expect(await data<Snapshot>(korean, 'get_policy')).toEqual(created);
    const savedAgain = await data<Snapshot>(korean, 'set_policy', { policy, expectedRevision: created.revision });
    expect(savedAgain).toEqual(created);
    expect(await readFile(join(root, 'goodui.policy.json'))).toEqual(before);
    expect(await data<Snapshot>(english, 'get_policy')).toEqual(savedAgain);
    const stale = await korean.callTool({ name: 'set_policy', arguments: { policy, expectedRevision: 'stale-revision' } });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ error: { code: 'POLICY_CONFLICT', message: expect.stringMatching(/[가-힣]/), details: { actualRevision: created.revision } } });
    expect(await readFile(join(root, 'goodui.policy.json'))).toEqual(before);
  });

  it('discovers the AI group and individual rules in both languages with valid examples and closed option schemas', async () => {
    const root = await project();
    // Reuse the core package's declared schema validator without adding a new
    // dependency to the MCP runtime just for this independent schema check.
    const Ajv = createRequire(import.meta.resolve('@pixelhize/goodui-core'))('ajv').Ajv;
    type Entry = { id: string; name: string; kind: string; description: string; reason: string; suggestion: string; category: string; defaultEnabled: boolean; example: Policy; optionsSchema: Record<string, unknown> };
    type Catalog = { rules: Entry[]; presets: { name: string }[]; schema?: unknown };
    for (const locale of ['en', 'ko'] as const) {
      const client = await memoryClient(root, locale);
      const catalog = await data<Catalog>(client, 'get_rule_catalog', { kind: 'ai-slop', includeSchema: false });
      expect(catalog).not.toHaveProperty('schema');
      expect(catalog.rules.map(rule => rule.kind)).toEqual(AI_SLOP_RULE_NAMES);
      expect(catalog.rules.filter(rule => rule.defaultEnabled)).toHaveLength(10);
      expect(catalog.presets.map(preset => preset.name)).toEqual(['ai-slop']);
      for (const entry of catalog.rules) {
        expect(entry.id).toBe(`goodui/${entry.name}`);
        expect(entry.kind).toBe(entry.name);
        expect(entry.category).toEqual(expect.any(String));
        for (const prose of [entry.description, entry.reason, entry.suggestion]) {
          if (locale === 'ko') expect(prose).toMatch(/[가-힣]/);
          else expect(prose).not.toMatch(/[가-힣]/);
        }
        expect(validatePolicy(entry.example).valid).toBe(true);
        expect(getAiSlopRules(entry.example)).toEqual([entry.name]);
        expect(Object.keys(entry.example.aiSlop!.rules!)).toEqual(AI_SLOP_RULE_NAMES);
        const check = new Ajv({ strict: false }).compile(entry.optionsSchema);
        expect(check(entry.example.aiSlop)).toBe(true);
        expect(check({ enabled: true, rules: { 'no-unknown-ai-pattern': true } })).toBe(false);
        expect(check({ enabled: true, rules: { 'no-gradient-text': 'true' } })).toBe(false);
        expect(Object.keys(entry.optionsSchema.definitions as object).sort()).toEqual(['nonblank', 'patterns']);
      }
      const one = await data<Catalog>(client, 'get_rule_catalog', { kind: 'goodui/no-gradient-text', includeSchema: false });
      expect(one.rules).toHaveLength(1);
      expect(one.rules[0]).toEqual(catalog.rules[0]);
      const validation = await data<{ valid: boolean; errors: string[] }>(client, 'validate_policy', { policy: one.rules[0]!.example });
      expect(validation).toMatchObject({ valid: true, errors: [] });
      const ordinary = await data<Catalog>(client, 'get_rule_catalog', { kind: 'restricted-imports', includeSchema: false });
      expect(ordinary.rules).toHaveLength(1);
      expect(ordinary.rules[0]!.kind).toBe('restricted-imports');
      expect(ordinary.presets).toEqual([]);
      const tailwind = await data<Catalog>(client, 'get_rule_catalog', { kind: 'goodui/no-raw-colors', includeSchema: false });
      expect(tailwind.rules).toEqual([]);
      expect(tailwind.presets.map(preset => preset.name)).toEqual(['tailwind']);
      const unknown = await client.callTool({ name: 'get_rule_catalog', arguments: { kind: 'goodui/no-unknown-ai-pattern' } });
      expect(unknown.isError).toBe(true);
      expect(unknown.structuredContent).toMatchObject({ error: { code: 'UNKNOWN_RULE' } });
      const message = (unknown.structuredContent as { error: { message: string } }).error.message;
      if (locale === 'ko') expect(message).toMatch(/[가-힣]/);
      else expect(message).toMatch(/^Unknown rule or preset:/);
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('changes lint prose while keeping rule IDs, positions, severities, counts and user reasons identical', async () => {
    const root = await project();
    const english = await memoryClient(root, 'en');
    const korean = await memoryClient(root, 'ko');
    await data(english, 'set_policy', { policy, expectedRevision: null });
    const source = "import client from 'legacy-client';\nexport default client;\n";
    await writeFile(join(root, 'app.ts'), source);
    type Report = { diagnostics: { message: string; ruleId: string | null; policyId?: string; reason?: string; suggestion?: string; line: number; column: number }[]; errorCount: number; warningCount: number; filesChecked: number };
    const en = await data<Report>(english, 'lint', { files: ['app.ts'] });
    const ko = await data<Report>(korean, 'lint', { files: ['app.ts'] });
    expect(ko).toMatchObject({ errorCount: 1, warningCount: 0, filesChecked: 1 });
    expect(ko.diagnostics[0]).toMatchObject({ ruleId: 'goodui/restricted-imports', policyId: 'user-network-contract', line: 1, reason: policy.rules[0]!.reason, suggestion: policy.rules[0]!.suggestion });
    expect(ko.diagnostics[0]!.message).toMatch(/[가-힣]/);
    expect(en.diagnostics[0]!.message).not.toMatch(/[가-힣]/);
    expect(ko.diagnostics[0]!.message).not.toBe(en.diagnostics[0]!.message);
    expect({ ...ko, diagnostics: ko.diagnostics.map(({ message: _message, ...rest }) => rest) }).toEqual({ ...en, diagnostics: en.diagnostics.map(({ message: _message, ...rest }) => rest) });
    expect(await readFile(join(root, 'app.ts'), 'utf8')).toBe(source);
  });
});
