import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, dirname, extname, resolve } from 'node:path';
import fg from 'fast-glob';
import postcss from 'postcss';
import * as tsParser from '@typescript-eslint/parser';
import { getTailwindRules, matchesFile, matchesPattern, PolicyError, resolveProjectPathSync, type Policy, type TailwindPolicy } from '@pixelhize/goodui-core';
import { createImportResolver, relativePath } from '../resolution.js';
import { type AstNode, type ImportedBinding } from './values.js';
import { selectorClasses } from './classes.js';
import { contextLocale, translatePluginMessage } from '../localization.js';

type DesignSystem = { candidatesToCss(candidates: string[]): (string | null)[]; getClassList(): [string, unknown][]; theme?: { prefix?: string | null } };
export interface ComponentDetails { name: string; file?: string; sizes: string[]; variants: string[]; axes?: Record<string, string[]> }
export interface DesignProject {
  key: string; root: string; options: TailwindPolicy; entries: string[]; colors: Map<string, string>;
  declaredClasses: Set<string>; fingerprints: Map<string, string>; systems: DesignSystem[]; uiImports: string[];
  components: Map<string, ComponentDetails>; resolveImport: (specifier: string, importer: string) => string;
  vocabulary?: string[];
  prefixes: string[];
}
const projects = new Map<string, DesignProject>();
const ignored = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/coverage/**', '**/.next/**'];
function fingerprint(file: string): string { const stat = statSync(file); return `${stat.mtimeMs}:${stat.size}`; }

function frameworkStylesheet(file: string): boolean {
  if (file.replaceAll('\\', '/').includes('/node_modules/tailwindcss/')) return true;
  let directory = dirname(file);
  for (let depth = 0; depth < 12; depth++) {
    const metadata = resolve(directory, 'package.json');
    if (existsSync(metadata)) { try { return JSON.parse(readFileSync(metadata, 'utf8')).name === 'tailwindcss'; } catch { return false; } }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
}

export async function prepareDesignProject(root: string, policy: Policy): Promise<DesignProject> {
  const options = policy.tailwind ?? {};
  const fingerprints = new Map<string, string>();
  const uiImports = [...(options.componentImports ?? [])];
  let entries: string[] = [];
  if (options.themeFiles) {
    entries = fg.sync(options.themeFiles, { cwd: root, absolute: true, onlyFiles: true, followSymbolicLinks: false, ignore: ignored }).map(file => resolveProjectPathSync(root, file));
    if (!entries.length) throw new PolicyError('TAILWIND_THEME_NOT_FOUND', 'No CSS files match tailwind.themeFiles. Point it to the project Tailwind v4 entry stylesheet.');
  } else {
    const componentsPath = resolve(root, 'components.json');
    if (existsSync(componentsPath)) {
      const file = resolveProjectPathSync(root, componentsPath);
      fingerprints.set(file, fingerprint(file));
      let metadata: any;
      try { metadata = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new PolicyError('INVALID_COMPONENTS_CONFIG', 'components.json is not valid JSON.'); }
      if (metadata.aliases?.ui && typeof metadata.aliases.ui === 'string') uiImports.push(metadata.aliases.ui, `${metadata.aliases.ui}/**`);
      if (metadata.tailwind?.css && typeof metadata.tailwind.css === 'string') entries.push(resolveProjectPathSync(root, metadata.tailwind.css));
    }
    if (!entries.length) {
      const candidates = fg.sync(['**/*.css'], { cwd: root, absolute: true, onlyFiles: true, followSymbolicLinks: false, ignore: ignored });
      entries = candidates.filter(file => /@import\s+(?:url\()?\s*["']tailwindcss(?:\/[^"']*)?["']/.test(readFileSync(file, 'utf8'))).sort();
      if (entries.length > 1) throw new PolicyError('TAILWIND_THEME_AMBIGUOUS', `Several Tailwind entries were found (${entries.map(file => relativePath(root, file)).join(', ')}). Set tailwind.themeFiles explicitly.`);
    }
  }
  entries = [...new Set(entries)].sort();
  if (!entries.length && getTailwindRules(policy).includes('no-unknown-classes')) throw new PolicyError('TAILWIND_THEME_NOT_FOUND', 'The no-unknown-classes rule needs a Tailwind v4 CSS entry. Set tailwind.themeFiles or point components.json tailwind.css at it.');
  const colors = new Map<string, string>(), declaredClasses = new Set<string>(), visited = new Set<string>(), prefixes = new Set<string>();
  function visit(file: string): void {
    if (frameworkStylesheet(file)) return;
    if (visited.has(file)) return;
    visited.add(file);
    fingerprints.set(file, fingerprint(file));
    let css: postcss.Root;
    try { css = postcss.parse(readFileSync(file, 'utf8'), { from: file }); }
    catch (error) { throw new PolicyError('INVALID_THEME_CSS', error instanceof Error ? error.message : String(error)); }
    css.walkDecls(declaration => {
      let parent: any = declaration.parent;
      while (parent && parent.type !== 'root') {
        if (parent.type === 'atrule' && parent.name === 'theme' && /^--(?:color|background-color|text-color|border-color)-/.test(declaration.prop)) {
          const name = declaration.prop.replace(/^--(?:color|background-color|text-color|border-color)-/, '');
          if (name === '*' && declaration.value.trim() === 'initial') colors.clear();
          else if (name !== '*') colors.set(name, declaration.value);
          break;
        }
        parent = parent.parent;
      }
    });
    css.walkRules(rule => { selectorClasses(rule.selector).forEach(name => declaredClasses.add(name)); });
    css.walkAtRules(atRule => {
      const prefix = /\bprefix\(\s*([a-z][\w-]*)\s*\)/i.exec(atRule.params)?.[1];
      if (prefix && ['import', 'theme'].includes(atRule.name)) prefixes.add(prefix);
      if (!['import', 'plugin', 'config'].includes(atRule.name)) return;
      const specifier = /^(?:url\()?\s*["']([^"']+)["']/.exec(atRule.params)?.[1];
      if (!specifier || specifier === 'tailwindcss' || specifier.startsWith('tailwindcss/')) return;
      let imported: string | undefined;
      if (specifier.startsWith('.')) {
        const candidate = resolve(dirname(file), specifier);
        imported = [candidate, `${candidate}.css`].find(existsSync);
        if (imported && frameworkStylesheet(imported)) return;
        if (imported) imported = resolveProjectPathSync(root, imported);
      } else {
        try { imported = createRequire(file).resolve(specifier); } catch { /* The compiler reports unresolved imports with its original details. */ }
      }
      if (!imported) return;
      if (atRule.name === 'import' && extname(imported) === '.css') visit(imported);
      else fingerprints.set(imported, fingerprint(imported));
    });
  }
  entries.forEach(visit);
  const systems: DesignSystem[] = [];
  if (getTailwindRules(policy).includes('no-unknown-classes')) {
    try {
      const compiler = await import('@tailwindcss/node');
      if (typeof compiler.__unstable__loadDesignSystem !== 'function') throw new Error('The installed compiler has no supported design-system API. GoodUI supports Tailwind v4.3+.');
      for (const file of entries) {
        const system = await compiler.__unstable__loadDesignSystem(readFileSync(file, 'utf8'), { base: dirname(file) });
        if (typeof system.candidatesToCss !== 'function' || typeof system.getClassList !== 'function') throw new Error('The installed compiler cannot validate candidates.');
        if (system.theme?.prefix) prefixes.add(system.theme.prefix);
        systems.push(system as unknown as DesignSystem);
      }
    } catch (error) {
      throw new PolicyError('TAILWIND_COMPILER_ERROR', `Cannot prepare the Tailwind v4 compiler: ${error instanceof Error ? error.message : String(error)} Check tailwind.themeFiles and the project Tailwind CSS imports.`);
    }
  }
  const key = createHash('sha256').update(root + JSON.stringify(options)).digest('hex');
  let resolver: ReturnType<typeof createImportResolver> | undefined;
  const project: DesignProject = { key, root, options, entries, colors, declaredClasses, fingerprints, systems, prefixes: [...prefixes], uiImports: uiImports.length ? uiImports : ['@/components/ui', '@/components/ui/**', '**/components/ui/**'], components: new Map(), resolveImport: (specifier, importer) => (resolver ??= createImportResolver(root))(specifier, importer) };
  projects.set(key, project);
  // Configurations are reused by editors; keep a bounded set rather than a compiler per linted file.
  if (projects.size > 24) projects.delete(projects.keys().next().value!);
  return project;
}

