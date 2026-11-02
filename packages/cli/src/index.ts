#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCancel, select } from '@clack/prompts';
import { PolicyError, getTailwindRules, getAiSlopRules, readPolicy, resolveLocale, localizeMessage, type Locale, type AiSlopRuleName } from '@pixelhize/goodui-core';
import { lintProject, type LintReport } from '@pixelhize/eslint-plugin-goodui';
import { chooseInstallMode, createInstallPlan, executeInstallPlan, type InstallMode, type PackageManager, type Preset } from './installer.js';
import { applyConfiguration, planConfiguration, createInitialPolicy } from './setup.js';
import { runMcp } from './mcp.js';
import { version } from './version.js';
import { diagnose, explainRule, listRules } from './inspect.js';
import { localizeCliMessage } from './locale.js';
import { helpText, localeArguments, text } from './ui-text.js';
import { aiSlopEnabled, changeAiSlop, chooseAiSlop, parseAiSlopNames, type AiSlopChoices } from './ai-slop-config.js';
export { initialPolicy, editorConfig } from './setup.js';

const HELP = `GoodUI — project contracts for JavaScript and TypeScript

Usage:
  goodui init                              Keyboard setup wizard
  goodui init --yes --mode lint            Install and configure project lint
  goodui init --yes --mode all --preset tailwind
  goodui init --dry-run --format json       Preview without changing files
  goodui init --no-install                  Write configuration only
  goodui check [FILE_OR_DIR ...] [--root DIR] [--policy FILE] [--format text|json]
  goodui policy validate [--root DIR] [--policy FILE] [--format text|json]
  goodui policy enable|disable ai-slop|CHECK_ID [--format json]
  goodui rules [--format json]             List built-in rules and presets
  goodui explain RULE_OR_POLICY_ID [--format json]
  goodui doctor [--root DIR] [--policy FILE] [--format json]
  goodui mcp [--root DIR] [--policy FILE]  Run the bundled MCP server

Setup options:
  --mode lint|agent|all|config              Default with --yes: lint
  --preset project|development|tailwind|full Default with --yes: project
  --package-manager npm|pnpm|yarn|bun        Otherwise detected from the project
  -y, --yes                                Non-interactive defaults
  --dry-run                                Show install commands and file changes
  --no-install                             Alias for --mode config
  --ai-slop / --no-ai-slop                  Enable/disable the built-in group
  --ai-slop-rules CHECK_1,CHECK_2            Enable exactly these AI Slop checks

Language options (all commands):
  --locale ko|en|auto                       Default: auto
  GOODUI_LOCALE=ko|en                       Override the detected system language

One main package: @pixelhize/goodui-cli. Core, plugin and MCP are included.
Tailwind v4 mode enables GoodUI's built-in design-system rules.
Existing lint/typecheck commands are preserved.
Check supports JS, TS, JSX, TSX, Vue and Svelte and does not modify source files.
Exit codes: 0 passed, 1 violations, 2 configuration/execution error, 130 cancelled.
  -h, --help     Show help
  -v, --version  Show version
`;

interface Arguments {
  command: 'init' | 'check' | 'validate' | 'rules' | 'explain' | 'doctor' | 'help' | 'version' | 'policy-enable' | 'policy-disable';
  rootDir: string; policyPath: string; format: 'text' | 'json'; files: string[];
  mode?: InstallMode; preset?: Preset; packageManager?: PackageManager;
  yes: boolean; dryRun: boolean;
  aiSlop?: boolean; aiSlopRules?: AiSlopRuleName[];
}

