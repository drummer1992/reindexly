const isNil = (value: any) => value == null

export const pick = <T extends Record<string, unknown>, K extends keyof T>(object: T, props: K[]): Pick<T, K> => {
  const result = {} as Pick<T, K>

  props.forEach(prop => {
    result[prop] = object[prop]
  })

  return result
}

export const omitBy = <T extends Record<string, unknown>>(
  object: T,
  predicate: (value: T[keyof T], key: keyof T) => boolean = isNil
): Partial<T> => {
  const result: Partial<T> = {}

  for (const prop of Object.keys(object) as Array<keyof T>) {
    if (!predicate(object[prop], prop)) {
      result[prop] = object[prop]
    }
  }

  return result
}