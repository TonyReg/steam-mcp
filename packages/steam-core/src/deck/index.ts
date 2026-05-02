import type { DeckStatus } from '../types.js';
import { isRecord, toNumber } from '../utils.js';

export class DeckStatusProvider {
  private readonly cache = new Map<number, DeckStatus>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getStatus(appId: number): Promise<DeckStatus> {
    const cached = this.cache.get(appId);
    if (cached) {
      return cached;
    }

    const url = `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appId}`;
    const response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      this.cache.set(appId, 'unknown');
      return 'unknown';
    }

    const payload = (await response.json()) as unknown;
    const status = normalizeDeckStatus(payload);
    this.cache.set(appId, status);
    return status;
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
