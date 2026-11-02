import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validatePolicy } from '../packages/core/src/index.js';

describe('documented policies', () => {
  it.each(['network-policy.json', 'design-system-policy.json', 'development-policy.json', 'component-policy.json', 'tailwind-policy.json', 'ai-slop-policy.json'])('%s conforms to the shipped schema', async name => {
    const policy = JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
    expect(validatePolicy(policy)).toMatchObject({ valid: true, errors: [] });
  });
});
