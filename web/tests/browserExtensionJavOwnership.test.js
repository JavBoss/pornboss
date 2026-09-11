import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../../browser-extension/content/jav-ownership.js', import.meta.url),
  'utf8'
)

function createHarness({ list = [], detail = [], respond, framed = false, site = 'javdb' } = {}) {
  const timers = new Map()
  const listeners = {}
  const calls = []
  let nextTimer = 0
  let now = 0
  let messageListener
  let mutationListener
  function attach(node, parent, entry) {
    node.parentElement = parent
    node.owner = entry
    if (node.dataset?.javbossOwnership && !entry.badges.includes(node)) entry.badges.push(node)
    for (const child of node.children || []) attach(child, node, entry)
  }
  const makeEntry = (input, label) => {
    const code = typeof input === 'string' ? input : input.code
    const related = typeof input === 'object' && input.related
    const entry = {
      badges: [],
      classList: { contains: () => false },
      getAttribute: () => (typeof input === 'object' && input.href ? input.href : `/en/${code}`),
      querySelector(selector) {
        if (selector === '.cover' || selector === '.photo-frame') return this.cover
        if (selector === '.photo-info date') return related ? null : this.code
        if (selector === '.id') return this.code
        if (selector === 'a[href]') return this
        if (selector === 'img') return this.image
        if (selector === '.header') return { textContent: label, nextElementSibling: this.code }
        if (selector === '.video-title strong' || selector === '.value') return this.code
        if (selector === 'strong') return { textContent: label }
        if (selector === '[data-javboss-ownership]') return this.badges[0] || null
        return null
      },
      insertBefore(badge, sibling) {
        assert.equal(sibling, label ? this.code.nextSibling : null)
        attach(badge, this, this)
      },
    }
    entry.cover = {
      badges: entry.badges,
      classList: { add() {} },
      querySelector: (selector) =>
        selector === '[data-javboss-ownership]'
          ? entry.badges[0] || null
          : selector === 'img'
            ? entry.image
            : null,
      insertBefore(badge, sibling) {
        assert.ok(sibling === null || sibling === entry.image)
        attach(badge, this, entry)
      },
    }
    entry.code = {
      textContent: code,
      parentElement: entry,
      nextSibling: { textContent: ' title' },
      tagName: site === 'javlibrary' && label ? 'TD' : 'SPAN',
    }
    entry.image = { parentElement: site === 'javbus' ? entry.cover : entry, src: 'cover.jpg' }
    return entry
  }
  const entries = list.map((code) => makeEntry(code))
  const blocks = detail.map(([label, code]) => makeEntry(code, label))
  const document = {
    body: {},
    querySelectorAll(selector) {
      if (selector === '[data-javboss-ownership]')
        return [...entries, ...blocks].flatMap((entry) => entry.badges)
      if (['.movie-list .item', 'a.movie-box', '.videothumblist .video'].includes(selector))
        return entries
      if (['.movie-panel-info .panel-block', '.movie .info p'].includes(selector)) return blocks
      return []
    },
    querySelector(selector) {
      return selector === '#video_id .text' ? blocks[0]?.code : null
    },
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        children: [],
        get classList() {
          return { contains: (name) => (this.className || '').split(' ').includes(name) }
        },
        appendChild(child) {
          this.children.push(child)
          child.parentElement = this
          if (this.owner) attach(child, this, this.owner)
        },
        dataset: {},
        remove() {
          const siblings = this.owner.badges
          for (const badge of [...siblings]) {
            if (badge === this || this.children?.includes(badge))
              siblings.splice(siblings.indexOf(badge), 1)
          }
        },
        attributes: {},
        listeners: {},
        setAttribute(key, value) {
          this.attributes[key] = value
        },
        removeAttribute(key) {
          delete this.attributes[key]
        },
        addEventListener(key, value) {
          this.listeners[key] = value
        },
      }
    },
  }
  const window = {
    location: {
      origin: `https://${site === 'javdb' ? site : 'www.' + site}.com`,
      href: `https://${site === 'javdb' ? site : 'www.' + site}.com/`,
    },
    setTimeout(callback) {
      timers.set(++nextTimer, callback)
      return nextTimer
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    addEventListener(type, listener) {
      listeners[type] = listener
    },
  }
  window.top = framed ? {} : window
  let responder =
    respond ||
    ((codes) => ({ ok: true, items: codes.map((code) => ({ code, owned: code === 'ABC-123' })) }))
  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener
        },
      },
      async sendMessage(message) {
        assert.equal(message.type, 'JAVBOSS_JAV_OWNERSHIP')
        calls.push(Array.from(message.codes))
        return responder(Array.from(message.codes))
      },
    },
  }
  vm.runInNewContext(source, {
    Date: { now: () => now },
    window,
    URL,
    document,
    chrome,
    MutationObserver: class {
      constructor(listener) {
        mutationListener = listener
      }
      observe() {}
    },
  })
  async function flush() {
    let count = 0
    while (timers.size) {
      assert.ok(count++ < 10, 'scan should settle instead of polling repeatedly')
      const pending = [...timers.values()]
      timers.clear()
      await Promise.all(pending.map((callback) => callback()))
    }
  }
  return {
    entries,
    blocks,
    calls,
    flush,
    listeners,
    advanceTime: (milliseconds) => {
      now += milliseconds
    },
    mutate: () => mutationListener(),
    refresh: () => messageListener({ type: 'JAVBOSS_JAV_OWNERSHIP_REFRESH' }),
    toggle: (enabled) => messageListener({ type: 'JAVBOSS_OWNERSHIP_SETTINGS_CHANGED', enabled }),
    respond: (callback) => {
      responder = callback
    },
    add: (code) => {
      const entry = makeEntry(code)
      entries.push(entry)
      mutationListener()
      return entry
    },
  }
}

