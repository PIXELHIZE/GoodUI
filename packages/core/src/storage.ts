import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { PolicyError, definePolicy, validatePolicy } from "./policy.js";
import { localizeMessage, type LocaleOptions } from './locale.js';
import type { Policy, PolicySnapshot, PolicyWriteOptions, ResolveProjectPathOptions } from "./types.js";

export const DEFAULT_POLICY_PATH = "goodui.policy.json";

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function entryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new PolicyError("INVALID_PATH", `Cannot inspect project path: ${path}`);
  }
}

/** Resolves existing ancestors as well as the final path to prevent symlink escapes. */
function resolveProjectPathInternal(
  root: string,
  path: string,
  options: ResolveProjectPathOptions = {},
): string {
  let realRoot: string;
  const requestedRoot = resolve(root);
  try {
    realRoot = realpathSync(requestedRoot);
    if (!statSync(realRoot).isDirectory()) throw new Error("Project root is not a directory.");
  } catch {
    throw new PolicyError("INVALID_PROJECT_ROOT", `Project root must be an existing directory: ${requestedRoot}`);
  }

  const candidate = resolve(requestedRoot, path);
  if (!isInside(requestedRoot, candidate) && !isInside(realRoot, candidate)) {
    throw new PolicyError("PATH_OUTSIDE_PROJECT", `Path is outside the project root: ${path}`);
  }

  let ancestor = candidate;
  const missing: string[] = [];
  while (!entryExists(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new PolicyError("PATH_NOT_FOUND", `Path does not exist: ${path}`);
    missing.unshift(relative(parent, ancestor));
    ancestor = parent;
  }
  let realAncestor: string;
  try {
    realAncestor = realpathSync(ancestor);
    if (missing.length > 0 && !statSync(realAncestor).isDirectory()) throw new Error("Parent is not a directory.");
  } catch {
    throw new PolicyError("INVALID_PATH", `Cannot resolve project path: ${path}`);
  }
  const resolved = resolve(realAncestor, ...missing);
  if (!isInside(realRoot, resolved)) {
    throw new PolicyError("PATH_OUTSIDE_PROJECT", `Path resolves outside the project root: ${path}`);
  }
  if (missing.length > 0 && !options.allowMissing) {
    throw new PolicyError("PATH_NOT_FOUND", `Path does not exist: ${path}`);
  }
  return resolved;
}

function localizedError(error: unknown, options: LocaleOptions): never {
  if (!(error instanceof PolicyError) || (options.locale ?? 'en') === 'en') throw error;
  const details = error.details && { ...error.details };
  if (details && Array.isArray(details.errors)) {
    details.errors = details.errors.map(value => typeof value === 'string' ? localizeMessage(value, 'ko') : value);
  }
  throw new PolicyError(error.code, localizeMessage(error.message, 'ko'), details);
}

export function resolveProjectPathSync(root: string, path: string, options: ResolveProjectPathOptions = {}): string {
  try { return resolveProjectPathInternal(root, path, options); }
  catch (error) { return localizedError(error, options); }
}

export async function resolveProjectPath(
  root: string,
  path: string,
  options: ResolveProjectPathOptions = {},
): Promise<string> {
  return resolveProjectPathSync(root, path, options);
}

function revisionOf(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseSnapshot(bytes: Buffer, path: string): PolicySnapshot {
  const revision = revisionOf(bytes);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new PolicyError("INVALID_POLICY", `Policy is not valid JSON: ${path}`, { path, revision });
  }
  const result = validatePolicy(value);
  if (!result.valid || !result.policy) {
    throw new PolicyError("INVALID_POLICY", `Invalid policy: ${result.errors.join("; ")}`, {
      path,
      revision,
      errors: result.errors,
    });
  }
  return { policy: result.policy, revision, path };
}

function policyPathForRead(root: string, policyPath: string): string {
  try {
    return resolveProjectPathSync(root, policyPath);
  } catch (error) {
    if (error instanceof PolicyError && error.code === "PATH_NOT_FOUND") {
      throw new PolicyError("POLICY_NOT_FOUND", `Policy file does not exist: ${policyPath}`);
    }
    throw error;
  }
}

function readPolicySyncInternal(root: string, policyPath = DEFAULT_POLICY_PATH): PolicySnapshot {
  const path = policyPathForRead(root, policyPath);
  try {
    return parseSnapshot(readFileSync(path), path);
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    throw new PolicyError("POLICY_READ_FAILED", `Cannot read policy file: ${path}`);
  }
}

async function readPolicyInternal(root: string, policyPath = DEFAULT_POLICY_PATH): Promise<PolicySnapshot> {
  const path = policyPathForRead(root, policyPath);
  try {
    return parseSnapshot(await readFile(path), path);
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    throw new PolicyError("POLICY_READ_FAILED", `Cannot read policy file: ${path}`);
  }
}

export function readPolicySync(root: string, policyPath = DEFAULT_POLICY_PATH, options: LocaleOptions = {}): PolicySnapshot {
  try { return readPolicySyncInternal(root, policyPath); }
  catch (error) { return localizedError(error, options); }
}

export async function readPolicy(root: string, policyPath = DEFAULT_POLICY_PATH, options: LocaleOptions = {}): Promise<PolicySnapshot> {
  try { return await readPolicyInternal(root, policyPath); }
  catch (error) { return localizedError(error, options); }
}

async function currentRevision(path: string): Promise<string | null> {
  try {
    return revisionOf(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new PolicyError("POLICY_READ_FAILED", `Cannot read policy file: ${path}`);
  }
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      return async () => {
        try { await unlink(lockPath); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new PolicyError("POLICY_WRITE_FAILED", `Cannot lock policy file: ${path}`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  throw new PolicyError("POLICY_LOCKED", `Policy is being edited, or a stale lock needs removal: ${lockPath}`);
}

/** Compare-and-swap writes serialize GoodUI writers and preserve the original on failure. */
async function writePolicyInternal(
  root: string,
  policy: Policy,
  options: PolicyWriteOptions,
): Promise<PolicySnapshot> {
  const stablePolicy = structuredClone(definePolicy(policy));
  const path = resolveProjectPathSync(root, options.policyPath ?? DEFAULT_POLICY_PATH, { allowMissing: true });
  await mkdir(dirname(path), { recursive: true });
  resolveProjectPathSync(root, dirname(path));
  const unlock = await acquireLock(path);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let temporaryExists = false;
  try {
    // Check again after acquiring the lock: another writer may have just committed.
    resolveProjectPathSync(root, path, { allowMissing: true });
    const actualRevision = await currentRevision(path);
    if (actualRevision !== options.expectedRevision) {
      throw new PolicyError("POLICY_CONFLICT", "Policy changed since it was read. Read it again before saving.", {
        path,
        expectedRevision: options.expectedRevision,
        actualRevision,
      });
    }

    const bytes = `${JSON.stringify(stablePolicy, null, 2)}\n`;
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(bytes, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    resolveProjectPathSync(root, path, { allowMissing: true });
    if (await currentRevision(path) !== actualRevision) {
      throw new PolicyError("POLICY_CONFLICT", "Policy was edited while saving. Read it again before saving.", { path });
    }
    await rename(temporaryPath, path);
    temporaryExists = false;
    return { policy: stablePolicy, revision: revisionOf(bytes), path };
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    throw new PolicyError("POLICY_WRITE_FAILED", `Cannot write policy file: ${path}`);
  } finally {
    if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
    await unlock();
  }
}

export async function writePolicy(root: string, policy: Policy, options: PolicyWriteOptions): Promise<PolicySnapshot> {
  try { return await writePolicyInternal(root, policy, options); }
  catch (error) { return localizedError(error, options); }
}
