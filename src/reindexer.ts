import Repository, {InitialReindexing, Reindexing, Stage} from "./repository";
import IndexApi, {TaskResponse} from "./index-api";
import PostSynchronizer from "./post-synchronizer";
import Locker from "./locker";
import assert from "assert";
import {toISOString} from "./utils/date";
import {doWhilst, waitFor} from "./utils/async";
import {identity} from "./utils/functions";

class ReindexingNotResumableError extends Error {
}

export default class Reindexer {
  private locker: Locker

  static Errors = {
    ReindexingNotResumableError,
  }

  constructor(private readonly repository: Repository, private readonly indexApi: IndexApi, private readonly postSynchronizer: PostSynchronizer) {
    assert((repository as unknown) instanceof Repository, 'repository should be an instance of Repository')
    assert((indexApi as unknown) instanceof IndexApi, 'indexApi should be an instance of IndexApi')
    assert((postSynchronizer as unknown) instanceof PostSynchronizer, 'postSynchronizer should be an instance of PostSynchronizer')

    this.locker = new Locker(repository)
  }

  public async reindex(reindexing: InitialReindexing): Promise<void> {
    return this.locker.runWithLock(
      () => this.runReindexing(reindexing),
      'Reindexing is already in progress',
    )
  }

  private async runReindexing(reindexing: InitialReindexing): Promise<void> {
    const storedReindexing = await this.repository.init(reindexing)

    await this.resume(storedReindexing).catch(async err => {
      if (err instanceof ReindexingNotResumableError) {
        await this.setStage(storedReindexing, Repository.Stage.REINDEXING_FAILED)
      }

      throw err
    })
  }

  private async resume(reindexing: Reindexing): Promise<void> {
    if (reindexing.stage === Repository.Stage.INDEX_CREATION) {
      await this.createIndex(reindexing)
      await this.setStage(reindexing, Repository.Stage.INITIAL_REINDEXING)
    }

    if (reindexing.stage === Repository.Stage.INITIAL_REINDEXING) {
      await this.handleInitialReindexing(reindexing)
      await this.setStage(reindexing, Repository.Stage.MANUAL_INDEXING)
    }

    if (reindexing.stage === Repository.Stage.MANUAL_INDEXING) {
      await this.indexManually(reindexing)
      await this.setStage(reindexing, Repository.Stage.ALIAS_UPDATE)
    }

    if (reindexing.stage === Repository.Stage.ALIAS_UPDATE) {
      await this.indexApi.updateAlias(reindexing)
      await this.setStage(reindexing, Repository.Stage.FINAL_MANUAL_INDEXING)
    }

    if (reindexing.stage === Repository.Stage.FINAL_MANUAL_INDEXING) {
      await this.postSync(reindexing)
      await this.setStage(reindexing, Repository.Stage.REINDEXING_COMPLETED)
    }

    console.log('Reindexing is completed successfully.')
  }

  private async handleInitialReindexing(reindexing: Reindexing): Promise<void> {
    if (!reindexing.taskId) {
      const startDate = new Date()

      const taskId = await this.indexApi.reindex(reindexing)

      await this.setLastSyncedDate(reindexing, startDate, taskId)
    }

    assert(reindexing.taskId, 'Reindexing taskId is not set')

    await this.waitForInitialReindexingCompletion(reindexing.taskId)
  }

  private async indexManually(reindexing: Reindexing): Promise<void> {
    await doWhilst(async () => {
      const syncedCount = await this.postSync(reindexing)

      return this.postSynchronizer.backlogIsAcceptable(syncedCount)
    }, identity)
  }

  private async postSync(reindexing: Reindexing): Promise<number> {
    const startDate = new Date()

    const syncedCount = await this.postSynchronizer.sync(reindexing)

    await this.setLastSyncedDate(reindexing, startDate)

    return syncedCount
  }

  private async setStage(reindexing: Reindexing, stage: Stage): Promise<void> {
    reindexing.stage = stage

    await this.repository.setStage(stage)
  }


  private async setLastSyncedDate(reindexing: Reindexing, date: Date, taskId?: string): Promise<void> {
    reindexing.lastSyncedDate = toISOString(date)

    if (taskId) {
      reindexing.taskId = taskId
    }

    await this.repository.setLastSyncedDate(reindexing.lastSyncedDate, taskId)
  }

  private async waitForInitialReindexingCompletion(taskId: string): Promise<void> {
    await waitFor(() => this.getReindexingTask(taskId), task => task.completed, {
      timeout: Infinity,
    })
  }

  private async getReindexingTask(taskId: string): Promise<TaskResponse | never> {
    return this.indexApi.getTask(taskId).catch(err => {
      if (err instanceof IndexApi.Errors.ReindexingError) {
        throw new ReindexingNotResumableError(`The reindexing task could not be completed. ${err.stack}`)
      }

      throw err
    })
  }

  private async createIndex(reindexing: Reindexing): Promise<void | never> {
    return this.indexApi.createIndex(reindexing).catch(err => {
      if (!(err instanceof IndexApi.Errors.IndexAlreadyExistsError)) {
        throw new ReindexingNotResumableError(`Can not create the destination index. ${err.stack}`)
      }
    })
  }
}