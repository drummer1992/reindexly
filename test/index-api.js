'use strict'

const assert = require('assert')
const sinon = require('sinon')
const { IndexApi } = require('../lib')

describe('index-api', () => {
  let api, request

  const reindexing = {
    alias         : 'orders',
    source        : 'orders_v1',
    target        : 'orders_v2',
    mapping       : { properties: { id: { type: 'keyword' } } },
    query         : { term: { country: 'AE' } },
    pipeline      : 'enrich',
    painlessScript: 'ctx._source.x = 1',
  }

  beforeEach(() => {
    api = new IndexApi()
    request = sinon.stub(api, '_request')
  })

  afterEach(() => sinon.restore())

  describe('reindex', () => {
    it('posts the sliced async _reindex body with script when present', async () => {
      request.resolves({ task: 'abc' })

      const taskId = await api.reindex(reindexing)

      assert.strictEqual(taskId, 'abc')

      sinon.assert.calledOnceWithExactly(request, 'post', '_reindex', {
        conflicts: 'proceed',
        source   : { index: 'orders_v1', query: reindexing.query },
        dest     : { index: 'orders_v2', pipeline: 'enrich' },
        script   : { source: 'ctx._source.x = 1' },
      }, {
        slices             : 'auto',
        refresh            : false,
        wait_for_completion: false,
      })
    })

    it('omits the script when no painless script is provided', async () => {
      request.resolves({ task: 'abc' })

      await api.reindex({ ...reindexing, painlessScript: undefined })

      assert.strictEqual(request.firstCall.args[2].script, undefined)
    })

    it('throws when the response carries no task identifier', async () => {
      request.resolves({})

      await assert.rejects(api.reindex(reindexing), /No 'task' identifier/)
    })
  })

  describe('createIndex', () => {
    it('puts the target with its mappings', async () => {
      request.resolves({ acknowledged: true })

      await api.createIndex(reindexing)

      sinon.assert.calledOnceWithExactly(request, 'put', 'orders_v2', { mappings: reindexing.mapping })
    })

    it('translates resource_already_exists into IndexAlreadyExistsError', async () => {
      request.rejects({ body: { error: { type: 'resource_already_exists_exception' } }, message: 'exists' })

      await assert.rejects(api.createIndex(reindexing), IndexApi.Errors.IndexAlreadyExistsError)
    })

    it('rethrows unrelated errors', async () => {
      request.rejects(new Error('network'))

      await assert.rejects(api.createIndex(reindexing), /network/)
    })

    it('throws when the index is not acknowledged', async () => {
      request.resolves({ acknowledged: false })

      await assert.rejects(api.createIndex(reindexing), /Index was not created/)
    })
  })

  describe('updateAlias', () => {
    it('swaps the alias atomically (remove from source, add to target)', async () => {
      request.resolves({ acknowledged: true })

      await api.updateAlias(reindexing)

      sinon.assert.calledOnceWithExactly(request, 'post', '_aliases', {
        actions: [
          { remove: { index: 'orders_v1', alias: 'orders' } },
          { add: { index: 'orders_v2', alias: 'orders' } },
        ],
      })
    })

    it('throws when the alias swap is not acknowledged', async () => {
      request.resolves({ acknowledged: false })

      await assert.rejects(api.updateAlias(reindexing), /Alias was not updated/)
    })
  })

  describe('getTask', () => {
    it('gets the task by id and returns it when healthy', async () => {
      request.resolves({ completed: true })

      const result = await api.getTask('node:1')

      sinon.assert.calledOnceWithExactly(request, 'get', '_tasks/node:1')
      assert.deepStrictEqual(result, { completed: true })
    })

    it('translates resource_not_found into ReindexingError', async () => {
      request.rejects({ body: { error: { type: 'resource_not_found_exception' } }, message: 'gone' })

      await assert.rejects(api.getTask('node:1'), IndexApi.Errors.ReindexingError)
    })

    it('translates a 404 status into ReindexingError', async () => {
      request.rejects({ status: 404, body: {}, message: 'not found' })

      await assert.rejects(api.getTask('node:1'), IndexApi.Errors.ReindexingError)
    })

    it('raises ReindexingError when the task completed with failures', async () => {
      request.resolves({ completed: true, response: { failures: [{ reason: 'mapping' }] } })

      await assert.rejects(api.getTask('node:1'), IndexApi.Errors.ReindexingError)
    })

    it('raises ReindexingError when the task carries a top-level error', async () => {
      request.resolves({ completed: true, error: { type: 'search_phase_execution' } })

      await assert.rejects(api.getTask('node:1'), IndexApi.Errors.ReindexingError)
    })
  })
})