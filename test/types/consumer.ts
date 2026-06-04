// Compile-only fixture (never executed): verifies the generated declarations
// in ../../types correctly type a real consumer. Run via `npm run typecheck`.

import { Reindexer, Repository, IndexApi, PostSynchronizer } from '../../types'

class FakeRepo extends Repository {
  async _init(): Promise<void> {}
  async _update(): Promise<void> {}
  async _acquire(): Promise<boolean> { return true }
  async _release(): Promise<void> {}
  async _getConfig(): Promise<Repository.Reindexing | null> { return null }
}

class FakeApi extends IndexApi {
  async _request(): Promise<any> { return {} }
}

class FakeSync extends PostSynchronizer {
  async _sync(_reindexing: Repository.Reindexing): Promise<number> { return 0 }
}

async function smoke(): Promise<void> {
  const reindexer = new Reindexer(new FakeRepo(), new FakeApi(), new FakeSync())

  const input: Repository.InitialReindexing = { alias: 'a', source: 's', target: 't', mapping: {} }

  await reindexer.reindex(input)

  const taskId: string = await new FakeApi().reindex(input)

  // Reindexing must extend InitialReindexing with the progress fields
  const stored: Repository.Reindexing = { ...input, taskId, stage: 'INDEX_CREATION', lastSyncedDate: '' }

  void [taskId, stored.alias, stored.taskId, stored.stage, stored.lastSyncedDate, Repository.Stage.REINDEXING_COMPLETED]
}

void smoke
