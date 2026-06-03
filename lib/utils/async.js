'use strict'

const DEFAULT_TIMEOUT = 20000
const DEFAULT_PAUSE = 2500

class TimeoutError extends Error {
}

const pause = ms => new Promise(resolve => {
  setTimeout(resolve, ms)
})

const doWhilst = async (iteratee, isDone) => {
  let result

  while (true) {
    result = await iteratee()

    if (await isDone(result)) {
      break
    }
  }

  return result
}

const waitFor = (probe, isDone, { timeout = DEFAULT_TIMEOUT, pause: pauseMs = DEFAULT_PAUSE, timeoutError } = {}) => {
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
  })
}

exports.pause = pause
exports.doWhilst = doWhilst
exports.waitFor = waitFor
exports.TimeoutError = TimeoutError