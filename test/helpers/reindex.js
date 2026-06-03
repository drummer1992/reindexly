'use strict'
/* eslint-disable require-await */

const sinon = require('sinon')
const { Repository, IndexApi, PostSynchronizer } = require('../../lib')

class FakeRepository extends Repository {
  #state
  #acquiredAt = null

  constructor(initialState = null) {
    super()

    this.#state = initialState
  }

  get state() {
    return this.#state
  }

  get acquiredAt() {
    return this.#acquiredAt
  }

  seed(state) {
    this.#state = state ? { ...state } : null
  }

  forceLock(at = new Date().toISOString()) {
    this.#acquiredAt = at
  }

  async _init(reindexing) {
    this.#state = { ...reindexing }
  }

  async _update(changes) {
    Object.assign(this.#state, changes)
  }

  async _getConfig() {
    return this.#state
  }

  async _acquire(date) {
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

const makeIndexApi = () => {
  const api = new IndexApi()

  sinon.stub(api, 'createIndex').resolves({ acknowledged: true })
  sinon.stub(api, 'reindex').resolves('task-1')
  sinon.stub(api, 'getTask').resolves({ completed: true })
  sinon.stub(api, 'updateAlias').resolves({ acknowledged: true })

  return api
}

const makePostSynchronizer = syncImpl => {
  const ps = new PostSynchronizer()
  const stub = sinon.stub(ps, 'sync')

  if (syncImpl) {
    stub.callsFake(syncImpl)
  } else {
    stub.resolves(0)
  }

  return ps
}

const baseInput = (overrides = {}) => ({
  alias  : 'reindex_test_alias',
  source : 'reindex_test_v1',
  target : 'reindex_test_v2',
  mapping: { properties: { id: { type: 'keyword' } } },
  ...overrides,
})

module.exports = {
  FakeRepository,
  makeIndexApi,
  makePostSynchronizer,
  baseInput,
  Stage: Repository.Stage,
}