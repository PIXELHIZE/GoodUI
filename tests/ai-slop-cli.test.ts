import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main, type CliRuntime } from '../packages/cli/src/index.js';
import { AI_SLOP_RULE_NAMES, DEFAULT_AI_SLOP_RULES, getAiSlopRules } from '../packages/core/src/index.js';

const roots: string[] = [];
async function project(policy?: object) {
  const root = await mkdtemp(join(tmpdir(), 'goodui-ai-cli-'));
  roots.push(root);
  if (policy) await writeFile(join(root, 'goodui.policy.json'), JSON.stringify(policy, null, 2) + '\n');
  return root;
}
async function run(root: string, args: string[], runtime: CliRuntime = {}) {
  let stdout = '', stderr = '';
  const code = await main(args, root, { stdout: value => { stdout += value; }, stderr: value => { stderr += value; } }, { isTTY: false, ...runtime });
  return { code, stdout, stderr };
}
const initial = { version: 1, rules: [{ id: 'custom', kind: 'restricted-api', globals: ['eval'], reason: 'Preserve this English reason.', suggestion: 'Preserve this suggestion.' }] };
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const actual = await realpath(root), parent = await realpath(tmpdir());
    expect(dirname(actual).toLowerCase()).toBe(parent.toLowerCase());
    expect(basename(actual)).toMatch(/^goodui-ai-cli-/);
    await rm(actual, { recursive: true, force: true });
  }
});

describe('built-in AI Slop controls', () => {
  it('enables ten built-in checks for a new project and previews them without writes', async () => {
    const root = await project();
    const preview = await run(root, ['init', '--dry-run', '--format', 'json']);
    expect(preview.code).toBe(0);
    expect(JSON.parse(preview.stdout).configuration).toMatchObject({ aiSlopEnabled: true, aiSlopRules: DEFAULT_AI_SLOP_RULES });
    expect(await readdir(root)).toEqual([]);
    expect((await run(root, ['init', '--no-install', '--format', 'json'])).code).toBe(0);
    const policy = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(getAiSlopRules(policy)).toEqual(DEFAULT_AI_SLOP_RULES);
    const health = await run(root, ['doctor', '--locale', 'ko', '--format', 'json']);
    expect(health.code).toBe(0);
    expect(JSON.parse(health.stdout).checks.find((check: {id: string}) => check.id === 'ai-slop')).toMatchObject({ status: 'ok', message: 'AI Slop 검사 켜짐; 활성 10개.' });
  });

  it('preserves an existing policy opt-out until explicitly requested', async () => {
    const root = await project(initial);
    const first = await run(root, ['init', '--no-install', '--format', 'json']);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout).aiSlopEnabled).toBe(false);
    const second = await run(root, ['init', '--no-install', '--ai-slop', '--locale', 'ko', '--format', 'json']);
    expect(second.code).toBe(0);
    const policy = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(getAiSlopRules(policy)).toHaveLength(10);
    expect(policy.rules).toEqual(initial.rules);
  });

  it('selects exactly the listed checks, including normally opt-in checks', async () => {
    const root = await project();
    const result = await run(root, ['init', '--no-install', '--ai-slop-rules', 'goodui/no-nested-cards,no-gradient-text', '--format', 'json']);
    expect(result.code).toBe(0);
    const policy = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(getAiSlopRules(policy)).toEqual(['no-gradient-text', 'no-nested-cards']);
    expect(Object.keys(policy.aiSlop.rules)).toHaveLength(AI_SLOP_RULE_NAMES.length);
  });

  it('keeps individual choices and user prose when disabling and reenabling the group', async () => {
    const root = await project({ ...initial, aiSlop: { enabled: true, note: 'Keep my note.', allowPhrases: ['Custom phrase'], rules: { 'no-emoji-icons': false, 'no-nested-cards': true } }, exceptions: [{ ruleId: 'goodui/no-gradient-text', files: ['legacy/**'], reason: 'Approved brand asset.' }] });
    for (const enabled of [false, true]) {
      const result = await run(root, ['policy', enabled ? 'enable' : 'disable', 'ai-slop', '--format', 'json']);
      expect(result.code).toBe(0);
      const snapshot = JSON.parse(result.stdout);
      expect(snapshot.aiSlopEnabled).toBe(enabled);
      expect(snapshot.policy.aiSlop).toMatchObject({ enabled, note: 'Keep my note.', rules: { 'no-emoji-icons': false, 'no-nested-cards': true } });
      expect(snapshot.policy.rules).toEqual(initial.rules);
      expect(snapshot.policy.exceptions[0].reason).toBe('Approved brand asset.');
    }
  });

  it('supports one-item commands and preserves all other item preferences', async () => {
    const root = await project(initial);
    expect((await run(root, ['policy', 'enable', 'goodui/no-generic-fonts', '--format', 'json'])).code).toBe(0);
    let policy = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(getAiSlopRules(policy)).toContain('no-generic-fonts');
    expect((await run(root, ['policy', 'disable', 'no-emoji-icons', '--format', 'json'])).code).toBe(0);
    policy = JSON.parse(await readFile(join(root, 'goodui.policy.json'), 'utf8'));
    expect(getAiSlopRules(policy)).not.toContain('no-emoji-icons');
    expect(getAiSlopRules(policy)).toContain('no-generic-fonts');
  });

  it.each([
    ['init', '--no-install', '--ai-slop-rules', 'unknown'],
    ['init', '--no-install', '--ai-slop', '--no-ai-slop'],
    ['init', '--no-install', '--no-ai-slop', '--ai-slop-rules', 'no-emoji-icons'],
    ['policy', 'disable', 'typo'],
  ])('fails invalid controls without changing policy: %j', async (...args) => {
    const root = await project(initial), path = join(root, 'goodui.policy.json');
    const before = await readFile(path, 'utf8');
    expect((await run(root, [...args, '--format', 'json'])).code).toBe(2);
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await readdir(root)).toEqual(['goodui.policy.json']);
  });

  it('cancels per-item keyboard setup before installation or any file writes', async () => {
    const root = await project(), executeInstall = vi.fn();
    const result = await run(root, ['init'], { isTTY: true, promptMode: async () => 'all', promptPreset: async () => 'project', promptAiSlop: async () => null, executeInstall });
    expect(result.code).toBe(130);
    expect(executeInstall).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('explains the complete group and an individual check without a policy', async () => {
    const root = await project();
    for (const id of ['ai-slop', 'goodui/no-gradient-text']) {
      const result = await run(root, ['explain', id, '--locale', 'ko', '--format', 'json']);
      expect(result.code).toBe(0);
      const explanation = JSON.parse(result.stdout);
      expect(explanation).toMatchObject({ preset: 'ai-slop', example: { aiSlop: { enabled: true } } });
      expect(explanation.description).toMatch(/[가-힣]/);
    }
  });
});