function parse(argv: string[], cwd: string, locale: Locale): Arguments {
  const result: Arguments = { command: 'help', rootDir: cwd, policyPath: 'goodui.policy.json', format: 'text', files: [], yes: false, dryRun: false };
  const positional: string[] = [];
  let setupOption = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (arg === '-h' || arg === '--help') return { ...result, command: 'help' };
    if (arg === '-v' || arg === '--version') return { ...result, command: 'version' };
    if (arg === '--yes' || arg === '-y') { result.yes = true; setupOption = true; continue; }
    if (arg === '--dry-run') { result.dryRun = true; setupOption = true; continue; }
    if (arg === '--ai-slop' || arg === '--no-ai-slop') {
      const enabled = arg === '--ai-slop';
      if (result.aiSlop !== undefined && result.aiSlop !== enabled) throw new PolicyError('AI_SLOP_CONFLICT', text(locale, 'Conflicting AI Slop options.', 'AI Slop 옵션이 서로 충돌합니다.'));
      result.aiSlop = enabled; setupOption = true; continue;
    }
    if (arg === '--no-install') {
      if (result.mode && result.mode !== 'config') throw new Error(text(locale, '--no-install conflicts with --mode.', '--no-install과 --mode가 충돌합니다.'));
      result.mode = 'config'; setupOption = true; continue;
    }
    if (['--root', '--policy', '--format', '--mode', '--preset', '--package-manager', '--ai-slop-rules'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(text(locale, `${arg} requires a value.`, `${arg}에 값을 지정해야 합니다.`));
      if (arg === '--root') result.rootDir = resolve(cwd, value);
      if (arg === '--policy') result.policyPath = value;
      if (arg === '--ai-slop-rules') { result.aiSlopRules = parseAiSlopNames(value, locale); setupOption = true; }
      if (arg === '--format') {
        if (value !== 'text' && value !== 'json') throw new Error(text(locale, '--format must be text or json.', '--format에는 text 또는 json을 지정하세요.'));
        result.format = value;
      }
      if (arg === '--mode') {
        if (!['lint', 'agent', 'all', 'config'].includes(value)) throw new Error(text(locale, '--mode must be lint, agent, all or config.', '--mode에는 lint, agent, all, config 중 하나를 지정하세요.'));
        if (result.mode && result.mode !== value) throw new Error(text(locale, 'Conflicting setup modes.', '설치 모드가 서로 충돌합니다.'));
        result.mode = value as InstallMode; setupOption = true;
      }
      if (arg === '--preset') {
        if (!['project', 'development', 'tailwind', 'full'].includes(value)) throw new Error(text(locale, '--preset must be project, development, tailwind or full.', '--preset에는 project, development, tailwind, full 중 하나를 지정하세요.'));
        result.preset = value as Preset; setupOption = true;
      }
      if (arg === '--package-manager') {
        if (!['npm', 'pnpm', 'yarn', 'bun'].includes(value)) throw new Error(text(locale, '--package-manager must be npm, pnpm, yarn or bun.', '--package-manager에는 npm, pnpm, yarn, bun 중 하나를 지정하세요.'));
        result.packageManager = value as PackageManager; setupOption = true;
      }
    } else if (arg.startsWith('-')) throw new Error(text(locale, `Unknown option: ${arg}`, `알 수 없는 옵션: ${arg}`));
    else positional.push(arg);
  }
  const [command, subcommand, ...rest] = positional;
  if (!command) return result;
  if (command === 'policy' && subcommand === 'validate' && rest.length === 0) result.command = 'validate';
  else if (command === 'policy' && ['enable', 'disable'].includes(subcommand ?? '') && rest.length === 1) { result.command = subcommand === 'enable' ? 'policy-enable' : 'policy-disable'; result.files = [rest[0]!]; }
  else if ((command === 'rules' || command === 'doctor') && subcommand === undefined) result.command = command;
  else if (command === 'explain' && subcommand && rest.length === 0) { result.command = 'explain'; result.files = [subcommand]; }
  else if ((command === 'init' || command === 'setup') && subcommand === undefined) result.command = 'init';
  else if (command === 'check') { result.command = 'check'; result.files = positional.slice(1); }
  else throw new Error(text(locale, `Unknown command: ${positional.join(' ')}. Run goodui --help.`, `알 수 없는 명령: ${positional.join(' ')}. goodui --help를 실행하세요.`));
  if (setupOption && result.command !== 'init') throw new Error(text(locale, 'Setup options are only supported by goodui init.', '설치 옵션은 goodui init에서만 사용할 수 있습니다.'));
  if (result.aiSlop === false && result.aiSlopRules !== undefined) throw new PolicyError('AI_SLOP_CONFLICT', text(locale, 'Cannot combine --no-ai-slop and --ai-slop-rules.', '--no-ai-slop과 --ai-slop-rules를 함께 사용할 수 없습니다.'));
  return result;
}