export function preparedProject(context: any): DesignProject {
  const key = context.settings?.gooduiNativeProject;
  const project = typeof key === 'string' ? projects.get(key) : undefined;
  if (!project) throw new PolicyError('DESIGN_ENGINE_NOT_PREPARED', translatePluginMessage('GoodUI design rules need await createConfig({rootDir,...}). Reload the ESLint configuration to prepare the native engine.', contextLocale(context)));
  for (const [file, expected] of project.fingerprints) {
    if (!existsSync(file) || fingerprint(file) !== expected) throw new PolicyError('DESIGN_ENGINE_STALE', translatePluginMessage(`Design source changed: ${relativePath(project.root, file)}. Reload/restart ESLint so createConfig can prepare the current theme; goodui check and MCP lint prepare it on each run.`, contextLocale(context)));
  }
  return project;
}

function staticProperty(node: AstNode): string | undefined { return node.computed ? typeof node.key?.value === 'string' ? node.key.value : undefined : node.key?.name ?? node.key?.value; }

/** Basic local/barrel resolution, deliberately bounded rather than whole-program inference. */
export function componentDetails(project: DesignProject, binding: ImportedBinding, importer: string): ComponentDetails | undefined {
  if (project.options.ignoreImports && matchesPattern(binding.source, project.options.ignoreImports)) return undefined;
  let target: string;
  try { target = project.resolveImport(binding.source, importer); } catch { return undefined; }
  const recognized = matchesPattern(binding.source, project.uiImports) || matchesFile(target, project.uiImports) || /(?:^|\/)components\/ui\//.test(target);
  const localTarget = resolve(project.root, target);
  let name = binding.name === 'default' ? basename(target).replace(/\.[^.]+$/, '').replace(/(^|-)(\w)/g, (_match, _separator: string, letter: string) => letter.toUpperCase()) : binding.name;
  const key = `${target}:${name}`;
  const cached = project.components.get(key);
  if (cached) return cached;
  const visited = new Set<string>();
  function inspect(file: string, exportName: string, depth: number): ComponentDetails | undefined {
    if (depth > 4 || !existsSync(file) || !/\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(file)) return undefined;
    try { file = resolveProjectPathSync(project.root, file); } catch { return undefined; }
    const identity = `${file}:${exportName}`;
    if (visited.has(identity)) return undefined;
    visited.add(identity);
    let code = readFileSync(file, 'utf8');
    project.fingerprints.set(file, fingerprint(file));
    const sfc = /\.(vue|svelte)$/.test(file);
    if (sfc) code = [...code.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).join('\n');
    let ast: any;
    try { ast = tsParser.parse(code, { filePath: sfc ? `${file}.ts` : file, loc: true, range: true, ecmaFeatures: { jsx: true } }); } catch { return undefined; }
    const declarations = new Map<string, any>();
    for (const statement of ast.body) {
      const declaration = statement.declaration ?? statement;
      if (declaration.id?.name) declarations.set(declaration.id.name, declaration);
      for (const item of declaration.declarations ?? []) if (item.id?.name) declarations.set(item.id.name, item);
    }
    let local: string | undefined;
    for (const statement of ast.body) {
      if (statement.type === 'ExportNamedDeclaration') {
        const specifier = statement.specifiers?.find((item: any) => (item.exported.name ?? item.exported.value) === exportName);
        if (specifier && statement.source) {
          try { return inspect(resolve(project.root, project.resolveImport(statement.source.value, file)), specifier.local.name ?? specifier.local.value, depth + 1); } catch { return undefined; }
        }
        if (specifier) local = specifier.local.name ?? specifier.local.value;
        const declaration = statement.declaration;
        if (declaration?.id?.name === exportName || declaration?.declarations?.some((item: any) => item.id?.name === exportName)) local = exportName;
      }
      if (statement.type === 'ExportDefaultDeclaration' && exportName === 'default') {
        local = statement.declaration.name ?? statement.declaration.id?.name ?? 'default';
        if (!declarations.has(local!)) declarations.set(local!, statement.declaration);
      }
    }
    if (sfc && exportName === 'default') local = 'default';
    if (!local) {
      for (const statement of ast.body) if (statement.type === 'ExportAllDeclaration' && statement.source) {
        const namespace = statement.exported?.name;
        if (namespace && !exportName.startsWith(`${namespace}.`)) continue;
        try {
          const found = inspect(resolve(project.root, project.resolveImport(statement.source.value, file)), namespace ? exportName.slice(namespace.length + 1) : exportName, depth + 1);
          if (found) return found;
        } catch { /* Keep looking for a matching export in the bounded barrel graph. */ }
      }
      return undefined;
    }
    const component = declarations.get(local);
    const details: ComponentDetails = { name: local === 'default' ? name : local, file, sizes: [], variants: [], axes: {} };
    const referenced = new Set<string>();
    function walk(node: any, callback: (node: any) => void): void {
      if (!node || typeof node !== 'object') return;
      callback(node);
      for (const [key, value] of Object.entries(node)) {
        if (['parent', 'loc', 'range', 'tokens', 'comments'].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(child => walk(child, callback)); else if (value && typeof value === 'object') walk(value, callback);
      }
    }
    walk(component, node => { if (node.type === 'Identifier') referenced.add(node.name); });
    // SFC props declarations are the component's public props; TSX follows only
    // referenced local prop types instead of borrowing every sibling's variants.
    const relevant = new Set<any>(component ? [component] : []);
    if (sfc) relevant.add(ast);
    for (let pass = 0; pass < 4; pass++) for (const [id, declaration] of declarations) {
      if (referenced.has(id) && /^(?:TSInterfaceDeclaration|TSTypeAliasDeclaration)$/.test(declaration.type) && !relevant.has(declaration)) {
        relevant.add(declaration);
        walk(declaration, node => { if (node.type === 'Identifier') referenced.add(node.name); });
      }
    }
    const factoryNames = new Set(['cva', 'tv', ...(project.options.variantFunctions ?? [])]);
    for (const statement of ast.body) if (statement.type === 'ImportDeclaration') for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier' && ['cva', 'tv'].includes(specifier.imported.name ?? specifier.imported.value)) factoryNames.add(specifier.local.name);
    }
    for (const [id, declaration] of declarations) {
      const init = declaration.init;
      const callee = init?.callee?.name ?? init?.callee?.property?.name;
      if (init?.type === 'CallExpression' && factoryNames.has(callee) && (referenced.has(id) || id.toLowerCase().startsWith(details.name.toLowerCase()))) relevant.add(init);
    }
    for (const node of relevant) walk(node, value => {
      if (value.type === 'Property' && staticProperty(value) === 'variants' && value.value?.type === 'ObjectExpression') {
        for (const axis of value.value.properties) {
          const axisName = staticProperty(axis);
          if (!axisName || axis.value?.type !== 'ObjectExpression') continue;
          const entries = axis.value.properties.map(staticProperty).filter((value: unknown) => typeof value === 'string') as string[];
          details.axes![axisName] = [...new Set([...(details.axes![axisName] ?? []), ...entries])].sort();
          if (axisName === 'size') details.sizes.push(...entries); else if (axisName === 'variant') details.variants.push(...entries);
        }
      }
      if (value.type === 'TSPropertySignature' && ['size', 'variant'].includes(staticProperty(value) ?? '')) {
        const type = value.typeAnnotation?.typeAnnotation;
        const values = (type?.types ?? [type]).filter((item: any) => item?.type === 'TSLiteralType' && typeof item.literal?.value === 'string').map((item: any) => item.literal.value);
        if (staticProperty(value) === 'size') details.sizes.push(...values); else details.variants.push(...values);
      }
    });
    return { ...details, sizes: [...new Set(details.sizes)].sort(), variants: [...new Set(details.variants)].sort() };
  }
  let details: ComponentDetails | undefined;
  if (existsSync(localTarget)) details = inspect(localTarget, binding.name, 0);
  const resolvedUi = details?.file && /(?:^|[\\/])components[\\/]ui[\\/]/.test(details.file);
  if (!recognized && !resolvedUi) return undefined;
  details ??= { name, sizes: [], variants: [] };
  project.components.set(key, details);
  return details;
}
