import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org/';
const hash = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

/** npm installs resolve the package document, which may lag its version endpoint. */
export function installMetadataVersion(document, pkg) {
  const published = document.versions?.[pkg.version];
  if (!published) return undefined;
  assert.equal(published.dist.integrity, pkg.integrity, `Install metadata integrity mismatch: ${pkg.name}`);
  return published;
}

/** Keep readiness and consumer checks ahead of every latest promotion. */
export async function publishStaged(packages, actions) {
  const existingVersions = await Promise.all(packages.map(pkg => actions.lookup(pkg)));
  for (const [index, pkg] of packages.entries()) {
    const existing = existingVersions[index];
    if (existing) {
      assert.equal(existing.dist.integrity, pkg.integrity, `${pkg.name}@${pkg.version} is immutable; bump its version before releasing changed contents.`);
    }
  }
  for (const [index, pkg] of packages.entries()) if (!existingVersions[index]) await actions.publish(pkg, 'next');
  await Promise.all(packages.map(pkg => actions.verify(pkg)));
  await actions.smoke();
  for (const pkg of packages) await actions.promote(pkg, 'latest');
}

function run(command, args, cwd = root) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${basename(command)} exited ${code ?? signal}`)));
  });
}

async function metadata(pkg) {
  const response = await fetch(`${registry}${pkg.name.replace('/', '%2f')}/${pkg.version}`, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Registry metadata failed: ${response.status} for ${pkg.name}`);
  return response.json();
}

async function verify(pkg) {
  const deadline = Date.now() + 15 * 60 * 1000;
  process.stdout.write(`Waiting for public ${pkg.name}@${pkg.version} and its tarball...\n`);
  while (Date.now() < deadline) {
    const published = await metadata(pkg);
    if (published) {
      assert.equal(published.dist.integrity, pkg.integrity, `Public integrity mismatch: ${pkg.name}`);
      const installation = await fetch(`${registry}${pkg.name.replace('/', '%2f')}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json', 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000),
      });
      if (!installation.ok && installation.status !== 404) throw new Error(`Install metadata failed: ${installation.status}`);
      const installable = installation.ok && installMetadataVersion(await installation.json(), pkg);
      if (!installable) {
        await new Promise(done => setTimeout(done, 15000));
        continue;
      }
      const url = new URL(published.dist.tarball);
      assert(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org', 'Unexpected tarball registry');
      const tarball = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (tarball.ok) {
        assert.equal(hash(Buffer.from(await tarball.arrayBuffer())), pkg.integrity, `Downloaded tarball mismatch: ${pkg.name}`);
        return;
      }
      if (tarball.status !== 404) throw new Error(`Tarball download failed: ${tarball.status}`);
    }
    await new Promise(done => setTimeout(done, 15000));
  }
  throw new Error(`Public registry readiness timed out: ${pkg.name}; latest was not promoted. Retry after processing completes.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--publish'].includes(arg)) || (args.includes('--publish') && args.includes('--dry-run'))) {
    throw new Error('Usage: pnpm release:plan | pnpm release:publish');
  }
  const packages = [];
  for (const directory of ['core', 'eslint-plugin', 'mcp', 'cli']) {
    const manifest = JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'));
    assert(/^\d+\.\d+\.\d+$/.test(manifest.version), 'latest releases require stable package versions');
    packages.push({ name: manifest.name, version: manifest.version, directory });
  }
  if (!args.includes('--publish')) {
    console.log(JSON.stringify({ registry, packages, stages: ['build and checks', 'pack', 'preflight immutable versions', 'publish missing versions to next', 'verify all public install metadata and tarballs', 'test:published', 'promote latest, CLI last'], writes: false }, null, 2));
    return;
  }
  const manager = process.env.npm_execpath;
  if (!manager) throw new Error('Run the release through pnpm release:publish.');
  const pnpm = args => /\.[cm]?js$/.test(manager) ? run(process.execPath, [manager, ...args]) : run(manager, args);
  const npmCli = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(existsSync);
  if (!npmCli) throw new Error('npm CLI is required.');
  const npm = args => run(process.execPath, [npmCli, ...args, `--registry=${registry}`, '--browser=false']);
  await pnpm(['check']);
  const temporary = await mkdtemp(join(tmpdir(), 'goodui-release-'));
  try {
    for (const pkg of packages) {
      await pnpm(['--dir', join(root, 'packages', pkg.directory), 'pack', '--pack-destination', temporary]);
      pkg.tarball = join(temporary, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
      pkg.integrity = hash(await readFile(pkg.tarball));
    }
    await publishStaged(packages, {
      lookup: metadata,
      publish: (pkg, tag) => npm(['publish', pkg.tarball, '--tag', tag, '--access', 'public', '--ignore-scripts']),
      verify,
      smoke: () => pnpm(['test:published']),
      promote: async (pkg, tag) => {
        const response = await fetch(`${registry}${pkg.name.replace('/', '%2f')}?release=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Cannot read dist-tags: ${pkg.name}`);
        const latest = (await response.json())['dist-tags']?.latest;
        if (latest === pkg.version) return;
        if (latest && /^\d+\.\d+\.\d+$/.test(latest)) {
          const current = latest.split('.').map(Number), candidate = pkg.version.split('.').map(Number);
          const first = current.findIndex((value, index) => value !== candidate[index]);
          assert(first < 0 || current[first] < candidate[first], `Refusing to downgrade ${pkg.name} latest from ${latest}`);
        }
        await npm(['dist-tag', 'add', `${pkg.name}@${pkg.version}`, tag]);
      },
    });
  } finally {
    const actual = realpathSync(temporary), parent = realpathSync(tmpdir());
    assert(dirname(actual).toLowerCase() === parent.toLowerCase() && basename(actual).startsWith('goodui-release-'), 'Unexpected temporary release directory');
    await rm(actual, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
