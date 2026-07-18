export type ISODateString = string & { readonly __brand: 'ISODateString' };

export const toISOString = (date: Date | ISODateString): ISODateString => {
  return new Date(date).toISOString() as ISODateString;
}