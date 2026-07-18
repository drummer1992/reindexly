
import sinon from 'sinon'
import { Repository, IndexApi, PostSynchronizer, Reindexing } from '../../src'

class FakeRepository extends Repository {
  #state: Reindexing | null
  #acquiredAt: string | null = null

  constructor(initialState: Reindexing | null = null) {
    super()

    this.#state = initialState
  }

  get state() {
    return this.#state
  }

  get acquiredAt() {
    return this.#acquiredAt
  }

  seed(state?: Reindexing | null) {
    this.#state = state ? { ...state } : null
  }

  forceLock(at = new Date().toISOString()) {
    this.#acquiredAt = at
  }

  async _init(reindexing: Reindexing) {
    this.#state = { ...reindexing }
  }

  async _update(changes: Partial<Reindexing>) {
    Object.assign(this.#state as Reindexing, changes)
  }

  async _getConfig() {
    return this.#state
  }

  async _acquire(date: string) {
    if (this.#acquiredAt) {
      return false
    }

    this.#acquiredAt = date

    return true
  }

  async _release() {
    this.#acquiredAt = null
  }
}

class TestIndexApi extends IndexApi {
  protected _request(): Promise<unknown> {
    return Promise.reject(new Error('_request not implemented in test'))
  }
}

class TestPostSynchronizer extends PostSynchronizer {
  protected _sync(): Promise<number> {
    return Promise.resolve(0)
  }
}

const makeIndexApi = (): sinon.SinonStubbedInstance<IndexApi> => {
  const api = new TestIndexApi()

  sinon.stub(api, 'createIndex').resolves()
  sinon.stub(api, 'reindex').resolves('task-1')
  sinon.stub(api, 'getTask').resolves({ completed: true })
  sinon.stub(api, 'updateAlias').resolves()

  return api as unknown as sinon.SinonStubbedInstance<IndexApi>
}

const makePostSynchronizer = (
  syncImpl?: (reindexing: Reindexing) => Promise<number>,
): sinon.SinonStubbedInstance<PostSynchronizer> => {
  const ps = new TestPostSynchronizer()
  const stub = sinon.stub(ps, 'sync')

  if (syncImpl) {
    stub.callsFake(syncImpl)
  } else {
    stub.resolves(0)
  }

  return ps as unknown as sinon.SinonStubbedInstance<PostSynchronizer>
}

const baseInput = (overrides: Record<string, unknown> = {}): Reindexing => ({
  alias  : 'reindex_test_alias',
  source : 'reindex_test_v1',
  target : 'reindex_test_v2',
  mapping: { properties: { id: { type: 'keyword' } } },
  ...overrides,
} as Reindexing)

const Stage = Repository.Stage

export {
  FakeRepository,
  makeIndexApi,
  makePostSynchronizer,
  baseInput,
  Stage,
}