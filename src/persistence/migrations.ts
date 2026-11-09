// Migration hook for model files (P3-06). Schema version 1 is the first version, so the real registry is empty and no
// migration is claimed to exist (docs/MODEL_FORMAT.md). The hook is exercised by tests with a synthetic registry.
import { MODEL_SCHEMA_VERSION } from './modelFormat';

/** Turns a document of schema `from` into one of schema `from + 1`. It must be pure: never mutate `input`. */
export type Migration = (input: Readonly<Record<string, unknown>>) => Record<string, unknown>;
/** Migration functions keyed by the schema version they read. */
export type MigrationRegistry = Readonly<Record<number, Migration>>;

/** No older schema exists yet. */
export const MIGRATIONS: MigrationRegistry = Object.freeze({});

export type MigrationResult =
  | { readonly ok: true; readonly value: unknown; readonly migratedFrom: number | null }
  | { readonly ok: false; readonly error: string };

const isObj = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Brings an older document up to the current schema, one step at a time. A value that is not an object, has no usable
 * `schemaVersion`, or is already current or newer passes through unchanged (the validator then accepts or refuses it).
 * A missing or throwing step refuses the file; the input is never modified.
 */
export function migrateToCurrent(value: unknown, registry: MigrationRegistry = MIGRATIONS, target: number = MODEL_SCHEMA_VERSION): MigrationResult {
  if (!isObj(value)) return { ok: true, value, migratedFrom: null };
  const start = value.schemaVersion;
  if (typeof start !== 'number' || !Number.isInteger(start) || start >= target) return { ok: true, value, migratedFrom: null };
  let current: Readonly<Record<string, unknown>> = value;
  for (let version = start; version < target; version += 1) {
    const step = Object.prototype.hasOwnProperty.call(registry, version) ? registry[version] : undefined;
    if (typeof step !== 'function') return { ok: false, error: `This file uses schema ${start}, which this app cannot convert: there is no migration from schema ${version}.` };
    let next: unknown;
    try {
      next = step(current);
    } catch {
      return { ok: false, error: `This file uses schema ${start}, and converting it from schema ${version} failed.` };
    }
    if (!isObj(next)) return { ok: false, error: `This file uses schema ${start}, and converting it from schema ${version} did not produce a model.` };
    current = { ...next, schemaVersion: version + 1 };
  }
  return { ok: true, value: current, migratedFrom: start };
}
