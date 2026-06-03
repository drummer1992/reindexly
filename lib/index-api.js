'use strict'
/* eslint-disable require-await,no-unused-vars */

const assert = require('assert')

const isErrorOfType = (err, type) => err.body?.error?.type === type

class ReindexingError extends Error {
}

class IndexAlreadyExistsError extends Error {
}

/**
 * @typedef {Object} TaskResponse
 * @property {Boolean} completed
 * @property {Object} task
 * @property {Object} [response]
 * @property {Object} [error]
 */

class IndexApi {
  static Errors = {
    IndexAlreadyExistsError,
    ReindexingError,
  }

  /**
   * @param {import('./repository').Reindexing} reindexing
   * @returns {Promise<String>} taskId
   */
  async reindex(reindexing) {
    const result = await this._request('post', '_reindex', {
      conflicts: 'proceed',
      source   : { index: reindexing.source, query: reindexing.query },
      dest     : { index: reindexing.target, pipeline: reindexing.pipeline },
      script   : reindexing.painlessScript ? { source: reindexing.painlessScript } : undefined,
    }, {
      slices             : 'auto',
      refresh            : false,
      wait_for_completion: false,
    })

    assert(result?.task, `No 'task' identifier in the reindex response. ${JSON.stringify(result)}`)

    return result.task
  }

  /**
   * @param {String} taskId
   * @returns {Promise<TaskResponse>} the task
   * @throws {ReindexingError} if the task no longer exists or completed with failures
   */
  async getTask(taskId) {
    const response = await this._request('get', `_tasks/${taskId}`).catch(err => {
      if (isErrorOfType(err, 'resource_not_found_exception') || err.status === 404) {
        throw new IndexApi.Errors.ReindexingError(`Task with id ${taskId} not found. Original: ${err.message}`)
      }

      throw err
    })

    assert(response, 'No response from getTask')

    if (response.response?.failures?.length || response.error) {
      throw new IndexApi.Errors.ReindexingError(`Error in reindexing task. Original: ${JSON.stringify(response)}`)
    }

    assert(typeof response.completed === 'boolean', 'No task information in response of getTask')

    return response
  }

  /**
   * @param {import('./repository').Reindexing} reindexing
   * @returns {Promise<void>}
   */
  async createIndex(reindexing) {
    const response = await this._request('put', reindexing.target, { mappings: reindexing.mapping }).catch(err => {
      if (isErrorOfType(err, 'resource_already_exists_exception')) {
        throw new IndexApi.Errors.IndexAlreadyExistsError(`Index already exists. Original: ${err.message}`)
      }

      throw err
    })

    assert(response?.acknowledged, `Index was not created. ${JSON.stringify(response)}`)
  }

  /**
   * @param {import('./repository').Reindexing} reindexing
   * @returns {Promise<void>}
   */
  async updateAlias(reindexing) {
    const response = await this._request('post', '_aliases', {
      actions: [
        { remove: { index: reindexing.source, alias: reindexing.alias } },
        { add: { index: reindexing.target, alias: reindexing.alias } },
      ],
    })

    assert(response?.acknowledged, `Alias was not updated. ${JSON.stringify(response)}`)
  }

  /**
   * @param {'get'|'post'|'put'} method
   * @param {String} path
   * @param {Object} [body]
   * @param {Object} [query]
   * @returns {Promise<*>}
   */
  async _request(method, path, body, query) {
    throw new Error('Not implemented')
  }
}

module.exports = IndexApi