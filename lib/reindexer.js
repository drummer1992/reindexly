'use strict'

const Repository = require('./repository')
const IndexApi = require('./index-api')
const PostSynchronizer = require('./post-synchronizer')
const assert = require('assert')
const { identity } = require('./utils/array')
const { waitFor, doWhilst } = require('./utils/async')

class ReindexingNotResumableError extends Error {
}

class Reindexer {
  static Errors = {
    ReindexingNotResumableError,
  }

  /** @type {Repository} */
  #repository
  /** @type {IndexApi} */
  #indexApi
  /** @type {PostSynchronizer} */
  #postSynchronizer

  /**
   * @param {Repository} repository - persistence + advisory lock
   * @param {IndexApi} indexApi - index management API
   * @param {PostSynchronizer} postSynchronizer - domain delta-sync step
   */
  constructor(repository, indexApi, postSynchronizer) {
    assert(repository instanceof Repository, 'repository should be an instance of Repository')
    assert(indexApi instanceof IndexApi, 'indexApi should be an instance of IndexApi')
    assert(postSynchronizer instanceof PostSynchronizer, 'postSynchronizer should be an instance of PostSynchronizer')

    this.#repository = repository
    this.#indexApi = indexApi
    this.#postSynchronizer = postSynchronizer
  }

  /**
   * @param {import('./repository').InitialReindexing} reindexing
   * @returns {Promise<void>}
   */
  async reindex(reindexing) {
    await this.#withLock(() => this.#runReindexing(reindexing))
  }

  async #runReindexing(reindexing) {
    const storedReindexing = await this.#repository.init(reindexing)

    await this.#resume(storedReindexing).catch(async err => {
      if (err instanceof ReindexingNotResumableError) {
        await this.#setStage(storedReindexing, Repository.Stage.REINDEXING_FAILED)
      }

      throw err
    })
  }

  async #resume(reindexing) {
    if (reindexing.stage === Repository.Stage.INDEX_CREATION) {
      await this.#createIndex(reindexing)
      await this.#setStage(reindexing, Repository.Stage.INITIAL_REINDEXING)
    }

    if (reindexing.stage === Repository.Stage.INITIAL_REINDEXING) {
      await this.#handleInitialReindexing(reindexing)
      await this.#setStage(reindexing, Repository.Stage.MANUAL_INDEXING)
    }

    if (reindexing.stage === Repository.Stage.MANUAL_INDEXING) {
      await this.#indexManually(reindexing)
      await this.#setStage(reindexing, Repository.Stage.ALIAS_UPDATE)
    }

    if (reindexing.stage === Repository.Stage.ALIAS_UPDATE) {
      await this.#indexApi.updateAlias(reindexing)
      await this.#setStage(reindexing, Repository.Stage.FINAL_MANUAL_INDEXING)
    }

    if (reindexing.stage === Repository.Stage.FINAL_MANUAL_INDEXING) {
      await this.#postSync(reindexing)
      await this.#setStage(reindexing, Repository.Stage.REINDEXING_COMPLETED)
    }

    console.log('Reindexing is completed successfully.')
  }

  async #handleInitialReindexing(reindexing) {
    if (!reindexing.taskId) {
      const startDate = new Date()

      const taskId = await this.#indexApi.reindex(reindexing)

      await this.#setLastSyncedDate(reindexing, startDate, taskId)
    }

    await this.#waitForInitialReindexingCompletion(reindexing.taskId)
  }

  async #indexManually(reindexing) {
    await doWhilst(async () => {
      const syncedCount = await this.#postSync(reindexing)

      return this.#postSynchronizer.backlogIsAcceptable(syncedCount)
    }, identity)
  }

  async #postSync(reindexing) {
    const startDate = new Date()

    const syncedCount = await this.#postSynchronizer.sync(reindexing)

    await this.#setLastSyncedDate(reindexing, startDate)

    return syncedCount
  }

  async #setStage(reindexing, stage) {
    reindexing.stage = stage

    await this.#repository.setStage(stage)
  }

  async #setLastSyncedDate(reindexing, date, taskId) {
    reindexing.lastSyncedDate = new Date(date).toISOString()

    if (taskId) {
      reindexing.taskId = taskId
    }

    await this.#repository.setLastSyncedDate(reindexing.lastSyncedDate, taskId)
  }

  async #waitForInitialReindexingCompletion(taskId) {
    await waitFor(() => this.#getReindexingTask(taskId), task => task.completed, {
      timeout: Infinity,
    })
  }

  #getReindexingTask(taskId) {
    return this.#indexApi.getTask(taskId).catch(err => {
      if (err instanceof IndexApi.Errors.ReindexingError) {
        throw new ReindexingNotResumableError(`The reindexing task could not be completed. ${err.stack}`)
      }

      throw err
    })
  }

  #createIndex(reindexing) {
    return this.#indexApi.createIndex(reindexing).catch(err => {
      if (!(err instanceof IndexApi.Errors.IndexAlreadyExistsError)) {
        throw new ReindexingNotResumableError(`Can not create the destination index. ${err.stack}`)
      }
    })
  }

  async #withLock(fn) {
    let acquired

    try {
      acquired = await this.#repository.acquire()

      assert(acquired, 'The reindexer is busy')

      await fn()
    } finally {
      acquired && await this.#repository.release()
    }
  }
}

module.exports = Reindexer