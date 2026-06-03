'use strict'

const isNil = value => value == null

exports.pick = (object, props) => {
  const result = {}

  props.forEach(prop => {
    result[prop] = object[prop]
  })

  return result
}

exports.omitBy = (object, predicate = isNil) => {
  const result = {}

  for (const prop in object) {
    if (!predicate(object[prop], prop)) {
      result[prop] = object[prop]
    }
  }

  return result
}