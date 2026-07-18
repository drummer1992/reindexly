const DEFAULT_TIMEOUT = 20000
const DEFAULT_PAUSE = 2500

export class TimeoutError extends Error {
}

const pause = (ms: number) => new Promise(resolve => {
  setTimeout(resolve, ms)
})

export const doWhilst = async <T>(iteratee: () => Promise<T>, isDone: (result: T) => Promise<boolean> | boolean) => {
  let result

  while (true) {
    result = await iteratee()

    if (await isDone(result)) {
      break
    }
  }

  return result
}

type WaitForOptions = {
  timeout?: number
  pause?: number
  timeoutError?: Error | string
}

export const waitFor = <T>(probe: () => Promise<T>, isDone: (result: T) => Promise<boolean> | boolean, {
  timeout = DEFAULT_TIMEOUT,
  pause: pauseMs = DEFAULT_PAUSE,
  timeoutError,
}: WaitForOptions = {}): Promise<T | never> => {
  const start = new Date().getTime()

  return doWhilst(probe, async result => {
    if (await isDone(result)) {
      return true
    }

    const waitTime = new Date().getTime() - start

    if (waitTime > timeout) {
      if (timeoutError instanceof Error) throw timeoutError

      throw new TimeoutError(timeoutError || 'Timeout occurred in waitFor statement')
    }

    await pause(pauseMs)

    return false
  })
}