function formatReport(report: LintReport, locale: Locale): string {
  const lines = report.diagnostics.map(d => `${d.filePath}:${d.line}:${d.column} ${text(locale, d.severity, d.severity === 'error' ? '오류' : '경고')} ${d.message}${d.ruleId ? ` (${d.ruleId})` : ''}`);
  lines.push(text(locale, `${report.filesChecked} file(s) checked; ${report.errorCount} error(s), ${report.warningCount} warning(s).`, `${report.filesChecked}개 파일 검사; 오류 ${report.errorCount}개, 경고 ${report.warningCount}개.`));
  return lines.join('\n') + '\n';
}

export interface CliIO { stdout(text: string): void; stderr(text: string): void }
export interface CliRuntime {
  isTTY?: boolean;
  promptMode?: () => Promise<InstallMode | null>;
  promptPreset?: () => Promise<Preset | null>;
  promptAiSlop?: (policy: import('@pixelhize/goodui-core').Policy) => Promise<AiSlopChoices | null>;
  executeInstall?: typeof executeInstallPlan;
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd(), io: CliIO = {
  stdout: text => { process.stdout.write(text); }, stderr: text => { process.stderr.write(text); },
}, runtime: CliRuntime = {}): Promise<number> {
  let json = argv.some((arg, index) => arg === '--format' && argv[index + 1] === 'json');
  let locale: Locale = 'en';
  try {
    locale = resolveLocale();
    const localized = localeArguments(argv, locale);
    locale = localized.locale;
    argv = localized.argv;
    if (argv[0] === 'mcp') return await runMcp([...argv.slice(1), '--locale', locale]);
    const args = parse(argv, cwd, locale);
    json = args.format === 'json';
    if (args.command === 'help') { io.stdout(helpText(locale, HELP)); return 0; }
    if (args.command === 'version') { io.stdout(version + '\n'); return 0; }
    if (args.command === 'policy-enable' || args.command === 'policy-disable') {
      const changed = await changeAiSlop(args.rootDir, args.policyPath, args.files[0]!, args.command === 'policy-enable', locale);
      io.stdout(json ? JSON.stringify(changed, null, 2) + '\n' : text(locale, `Updated ${changed.path}; AI Slop has ${changed.activeRules.length} active checks.\n`, `${changed.path}을(를) 갱신했습니다. 활성 AI Slop 검사: ${changed.activeRules.length}개.\n`));
      return 0;
    }
    if (args.command === 'rules') {
      const catalog = listRules(locale);
      io.stdout(json ? JSON.stringify(catalog, null, 2) + '\n' : catalog.rules.map(rule => `${rule.id}${rule.preset ? ` [${rule.preset}${rule.defaultEnabled ? text(locale, ', default', ', 기본') : text(locale, ', opt-in', ', 선택')}]` : ''}\n  ${rule.description}`).join('\n') + '\n');
      return 0;
    }
    if (args.command === 'explain') {
      const explanation = await explainRule(args.files[0]!, args.rootDir, args.policyPath, locale);
      io.stdout(JSON.stringify(explanation, null, 2) + '\n');
      return 0;
    }
    if (args.command === 'doctor') {
      const report = await diagnose(args.rootDir, args.policyPath, locale);
      io.stdout(json ? JSON.stringify(report, null, 2) + '\n' : report.checks.map(check => `${text(locale, check.status.toUpperCase(), { ok: '정상', warning: '경고', error: '오류' }[check.status])} ${check.id}: ${check.message}${check.hint ? `\n  ${check.hint}` : ''}`).join('\n') + '\n');
      return report.ok ? 0 : 2;
    }
    if (args.command === 'init') {
      const isTTY = runtime.isTTY ?? !!(process.stdin.isTTY && process.stdout.isTTY);
      const mode = await chooseInstallMode({ mode: args.mode, yes: args.yes || args.dryRun, json, isTTY, prompt: runtime.promptMode, locale });
      if (mode === null) { io.stdout(json ? '{"cancelled":true}\n' : text(locale, 'Setup cancelled.\n', '설치를 취소했습니다.\n')); return 130; }
      let preset: Preset | null = args.preset ?? 'project';
      if (!args.preset && isTTY && !json && !args.yes && !args.dryRun && args.mode === undefined) {
        if (runtime.promptPreset) preset = await runtime.promptPreset();
        else {
          const selected = await select({ message: text(locale, 'Which project rules should GoodUI configure?', '어떤 프로젝트 규칙을 설정할까요?\n↑/↓ 이동 · Enter 선택'), showInstructions: locale !== 'ko', options: [
            { value: 'project', label: text(locale, 'Project contracts', '프로젝트 규칙'), hint: text(locale, 'Imports, APIs, boundaries and UI structure', 'import·API·폴더 경계·UI 규칙을 위한 기본 예제') },
            { value: 'development', label: text(locale, 'Development standards', '개발 규약'), hint: text(locale, 'Strict TypeScript syntax, function and file budgets', 'TypeScript 문법 제한과 함수·파일 한계') },
            { value: 'tailwind', label: text(locale, 'Project contracts + Tailwind', '프로젝트 규칙 + Tailwind'), hint: text(locale, 'Built-in token, class and component checks', '내장 토큰·클래스·컴포넌트 검사') },
            { value: 'full', label: text(locale, 'Development + strict design system', '개발 규약 + 엄격한 디자인 시스템'), hint: text(locale, 'All Tailwind checks, development budgets and basic props contracts', 'Tailwind 6개 규칙·개발 한계·기본 속성 계약') },
          ] });
          preset = isCancel(selected) ? null : selected as Preset;
        }
      }
      if (preset === null) { io.stdout(json ? '{"cancelled":true}\n' : text(locale, 'Setup cancelled.\n', '설치를 취소했습니다.\n')); return 130; }
      let currentPolicy: import('@pixelhize/goodui-core').Policy | undefined;
      try { currentPolicy = (await readPolicy(args.rootDir, args.policyPath, { locale })).policy; }
      catch (error) { if (!(error instanceof PolicyError && error.code === 'POLICY_NOT_FOUND')) throw error; }
      let aiSlop: AiSlopChoices = { enabled: args.aiSlop, rules: args.aiSlopRules };
      if (args.aiSlop === undefined && args.aiSlopRules === undefined && isTTY && !json && !args.yes && !args.dryRun && args.mode === undefined) {
        const selected = await (runtime.promptAiSlop ?? (policy => chooseAiSlop(policy, locale)))(currentPolicy ?? createInitialPolicy(locale));
        if (selected === null) { io.stdout(text(locale, 'Setup cancelled.\n', '설치를 취소했습니다.\n')); return 130; }
        aiSlop = selected;
      }
      const dependencyPreset = currentPolicy?.presets?.includes('tailwind') && preset !== 'full' ? 'tailwind' : preset;
      const installation = await createInstallPlan({ rootDir: args.rootDir, mode, preset: dependencyPreset, packageManager: args.packageManager, version, locale });
      if (dependencyPreset !== preset) installation.warnings.push(text(locale, 'The existing Tailwind preset is preserved.', '기존 Tailwind 프리셋을 보존합니다.'));
      const setupOptions = { rootDir: args.rootDir, policyPath: args.policyPath, mode, preset, packageManager: installation.packageManager, locale, aiSlop };
      const configuration = await planConfiguration(setupOptions);
      const outputConfiguration = () => ({
        policyFile: configuration.policyFile, policyCreated: configuration.policyCreated, policyUpdated: configuration.policyUpdated,
        schemaFile: configuration.schemaFile, schemaCreated: configuration.schemaCreated, schemaUpdated: configuration.schemaUpdated,
        configFile: configuration.configFile, configCreated: configuration.configCreated, integration: configuration.integration,
        scripts: configuration.scripts, mcp: configuration.mcp, writes: configuration.writes, warnings: configuration.warnings,
        enabledContracts: configuration.policy.rules.filter(rule => rule.enabled !== false).map(rule => rule.id),
        designRules: getTailwindRules(configuration.policy),
        aiSlopEnabled: aiSlopEnabled(configuration.policy), aiSlopRules: getAiSlopRules(configuration.policy),
      });
      if (args.dryRun) {
        const preview = { dryRun: true, mode, preset, installation, configuration: outputConfiguration() };
        io.stdout(json ? JSON.stringify(preview, null, 2) + '\n' : `${JSON.stringify(preview, null, 2)}\n${text(locale, 'No files changed.', '변경된 파일이 없습니다.')}\n`);
        return 0;
      }
      const installed = await (runtime.executeInstall ?? executeInstallPlan)(installation, {
        locale,
        onStdout: text => json ? io.stderr(text) : io.stdout(text), onStderr: text => io.stderr(text),
      });
      await applyConfiguration(setupOptions, configuration);
      const result = { dryRun: false, mode, preset, ...outputConfiguration(), installation: installed, message: text(locale, 'GoodUI setup is complete. Customize goodui.policy.json with your project contracts.', 'GoodUI 설정을 완료했습니다. goodui.policy.json에 프로젝트 규칙을 지정하세요.') };
      if (json) io.stdout(JSON.stringify(result, null, 2) + '\n');
      else {
        io.stdout(`${configuration.policyCreated ? text(locale, 'Created', '생성') : configuration.policyUpdated ? text(locale, 'Updated', '수정') : text(locale, 'Preserved', '보존')} ${configuration.policyFile}\n`);
        if (configuration.configFile) io.stdout(`${configuration.configCreated ? text(locale, 'Created', '생성') : text(locale, 'Preserved', '보존')} ${configuration.configFile}\n`);
        for (const warning of [...installation.warnings, ...configuration.warnings]) io.stdout(`${text(locale, 'Note', '안내')}: ${warning}\n`);
        if (!configuration.configCreated && configuration.integration) io.stdout(`${text(locale, 'Editor integration', '에디터 연결')} :\n${configuration.integration}`);
        if (configuration.mcp) io.stdout(`${text(locale, 'MCP host configuration (add to your chosen client)', 'MCP 호스트 설정 (사용할 클라이언트에 추가하세요)')}:\n${JSON.stringify(configuration.mcp, null, 2)}\n`);
        io.stdout(text(locale, 'GoodUI is ready. Run goodui check; keep your existing lint and typecheck commands.\n', 'GoodUI 준비가 완료됐습니다. goodui check로 검사하세요. 기존 lint·typecheck 명령은 함께 유지하세요.\n'));
      }
      return 0;
    }
    if (args.command === 'validate') {
      const snapshot = await readPolicy(args.rootDir, args.policyPath, { locale });
      io.stdout(json ? JSON.stringify({ valid: true, path: snapshot.path, revision: snapshot.revision }, null, 2) + '\n' : text(locale, `Valid policy: ${snapshot.path}\n`, `유효한 정책: ${snapshot.path}\n`));
      return 0;
    }
    const report = await lintProject({ rootDir: args.rootDir, policyPath: args.policyPath, locale, ...(args.files.length ? { files: args.files } : {}) });
    io.stdout(json ? JSON.stringify(report, null, 2) + '\n' : formatReport(report, locale));
    return report.errorCount > 0 ? 1 : 0;
  } catch (error) {
    const message = localizeCliMessage(localizeMessage(error instanceof Error ? error.message : String(error), locale), locale);
    const code = error instanceof PolicyError ? error.code : error && typeof error === 'object' && 'code' in error ? String(error.code) : 'EXECUTION_ERROR';
    if (json) io.stdout(JSON.stringify({ error: { code, message } }, null, 2) + '\n');
    else io.stderr(`GoodUI: ${message}\n`);
    return 2;
  }
}

function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href; }
  catch { return false; }
}
if (isEntryPoint()) process.exitCode = await main();
