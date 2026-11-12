// Which page to run, chosen from the page address: manual driving by default, or the population training view
// (P2-05) with `?mode=train`, or the track editor (P4-02) with `?mode=edit`. Anything else keeps the default, so the normal page is unchanged.

export type PageMode = 'drive' | 'train' | 'edit';

/** 'train' or 'edit' if the query string's last `mode` parameter is exactly that; otherwise 'drive'. */
export function pageMode(search: string): PageMode {
  const modes = new URLSearchParams(search).getAll('mode');
  const last = modes[modes.length - 1]?.trim();
  return last === 'train' || last === 'edit' ? last : 'drive';
}
