import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, it } from 'vitest';
import { main } from '../../cli/src/index.js';

it.each(['en', 'ko'] as const)('returns the same %s Tailwind diagnostics through the main CLI and bundled MCP server', async locale => {
  const root = fileURLToPath(new URL('../../eslint-plugin/test/fixtures/tailwind/', import.meta.url));
  let stdout = '', stderr = '';
  const code = await main(['check', 'src/broken.tsx', '--root', root, '--format', 'json', '--locale', locale], root, {
    stdout: value => { stdout += value; }, stderr: value => { stderr += value; },
  });
  expect(code).toBe(1);
  expect(stderr).toBe('');
  const direct = JSON.parse(stdout);
  const client = new Client({ name: 'goodui-tailwind-parity', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url)), 'mcp', '--root', root, '--locale', locale],
      cwd: root,
    }));
    const response = await client.callTool({ name: 'lint', arguments: { files: ['src/broken.tsx'] } });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual(direct);
    expect(direct.diagnostics.map((diagnostic: { ruleId: string }) => diagnostic.ruleId)).toContain('goodui/no-unknown-classes');
  } finally { await client.close(); }
}, 30000);
