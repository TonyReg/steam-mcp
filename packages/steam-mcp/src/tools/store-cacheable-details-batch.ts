import type { StoreAppDetails, StoreSearchCandidate } from '@steam-mcp/steam-core';
import type { SteamMcpContext } from '../context.js';

type MergeStoreCandidateWithDetails = (
  candidate: StoreSearchCandidate,
  details: StoreAppDetails
) => StoreSearchCandidate;

export async function enrichStoreCandidatesWithCacheableDetails(
  storeClient: SteamMcpContext['storeClient'],
  candidates: StoreSearchCandidate[],
  mergeCandidate: MergeStoreCandidateWithDetails
): Promise<StoreSearchCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => {
    const details = await storeClient.getCacheableAppDetails(candidate.appId);
    if (!details) {
      return candidate;
    }

    return mergeCandidate(candidate, details);
  }));
}

export function mergeStoreSearchCandidateWithCacheableDetails(
  candidate: StoreSearchCandidate,
  details: StoreAppDetails
): StoreSearchCandidate {
  return {
    ...candidate,
    type: details.type ?? candidate.type,
    releaseDate: details.releaseDate ?? candidate.releaseDate,
    comingSoon: details.comingSoon ?? candidate.comingSoon,
    developers: details.developers,
    publishers: details.publishers,
    genres: details.genres,
    categories: details.categories,
    tags: details.tags,
    shortDescription: details.shortDescription ?? candidate.shortDescription,
    headerImage: details.headerImage ?? candidate.headerImage,
    storeUrl: details.storeUrl ?? candidate.storeUrl
  } satisfies StoreSearchCandidate;
}

export function mergeSimilarStoreCandidateWithCacheableDetails(
  candidate: StoreSearchCandidate,
  details: StoreAppDetails
): StoreSearchCandidate {
  return {
    ...candidate,
    developers: details.developers,
    publishers: details.publishers,
    genres: details.genres,
    tags: details.tags,
    headerImage: details.headerImage ?? candidate.headerImage
  } satisfies StoreSearchCandidate;
}
