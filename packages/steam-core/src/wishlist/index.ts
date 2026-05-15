import type { OfficialStoreClient } from '../official-store/index.js';
import type { StoreClient } from '../store/index.js';
import type {
  OfficialWishlistItemSummary,
  StorePriceOverview,
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

export interface WishlistOnSaleOptions {
  steamId: string;
  limit?: number;
}

export interface WishlistOnSaleItem {
  appId: number;
  name?: string;
  type?: string;
  storeUrl?: string;
  priority?: number;
  dateAdded?: number;
  price: StorePriceOverview;
}

export interface WishlistOnSaleResult {
  totalCount: number;
  onSaleCount: number;
  unknownPriceCount: number;
  items: WishlistOnSaleItem[];
}

export class WishlistSaleService {
  constructor(
    private readonly wishlistService: Pick<WishlistService, 'list'>,
    private readonly storeClient: Pick<StoreClient, 'getFreshAppDetails'>
  ) {}

  async listOnSale(options: WishlistOnSaleOptions): Promise<WishlistOnSaleResult> {
    const wishlist = await this.wishlistService.list({ steamId: options.steamId });
    const items: WishlistOnSaleItem[] = [];
    let onSaleCount = 0;
    let unknownPriceCount = 0;

    for (const wishlistItem of wishlist.items) {
      const details = await this.storeClient.getFreshAppDetails(wishlistItem.appId);
      const price = details?.priceOverview;
      if (!price) {
        unknownPriceCount += 1;
        continue;
      }

      if (price.discountPercent <= 0 || price.finalInCents >= price.initialInCents) {
        continue;
      }

      onSaleCount += 1;
      if (options.limit !== undefined && items.length >= options.limit) {
        continue;
      }

      items.push({
        appId: wishlistItem.appId,
        ...(details.name === undefined ? {} : { name: details.name }),
        ...(details.type === undefined ? {} : { type: details.type }),
        ...(details.storeUrl === undefined ? {} : { storeUrl: details.storeUrl }),
        ...(wishlistItem.priority === undefined ? {} : { priority: wishlistItem.priority }),
        ...(wishlistItem.dateAdded === undefined ? {} : { dateAdded: wishlistItem.dateAdded }),
        price
      });
    }

    return {
      totalCount: wishlist.totalCount,
      onSaleCount,
      unknownPriceCount,
      items
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
