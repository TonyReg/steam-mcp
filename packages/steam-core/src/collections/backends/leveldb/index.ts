export class LevelDbCollectionBackendPlaceholder {
  readonly backendId = 'leveldb';

  async detect(): Promise<boolean> {
    return false;
  }
}
