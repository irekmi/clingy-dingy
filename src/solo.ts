// Solo run: the player's personal stats, kept in this browser (localStorage).
// Verified times of logged-in players also reach the global ranking through the server.

const KEY = 'cd_solo_v1';

export interface SoloStats {
  /** best finish time in ms */
  best: number | null;
  /** finished runs so far */
  attempts: number;
  /** the latest runs, newest first */
  recent: number[];
}

/**
 * Planned (see docs/ROADMAP.md): show an ad every this many attempts, on the results screen only.
 * Not wired to any ad yet; `soloAdDue` is the single place to hook it up.
 */
export const SOLO_AD_EVERY = 5;
export const soloAdDue = (attempts: number) => attempts > 0 && attempts % SOLO_AD_EVERY === 0;

const empty = (): SoloStats => ({ best: null, attempts: 0, recent: [] });

export function getSolo(): SoloStats {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s.attempts === 'number' && Array.isArray(s.recent)) {
      return { best: typeof s.best === 'number' ? s.best : null, attempts: s.attempts, recent: s.recent.filter((x: unknown) => typeof x === 'number').slice(0, 8) };
    }
  } catch {
    /* no storage or broken data: start from scratch */
  }
  return empty();
}

/** Records a finished run; says whether it is a new personal record. */
export function recordSolo(ms: number): { record: boolean; prevBest: number | null; stats: SoloStats } {
  const prev = getSolo();
  const record = prev.best === null || ms < prev.best;
  const stats: SoloStats = {
    best: record ? ms : prev.best,
    attempts: prev.attempts + 1,
    recent: [ms, ...prev.recent].slice(0, 8),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
  return { record, prevBest: prev.best, stats };
}
