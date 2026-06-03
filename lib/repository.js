'use strict'

const { object, string } = require('sito')
const assert = require('assert')
const { isDeepStrictEqual } = require('util')
const { pick, omitBy } = require('./utils/object')

/**
 * @typedef {Object} InitialReindexing
 * @property {String} [alias] - Index alias
 * @property {String} [source] - Source Index
 * @property {String} [target] - Target Index
 * @property {Object} [mapping] - Index mapping
 * @property {String} [painlessScript] - Optional painless script for reindexing
 * @property {String} [pipeline] - Optional ingest pipeline for reindexing
 * @property {Object} [query] - Optional query to filter documents for reindexing
 */

/**
 * @typedef {InitialReindexing} Reindexing
 * @property {String} [taskId] - Reindexing task ID
 * @property {String} [stage] - Reindexing stage
 * @property {String} [lastSyncedDate] - ISO string of the latest synchronization date
 */

class Repository {
  static Stage = {
    INDEX_CREATION       : 'INDEX_CREATION',
    INITIAL_REINDEXING   : 'INITIAL REINDEXING',
    MANUAL_INDEXING      : 'MANUAL INDEXING',
    ALIAS_UPDATE         : 'ALIAS UPDATE',
    FINAL_MANUAL_INDEXING: 'FINAL MANUAL INDEXING',
    REINDEXING_FAILED    : 'REINDEXING FAILED',
    REINDEXING_COMPLETED : 'REINDEXING COMPLETED',
  }

  #initialReindexingSchema = object({
    alias         : string().required(),
    source        : string().required(),
    target        : string().required(),
    mapping       : object().required(),
    painlessScript: string(),
    pipeline      : string(),
    query         : object(),
  }).strict()

  /**
   * @param {InitialReindexing} reindexing
   * @returns {Promise<Reindexing>}
   */
  async init(reindexing) {
    await this.#initialReindexingSchema.assert(reindexing, { clazz: assert.AssertionError })

    const stored = await this._getConfig()

    if (stored && this.#isActiveStage(stored.stage)) {
      const toCompare = ['alias', 'source', 'target', 'mapping', 'painlessScript', 'pipeline', 'query']
      const configMatchesStored = isDeepStrictEqual(pick(stored, toCompare), pick(reindexing, toCompare))

      assert(configMatchesStored, 'Stored reindexing config mismatches with the provided one')

      return stored
    }

    const config = { ...reindexing, stage: Repository.Stage.INDEX_CREATION }

    await this._init(config)

    return config
  }

  #isActiveStage(stage) {
    return ![Repository.Stage.REINDEXING_COMPLETED, Repository.Stage.REINDEXING_FAILED].includes(stage)
  }

  /**
   * @returns {Promise<Boolean>}
   */
  acquire() {
    return this._acquire(new Date().toISOString())
  }

  /**
   * @returns {Promise<void>}
   */
  release() {
    return this._release()
  }

  /**
   * @param {String} stage
   * @returns {Promise<void>}
   */
  setStage(stage) {
    assert(Object.values(Repository.Stage).includes(stage), 'Invalid stage')

    return this._update({ stage })
  }

  /**
   * @param {Date | String | Number} date
   * @param {String} [taskId]
   * @returns {Promise<void>}
   */
  setLastSyncedDate(date, taskId) {
    assert(date, 'date is required')

    return this._update(omitBy({ taskId, lastSyncedDate: new Date(date).toISOString() }))
  }

  /**
   * @param {Reindexing} reindexing
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line require-await,no-unused-vars
  async _init(reindexing) {
    throw new Error('Not implemented')
  }

  /**
   * @param {Reindexing} changes
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line require-await,no-unused-vars
  async _update(changes) {
    throw new Error('Not implemented')
  }

  /**
   * @param {String} date
   * @returns {Promise<Boolean>}
   */
  // eslint-disable-next-line require-await,no-unused-vars
  async _acquire(date) {
    throw new Error('Not implemented')
  }

  /**
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line require-await
  async _release() {
    throw new Error('Not implemented')
  }

  /**
   * @returns {Promise<Reindexing|null>}
   */
  // eslint-disable-next-line require-await
  async _getConfig() {
    throw new Error('Not implemented')
  }
}

module.exports = Repository