test('JavDB marks list covers and detail codes once, sharing a batch for duplicates', async () => {
  const h = createHarness({
    list: ['ABC-123', 'ABC-124', 'ABC-123', 'Milfy.2026.09.09'],
    detail: [
      ['番號:', '082226_01'],
      ['日期:', '2026-08-22'],
    ],
  })
  await h.flush()
  assert.deepEqual(h.calls, [['ABC-123', 'ABC-124', 'Milfy.2026.09.09', '082226_01']])
  assert.equal(h.entries[0].badges[0].textContent, '已拥有')
  assert.equal(h.entries[0].badges[0].parentElement, h.entries[0].cover)
  assert.equal(h.entries[1].badges.length, 0)
  assert.equal(h.blocks[0].badges.length, 0)
  assert.equal(h.blocks[1].badges.length, 0)
  h.mutate()
  await h.flush()
  assert.equal(h.calls.length, 1)
  assert.equal(h.entries[0].badges.length, 1)
  assert.equal(h.entries[0].code.textContent, 'ABC-123')
})

test('JavDB queries dynamically inserted cards and changed codes without losing cached results', async () => {
  const h = createHarness({ list: ['ABC-123'] })
  await h.flush()
  const duplicate = h.add('ABC-123')
  const added = h.add('ABC-125')
  await h.flush()
  assert.deepEqual(h.calls, [['ABC-123'], ['ABC-125']])
  assert.equal(duplicate.badges[0].dataset.javbossOwnership, 'owned')
  assert.equal(added.badges.length, 0)
  h.entries[0].code.textContent = 'ABC-126'
  h.mutate()
  await h.flush()
  assert.deepEqual(h.calls[2], ['ABC-126'])
  assert.equal(h.entries[0].badges.length, 0)
})

test('JavDB splits large pages into bounded batches and ignores malformed codes and frames', async () => {
  const h = createHarness({
    list: [...Array.from({ length: 401 }, (_, i) => `ABC-${i}`), '', '%bad', 'A'.repeat(129)],
  })
  await h.flush()
  assert.deepEqual(
    h.calls.map((codes) => codes.length),
    [200, 200, 1]
  )
  const framed = createHarness({ list: ['ABC-123'], framed: true })
  await framed.flush()
  assert.equal(framed.calls.length, 0)
})

test('JavDB shows no unconfirmed badge and preserves confirmed badges on failure', async () => {
  const h = createHarness({
    list: ['ABC-123'],
    detail: [['番號:', 'ABC-123']],
    respond: () => ({ ok: true, items: [] }),
  })
  await h.flush()
  assert.equal(h.entries[0].badges.length, 0)
  assert.equal(h.blocks[0].badges.length, 0)
  h.respond((codes) => ({ ok: true, items: codes.map((code) => ({ code, owned: true })) }))
  h.refresh()
  await h.flush()
  assert.equal(h.entries[0].badges[0].textContent, '已拥有')
  assert.equal(h.blocks[0].badges[0].textContent, '已拥有')
  h.respond(() => {
    throw new Error('disconnected')
  })
  h.refresh()
  await h.flush()
  assert.equal(h.entries[0].badges.length, 1)
  assert.equal(h.blocks[0].badges.length, 1)
})

