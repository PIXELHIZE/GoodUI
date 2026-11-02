#!/usr/bin/env node
import { realpath, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createGooduiServer } from './server.js';
import { localizeMessage, resolveLocale, type LocaleInput } from '@pixelhize/goodui-core';

function languageArgument(): LocaleInput | undefined {
  let value: string | undefined;
  for (let index = 2; index < process.argv.length; index++) {
    if (process.argv[index] === '--locale') value = process.argv[index + 1];
    else if (process.argv[index]?.startsWith('--locale=')) value = process.argv[index]!.slice(9);
  }
  return value === 'en' || value === 'ko' || value === 'auto' ? value : undefined;
}
const locale = resolveLocale(languageArgument());

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { root: { type: 'string' }, policy: { type: 'string' }, locale: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: false,
  });
  if (values.locale !== undefined && !['en', 'ko', 'auto'].includes(values.locale)) {
    throw new Error(locale === 'ko' ? '--locale에는 ko, en, auto 중 하나를 지정하세요.' : '--locale must be ko, en, or auto.');
  }
  if (values.help) {
    process.stdout.write(locale === 'ko'
      ? '사용법: goodui mcp [--root <프로젝트-디렉터리>] [--policy <정책-파일>] [--locale ko|en|auto]\n독립 실행 명령: goodui-mcp\n\nGoodUI MCP 서버를 stdio로 실행합니다. 기본 프로젝트는 현재 디렉터리이며 기본 정책은 goodui.policy.json입니다.\n'
      : 'Usage: goodui mcp [--root <project-directory>] [--policy <policy-file>] [--locale ko|en|auto]\nStandalone alias: goodui-mcp\n\nRuns the GoodUI MCP server over stdio. The project defaults to the current directory; the policy defaults to goodui.policy.json.\n');
    return;
  }
  const rootDir = await realpath(values.root ?? process.cwd());
  if (!(await stat(rootDir)).isDirectory()) {
    throw new Error(locale === 'ko' ? '--root에는 프로젝트 디렉터리를 지정해야 합니다.' : '--root must be a project directory.');
  }
  await serveStdio(() => createGooduiServer({ rootDir, policyPath: values.policy, locale }));
}

main().catch((error: unknown) => {
  const original = error instanceof Error ? error.message : String(error);
  const message = localizeMessage(original, locale);
  process.stderr.write(`goodui-mcp: ${locale === 'ko' && message === original && !/[가-힣]/.test(message) ? `MCP 실행 오류: ${message}` : message}\n`);
  process.exitCode = 1;
});
