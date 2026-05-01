import type { CollectionPlan, CollectionSnapshot } from '../types.js';

export interface CollectionBackendApplyDraft {
  nextDocument: string;
  expectedSnapshotHash: string;
}

export interface CollectionBackendAdapter {
  readonly backendId: string;
  detect(): Promise<boolean>;
  readSnapshot(): Promise<CollectionSnapshot>;
  validatePlan(plan: CollectionPlan, snapshot: CollectionSnapshot): string[];
  applyPlan(plan: CollectionPlan, snapshot: CollectionSnapshot): Promise<CollectionBackendApplyDraft>;
}
