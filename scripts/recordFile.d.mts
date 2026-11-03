export declare class OutputExistsError extends Error {}
export declare class RollbackIncompleteError extends Error {}
export declare class OutputDirectoryError extends Error {}
export declare function checkOutputEntries(outDir: string, names: readonly string[], force: boolean): void;
export declare function writeRecordFile(out: string, text: string, force: boolean): void;
export interface PairOps {
  link(existing: string, created: string): void;
  rename(from: string, to: string): void;
  lstat(path: string): { ino: number };
  unlink(path: string): void;
}
export declare function writeRecordPair(entries: readonly { readonly out: string; readonly text: string }[], force: boolean, ops?: PairOps): void;
