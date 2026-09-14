/**
 * Contract regression test for the Harness 0.1.2 keyed settings-plugin slot.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const slotRoot = process.env.SLOTS_PACKAGE_DIR
  ? join(process.env.SLOTS_PACKAGE_DIR, '__probe__.mjs')
  : join(here, '__probe__.mjs')
const requireFrom = createRequire(pathToFileURL(slotRoot))
const { SlotCore } = requireFrom('@deepseek-ai/dsh-client-ui-slots')
const bundlePath = join(here, '..', 'lib', 'client.cjs')
let bundle
try {
  bundle = readFileSync(bundlePath, 'utf8')
} catch {
  throw new Error('lib/client.cjs not found — run pnpm build before this test')
}

const key = /const CARD_KEY = "([^"]+)"/.exec(bundle)?.[1]
assert.equal(key, 'web-search-tavily', 'shipped card key must be the Tavily settings namespace')
assert.match(bundle, /\bkey: CARD_KEY/, 'shipped card registration must carry key')
assert.doesNotMatch(bundle, /\bid: CARD_KEY/, '0.1.2 card registration must not use the retired list-slot id')
assert.doesNotMatch(bundle, /\border: CARD_ORDER/, '0.1.2 card registration must not use the retired list-slot order')

const core = new SlotCore()
core.register({ name: 'root', children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } } }, () => {})
assert.doesNotThrow(() => core.register({ name: 'settings.plugin.item', key }, () => {}))
const [entry] = core.entriesOfSlot('settings.plugin.item')
assert.equal(entry.options.key, key)

const slotsVersion = requireFrom('@deepseek-ai/dsh-client-ui-slots/package.json').version
console.log('slot-contract-compat: ok — keyed Tavily card registration accepted by SlotCore ' + slotsVersion)
