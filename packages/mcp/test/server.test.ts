import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGooduiServer } from '../src/index.js';

const policyPath = 'goodui.policy.jsonc';
const policy = {
  version: 1,
  rules: [{
    id: 'use-approved-client', kind: 'restricted-imports', modules: ['legacy-client'],
    reason: 'All application requests must use the approved client.',
    suggestion: 'Import the project client instead.',
  }],
};

describe('GoodUI stdio MCP server', () => {
  let root: string;
  let client: Client;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'goodui-mcp-'));
    client = new Client({ name: 'goodui-mcp-tests', version: '0.1.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), '--root', root],
      cwd: root,
    }));
  });

  afterEach(async () => {
    await client?.close();
    if (root?.startsWith(join(tmpdir(), 'goodui-mcp-'))) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exports an independently owned server factory and advertises all five typed tools', async () => {
    const server = createGooduiServer({ rootDir: root });
    expect(server.server).toBeDefined();
    await server.close();
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'get_policy', 'get_rule_catalog', 'lint', 'set_policy', 'validate_policy',
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
    const catalog = await client.callTool({ name: 'get_rule_catalog', arguments: {} });
    expect(catalog.isError).not.toBe(true);
    expect(catalog.structuredContent).toHaveProperty('rules');
    expect(catalog.structuredContent).toHaveProperty('schema');
    expect(catalog.structuredContent).toHaveProperty('presets', expect.arrayContaining([expect.objectContaining({ name: 'tailwind' }), expect.objectContaining({ name: 'ai-slop' })]));
    expect((catalog.structuredContent as { rules: unknown[] }).rules).toHaveLength(22);
    const compact = await client.callTool({ name: 'get_rule_catalog', arguments: { kind: 'component-contracts', includeSchema: false } });
    expect(compact.isError).not.toBe(true);
    expect((compact.structuredContent as { rules: unknown[] }).rules).toHaveLength(1);
    expect(compact.structuredContent).not.toHaveProperty('schema');
  });

  it('creates, reads, validates, and lints a policy without an AI provider', async () => {
    const created = await client.callTool({
      name: 'set_policy', arguments: { policyPath, policy, expectedRevision: null },
    });
    expect(created.isError).not.toBe(true);
    const snapshot = created.structuredContent as { revision: string; policy: unknown };
    expect(snapshot.revision).toEqual(expect.any(String));
    const loaded = await client.callTool({ name: 'get_policy', arguments: { policyPath } });
    expect(loaded.structuredContent).toEqual(created.structuredContent);

    const before = await readFile(join(root, policyPath), 'utf8');
    const invalid = await client.callTool({ name: 'validate_policy', arguments: { policy: { version: 99 } } });
    expect(invalid.structuredContent).toMatchObject({ valid: false, errors: expect.any(Array) });
    expect(await readFile(join(root, policyPath), 'utf8')).toBe(before);

    await writeFile(join(root, 'app.ts'), "import thing from 'legacy-client';\nexport default thing;\n");
    const linted = await client.callTool({ name: 'lint', arguments: { policyPath, files: ['app.ts'] } });
    expect(linted.isError).not.toBe(true);
    expect(linted.structuredContent).toMatchObject({
      errorCount: 1, filesChecked: 1,
      diagnostics: [expect.objectContaining({ policyId: 'use-approved-client', line: 1 })],
    });
    await mkdir(join(root, '[id]'));
    await writeFile(join(root, '[id]', 'page.tsx'), "import thing from 'legacy-client';\nexport default thing;\n");
    const route = await client.callTool({ name: 'lint', arguments: { policyPath, files: ['[id]/page.tsx'] } });
    expect(route.isError).not.toBe(true);
    expect(route.structuredContent).toMatchObject({ errorCount: 1, filesChecked: 1 });
    expect(await readFile(join(root, policyPath), 'utf8')).toBe(before);
  });

  it('previews an unsaved policy and refuses stale or invalid writes', async () => {
    await writeFile(join(root, 'app.js'), "import thing from 'legacy-client';\nexport default thing;\n");
    const preview = await client.callTool({ name: 'lint', arguments: { policy, files: ['app.js'] } });
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({ errorCount: 1 });
    await expect(readFile(join(root, 'goodui.policy.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, 'app.js'), 'utf8')).toBe("import thing from 'legacy-client';\nexport default thing;\n");

    const created = await client.callTool({
      name: 'set_policy', arguments: { policyPath, policy, expectedRevision: null },
    });
    const snapshot = created.structuredContent as { revision: string };
    const before = await readFile(join(root, policyPath), 'utf8');
    const stale = await client.callTool({
      name: 'set_policy', arguments: { policyPath, policy, expectedRevision: 'stale-revision' },
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ error: { code: 'POLICY_CONFLICT' } });
    const invalid = await client.callTool({
      name: 'set_policy', arguments: { policyPath, policy: { version: 99 }, expectedRevision: snapshot.revision },
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toMatchObject({ error: { code: 'INVALID_POLICY' } });
    expect(await readFile(join(root, policyPath), 'utf8')).toBe(before);
  });

  it('rejects policy and lint paths outside the bound project and rejects file globs', async () => {
    const escapedRead = await client.callTool({ name: 'get_policy', arguments: { policyPath: '../outside.json' } });
    expect(escapedRead.isError).toBe(true);
    const escapedWrite = await client.callTool({
      name: 'set_policy', arguments: { policyPath: '../outside.json', policy, expectedRevision: null },
    });
    expect(escapedWrite.isError).toBe(true);
    const escapedLint = await client.callTool({ name: 'lint', arguments: { policy, files: ['../outside.js'] } });
    expect(escapedLint.isError).toBe(true);
    const globLint = await client.callTool({ name: 'lint', arguments: { policy, files: ['**/*.js'] } });
    expect(globLint.isError).toBe(true);
    const ambiguous = await client.callTool({ name: 'lint', arguments: { policy, policyPath } });
    expect(ambiguous.isError).toBe(true);
    expect(() => createGooduiServer({ rootDir: root, policyPath: '../outside.json' })).toThrowError(expect.objectContaining({ code: 'PATH_OUTSIDE_PROJECT' }));
  });

  it('uses the startup custom policy for create, read and lint while allowing explicit overrides', async () => {
    await client.close();
    client = new Client({ name: 'goodui-custom-policy-tests', version: '0.1.0' });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), '--root', root, '--policy', 'config/contracts.json'],
      cwd: root,
    }));
    const created = await client.callTool({ name: 'set_policy', arguments: { policy, expectedRevision: null } });
    expect(created.isError).not.toBe(true);
    expect(created.structuredContent).toMatchObject({ path: join(await realpath(root), 'config', 'contracts.json') });
    const loaded = await client.callTool({ name: 'get_policy', arguments: {} });
    expect(loaded.structuredContent).toEqual(created.structuredContent);
    await expect(readFile(join(root, 'goodui.policy.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    await writeFile(join(root, 'app.js'), "import thing from 'legacy-client';\nexport default thing;\n");
    const linted = await client.callTool({ name: 'lint', arguments: {} });
    expect(linted.isError).not.toBe(true);
    expect(linted.structuredContent).toMatchObject({ errorCount: 1, filesChecked: 1 });
    const previewPolicy = { ...policy, rules: [{ ...policy.rules[0], modules: ['other-client'] }] };
    const preview = await client.callTool({ name: 'lint', arguments: { policy: previewPolicy } });
    expect(preview.isError).not.toBe(true);
    expect(preview.structuredContent).toMatchObject({ errorCount: 0 });

    const override = await client.callTool({ name: 'set_policy', arguments: { policyPath: 'override.json', policy: previewPolicy, expectedRevision: null } });
    expect(override.isError).not.toBe(true);
    const overrideRead = await client.callTool({ name: 'get_policy', arguments: { policyPath: 'override.json' } });
    expect(overrideRead.structuredContent).toEqual(override.structuredContent);
    const overrideLint = await client.callTool({ name: 'lint', arguments: { policyPath: 'override.json' } });
    expect(overrideLint.isError).not.toBe(true);
    expect(overrideLint.structuredContent).toMatchObject({ errorCount: 0 });
    expect(JSON.parse(await readFile(join(root, 'config', 'contracts.json'), 'utf8')).rules[0].modules).toEqual(['legacy-client']);
  });
});
