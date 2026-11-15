export declare const USAGE: string;
export declare const COMMANDS: readonly string[];
export declare class UsageError extends Error {}
export declare class ArgumentError extends UsageError {}
export interface E6Options {
  command: string;
  files: string[];
  e5Manifest: string | null;
  e5Record: string | null;
  e4Manifest: string | null;
  e4Dir: string | null;
  ledger: string | null;
  out: string | null;
  outDir: string | null;
  force: boolean;
  openHeldOut: boolean;
}
export declare function parseArgs(argv: readonly string[]): E6Options;
export declare function readJson(path: string, what: string): unknown;
export declare function readE4Records(dir: string, seeds: readonly number[]): { records: unknown[]; paths: string[] };
export interface E6Deps {
  study: Record<string, unknown>;
  access: Record<string, (...args: never[]) => unknown>;
  registry: unknown;
  engine(): { name: string; version: string; v8: string };
  source(): { revision: string | null; dirty: boolean | null; unavailableReason: string | null; appVersion: string };
  now(): string;
  log(line: string): void;
  warn(line: string): void;
}
export declare function execute(options: E6Options, deps: E6Deps): Promise<number>;
