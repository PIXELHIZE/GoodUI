/** Public editor/configuration API: consumers only need the main GoodUI package. */
export { default, plugin, createConfig, lintProject } from '@pixelhize/eslint-plugin-goodui';
export type { ConfigOptions, LintOptions, Diagnostic, LintReport } from '@pixelhize/eslint-plugin-goodui';
