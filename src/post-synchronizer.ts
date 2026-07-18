import { Reindexing } from './repository'

const assert = require('assert')

export default abstract class PostSynchronizer {
  /**
   * The maximum number of documents a single sync iteration may index for the
   * catch-up loop to be considered converged. It must exceed the steady-state
   * number of documents changed within the sync overlap window, otherwise the
   * loop will never converge.
   */
  ACCEPTABLE_BACKLOG = 500

  backlogIsAcceptable(syncedCount: number) {
    assert(typeof (syncedCount as unknown) === 'number', 'syncedCount should be a number')

    return syncedCount <= this.ACCEPTABLE_BACKLOG
  }

  sync(reindexing: Reindexing): Promise<number> {
    return this._sync(reindexing)
  }

  protected abstract _sync(reindexing: Reindexing): Promise<number>
}