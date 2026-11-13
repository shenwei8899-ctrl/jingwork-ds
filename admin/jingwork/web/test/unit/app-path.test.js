import assert from 'node:assert/strict'
import test from 'node:test'
import { appPath, userTokenKey } from '../../src/utils/appPath.js'

test('application prefix covers API, assets and navigation without duplicating it', () => {
  assert.equal(appPath('/api/auth/me', '/work/'), '/work/api/auth/me')
  assert.equal(appPath('/assets/icon.svg', '/work/'), '/work/assets/icon.svg')
  assert.equal(appPath('/login', '/work/'), '/work/login')
  assert.equal(appPath('/work/api/auth/me', '/work/'), '/work/api/auth/me')
  assert.equal(appPath('/workbench', '/work/'), '/work/workbench')
})

test('root deployments and external URLs keep their existing targets', () => {
  assert.equal(appPath('/api/auth/me', '/'), '/api/auth/me')
  assert.equal(appPath('https://identity.example/iam/', '/work/'), 'https://identity.example/iam/')
  assert.equal(appPath('//cdn.example/image', '/work/'), '//cdn.example/image')
  assert.equal(userTokenKey, 'user_token')
})
