// Compile-only fixture (never executed): verifies the generated declarations
// in ../../dist correctly type a real consumer. Run via `npm run typecheck`.

import { Reindexer, Repository, IndexApi, PostSynchronizer, Reindexing, InitialReindexing, Stage } from '../../dist'

class FakeRepo extends Repository {
  async _init(): Promise<void> {}
  async _update(): Promise<void> {}
  async _acquire(): Promise<boolean> { return true }
  async _release(): Promise<void> {}
  async _getConfig(): Promise<Reindexing | null> { return null }
}

class FakeApi extends IndexApi {
  async _request(): Promise<any> { return {} }
}

class FakeSync extends PostSynchronizer {
  async _sync(_reindexing: Reindexing): Promise<number> { return 0 }
}

async function smoke(): Promise<void> {
  const reindexer = new Reindexer(new FakeRepo(), new FakeApi(), new FakeSync())

  const input: InitialReindexing = { alias: 'a', source: 's', target: 't', mapping: {}, painlessScript: '', pipeline: '', query: {} }

  await reindexer.reindex(input)

  // Reindexing must extend InitialReindexing with the progress fields
  const stored: Reindexing = { ...input, stage: Stage.INDEX_CREATION, lastSyncedDate: '' as any }

  const taskId: string = await new FakeApi().reindex(stored)

  void [taskId, stored.alias, stored.taskId, stored.stage, stored.lastSyncedDate, Stage.REINDEXING_COMPLETED]
}

void smoke
