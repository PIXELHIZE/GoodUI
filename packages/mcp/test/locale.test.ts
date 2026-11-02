import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const roots: string[] = [];
const clients: Client[] = [];
const executable = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
afterAll(async () => {
  await Promise.all(clients.map(client => client.close()));
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
});
async function project(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'goodui-mcp-locale-')); roots.push(root); return root; }
async function connect(root: string, locale?: 'ko' | 'en', env?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'goodui-language-tests', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [executable, '--root', root, ...(locale ? ['--locale', locale] : [])], cwd: root, ...(env ? { env } : {}) }));
  return client;
}

describe('MCP language configuration', () => {
  it('localizes tool and catalogue descriptions and own errors', async () => {
    const root = await project();
    const client = await connect(root, 'ko');
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
    expect(tools.every(tool => /[가-힣]/.test(tool.description ?? ''))).toBe(true);
    const catalog = await client.callTool({ name: 'get_rule_catalog', arguments: { kind: 'restricted-api' } });
    const data = catalog.structuredContent as { rules: {kind:string;description:string}[];schema:{title:string} };
    expect(data.rules[0]?.kind).toBe('restricted-api');
    expect(data.rules[0]?.description).toMatch(/[가-힣]/);
    expect(data.schema.title).toMatch(/[가-힣]/);
    const unknown = await client.callTool({ name: 'get_rule_catalog', arguments: { kind: 'not-a-rule' } });
    expect(unknown.structuredContent).toMatchObject({ error: { code: 'UNKNOWN_RULE', message: expect.stringContaining('알 수 없는') } });
    const invalid = await client.callTool({ name: 'validate_policy', arguments: { policy: { version: 99 } } });
    expect((invalid.structuredContent as {errors:string[]}).errors.every(error => /[가-힣]/.test(error))).toBe(true);
    const escaped = await client.callTool({ name: 'get_policy', arguments: { policyPath: '../outside.json' } });
    expect(escaped.structuredContent).toMatchObject({ error: { code: 'PATH_OUTSIDE_PROJECT', message: expect.stringMatching(/[가-힣]/) } });
  });

  it('keeps policy bytes and revisions intact while KO and EN instances return matching machine diagnostics', async () => {
    const root = await project();
    const [ko, en] = await Promise.all([connect(root, 'ko'), connect(root, 'en')]);
    const policy = { version: 1, presets: ['tailwind'], tailwind: { rules: ['no-inline-styles'], note: 'USER_NOTE_ORIGINAL' }, rules: [{ id: 'original-id', kind: 'restricted-imports', modules: ['legacy-client'], reason: 'USER_REASON_ORIGINAL', suggestion: 'USER_SUGGESTION_ORIGINAL' }] };
    const created = await ko.callTool({ name: 'set_policy', arguments: { policy, expectedRevision: null } });
    expect(created.isError).not.toBe(true);
    const before = await readFile(join(root, 'goodui.policy.json'), 'utf8');
    const loaded = await en.callTool({ name: 'get_policy', arguments: {} });
    expect(loaded.structuredContent).toEqual(created.structuredContent);
    expect((loaded.structuredContent as {policy:unknown}).policy).toEqual(policy);
    await writeFile(join(root, 'app.ts'), "import 'legacy-client';");
    const [koResult, enResult] = await Promise.all([ko.callTool({ name: 'lint', arguments: {} }), en.callTool({ name: 'lint', arguments: {} })]);
    const a = koResult.structuredContent as { diagnostics: {message:string;reason:string;suggestion:string}[] };
    const b = enResult.structuredContent as typeof a;
    expect(a.diagnostics[0]?.message).toContain('이유: USER_REASON_ORIGINAL');
    expect(b.diagnostics[0]?.message).toContain('Reason: USER_REASON_ORIGINAL');
    expect(a.diagnostics.map(({message,...rest})=>rest)).toEqual(b.diagnostics.map(({message,...rest})=>rest));
    expect(await readFile(join(root, 'goodui.policy.json'), 'utf8')).toBe(before);
  });

  it('supports automatic environment selection and an explicit flag override', async () => {
    const root = await project();
    const auto = await connect(root, undefined, { GOODUI_LOCALE: 'ko' });
    expect((await auto.listTools()).tools[0]?.description).toMatch(/[가-힣]/);
    const explicit = await connect(root, 'en', { GOODUI_LOCALE: 'ko' });
    expect((await explicit.listTools()).tools.every(tool => !/[가-힣]/.test(tool.description ?? ''))).toBe(true);
  });
});
