import { Reindexing } from './repository'
import assert from 'assert'

export default abstract class PostSynchronizer {
  /**
   * The maximum number of documents a single sync iteration may index for the
   * catch-up loop to be considered converged. It must exceed the steady-state
   * number of documents changed within the sync overlap window, otherwise the
   * loop will never converge.
   */
  public ACCEPTABLE_BACKLOG: number = 500

  public backlogIsAcceptable(syncedCount: number) {
    assert(typeof (syncedCount as unknown) === 'number', 'syncedCount should be a number')

    return syncedCount <= this.ACCEPTABLE_BACKLOG
  }

  public sync(reindexing: Required<Reindexing>): Promise<number> {
    return this._sync(reindexing)
  }

  protected abstract _sync(reindexing: Required<Reindexing>): Promise<number>
}