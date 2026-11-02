import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { PolicyError, resolveProjectPathSync } from '@pixelhize/goodui-core';

export function slash(value: string): string { return value.replaceAll('\\', '/'); }

export function relativePath(root: string, file: string): string {
  return slash(relative(root, file));
}

/** Reads JSON/JSONC compiler configuration; never imports project JavaScript. */
export function createImportResolver(root: string): (specifier: string, importer: string) => string {
  const foundConfig = ['tsconfig.json', 'jsconfig.json'].map(name => resolve(root, name)).find(existsSync);
  const configPath = foundConfig ? resolveProjectPathSync(root, foundConfig) : undefined;
  let options: ts.CompilerOptions = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler };
  let pathsBase = root;
  if (configPath) {
    const config = ts.readConfigFile(configPath, file => readFileSync(file, 'utf8'));
    if (config.error) throw configError(config.error);
    const host: ts.ParseConfigHost = { ...ts.sys, readFile(file) {
      if (existsSync(file)) {
        const real = realpathSync(file);
        const rel = relative(root, real);
        if ((isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) && !slash(real).includes('/node_modules/')) {
          throw new PolicyError('CONFIG_OUTSIDE_PROJECT', `Compiler configuration extends a file outside the project: ${file}`);
        }
      }
      return ts.sys.readFile(file);
    } };
    const parsed = ts.parseJsonConfigFileContent(config.config, host, dirname(configPath), undefined, configPath);
    const errors = parsed.errors.filter(error => error.code !== 18003 && error.code !== 18002);
    if (errors.length) throw configError(errors[0]!);
    options = parsed.options;
    pathsBase = options.baseUrl ?? (options as ts.CompilerOptions & { pathsBasePath?: string }).pathsBasePath ?? dirname(configPath);
  }
  const moduleCache = ts.createModuleResolutionCache(root, file => file, options);

  function existing(base: string): string | undefined {
    const candidates = [base, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.d.ts'].map(ext => base + ext),
      ...['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'].map(ext => resolve(base, `index${ext}`))];
    return candidates.find(file => existsSync(file) && statSync(file).isFile());
  }

  return (specifier, importer) => {
    // Component imports often carry Vite resource queries. They still identify the same source file.
    const clean = specifier.replace(/[?#].*$/, '');
    let resolvedFile: string | undefined;
    if (clean.startsWith('.')) resolvedFile = existing(resolve(dirname(importer), clean));
    if (!resolvedFile) {
      const keys = Object.keys(options.paths ?? {}).sort((a, b) => {
        if (!a.includes('*')) return b.includes('*') ? -1 : b.length - a.length;
        if (!b.includes('*')) return 1;
        return b.indexOf('*') - a.indexOf('*') || b.length - a.length;
      });
      for (const key of keys) {
        const star = key.indexOf('*');
        const matched = star === -1 ? clean === key : clean.startsWith(key.slice(0, star)) && clean.endsWith(key.slice(star + 1));
        if (!matched) continue;
        const wildcard = star === -1 ? '' : clean.slice(star, clean.length - (key.length - star - 1));
        for (const target of options.paths![key]!) {
          resolvedFile = existing(resolve(pathsBase, target.replace('*', wildcard)));
          if (resolvedFile) break;
        }
        if (resolvedFile) break;
      }
    }
    if (!resolvedFile) resolvedFile = ts.resolveModuleName(clean, importer, options, ts.sys, moduleCache).resolvedModule?.resolvedFileName;
    if (resolvedFile) {
      const rel = relativePath(root, realpathSync(resolvedFile));
      // Dependencies have public module names, not package-manager-specific installation paths.
      if (!rel.startsWith('../') && !isAbsolute(rel) && !rel.split('/').includes('node_modules')) return rel;
      if (clean.startsWith('.')) return rel;
      return specifier;
    }
    if (clean.startsWith('.')) {
      throw new PolicyError('UNRESOLVED_IMPORT', `Cannot resolve import ${JSON.stringify(specifier)} from ${relativePath(root, importer)}.`);
    }
    // A missing configured alias must not silently turn into an external dependency.
    if (Object.keys(options.paths ?? {}).some(key => key.includes('*') ? clean.startsWith(key.slice(0, key.indexOf('*'))) : clean === key)) {
      throw new PolicyError('UNRESOLVED_IMPORT', `Cannot resolve configured alias ${JSON.stringify(specifier)} from ${relativePath(root, importer)}.`);
    }
    return specifier;
  };
}

function configError(error: ts.Diagnostic): PolicyError {
  return new PolicyError('INVALID_COMPILER_CONFIG', ts.flattenDiagnosticMessageText(error.messageText, '\n'));
}
