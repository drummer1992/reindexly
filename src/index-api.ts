import {Reindexing} from "./repository";
import assert from "assert";

export type HttpMethod = 'get' | 'post' | 'put'

export type TaskResponse = {
  completed: boolean

  response?: {
    failures?: Array<{
      status: number
      cause: {
        type: string
        reason: string
      }
    }>,
  }

  error?: {
    type: string
    reason: string

    caused_by?: {
      type: string
      reason: string
    }
  }
}

export type ReindexingResponse = {
  task: string
}

type IndexResponseError = {
  message: any
  status: number
  body: any
}

const toIndexResponseError = (err: unknown): IndexResponseError => {
  const error = err as IndexResponseError

  assert(error.message, 'No message in the error')
  assert(error.status, 'No status in the error')
  assert(error.body, 'No body in the error')

  return error
}

class ReindexingError extends Error {
}

class IndexAlreadyExistsError extends Error {
}

const isErrorOfType = (err: IndexResponseError, type: string) => {
  return err.body?.error?.type === type
}

export default abstract class IndexApi {
  static Errors = {
    IndexAlreadyExistsError,
    ReindexingError,
  }

  public async reindex(reindexing: Reindexing): Promise<string | never> {
    const result = await this._request('post', '_reindex', {
      conflicts: 'proceed',
      source: {index: reindexing.source, query: reindexing.query},
      dest: {index: reindexing.target, pipeline: reindexing.pipeline},
      script: reindexing.painlessScript ? {source: reindexing.painlessScript} : undefined,
    }, {
      slices: 'auto',
      refresh: false,
      wait_for_completion: false,
    }) as ReindexingResponse

    assert(result?.task, `No 'task' identifier in the reindex response. ${JSON.stringify(result)}`)

    return result.task
  }

  async getTask(taskId: string): Promise<TaskResponse | never> {
    const response = await this._request('get', `_tasks/${taskId}`).catch((err: unknown) => {
      const error = toIndexResponseError(err)

      if (isErrorOfType(error, 'resource_not_found_exception') || error.status === 404) {
        throw new IndexApi.Errors.ReindexingError(`Task with id ${taskId} not found. Original: ${error.message}`)
      }

      throw error
    }) as TaskResponse

    assert(response, 'No response from getTask')

    if (response.response?.failures?.length || response.error) {
      throw new IndexApi.Errors.ReindexingError(`Error in reindexing task. Original: ${JSON.stringify(response)}`)
    }

    assert(typeof (response.completed as unknown) === 'boolean', 'No task information in response of getTask')

    return response
  }

  async createIndex(reindexing: Reindexing): Promise<void | never> {
    const response = await this._request('put', reindexing.target, {mappings: reindexing.mapping}).catch((err: unknown) => {
      const error = toIndexResponseError(err)

      if (isErrorOfType(error, 'resource_already_exists_exception')) {
        throw new IndexApi.Errors.IndexAlreadyExistsError(`Index already exists. Original: ${error.message}`)
      }

      throw err
    }) as { acknowledged: boolean }

    assert(response?.acknowledged, `Index was not created. ${JSON.stringify(response)}`)
  }

  async updateAlias(reindexing: Reindexing): Promise<void | never> {
    const response = await this._request('post', '_aliases', {
      actions: [
        {remove: {index: reindexing.source, alias: reindexing.alias}},
        {add: {index: reindexing.target, alias: reindexing.alias}},
      ],
    }) as { acknowledged: boolean }

    assert(response?.acknowledged, `Alias was not updated. ${JSON.stringify(response)}`)
  }

  protected abstract _request(method: HttpMethod, path: string, body?: object, query?: object): Promise<unknown>
}