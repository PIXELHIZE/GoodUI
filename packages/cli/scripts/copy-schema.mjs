import { copyFile, cp, readdir, readFile, writeFile } from 'node:fs/promises';

await copyFile(new URL(import.meta.resolve('@pixelhize/goodui-core/schema.json')), new URL('../schema.json', import.meta.url));
await copyFile(new URL('../../../SETUP.md', import.meta.url), new URL('../SETUP.md', import.meta.url));
await cp(new URL('../../../docs/', import.meta.url), new URL('../docs/', import.meta.url), { recursive: true });
await cp(new URL('../../../examples/', import.meta.url), new URL('../examples/', import.meta.url), { recursive: true });
const examples = new URL('../examples/', import.meta.url);
for (const name of await readdir(examples)) {
  if (!name.endsWith('.json')) continue;
  const target = new URL(name, examples);
  const policy = JSON.parse(await readFile(target, 'utf8'));
  policy.$schema = '../schema.json';
  await writeFile(target, JSON.stringify(policy, null, 2) + '\n');
}
