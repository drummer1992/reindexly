'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { Reindexer, IndexApi } = require('../lib')
const { FakeRepository, makeIndexApi, makePostSynchronizer, baseInput, Stage } = require('./helpers/reindex')

describe('reindexer', () => {
  let repo, indexApi, postSync

  const build = () => new Reindexer(repo, indexApi, postSync)

  beforeEach(() => {
    repo = new FakeRepository()
    indexApi = makeIndexApi()
    postSync = makePostSynchronizer()
  })

  afterEach(() => sinon.restore())

  describe('happy path', () => {
    it('drives a fresh reindex through every stage to COMPLETED', async () => {
      await build().reindex(baseInput())

      assert.strictEqual(repo.state.stage, Stage.REINDEXING_COMPLETED)
      assert.ok(indexApi.createIndex.calledOnce)
      assert.ok(indexApi.reindex.calledOnce)
      assert.ok(indexApi.updateAlias.calledOnce)
      // one converging MANUAL_INDEXING iteration + one FINAL_MANUAL_INDEXING sync
      assert.strictEqual(postSync.sync.callCount, 2)

      sinon.assert.callOrder(indexApi.createIndex, indexApi.reindex, indexApi.updateAlias)
    })

    it('releases the lock after a successful run', async () => {
      await build().reindex(baseInput())

      assert.strictEqual(repo.acquiredAt, null)
    })
  })

  describe('locking', () => {
    it('refuses to run and does not release when the lock is held', async () => {
      repo.forceLock('2026-01-01T00:00:00.000Z')

      await assert.rejects(build().reindex(baseInput()), /The reindexer is busy/)

      assert.ok(indexApi.createIndex.notCalled)
      assert.strictEqual(repo.acquiredAt, '2026-01-01T00:00:00.000Z')
    })

    it('releases the lock even when the run fails', async () => {
      indexApi.createIndex.rejects(new Error('boom'))

      await assert.rejects(build().reindex(baseInput()))

      assert.strictEqual(repo.state.stage, Stage.REINDEXING_FAILED)
      assert.strictEqual(repo.acquiredAt, null)
    })
  })

  describe('config singleton / resume entry', () => {
    it('resumes when a matching reindexing is already in progress', async () => {
      repo.seed(baseInput({ stage: Stage.ALIAS_UPDATE, lastSyncedDate: new Date().toISOString() }))

      await build().reindex(baseInput())

      assert.strictEqual(repo.state.stage, Stage.REINDEXING_COMPLETED)
      assert.ok(indexApi.createIndex.notCalled)
      assert.ok(indexApi.reindex.notCalled)
      assert.ok(indexApi.updateAlias.calledOnce)
    })

    it('rejects when the in-progress config does not match the provided params', async () => {
      repo.seed(baseInput({ target: 'reindex_test_v9', stage: Stage.MANUAL_INDEXING }))

      await assert.rejects(build().reindex(baseInput()), /config mismatches/)
    })

    it('propagates a non-AlreadyExists init error and releases the lock', async () => {
      sinon.stub(repo, 'init').rejects(new Error('db down'))

      await assert.rejects(build().reindex(baseInput()), /db down/)

      assert.strictEqual(repo.acquiredAt, null)
    })
  })

  describe('resume from each stage', () => {
    const cases = [Stage.MANUAL_INDEXING, Stage.ALIAS_UPDATE, Stage.FINAL_MANUAL_INDEXING]

    cases.forEach(stage => {
      it(`resumes from ${stage} and completes without re-creating the index`, async () => {
        repo.seed(baseInput({ stage, taskId: 't', lastSyncedDate: new Date().toISOString() }))

        await build().reindex(baseInput())

        assert.strictEqual(repo.state.stage, Stage.REINDEXING_COMPLETED)
        assert.ok(indexApi.createIndex.notCalled)
        assert.ok(indexApi.reindex.notCalled)
      })
    })
  })

  describe('INITIAL_REINDEXING / task handling', () => {
    it('issues the reindex task and persists its id when none is stored', async () => {
      await build().reindex(baseInput())

      assert.ok(indexApi.reindex.calledOnce)
      assert.strictEqual(repo.state.taskId, 'task-1')
    })

    it('does not re-issue the reindex when a taskId is already stored', async () => {
      repo.seed(baseInput({
        stage         : Stage.INITIAL_REINDEXING,
        taskId        : 'existing',
        lastSyncedDate: new Date().toISOString(),
      }))

      await build().reindex(baseInput())

      assert.ok(indexApi.reindex.notCalled)
      assert.ok(indexApi.getTask.called)
      assert.strictEqual(repo.state.stage, Stage.REINDEXING_COMPLETED)
    })

    it('marks FAILED when the task is lost or finished with failures (ReindexingError)', async () => {
      indexApi.getTask.rejects(new IndexApi.Errors.ReindexingError('gone'))

      await assert.rejects(build().reindex(baseInput()), /reindexing task could not be completed/i)

      assert.strictEqual(repo.state.stage, Stage.REINDEXING_FAILED)
      assert.strictEqual(repo.acquiredAt, null)
    })
  })

  describe('createIndex', () => {
    it('swallows IndexAlreadyExistsError and proceeds (idempotent resume)', async () => {
      indexApi.createIndex.rejects(new IndexApi.Errors.IndexAlreadyExistsError('exists'))

      await build().reindex(baseInput())

      assert.ok(indexApi.reindex.calledOnce)
      assert.strictEqual(repo.state.stage, Stage.REINDEXING_COMPLETED)
    })

    it('wraps a createIndex failure as non-resumable and marks FAILED', async () => {
      indexApi.createIndex.rejects(new Error('Index was not created'))

      await assert.rejects(build().reindex(baseInput()), /Can not create the destination index/)

      assert.strictEqual(repo.state.stage, Stage.REINDEXING_FAILED)
    })
  })

  describe('MANUAL_INDEXING convergence', () => {
    it('loops until a sync indexes <= the acceptable backlog', async () => {
      const counts = [600, 600, 100] // 2 iterations above the 500-doc threshold, then a final one within it

      postSync = makePostSynchronizer(() => Promise.resolve(counts.shift()))

      await build().reindex(baseInput())

      // 3 converging MANUAL iterations + 1 FINAL sync
      assert.strictEqual(postSync.sync.callCount, 4)
      // every sync receives the reindexing config carrying the target and a checkpoint
      postSync.sync.getCalls().forEach(call => {
        assert.strictEqual(call.args[0].target, 'reindex_test_v2')
        assert.ok(call.args[0].lastSyncedDate)
      })
    })
  })

  describe('ALIAS_UPDATE', () => {
    it('treats an alias-swap failure as transient — no FAILED', async () => {
      indexApi.updateAlias.rejects(new Error('Alias was not updated'))

      await assert.rejects(build().reindex(baseInput()), /Alias was not updated/)

      assert.strictEqual(repo.state.stage, Stage.ALIAS_UPDATE)
      assert.strictEqual(repo.acquiredAt, null)
    })
  })
})