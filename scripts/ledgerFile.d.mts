export declare class LedgerFileError extends Error {}
export interface LedgerLike {
  openings(): readonly unknown[];
  claim(opening: unknown): void;
}
export declare function createFileLedger(path: string, createMemoryLedger: (recorded: readonly unknown[]) => LedgerLike): LedgerLike;
