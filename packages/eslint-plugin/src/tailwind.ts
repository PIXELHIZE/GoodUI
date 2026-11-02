import type { Linter } from 'eslint';
import { getTailwindRules, TAILWIND_RULE_NAMES, type Policy } from '@pixelhize/goodui-core';
import { prepareDesignProject } from './design-system/project.js';
export { nativeRules } from './design-system/rules.js';

/** Native rules share one prepared theme/compiler model across all files in a run. */
export async function tailwindConfigs(root: string, policy: Policy, files: string[]): Promise<Linter.Config[]> {
  const selected = getTailwindRules(policy);
  if (!selected.length) return [];
  const project = await prepareDesignProject(root, policy);
  const options = { rootDir: root, policy };
  const configs: Linter.Config[] = [{
    name: 'goodui/tailwind', files,
    settings: { gooduiNativeProject: project.key },
    rules: Object.fromEntries(selected.map(name => [`goodui/${name}`, ['error', options]])),
  }];
  const known = new Set(TAILWIND_RULE_NAMES.map(name => `goodui/${name}`));
  for (const [index, exception] of (policy.exceptions ?? []).entries()) {
    if (known.has(exception.ruleId)) configs.push({
      name: `goodui/design-exception-${index + 1}`,
      files: files.flatMap(include => exception.files.map(exempt => [include, exempt])),
      rules: { [exception.ruleId]: 'off' },
    });
  }
  return configs;
}
