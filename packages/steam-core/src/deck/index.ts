import type { DeckStatus } from '../types.js';
import { isRecord, toNumber } from '../utils.js';

const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;

export class DeckStatusProvider {
  private readonly cache = new Map<number, DeckStatus>();
  private readonly inFlight = new Map<number, Promise<DeckStatus>>();
  private readonly maxConcurrentRequests: number;
  private activeRequests = 0;
  private readonly waitingResolvers: Array<() => void> = [];

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    maxConcurrentRequests = DEFAULT_MAX_CONCURRENT_REQUESTS
  ) {
    this.maxConcurrentRequests = Math.max(1, Math.floor(maxConcurrentRequests));
  }

  async getStatus(appId: number): Promise<DeckStatus> {
    const cached = this.cache.get(appId);
    if (cached) {
      return cached;
    }

    const inFlight = this.inFlight.get(appId);
    if (inFlight) {
      return inFlight;
    }

    const request = this.fetchStatus(appId).finally(() => {
      this.inFlight.delete(appId);
    });
    this.inFlight.set(appId, request);
    return request;
  }

  private async fetchStatus(appId: number): Promise<DeckStatus> {
    await this.acquireSlot();
    try {
      const url = `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appId}`;
      const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        return 'unknown';
      }

      const payload = (await response.json()) as unknown;
      const status = normalizeDeckStatus(payload);
      this.cache.set(appId, status);
      return status;
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < this.maxConcurrentRequests) {
      this.activeRequests += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waitingResolvers.push(() => {
        this.activeRequests += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeRequests -= 1;
    const next = this.waitingResolvers.shift();
    next?.();
  }
}

export function normalizeDeckStatus(payload: unknown): DeckStatus {
  if (!isRecord(payload)) {
    return 'unknown';
  }

  const resolvedCategory = readResolvedCategory(payload);
  switch (resolvedCategory) {
    case 3:
      return 'verified';
    case 2:
      return 'playable';
    case 1:
      return 'unsupported';
    default:
      return 'unknown';
  }
}

function readResolvedCategory(payload: Record<string, unknown>): number | undefined {
  const direct = toNumber(payload.resolved_category);
  if (direct !== undefined) {
    return direct;
  }

  const results = payload.results;
  if (isRecord(results)) {
    const nested = toNumber(results.resolved_category);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}
