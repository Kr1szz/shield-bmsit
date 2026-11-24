import { useCallback, useEffect, useState } from 'react'
import { Database as DbIcon, Play, RefreshCw, Table2, Eye, Code2, Download } from 'lucide-react'
import { Scramble, useReveal } from '../components/ui'
import { api, onDbWrite, type DbSummary, type Row } from '../lib/db'

const SAMPLES: { label: string; sql: string }[] = [
  { label: 'Hero leaderboard', sql: 'SELECT * FROM hero_leaderboard LIMIT 10' },
  { label: 'Doomsday recruits', sql: "SELECT name, real_name, role, power_score FROM heroes WHERE doomsday = 1" },
  { label: 'Strongest combos', sql: 'SELECT h.name, c.name AS combo, c.hits, c.bonus FROM combos c JOIN heroes h ON h.id = c.hero_id ORDER BY c.bonus DESC, c.hits DESC' },
  { label: 'Missions by status', sql: 'SELECT status, COUNT(*) AS missions, GROUP_CONCAT(codename, \', \') AS codenames FROM missions GROUP BY status' },
  { label: 'Battle history', sql: 'SELECT b.id, m.codename, v.name AS villain, b.outcome, b.rounds, b.total_damage, b.fought_at FROM battles b JOIN missions m ON m.id = b.mission_id JOIN villains v ON v.id = b.villain_id ORDER BY b.id DESC' },
  { label: 'Who is deployed', sql: 'SELECT * FROM active_deployments' },
]

function Cell({ v }: { v: Row[string] }) {
  if (v === null) return <span className="text-bone/30">NULL</span>
  const s = String(v)
  return <span title={s.length > 60 ? s : undefined}>{s.length > 60 ? `${s.slice(0, 57)}…` : s}</span>
}

