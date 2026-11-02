import { describe, expect, it } from 'vitest';
// @ts-expect-error The release runner is a plain Node script.
import { publishStaged, installMetadataVersion } from '../scripts/release.mjs';

describe('staged public release', () => {
  const packages = ['core', 'plugin', 'mcp', 'cli'].map(name => ({ name, version: '0.2.0', integrity: `sha512-${name}` }));
  it('does not mistake a ready version endpoint for npm install readiness', () => {
    const pkg = packages[0]!;
    expect(installMetadataVersion({ version: pkg.version, dist: { integrity: pkg.integrity } }, pkg)).toBeUndefined();
    expect(installMetadataVersion({ versions: { '0.1.0': { dist: { integrity: 'older' } } } }, pkg)).toBeUndefined();
  });
  it('requires the expected integrity in the install metadata too', () => {
    const pkg = packages[0]!;
    const entry = { dist: { integrity: pkg.integrity } };
    expect(installMetadataVersion({ versions: { [pkg.version]: entry } }, pkg)).toBe(entry);
    expect(() => installMetadataVersion({ versions: { [pkg.version]: { dist: { integrity: 'wrong' } } } }, pkg)).toThrow('integrity mismatch');
  });
  function fixture() {
    const events: string[] = [];
    return { events, actions: {
      lookup: async () => undefined,
      publish: async (pkg: {name:string}, tag: string) => { events.push(`publish:${pkg.name}:${tag}`); },
      verify: async (pkg: {name:string}) => { events.push(`ready:${pkg.name}`); },
      smoke: async () => { events.push('consumers'); },
      promote: async (pkg: {name:string}, tag: string) => { events.push(`promote:${pkg.name}:${tag}`); },
    } };
  }
  it('waits for public dependencies and consumers before promoting latest, CLI last', async () => {
    const {events, actions} = fixture();
    await publishStaged(packages, actions);
    expect(events).toEqual(packages.map(pkg => `publish:${pkg.name}:next`).concat(packages.map(pkg => `ready:${pkg.name}`), 'consumers', packages.map(pkg => `promote:${pkg.name}:latest`)));
  });
  it('keeps candidates off latest if the MCP dependency remains unavailable', async () => {
    const {events, actions} = fixture();
    actions.verify = async pkg => { if (pkg.name === 'mcp') throw new Error('not publicly available'); events.push(`ready:${pkg.name}`); };
    await expect(publishStaged(packages, actions)).rejects.toThrow('not publicly available');
    expect(events).toContain('publish:cli:next');
    expect(events.some(event => /promote|consumers/.test(event))).toBe(false);
  });
  it('does not promote any latest tag if the public installation test fails', async () => {
    const {events, actions} = fixture();
    actions.smoke = async () => { throw new Error('install failed'); };
    await expect(publishStaged(packages, actions)).rejects.toThrow('install failed');
    expect(events.some(event => event.startsWith('promote'))).toBe(false);
  });
  it('preserves immutable published versions and rejects changed tarballs', async () => {
    const {events, actions} = fixture();
    const existing = { ...actions, lookup: async () => ({ dist: {integrity: 'different'} }) };
    await expect(publishStaged(packages, existing)).rejects.toThrow('immutable');
    expect(events).toEqual([]);
  });
  it('preflights every immutable version before publishing any missing candidate', async () => {
    const {events, actions} = fixture();
    await expect(publishStaged(packages, { ...actions, lookup: async (pkg: { name: string }) => pkg.name === 'mcp' ? { dist: { integrity: 'different' } } : undefined })).rejects.toThrow('immutable');
    expect(events).toEqual([]);
  });
  it('verifies existing matching releases without republishing them', async () => {
    const {events, actions} = fixture();
    await publishStaged(packages, { ...actions, lookup: async (pkg: {integrity:string}) => ({dist:{integrity:pkg.integrity}}) });
    expect(events.some(event => event.startsWith('publish'))).toBe(false);
    expect(events).toContain('consumers');
  });
});
