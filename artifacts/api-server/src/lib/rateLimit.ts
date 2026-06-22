// In-memory fixed-window rate limiter.
// ─────────────────────────────────────────────────────────────────────────────
// Deliberately simple and process-local (no Redis): the API runs as a single
// instance and this is a safety net, not a billing meter. Its job is to stop a
// runaway client polling loop (or a buggy retry storm) from hammering an
// upstream resource — e.g. logging into a Reolink camera and pulling frames far
// faster than the intended ~1 request / 1.5s.
//
// Keys are caller-supplied (e.g. `snapshot:<recipientUid>`), so the same limiter
// instance can guard several logical buckets. Stale windows are swept lazily so
// the map can't grow unbounded.

interface WindowState {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still permitted in the current window (>= 0). */
  remaining: number;
  /** Whole seconds until the current window resets. */
  retryAfterSec: number;
}

export function createFixedWindowLimiter(opts: {
  windowMs: number;
  max: number;
}): (key: string) => RateLimitResult {
  const { windowMs, max } = opts;
  const windows = new Map<string, WindowState>();

  // Opportunistic cleanup — only walk the map once it has grown, so the common
  // path stays O(1).
  function sweep(now: number): void {
    if (windows.size < 1000) return;
    for (const [k, w] of windows) {
      if (w.resetAt <= now) windows.delete(k);
    }
  }

  return function check(key: string): RateLimitResult {
    const now = Date.now();
    sweep(now);
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    return {
      allowed: w.count <= max,
      remaining: Math.max(0, max - w.count),
      retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
    };
  };
}
