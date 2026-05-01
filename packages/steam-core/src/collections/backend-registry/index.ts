import type { CollectionBackendAdapter } from '../types.js';

export type CollectionBackendFactory = (sourcePath: string, steamId: string) => CollectionBackendAdapter;

export class CollectionBackendRegistry {
  constructor(
    private readonly backends: CollectionBackendAdapter[] = [],
    private readonly factories: Record<string, CollectionBackendFactory> = {}
  ) {}

  async detect(): Promise<CollectionBackendAdapter | undefined> {
    for (const backend of this.backends) {
      if (await backend.detect()) {
        return backend;
      }
    }

    return undefined;
  }

  getById(backendId: string): CollectionBackendAdapter | undefined {
    return this.backends.find((backend) => backend.backendId === backendId);
  }

  resolve(backendId: string, sourcePath: string, steamId: string): CollectionBackendAdapter | undefined {
    const factory = this.factories[backendId];
    if (factory) {
      return factory(sourcePath, steamId);
    }

    return this.getById(backendId);
  }
}
