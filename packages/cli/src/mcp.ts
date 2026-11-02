import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Run the bundled MCP transport with its own dependencies and unmodified stdio. */
export async function runMcp(args: string[]): Promise<number> {
  const entry = fileURLToPath(new URL('./cli.js', import.meta.resolve('@pixelhize/goodui-mcp')));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
