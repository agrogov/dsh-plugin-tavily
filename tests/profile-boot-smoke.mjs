/**
 * Real-profile boot smoke for the built dsh-plugin-tavily.
 *
 * Installs the packed plugin into a fresh dsh web profile, boots `dsh web`
 * headless, and asserts the server comes up, the plugin's client bundle is
 * installed with the keyed card registration (`key`, with no retired list-slot fields), and
 * no plugin-load failure markers appear in the boot log. This is the
 * install→boot wiring check; the slot-contract semantics of the installed
 * registration are pinned separately by `tests/slot-contract-compat.mjs`
 * (run per `@deepseek-ai/dsh-client-ui-slots` version).
 *
 * Env:
 *   PLUGIN_TGZ       path to the packed plugin tarball (required)
 *   DSH_CMD          dsh CLI invocation (default `dsh`; e.g.
 *                    `node /path/to/@deepseek-ai/dsh/lib/bin.js`)
 *   SMOKE_DSH_HOME   profile root (default: a fresh temp dir; the ambient
 *                    DSH_HOME is deliberately NEVER used, so a developer's
 *                    real profile can't be touched by accident)
 *   PORT             fixed listen port (default 46999)
 *
 * Usage:
 *   pnpm build && pnpm pack --pack-destination /tmp
 *   PLUGIN_TGZ=/tmp/dsh-external-dsh-plugin-tavily-*.tgz node tests/profile-boot-smoke.mjs
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PLUGIN_TGZ = process.env.PLUGIN_TGZ
assert.ok(PLUGIN_TGZ, 'PLUGIN_TGZ must point at the packed plugin tarball')
const DSH_CMD = process.env.DSH_CMD ?? 'dsh'
const explicitHome = process.env.SMOKE_DSH_HOME
const DSH_HOME = explicitHome ?? mkdtempSync(join(tmpdir(), 'dsh-profile-smoke-'))
const HOME_CREATED = !explicitHome
const PORT = Number(process.env.PORT ?? 46999)
const INSTALLED_CLIENT_BUNDLE = join(DSH_HOME, 'profiles', 'web', 'node_modules', '@dsh-external', 'dsh-plugin-tavily', 'lib', 'client.cjs')

const FAILURE_MARKERS = [
  /Failed to load plugins/i,
  /requires options\.(id|key)/,
  /unhandled|ECONNREFUSED/i,
]

function run(cmd, args, opts = {}) {
  // DSH_CMD may itself be a compound command (e.g. `npx --package … dsh`), so
  // the child runs through a shell; args are joined into the command line and
  // are either fixed literals or the required tarball path.
  const res = spawnSync([cmd, ...args].join(' '), { encoding: 'utf8', shell: true, env: { ...process.env, DSH_HOME }, ...opts })
  if (res.error) throw res.error
  return res
}

function waitForPort(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (Date.now() > deadline) return reject(new Error(`port ${port} never opened within ${timeoutMs}ms`))
      const sock = connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); resolve() })
      sock.once('error', () => { sock.destroy(); setTimeout(tryOnce, 500) })
    }
    tryOnce()
  })
}

try {
  // 1. Install the plugin into a fresh web profile (initializes + pnpm add).
  const add = run(DSH_CMD, ['plugin', '--profile', 'web', 'add', PLUGIN_TGZ], { timeout: 180_000 })
  assert.equal(add.status, 0, `dsh plugin add failed:\n${add.stdout}\n${add.stderr}`)

  // 2. Boot `dsh web` headless and wait for the listen port.
  const server = spawn([DSH_CMD, 'web', '--no-open', '--port', String(PORT)].join(' '), {
    env: { ...process.env, DSH_HOME },
    shell: true,
  })
  let bootLog = ''
  server.stdout.on('data', (d) => { bootLog += d })
  server.stderr.on('data', (d) => { bootLog += d })
  const exit = new Promise((resolve) => server.once('exit', (code, sig) => resolve({ code, sig })))
  await waitForPort(PORT)

  // 3. Verify the installed browser bundle. In 0.1.2 the /plugins routes are
  // browser-session authenticated, so an unauthenticated Node fetch correctly
  // receives 404/401 and is not a useful load assertion.
  const bundle = readFileSync(INSTALLED_CLIENT_BUNDLE, 'utf8')
  assert.ok(bundle.includes('web-search-tavily'), 'installed client bundle must contain the Tavily card namespace')
  assert.match(bundle, /key\s*:\s*CARD_KEY/, 'installed client bundle must register with `key`')

  // The meaningful liveness guarantee is "still serving when the checks above
  // ran" — dsh web shuts down gracefully (exit 0) on SIGTERM, so a post-kill
  // exit code is expected. Only a pre-kill exit is a failure.
  assert.ok(
    server.exitCode === null && server.signalCode === null,
    `dsh web exited before the smoke finished (code=${server.exitCode}, sig=${server.signalCode})`,
  )
  server.kill('SIGTERM')
  await exit

  // 4. Boot log must carry no plugin-load failure markers.
  const hits = FAILURE_MARKERS.filter((m) => m.test(bootLog))
  assert.deepEqual(hits, [], `boot log contains failure markers:\n${bootLog}`)

  console.log(`profile-boot-smoke: ok — ${DSH_HOME} installed, dsh web stayed live with the keyed client bundle (port ${PORT})`)
} finally {
  if (HOME_CREATED) rmSync(DSH_HOME, { recursive: true, force: true })
}

// dsh web may leave a descendant process holding the stdio pipes after the
// server itself has exited; that would keep this script's event loop alive
// and hang the CI step long past a passed smoke (observed on an earlier release
// leg: the ok line printed at 16:47:59, the job only ended when its 15-minute
// timeout cancelled it). Exit explicitly so the runner sees a finished step.
// Everything above the try/finally has already run; on an assertion throw the
// finally still cleans up and the uncaught error exits with code 1 first.
process.exit(0)