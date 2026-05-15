import { createWishlistAnnotationMap, resolveSteamWebApiSteamId } from '@steam-mcp/steam-core';
import type { WishlistAnnotation } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';

export type WishlistAnnotationLookup =
  | { ok: true; annotations: Map<number, WishlistAnnotation> }
  | { ok: false; error: string };

export async function resolveWishlistAnnotations(context: SteamMcpContext, toolName: string): Promise<WishlistAnnotationLookup> {
  const discovery = await context.discoveryService.discover();
  const selectedUserId = discovery.selectedUserId;
  if (!selectedUserId) {
    return {
      ok: false,
      error: `No selected Steam user was found; ${toolName} includeWishlist requires a discoverable selected user.`
    };
  }

  const steamId = resolveSteamWebApiSteamId(selectedUserId);
  if (!steamId) {
    return {
      ok: false,
      error: `The selected Steam user could not be resolved to a SteamID64; ${toolName} includeWishlist requires a valid SteamID64.`
    };
  }

  try {
    const wishlist = await context.wishlistService.list({ steamId });
    return {
      ok: true,
      annotations: createWishlistAnnotationMap(wishlist.items)
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `Unknown ${toolName} wishlist lookup failure.`
    };
  }
}
