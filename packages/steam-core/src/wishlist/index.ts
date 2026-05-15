import type { OfficialStoreClient } from '../official-store/index.js';
import type { StoreClient } from '../store/index.js';
import type {
  DeckStatus,
  OfficialWishlistItemSummary,
  StoreAppDetails,
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

export interface WishlistEnrichedItem {
  appId: number;
  priority?: number;
  dateAdded?: number;
  details?: StoreAppDetails;
  deckStatus?: DeckStatus;
}

export interface WishlistDetailsOptions {
  steamId: string;
  limit?: number;
  includeDeckStatus?: boolean;
  priceFreshness?: 'cacheable' | 'fresh';
}

export interface WishlistDetailsResult {
  totalCount: number;
  items: WishlistEnrichedItem[];
  missingDetailsCount: number;
}

export interface WishlistDiscountSummaryOptions {
  steamId: string;
  limit?: number;
  minimumDiscountPercent?: number;
}

export interface WishlistDiscountSummaryItem {
  appId: number;
  name?: string;
  type?: 'game' | 'software' | 'dlc';
  storeUrl?: string;
  priority?: number;
  dateAdded?: number;
  price: StorePriceOverview;
  savingsInCents: number;
}

export interface WishlistDiscountCurrencySummary {
  currency?: string;
  discountedCount: number;
  totalInitialInCents: number;
  totalFinalInCents: number;
  totalSavingsInCents: number;
}

export interface WishlistDiscountSummaryResult {
  totalCount: number;
  pricedCount: number;
  discountedCount: number;
  unknownPriceCount: number;
  items: WishlistDiscountSummaryItem[];
  currencies: WishlistDiscountCurrencySummary[];
  metadata: {
    priceSource: 'live-public-appdetails';
    countsIgnoreLimit: true;
  };
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

export class WishlistEnrichmentService {
  constructor(
    private readonly wishlistService: Pick<WishlistService, 'list'>,
    private readonly storeClient: Pick<StoreClient, 'getCacheableAppDetails' | 'getFreshAppDetails'>,
    private readonly deckStatusProvider: { getStatus(appId: number): Promise<DeckStatus> }
  ) {}

  async listDetails(options: WishlistDetailsOptions): Promise<WishlistDetailsResult> {
    const wishlist = await this.wishlistService.list({ steamId: options.steamId });
    const wishlistItems = options.limit === undefined ? wishlist.items : wishlist.items.slice(0, options.limit);
    const items: WishlistEnrichedItem[] = [];
    let missingDetailsCount = 0;

    for (const wishlistItem of wishlistItems) {
      const details = options.priceFreshness === 'fresh'
        ? await this.storeClient.getFreshAppDetails(wishlistItem.appId)
        : await this.storeClient.getCacheableAppDetails(wishlistItem.appId);
      if (!details) {
        missingDetailsCount += 1;
      }

      const deckStatus = options.includeDeckStatus
        ? await this.deckStatusProvider.getStatus(wishlistItem.appId)
        : undefined;

      items.push({
        appId: wishlistItem.appId,
        ...(wishlistItem.priority === undefined ? {} : { priority: wishlistItem.priority }),
        ...(wishlistItem.dateAdded === undefined ? {} : { dateAdded: wishlistItem.dateAdded }),
        ...(details === undefined ? {} : { details }),
        ...(deckStatus === undefined ? {} : { deckStatus })
      });
    }

    return {
      totalCount: wishlist.totalCount,
      items,
      missingDetailsCount
    };
  }

  async summarizeDiscounts(options: WishlistDiscountSummaryOptions): Promise<WishlistDiscountSummaryResult> {
    const wishlist = await this.wishlistService.list({ steamId: options.steamId });
    const items: WishlistDiscountSummaryItem[] = [];
    const currencySummaries = new Map<string, WishlistDiscountCurrencySummary>();
    const minimumDiscountPercent = options.minimumDiscountPercent ?? 1;
    let pricedCount = 0;
    let discountedCount = 0;
    let unknownPriceCount = 0;

    for (const wishlistItem of wishlist.items) {
      const details = await this.storeClient.getFreshAppDetails(wishlistItem.appId);
      const price = details?.priceOverview;
      if (!price) {
        unknownPriceCount += 1;
        continue;
      }

      pricedCount += 1;
      const savingsInCents = price.initialInCents - price.finalInCents;
      if (price.discountPercent < minimumDiscountPercent || savingsInCents <= 0) {
        continue;
      }

      discountedCount += 1;
      const currencyKey = price.currency ?? '';
      const currencySummary = currencySummaries.get(currencyKey) ?? {
        ...(price.currency === undefined ? {} : { currency: price.currency }),
        discountedCount: 0,
        totalInitialInCents: 0,
        totalFinalInCents: 0,
        totalSavingsInCents: 0
      };
      currencySummary.discountedCount += 1;
      currencySummary.totalInitialInCents += price.initialInCents;
      currencySummary.totalFinalInCents += price.finalInCents;
      currencySummary.totalSavingsInCents += savingsInCents;
      currencySummaries.set(currencyKey, currencySummary);

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
        price,
        savingsInCents
      });
    }

    return {
      totalCount: wishlist.totalCount,
      pricedCount,
      discountedCount,
      unknownPriceCount,
      items,
      currencies: [...currencySummaries.values()],
      metadata: {
        priceSource: 'live-public-appdetails',
        countsIgnoreLimit: true
      }
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
