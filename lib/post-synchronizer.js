'use strict'

const assert = require('assert')

class PostSynchronizer {
  /**
   * The maximum number of documents a single sync iteration may index for the
   * catch-up loop to be considered converged. It must exceed the steady-state
   * number of documents changed within the sync overlap window, otherwise the
   * loop will never converge.
   */
  ACCEPTABLE_BACKLOG = 500

  /**
   * @param {Number} syncedCount - number of documents indexed by the last sync
   * @returns {Boolean}
   */
  backlogIsAcceptable(syncedCount) {
    assert(typeof syncedCount === 'number', 'syncedCount should be a number')

    return syncedCount <= this.ACCEPTABLE_BACKLOG
  }

  /**
   * @param {import('./repository').Reindexing} reindexing
   * @returns {Promise<Number>}
   */
  sync(reindexing) {
    return this._sync(reindexing)
  }

  /**
   * @param {import('./repository').Reindexing} reindexing
   * @returns {Promise<Number>} number of documents indexed
   */
  // eslint-disable-next-line no-unused-vars,require-await
  async _sync(reindexing) {
    throw new Error('Not implemented')
  }
}

module.exports = PostSynchronizer