function Grid({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <p className="label p-6 text-bone/50">{empty}</p>
  const cols = Object.keys(rows[0])
  return (
    <div data-lenis-prevent className="scrollbar-thin max-h-[420px] overflow-auto">
      <table className="w-full border-collapse text-left font-mono text-[11px] leading-5">
        <thead className="sticky top-0 bg-ink">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border-b-2 border-bone px-3 py-2 font-bold whitespace-nowrap text-marvel uppercase">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-bone/15 hover:bg-bone/5">
              {cols.map((c) => (
                <td key={c} className="px-3 py-1.5 whitespace-nowrap"><Cell v={r[c]} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DataVault() {
  const ref = useReveal<HTMLElement>()
  const [info, setInfo] = useState<DbSummary | null>(null)
  const [offline, setOffline] = useState(false)
  const [table, setTable] = useState('heroes')
  const [rows, setRows] = useState<Row[]>([])
  const [showSql, setShowSql] = useState(false)
  const [sql, setSql] = useState(SAMPLES[0].sql)
  const [result, setResult] = useState<{ rows: Row[]; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pulse, setPulse] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([api.summary(), api.table(table, 100)])
      setInfo(s)
      setRows(t.rows)
      setOffline(false)
    } catch {
      setOffline(true)
    }
  }, [table])

  useEffect(() => { void refresh() }, [refresh])
  // live: refresh whenever the app writes to the database
  useEffect(() => onDbWrite(() => { setPulse((p) => p + 1); void refresh() }), [refresh])

  const run = async (q = sql) => {
    setError(null)
    try {
      setResult(await api.query(q))
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const current = info?.tables.find((t) => t.name === table)

  return (
    <section id="vault" ref={ref} className="bg-ink px-4 py-16 text-bone md:px-12 md:py-24">
      <header className="mb-12 grid gap-6 md:grid-cols-12">
        <div data-reveal className="label flex gap-4 md:col-span-12">
          <span className="bg-marvel px-2 text-bone">07</span>
          <span>Data vault · SQLite</span>
          <span className="hidden flex-1 border-b border-bone/30 md:block" />
        </div>
        <h2 data-reveal className="md:col-span-8">
          <Scramble text="Mission" className="display block text-[clamp(2.5rem,6vw,4.5rem)]" />
          <span className="display-thin block text-[clamp(2.5rem,6vw,4.5rem)] text-marvel">records</span>
        </h2>
        <p data-reveal className="max-w-sm text-[15px] leading-6 text-bone/80 md:col-span-4 md:self-end">
          Every deployment, battle, status change and comms entry is written to a SQLite 3 database — on the server when
          it’s running, or right here in your browser. Browse the tables live, run your own <b>SELECT</b>, or download the file.
        </p>
      </header>

      {offline ? (
        <div data-reveal className="border-2 border-bone p-8">
          <p className="display text-3xl">Vault offline</p>
          <p className="mt-2 max-w-md text-bone/70">The database couldn’t start in this browser (storage or WebAssembly may be blocked). Try another browser, or run the project with <code className="bg-bone px-1 text-ink">npm run dev</code>.</p>
          <button onClick={() => void refresh()} className="btn btn-inv mt-6"><RefreshCw size={14} /> Retry</button>
        </div>
      ) : (
        <>
          {/* connection strip */}
          <div data-reveal className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-y-2 border-bone py-3 font-mono text-[11px]">
            <span className="flex items-center gap-2">
              <span key={pulse} className="inline-block h-2 w-2 animate-ping bg-marvel [animation-iteration-count:2]" />
              <span className="label text-marvel">Live</span>
            </span>
            <span className="flex items-center gap-2"><DbIcon size={13} /> {info?.file ?? '…'}</span>
            <span className="border border-bone/40 px-1.5" title={info?.engine === 'browser' ? 'Real SQLite compiled to WebAssembly (sql.js), saved on this device' : 'Node’s built-in SQLite on the server'}>
              {info?.engine === 'browser' ? 'In-browser engine (WebAssembly)' : 'Server engine (node:sqlite)'}
            </span>
            <span>SQLite {info?.sqliteVersion ?? '…'}</span>
            <span>{info ? `${info.tables.filter((t) => t.type === 'table').length} tables · ${info.tables.filter((t) => t.type === 'view').length} views` : ''}</span>
            <span>{info ? `${info.tables.filter((t) => t.type === 'table').reduce((a, t) => a + t.rows, 0)} rows` : ''}</span>
            <button onClick={() => void api.download()} className="ml-auto flex items-center gap-1 hover:text-marvel" data-cursor="Download"><Download size={13} /> Download .db</button>
            <button onClick={() => void refresh()} className="flex items-center gap-1 hover:text-marvel" aria-label="Refresh"><RefreshCw size={13} /> Refresh</button>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* table list */}
            <ul data-reveal className="border-2 border-bone lg:col-span-3">
              {info?.tables.map((t) => (
                <li key={t.name}>
                  <button
                    onClick={() => { setTable(t.name); setShowSql(false) }}
                    className={`flex w-full items-center gap-2 border-b border-bone/20 px-3 py-2 text-left font-mono text-[12px] ${table === t.name ? 'bg-marvel text-bone' : 'hover:bg-bone/10'}`}
                  >
                    {t.type === 'view' ? <Eye size={13} /> : <Table2 size={13} />}
                    <span className="truncate">{t.name}</span>
                    <span className={`ml-auto ${table === t.name ? '' : 'text-bone/50'}`}>{t.rows}</span>
                  </button>
                </li>
              ))}
            </ul>

            {/* table viewer */}
            <div data-reveal className="min-w-0 border-2 border-bone lg:col-span-9">
              <div className="flex flex-wrap items-center gap-3 border-b-2 border-bone px-4 py-2">
                <span className="display text-xl">{table}</span>
                <span className="label text-bone/50">{current ? `${current.type} · ${current.rows} rows · ${current.columns.length} columns` : ''}</span>
                <button onClick={() => setShowSql((v) => !v)} className={`label ml-auto flex items-center gap-1 border px-2 py-0.5 ${showSql ? 'border-marvel bg-marvel' : 'border-bone hover:bg-bone hover:text-ink'}`}>
                  <Code2 size={12} /> Schema
                </button>
              </div>
              {showSql && current ? (
                <pre data-lenis-prevent className="scrollbar-thin max-h-[420px] overflow-auto p-4 font-mono text-[11px] leading-5 text-bone/90">{current.sql}</pre>
              ) : (
                <Grid rows={rows} empty="No rows yet — deploy a team or fight a battle and watch this fill in." />
              )}
            </div>
          </div>

          {/* SQL console */}
          <div data-reveal className="mt-6 border-2 border-bone">
            <div className="flex flex-wrap items-center gap-2 border-b-2 border-bone px-4 py-2">
              <span className="label mr-2">SQL console · read-only</span>
              {SAMPLES.map((s) => (
                <button key={s.label} onClick={() => { setSql(s.sql); void run(s.sql) }} className="label border border-bone/50 px-2 py-0.5 hover:border-marvel hover:text-marvel">
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-0 md:flex-row">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation() // keep battle hotkeys out of the editor
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void run() }
                }}
                spellCheck={false}
                rows={3}
                aria-label="SQL query"
                className="min-h-[88px] flex-1 resize-y bg-transparent p-4 font-mono text-[12px] leading-5 text-bone outline-none placeholder:text-bone/30"
                placeholder="SELECT * FROM heroes WHERE role = 'Mystic'"
              />
              <button onClick={() => void run()} className="btn btn-red m-3 self-start md:self-stretch" data-cursor="Run">
                <Play size={14} /> Run <span className="hidden text-[10px] opacity-70 md:inline">Ctrl+↵</span>
              </button>
            </div>
            {(error || result) && (
              <div className="border-t-2 border-bone">
                {error ? (
                  <p className="p-4 font-mono text-[12px] text-marvel">! {error}</p>
                ) : result ? (
                  <>
                    <p className="label border-b border-bone/20 px-4 py-1 text-bone/50">{result.rows.length} rows · {result.ms} ms</p>
                    <Grid rows={result.rows} empty="Query returned no rows." />
                  </>
                ) : null}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
