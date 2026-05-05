import type { CollectionApplyOptions, CollectionPlan, CollectionSnapshot } from '../types.js';

export interface CollectionBackendFileWrite {
  targetPath: string;
  content: string;
}

export interface CollectionBackendApplyDraft {
  dirtyWrites: CollectionBackendFileWrite[];
  finalizeWrites: CollectionBackendFileWrite[];
  expectedDirtySnapshotHash?: string;
  expectedFinalSnapshotHash: string;
  finalizeWarnings?: string[];
}

export interface CollectionBackendAdapter {
  readonly backendId: string;
  detect(): Promise<boolean>;
  readSnapshot(): Promise<CollectionSnapshot>;
  validatePlan(plan: CollectionPlan, snapshot: CollectionSnapshot): string[];
  applyPlan(plan: CollectionPlan, snapshot: CollectionSnapshot, options?: CollectionApplyOptions): Promise<CollectionBackendApplyDraft>;
}
