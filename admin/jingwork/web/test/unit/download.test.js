import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileStyle, compileTemplate, parse } from 'vue/compiler-sfc'
import { desktopRelease, otherPlatforms } from '../../src/content/downloads.js'
import { isReleaseAvailable } from '../../src/apis/download_api.js'

test('下载元数据与已验证的 Jing Work 品牌预览包一致', () => {
  assert.equal(desktopRelease.bytes, 218312472)
  assert.ok(desktopRelease.filename.startsWith('JingWork-'))
  assert.equal(desktopRelease.url, `/downloads/${desktopRelease.filename}`)
  assert.equal(
    desktopRelease.sha256,
    '5d6f21df2281ac0141224ae28f00d0aced3625cb70cfbacf509fd31af7ea0afc'
  )
  assert.equal(desktopRelease.version, '1.0.2b8')
  assert.equal(desktopRelease.status, '开发预览版')
})

test('仅实际存在且大小一致的安装包可以启用下载', async () => {
  const signal = new AbortController().signal
  assert.equal(
    await isReleaseAvailable(desktopRelease, {
      signal,
      fetcher: async (url, options) => {
        assert.equal(url, desktopRelease.url)
        assert.equal(options.method, 'HEAD')
        assert.equal(options.signal, signal)
        return new Response(null, {
          headers: {
            'Content-Length': String(desktopRelease.bytes),
            'Content-Type': 'application/octet-stream'
          }
        })
      }
    }),
    true
  )
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, {
      headers: { 'Content-Type': 'text/html', 'Content-Length': String(desktopRelease.bytes) }
    }),
    new Response(null, { headers: { 'Content-Length': '42' } }),
    new Response(null)
  ]) {
    assert.equal(await isReleaseAvailable(desktopRelease, { fetcher: async () => response }), false)
  }
  await assert.rejects(
    isReleaseAvailable(desktopRelease, {
      fetcher: async () => {
        throw new Error('offline')
      }
    }),
    /offline/
  )
})

test('各平台指向对应安装包而非上游地址', () => {
  assert.deepEqual(
    otherPlatforms.map((platform) => platform.name),
    ['macOS Intel', 'Windows x64', 'Windows ARM64']
  )
  for (const platform of otherPlatforms) {
    assert.equal(platform.url, `/downloads/${platform.filename}`)
    assert.ok(platform.bytes > 0)
    assert.match(platform.sha256, /^[a-f0-9]{64}$/)
  }
  const view = readFileSync(new URL('../../src/views/DownloadView.vue', import.meta.url), 'utf8')
  assert.ok(!view.includes('github.com/TencentCloud'))
  assert.ok(view.includes('未经 Apple 公证'))
  assert.ok(view.includes('隐私与安全性'))
  assert.ok(view.includes('仍要打开'))
})

test('下载页和首页模板可编译，导航下载与工作台入口保持独立', () => {
  for (const name of ['DownloadView', 'HomeView']) {
    const source = readFileSync(new URL(`../../src/views/${name}.vue`, import.meta.url), 'utf8')
    const { descriptor } = parse(source)
    const { errors } = compileTemplate({
      source: descriptor.template.content,
      filename: `${name}.vue`,
      id: `test-${name}`
    })
    assert.deepEqual(errors, [])
  }
  const home = readFileSync(new URL('../../src/views/HomeView.vue', import.meta.url), 'utf8')
  assert.equal((home.match(/href="\/download"/g) || []).length, 2)
  assert.ok(home.includes("path: '/agent'"))
})

test('深色图标滤镜只作用于下载页图标，不反色整个页面', () => {
  const source = readFileSync(
    new URL('../../src/assets/css/jing-download.css', import.meta.url),
    'utf8'
  )
  const { code, errors } = compileStyle({ source, id: 'data-v-download', scoped: true })
  assert.deepEqual(errors, [])
  assert.match(
    code,
    /:root\.dark \.download-platform-icon img\[data-v-download\]\s*\{\s*filter: invert\(1\)/
  )
  assert.doesNotMatch(code, /:root\.dark\s*\{[^}]*filter:/)
})
