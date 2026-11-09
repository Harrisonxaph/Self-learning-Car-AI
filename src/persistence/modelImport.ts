// Importing a champion from the text of a file (P3-06). Pure: it reads text and returns a result; it writes nothing, so a
// refusal cannot have a side effect. The caller checks the file's own size before reading it; the same cap is applied
// here before any parsing.
import { migrateToCurrent, MIGRATIONS, type MigrationRegistry } from './migrations';
import { compatibility, MAX_MODEL_BYTES, validateModel, type ModelDocument, type TrackRegistryEntry } from './modelFormat';

export interface ImportOptions {
  readonly registry: readonly TrackRegistryEntry[];
  readonly migrations?: MigrationRegistry;
}

export type ImportResult =
  | { readonly ok: true; readonly model: ModelDocument; readonly drivable: boolean; readonly warnings: readonly string[]; readonly migratedFrom: number | null }
  | { readonly ok: false; readonly errors: readonly string[] };

/** How many of a refusal's errors a sentence names. */
export const MAX_ERRORS_SHOWN = 3;

/** One short sentence for a refusal: the first few errors and a count of the rest. */
export function describeRefusal(errors: readonly string[]): string {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN).join(' ');
  const more = errors.length - MAX_ERRORS_SHOWN;
  return `Nothing was imported. ${shown}${more > 0 ? ` (and ${more} more problem${more === 1 ? '' : 's'})` : ''}`;
}

export function importModelText(text: string, options: ImportOptions): ImportResult {
  try {
    return importUnchecked(text, options);
  } catch {
    return { ok: false, errors: ['This file could not be checked.'] };
  }
}

function importUnchecked(text: string, options: ImportOptions): ImportResult {
  if (typeof text !== 'string') return { ok: false, errors: ["This isn't a valid model file (it is not text)."] };
  if (text.length > MAX_MODEL_BYTES) return { ok: false, errors: ['This file is larger than the 1 MiB limit for a champion.'] };
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === '') return { ok: false, errors: ['This file is empty.'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, errors: ["This isn't a valid model file (it is not readable JSON)."] };
  }
  const migrated = migrateToCurrent(parsed, options.migrations ?? MIGRATIONS);
  if (!migrated.ok) return { ok: false, errors: [migrated.error] };
  const checked = validateModel(migrated.value, options.registry);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const c = compatibility(checked.model);
  return { ok: true, model: checked.model, drivable: c.drivable, warnings: c.drivable ? c.warnings : c.reasons, migratedFrom: migrated.migratedFrom };
}
