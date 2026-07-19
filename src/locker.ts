import Repository from './repository'
import assert from 'assert'

export default class Locker {
  constructor(private readonly repository: Repository) {
    assert((repository as unknown) instanceof Repository, 'repository should be an instance of Repository')
  }

  public async runWithLock<T>(fn: () => Promise<T>, busyMessage: string): Promise<T | never> {
    let acquired

    try {
      acquired = await this.repository.acquire()

      assert(acquired, busyMessage)

      return await fn()
    } finally {
      acquired && await this.repository.release()
    }
  }
}