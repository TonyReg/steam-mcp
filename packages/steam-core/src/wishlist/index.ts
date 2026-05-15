import type { OfficialStoreClient } from '../official-store/index.js';
import type {
  OfficialWishlistItemSummary,
  WishlistAnnotation,
  WishlistListOptions,
  WishlistListResult
} from '../types.js';

export class WishlistService {
  constructor(private readonly officialStoreClient: OfficialStoreClient) {}

  async list(options: WishlistListOptions): Promise<WishlistListResult> {
    const [countResult, wishlistResult] = await Promise.all([
      this.officialStoreClient.getWishlistItemCount({ steamId: options.steamId }),
      this.officialStoreClient.getWishlist({ steamId: options.steamId })
    ]);

    return {
      totalCount: countResult.count,
      items: wishlistResult.items
    };
  }
}

export function createWishlistAnnotationMap(items: readonly OfficialWishlistItemSummary[]): Map<number, WishlistAnnotation> {
  return new Map(items.map((item) => [
    item.appId,
    {
      listed: true,
      ...(item.priority === undefined ? {} : { priority: item.priority }),
      ...(item.dateAdded === undefined ? {} : { dateAdded: item.dateAdded })
    }
  ]));
}
