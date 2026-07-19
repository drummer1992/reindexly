import assert from 'node:assert'
import { isDeepStrictEqual } from 'node:util'
import { omitBy, pick } from './utils/object'
import { ISODateString, toISOString } from './utils/date'

export enum Stage {
  INDEX_CREATION = 'INDEX_CREATION',
  INITIAL_REINDEXING = 'INITIAL REINDEXING',
  MANUAL_INDEXING = 'MANUAL INDEXING',
  ALIAS_UPDATE = 'ALIAS UPDATE',
  FINAL_MANUAL_INDEXING = 'FINAL MANUAL INDEXING',
  REINDEXING_FAILED = 'REINDEXING FAILED',
  REINDEXING_COMPLETED = 'REINDEXING COMPLETED',
}

export type InitialReindexing = {
  alias: string
  source: string
  target: string
  mapping: object
  painlessScript: string
  pipeline: string
  query: object
}

export type ReindexingProgress = {
  taskId?: string
  stage: Stage
  lastSyncedDate?: ISODateString
}

export type Reindexing = InitialReindexing & ReindexingProgress

export default abstract class Repository {
  public static Stage = Stage

  public async init(reindexing: InitialReindexing): Promise<Reindexing> {
    this.assertInitialReindexing(reindexing)

    const stored: Reindexing | null = await this._getConfig()

    if (stored && this.isActiveStage(stored.stage)) {
      const toCompare: Array<keyof InitialReindexing> = ['alias', 'source', 'target', 'mapping', 'painlessScript', 'pipeline', 'query']
      const configMatchesStored: boolean = isDeepStrictEqual(pick(stored, toCompare), pick(reindexing, toCompare))

      assert(configMatchesStored, 'Stored reindexing config mismatches with the provided one')

      return stored
    }

    const config: Reindexing = { ...reindexing, stage: Repository.Stage.INDEX_CREATION }

    await this._init(config)

    return config
  }

  public acquire(): Promise<boolean> {
    return this._acquire(toISOString(new Date()))
  }

  public release(): Promise<void> {
    return this._release()
  }

  public setStage(stage: Stage): Promise<void> {
    assert(Object.values(Repository.Stage).includes(stage), 'Invalid stage')

    return this._update({ stage })
  }

  public setLastSyncedDate(date: ISODateString | Date, taskId?: string) {
    assert(date, 'date is required')

    return this._update(omitBy({ lastSyncedDate: toISOString(date), taskId }))
  }

  private assertInitialReindexing(reindexing: InitialReindexing): void | never {
    assert(reindexing, 'Reindexing config is required')
    assert(reindexing.alias, 'alias is required')
    assert(reindexing.source, 'source is required')
    assert(reindexing.target, 'target is required')
    assert(reindexing.mapping, 'mapping is required')
  }

  private isActiveStage(stage: Stage): boolean {
    return ![Repository.Stage.REINDEXING_COMPLETED, Repository.Stage.REINDEXING_FAILED].includes(stage)
  }

  protected abstract _init(reindexing: Reindexing): Promise<void>

  protected abstract _update(reindexing: Partial<Reindexing>): Promise<void>

  protected abstract _acquire(date: ISODateString): Promise<boolean>

  protected abstract _release(): Promise<void>

  protected abstract _getConfig(): Promise<Reindexing | null>
}