test('JavDB inserts list and detail badges only after ownership is confirmed and discards stale responses', async () => {
  let resolve
  const h = createHarness({
    list: ['ABC-123'],
    detail: [['番號:', 'ABC-123']],
    respond: () =>
      new Promise((done) => {
        resolve = done
      }),
  })
  const pending = h.flush()
  assert.equal(h.entries[0].badges.length, 0)
  assert.equal(h.blocks[0].badges.length, 0)
  h.refresh()
  h.add('ABC-124')
  h.respond((codes) => ({ ok: true, items: codes.map((code) => ({ code, owned: false })) }))
  resolve({ ok: true, items: [{ code: 'ABC-123', owned: true }] })
  await pending
  assert.deepEqual(h.calls, [['ABC-123'], ['ABC-123', 'ABC-124']])
  assert.equal(h.entries[0].badges.length, 0)
  assert.equal(h.entries[1].badges.length, 0)
  assert.equal(h.blocks[0].badges.length, 0)

  h.respond(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  h.refresh()
  const confirmed = h.flush()
  assert.equal(h.entries[0].badges.length, 0)
  assert.equal(h.blocks[0].badges.length, 0)
  resolve({
    ok: true,
    items: [
      { code: 'ABC-123', owned: true },
      { code: 'ABC-124', owned: false },
    ],
  })
  await confirmed
  assert.equal(h.entries[0].badges[0].textContent, '已拥有')
  assert.equal(h.entries[1].badges.length, 0)
  assert.equal(h.blocks[0].badges[0].textContent, '已拥有')
})

for (const site of ['javbus', 'javlibrary']) {
  test(`${site} marks covers and detail fields without changing the code or duplicating markup`, async () => {
    let resolve
    const h = createHarness({
      site,
      list: ['ABC-123', 'ABC-124'],
      detail: [['識別碼:', 'ABC-123']],
      respond: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const pending = h.flush()
    assert.equal(h.entries[0].badges.length, 0)
    assert.equal(h.blocks[0].badges.length, 0)
    resolve({
      ok: true,
      items: [
        { code: 'ABC-123', owned: true },
        { code: 'ABC-124', owned: false },
      ],
    })
    await pending
    assert.deepEqual(h.calls, [['ABC-123', 'ABC-124']])
    assert.equal(h.entries[0].badges[0].textContent, '已拥有')
    assert.equal(h.entries[1].badges.length, 0)
    assert.equal(h.blocks[0].badges[0].textContent, '已拥有')
    assert.equal(h.blocks[0].code.textContent, 'ABC-123')
    if (site === 'javlibrary') {
      assert.equal(h.entries[0].badges[0].parentElement, h.entries[0])
      assert.equal(h.entries[0].image.parentElement, h.entries[0])
      assert.equal(h.blocks[0].badges[0].parentElement.tagName, 'TD')
    } else {
      assert.equal(h.entries[0].badges[0].parentElement, h.entries[0].cover)
      assert.equal(h.entries[0].image.parentElement.className, 'javboss-ownership-crop')
    }
    h.mutate()
    await h.flush()
    assert.equal(h.calls.length, 1)
    assert.equal(h.entries[0].badges.length, 1)
    const duplicate = h.add('ABC-123')
    await h.flush()
    assert.equal(duplicate.badges[0].textContent, '已拥有')
    h.respond((codes) => ({ ok: true, items: codes.map((code) => ({ code, owned: false })) }))
    h.refresh()
    await h.flush()
    assert.equal(h.entries[0].badges.length, 0)
    assert.equal(h.blocks[0].badges.length, 0)
  })
}

test('JavBus related cards use the local movie URL when no code is displayed', async () => {
  const h = createHarness({
    site: 'javbus',
    list: [
      { code: 'ABC-123', related: true },
      { code: 'FORUM-123', related: true, href: '/forum/forum.php?mod=viewthread&tid=123' },
      { code: 'ABC-124', related: true, href: 'https://untrusted.example/ABC-124' },
    ],
  })
  await h.flush()
  assert.deepEqual(h.calls, [['ABC-123']])
  assert.equal(h.entries[0].badges[0].textContent, '已拥有')
  assert.equal(h.entries[1].badges.length, 0)
})

for (const site of ['javdb', 'javbus', 'javlibrary']) {
  test(`${site} focus and page restoration preserve badges until ownership changes`, async () => {
    const label = site === 'javdb' ? '番號:' : '識別碼:'
    const h = createHarness({ site, list: ['ABC-123'], detail: [[label, 'ABC-123']] })
    await h.flush()
    const listBadge = h.entries[0].badges[0]
    const detailBadge = h.blocks[0].badges[0]
    const assertPreserved = () => {
      assert.equal(h.entries[0].badges[0], listBadge)
      assert.equal(h.blocks[0].badges[0], detailBadge)
    }
    h.advanceTime(29999)
    h.listeners.focus()
    await h.flush()
    assert.equal(h.calls.length, 1)

    let resolve
    h.respond(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    h.advanceTime(1)
    h.listeners.focus()
    assertPreserved()
    const pending = h.flush()
    assert.equal(h.calls.length, 2)
    assertPreserved()
    resolve({ ok: true, items: [{ code: 'ABC-123', owned: true }] })
    await pending
    assertPreserved()

    for (const response of [{ ok: false }, { ok: true, items: [] }]) {
      h.respond(() => response)
      h.listeners.pageshow({ persisted: true })
      await h.flush()
      assertPreserved()
    }

    h.respond(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    h.advanceTime(30000)
    h.listeners.focus()
    const removal = h.flush()
    assertPreserved()
    resolve({ ok: true, items: [{ code: 'ABC-123', owned: false }] })
    await removal
    assert.equal(h.entries[0].badges.length, 0)
    assert.equal(h.blocks[0].badges.length, 0)
  })

  test(`${site} reused cards and detail fields do not retain another movie's badge`, async () => {
    const label = site === 'javdb' ? '番號:' : '識別碼:'
    const h = createHarness({ site, list: ['ABC-123'], detail: [[label, 'ABC-123']] })
    await h.flush()
    let resolve
    h.respond(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    h.entries[0].code.textContent = 'ABC-124'
    h.blocks[0].code.textContent = 'ABC-124'
    h.mutate()
    const pending = h.flush()
    assert.equal(h.entries[0].badges.length, 0)
    assert.equal(h.blocks[0].badges.length, 0)
    resolve({ ok: false })
    await pending
    assert.equal(h.entries[0].badges.length, 0)
    assert.equal(h.blocks[0].badges.length, 0)
  })

  test(`${site} disabling hides existing badges, stops queries and rejects pending results`, async () => {
    const label = site === 'javdb' ? '番號:' : '識別碼:'
    const h = createHarness({ site, list: ['ABC-123'], detail: [[label, 'ABC-123']] })
    await h.flush()
    assert.equal(h.entries[0].badges.length, 1)
    assert.equal(h.blocks[0].badges.length, 1)
    h.toggle(false)
    assert.equal(h.entries[0].badges.length, 0)
    assert.equal(h.blocks[0].badges.length, 0)
    h.add('ABC-124')
    h.mutate()
    h.refresh()
    h.listeners.pageshow({ persisted: true })
    await h.flush()
    assert.equal(h.calls.length, 1)
    let resolve
    h.respond(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    h.toggle(true)
    const pending = h.flush()
    h.toggle(false)
    resolve({
      ok: true,
      items: [
        { code: 'ABC-123', owned: true },
        { code: 'ABC-124', owned: true },
      ],
    })
    await pending
    assert.equal(h.entries[0].badges.length, 0)
    assert.equal(h.blocks[0].badges.length, 0)
    h.respond((codes) => ({ ok: true, items: codes.map((code) => ({ code, owned: true })) }))
    h.toggle(true)
    await h.flush()
    assert.equal(h.entries[0].badges[0].textContent, '已拥有')
    assert.equal(h.entries[1].badges[0].textContent, '已拥有')
    assert.equal(h.blocks[0].badges[0].textContent, '已拥有')
  })
}

test('a saved disabled preference stops automatic queries on a newly opened page', async () => {
  const h = createHarness({
    list: ['ABC-123'],
    respond: () => ({ ok: true, enabled: false, items: [] }),
  })
  await h.flush()
  assert.equal(h.entries[0].badges.length, 0)
  h.add('ABC-124')
  h.refresh()
  await h.flush()
  assert.equal(h.calls.length, 1)
})
