// A tiny token-bucket rate limiter — one bucket per WebSocket connection.
//
// Untrusted browsers can flood the room with messages. A token bucket gives a
// generous burst (capacity) while capping the sustained rate (refill/sec), and
// is cheap and allocation-free on the hot path. Time is injected so the logic
// is deterministic and unit-testable without real clocks.

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private tokens: number;
  private last: number;

  constructor(capacity: number, refillPerSec: number, now: number) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.last = now;
  }

  /** Try to spend `cost` tokens at time `now` (ms). Returns false if too few. */
  take(now: number, cost = 1): boolean {
    const elapsedSec = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.last = now;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** Remaining tokens (for diagnostics/tests). */
  available(now: number): number {
    const elapsedSec = Math.max(0, now - this.last) / 1000;
    return Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
  }
}
