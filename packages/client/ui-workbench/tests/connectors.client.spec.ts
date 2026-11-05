/** Connector catalog copy is owned by typed locale dictionaries. */
import { expect, it } from 'vitest'
import { CONNECTOR_CATALOG } from '../src/connector-catalog.ts'
import { zh, en } from '../src/client/locales.ts'

it('localizes every bundled connector title and description', () => {
  for (const entry of CONNECTOR_CATALOG) {
    expect(zh[entry.nameKey]).toBeTruthy()
    expect(en[entry.nameKey]).toBeTruthy()
    expect(zh[entry.descriptionKey]).toBeTruthy()
    expect(en[entry.descriptionKey]).toBeTruthy()
  }
})
