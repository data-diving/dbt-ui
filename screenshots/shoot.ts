/**
 * Takes the docs screenshots from the seeded demo stack (see README.md).
 *
 *   npx tsx shoot.ts                     all screenshots
 *   npx tsx shoot.ts using-editor ...    only these
 *
 * Raw captures go to out/raw/, framed ones (browser window around them) to docs/images/screens/.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, type Page, type BrowserContext } from 'playwright'
import { BACKEND_CONTAINER, BASE, DANA, REPOS, api } from './demo.ts'
import { frame } from './frame.ts'

const VIEWPORT = { width: 1440, height: 900 }
const RAW = new URL('./out/raw/', import.meta.url).pathname
const JAFFLE = `${REPOS}/worktrees/jaffle_shop_duckdb-dana-analyst`
/** The same worktree on the host */
const WORKTREE_DIR = fileURLToPath(new URL('./.demo/git-repos/worktrees/jaffle_shop_duckdb-dana-analyst/', import.meta.url))
mkdirSync(RAW, { recursive: true })

type Shot = {
  name: string
  /** No stored identity or project: the app's first start */
  fresh?: boolean
  /** Project the app opens with (default: the jaffle worktree; null: none) */
  project?: string | null
  run: (page: Page, ctx: BrowserContext) => Promise<void>
  /** Part of the page to capture (default: the whole window) */
  clip?: { x: number, y: number, width: number, height: number }
}

/** Browser state of Dana, who has opened the jaffle project before */
const initialStorage = (projectPath: string | null) => ({
  'dbt-ui-git-config': JSON.stringify({ userName: DANA.name, userEmail: DANA.email }),
  ...(projectPath ? { 'dbt-ui-project-path': projectPath } : {}),
  'dbt-ui-recent-projects': JSON.stringify([
    { path: JAFFLE, name: 'jaffle_shop', displayPath: 'https://github.com/dbt-labs/jaffle_shop_duckdb.git', lastOpened: Date.now() },
    { path: `${REPOS}/worktrees/analytics-platform-dana-analyst/transform`, name: 'jaffle_shop',
      displayPath: `${REPOS}/analytics-platform/transform`, lastOpened: Date.now() - 86400e3 },
    { path: `${REPOS}/worktrees/dbt_marketing-dana-analyst`, name: 'marketing',
      displayPath: 'https://github.com/acme/dbt-marketing.git', lastOpened: Date.now() - 3 * 86400e3 },
  ]),
})

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>, shot: Shot) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT, colorScheme: 'dark', timezoneId: 'UTC', locale: 'en-US',
  })
  if (shot.fresh) return ctx
  const storage = initialStorage(shot.project === undefined ? JAFFLE : shot.project)
  await ctx.addInitScript((items: Record<string, string>) => {
    if (sessionStorage.getItem('demo-initialized')) return
    sessionStorage.setItem('demo-initialized', '1')
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, v)
  }, storage)
  return ctx
}

/** Opens the app with the jaffle project and waits until the file tree is there */
async function openApp(page: Page) {
  await page.goto(BASE)
  await page.getByText('models', { exact: true }).first().waitFor()
  await page.waitForTimeout(500)
}

/** Dana's uncommitted work in the jaffle worktree, shown in the file tree and the Git dialog */
async function prepareWorktree() {
  const dir = WORKTREE_DIR
  // The worktree's .git points to the container's paths
  const git = (...args: string[]) =>
    execFileSync('docker', ['exec', 'dbtui-demo-backend-1', 'git', '-C', JAFFLE, ...args], { stdio: 'pipe' })
  git('reset', '--quiet', '--hard')
  const customers = `${dir}models/customers.sql`
  writeFileSync(customers, readFileSync(customers, 'utf8').replace(
    'customer_orders.number_of_orders,',
    'customer_orders.number_of_orders,\n        customer_orders.number_of_orders > 1 as is_repeat_customer,',
  ))
  const stgOrders = `${dir}models/staging/stg_orders.sql`
  writeFileSync(stgOrders, readFileSync(stgOrders, 'utf8').replace('status', 'lower(status) as status'))
  rmSync(`${dir}models/overview.md`)
  await api('/api/git-stage', { path: JAFFLE, files: ['models/staging/stg_orders.sql'] })
}

/** Expands a folder in the file tree and opens a file in it */
async function openFile(page: Page, folders: string[], file: string) {
  for (const folder of folders) {
    await page.locator('.sidebar').getByText(folder, { exact: true }).first().click()
  }
  await page.locator('.sidebar').getByText(file, { exact: true }).first().click()
  await page.waitForTimeout(1200)
}

/** Drags the divider between the editor and the lineage panel to y */
async function dragLineageDivider(page: Page, to: number) {
  const box = (await page.locator('.split-pane-divider.vertical').first().boundingBox())!
  const x = box.x + box.width / 2
  await page.mouse.move(x, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, to, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

async function openScheduler(page: Page, section: 'Jobs' | 'Runs' | 'Settings') {
  await openApp(page)
  await page.getByTitle('Scheduler', { exact: true }).click()
  await page.locator('.scheduler-nav-item', { hasText: section }).click()
  await page.waitForTimeout(1500)
}

/** A run in progress while fn runs: a copy of the latest Nightly build run, started 40 s ago */
async function withRunningRun(fn: () => Promise<void>, page: Page) {
  const sql = (code: string) => execFileSync('docker', ['exec', '-i', BACKEND_CONTAINER, 'python', '-'], {
    input: `import sqlite3, datetime\ndb = sqlite3.connect('/home/dbtui/data/dbt-ui.db', timeout=30)\n${code}\ndb.commit()\n`,
  }).toString()
  const id = sql(`
now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
fmt = lambda d: d.strftime('%Y-%m-%d %H:%M:%S.%f')
cols = [r[1] for r in db.execute('pragma table_info(scheduler_runs)') if r[1] != 'id']
row = dict(zip(cols, db.execute(f"select {','.join(cols)} from scheduler_runs where job_name = 'Nightly build' and status = 'success' order by id desc limit 1").fetchone()))
row.update(status='running', trigger='run_now', triggered_by='${DANA.name}', finished_at=None, exit_code=None,
           queued_at=fmt(now - datetime.timedelta(seconds=41)), started_at=fmt(now - datetime.timedelta(seconds=40)),
           scheduled_for=fmt(now - datetime.timedelta(seconds=41)), models_success=0, models_error=0, error='')
cur = db.execute(f"insert into scheduler_runs ({','.join(row)}) values ({','.join('?' for _ in row)})", list(row.values()))
print(cur.lastrowid)`).trim()
  try {
    await fn()
  } finally {
    sql(`db.execute('delete from scheduler_runs where id = ?', (${id},))`)
  }
}

const shots: Shot[] = [
  {
    name: 'getting-started-identity',
    fresh: true,
    run: async (page) => {
      await page.goto(BASE)
      await page.locator('input').nth(0).fill(DANA.name)
      await page.locator('input').nth(1).fill(DANA.email)
    },
  },
  {
    name: 'getting-started-open-project',
    project: null,
    run: async (page) => {
      const loaded = page.waitForResponse(r => r.url().includes('default-project-path'))
      await page.goto(BASE)
      await loaded
      await page.waitForTimeout(200)
      await page.locator('.path-input').fill('https://github.com/dbt-labs/jaffle_shop_duckdb.git')
    },
  },
  {
    name: 'using-project-browser',
    run: async (page) => {
      await openApp(page)
      await page.locator('.sidebar').getByText('models', { exact: true }).first().click()
      await page.locator('.sidebar').getByText('staging', { exact: true }).first().click()
      await page.locator('.sidebar').getByText('customers.sql', { exact: true }).first().click()
      await page.waitForTimeout(1000)
    },
  },
  {
    name: 'using-editor',
    run: async (page) => {
      await openApp(page)
      await openFile(page, ['models'], 'customers.sql')
    },
  },
  {
    name: 'using-show-data',
    run: async (page) => {
      await openApp(page)
      await openFile(page, ['models'], 'customers.sql')
      await page.getByTitle('Preview data (dbt show)').click()
      await page.getByRole('button', { name: 'Load Data' }).click()
      await page.getByText(/Showing first/).waitFor({ timeout: 60000 })
    },
  },
  {
    name: 'using-lineage',
    run: async (page) => {
      await openApp(page)
      await openFile(page, ['models'], 'customers.sql')
      await page.getByTitle('Enable lineage').click()
      await page.locator('.react-flow__node').first().waitFor({ timeout: 60000 })
      await dragLineageDivider(page, 300)
      await page.locator('.react-flow__controls-fitview').click()
      await page.waitForTimeout(1000)
    },
  },
  {
    name: 'using-running-dbt-dialog',
    run: async (page) => {
      await openApp(page)
      await openFile(page, ['models'], 'customers.sql')
      await page.getByTitle('Run model').click()
      await page.locator('.dbt-run-modal').waitFor()
    },
  },
  {
    name: 'using-running-dbt-result',
    run: async (page) => {
      await openApp(page)
      await openFile(page, ['models'], 'customers.sql')
      await page.getByTitle('Run model').click()
      await page.locator('.dbt-run-modal-run').click()
      await page.getByText(/dbt run completed/i).waitFor({ timeout: 120000 })
      await page.waitForTimeout(500)
    },
  },
  {
    name: 'using-editor-conflict',
    run: async (page) => {
      await openApp(page)
      await openFile(page, ['models'], 'orders.sql')
      // Someone else changes the first line on disk while Dana edits the same line
      const file = `${WORKTREE_DIR}models/orders.sql`
      const original = readFileSync(file, 'utf8')
      writeFileSync(file, original.replace("'gift_card']", "'gift_card', 'voucher']"))
      try {
        await page.locator('.monaco-editor .view-line').first().click()
        await page.keyboard.press('End')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.type(", 'paypal'")
        await page.locator('.save-btn').click()
        await page.locator('.conflict-modal, [class*="conflict"]').first().waitFor({ timeout: 15000 })
        await page.waitForTimeout(500)
      } finally {
        writeFileSync(file, original)
      }
    },
  },
  {
    name: 'using-git-modal',
    run: async (page) => {
      // Staged here: shots before this one (e.g. saving a file) can reset the index
      await api('/api/git-stage', { path: JAFFLE, files: ['models/staging/stg_orders.sql'] })
      await openApp(page)
      await page.getByTitle('Git', { exact: true }).click()
      await page.locator('.git-commit-input').fill('Normalize order status')
      await page.waitForTimeout(800)
    },
  },
  {
    name: 'using-metadv',
    run: async (page) => {
      await openApp(page)
      await page.locator('.metadv-button').click()
      await page.getByText('stg_customers').first().waitFor({ timeout: 60000 })
      await page.waitForTimeout(2000)
    },
  },
  {
    name: 'scheduler-overview',
    run: async (page) => {
      await openScheduler(page, 'Jobs')
    },
  },
  {
    name: 'scheduler-jobs-list',
    run: async (page) => {
      await openScheduler(page, 'Jobs')
      await page.locator('tr', { hasText: 'Hourly orders' }).hover()
    },
    clip: { x: 300, y: 0, width: 1140, height: 230 },
  },
  {
    name: 'scheduler-job-form',
    run: async (page) => {
      await openScheduler(page, 'Jobs')
      await page.getByRole('button', { name: 'New job' }).click()
      const form = page.locator('.scheduler-modal')
      await form.locator('.scheduler-field', { hasText: 'Name' }).locator('input').fill('Marts every morning')
      await form.locator('.scheduler-field', { hasText: 'Command' }).locator('select').selectOption('build')
      await form.locator('.scheduler-field', { hasText: 'Selector' }).locator('input').fill('+customers +orders')
      await form.locator('.scheduler-field', { hasText: 'Cron expression' }).locator('input').fill('0 6 * * 1-5')
      await page.waitForTimeout(1200)
    },
  },
  {
    name: 'scheduler-runs-list',
    run: async (page) => {
      await withRunningRun(async () => {
        await openScheduler(page, 'Runs')
        await page.waitForTimeout(1500)
      }, page)
    },
  },
  {
    name: 'scheduler-run-details',
    run: async (page) => {
      await openScheduler(page, 'Runs')
      await page.locator('tr', { hasText: 'failed' }).first().click()
      await page.getByText(/assert_orders_have_payments/).first().waitFor({ timeout: 15000 })
      await page.waitForTimeout(1000)
    },
  },
  {
    name: 'scheduler-rerun-confirmation',
    run: async (page) => {
      await openScheduler(page, 'Runs')
      await page.locator('tr', { hasText: 'failed' }).first().getByTitle('Rerun for this slot').click()
      await page.getByText(/^Rerun #/).waitFor()
      await page.waitForTimeout(500)
    },
  },
  {
    name: 'scheduler-timeline-scheduled',
    run: async (page) => {
      await openScheduler(page, 'Jobs')
    },
    clip: { x: 300, y: 538, width: 1140, height: 200 },
  },
  {
    name: 'scheduler-timeline-memory',
    run: async (page) => {
      await openScheduler(page, 'Jobs')
      await page.getByTitle('Expand').click()
      await page.getByRole('button', { name: 'Actual run at' }).click()
      await page.getByRole('button', { name: '4h', exact: true }).click()
      await page.waitForTimeout(1000)
      // Move over the chart from the right until a run's tooltip shows
      const box = (await page.locator('.memory-chart').boundingBox())!
      for (let x = box.x + box.width * 0.8; x > box.x + 250; x -= 15) {
        await page.mouse.move(x, box.y + box.height * 0.85)
        if (await page.locator('.memory-tooltip').isVisible().catch(() => false)) break
      }
      await page.waitForTimeout(500)
    },
  },
  {
    name: 'scheduler-settings-credentials',
    run: async (page) => {
      await openScheduler(page, 'Settings')
    },
    clip: { x: 300, y: 0, width: 1140, height: 245 },
  },
  {
    name: 'scheduler-settings-all-projects',
    run: async (page) => {
      await openScheduler(page, 'Settings')
      await page.getByText('ALL PROJECTS', { exact: false }).first().scrollIntoViewIfNeeded()
    },
  },
  {
    name: 'scheduler-notification-channel',
    run: async (page) => {
      await openScheduler(page, 'Settings')
      await page.getByRole('button', { name: 'Add channel' }).click()
      const form = page.locator('.scheduler-modal')
      await form.locator('.scheduler-field', { hasText: 'Name' }).first().locator('input').fill('Data team Telegram')
      await form.locator('.scheduler-field', { hasText: 'Start from' }).locator('select').selectOption({ label: 'Telegram bot' })
      await page.waitForTimeout(800)
    },
  },
  {
    name: 'using-env-vars',
    run: async (page) => {
      await openApp(page)
      await page.getByTitle('Manage environment variables').click()
      const list = page.locator('.env-vars-list')
      await list.waitFor({ timeout: 30000 })
      const values: Record<string, string> = {
        DBT_HOST: 's3.example.com', DBT_USER: 'dana', DBT_PASSWORD: 'secret-password',
      }
      const inputs = list.locator('input')
      for (let i = 0; i < await inputs.count(); i++) {
        const row = await inputs.nth(i).evaluate(el => el.closest('[class*="item"], [class*="row"]')?.textContent ?? '')
        const name = Object.keys(values).find(n => row.includes(n))
        if (name) await inputs.nth(i).fill(values[name])
      }
    },
  },
]

async function main() {
  const only = process.argv.slice(2)
  await prepareWorktree()
  const browser = await chromium.launch()
  for (const shot of shots.filter(s => !only.length || only.includes(s.name))) {
    const ctx = await newContext(browser, shot)
    const page = await ctx.newPage()
    try {
      await shot.run(page, ctx)
      const raw = `${RAW}${shot.name}.png`
      await page.screenshot({ path: raw, clip: shot.clip })
      await frame(raw, shot.name)
      console.log(`  ${shot.name}`)
    } catch (e) {
      await page.screenshot({ path: `${RAW}${shot.name}.error.png` }).catch(() => {})
      console.error(`  ${shot.name} FAILED: ${(e as Error).message.split('\n')[0]}`)
      process.exitCode = 1
    }
    await ctx.close()
  }
  await browser.close()
}

main()
