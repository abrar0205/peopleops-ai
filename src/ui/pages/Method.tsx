import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import { REPO_URL } from '../App'
import { Card, PageHead } from '../common'

function Architecture() {
  const box = (x: number, y: number, w: number, title: string, sub: string, dark = false) => (
    <g>
      <rect className={`box ${dark ? 'dark' : ''}`} x={x} y={y} width={w} height={54} rx={8} />
      <text x={x + 12} y={y + 23} className={dark ? 'dark-text' : ''} style={{ fontWeight: 600 }}>{title}</text>
      <text x={x + 12} y={y + 41} className={dark ? 'dark-sub' : 'sub'}>{sub}</text>
    </g>
  )
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <path className="edge" d={`M${x1},${y1} L${x2},${y2}`} markerEnd="url(#arrow)" />
  return (
    <svg className="arch" viewBox="0 0 920 300" role="img" aria-label="Architecture: source extracts flow through staging, quality rules and core tables into the analytics schema, which the tRPC API and the UI read.">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--text-3)" />
        </marker>
      </defs>
      <rect className="zone" x={4} y={4} width={912} height={292} rx={12} />
      <text className="zone-label" x={18} y={24}>POSTGRESQL (PGLITE IN THE BROWSER · POSTGRES 16+ IN SERVER MODE)</text>
      {box(18, 44, 150, 'Source extracts', 'HRIS · time clock · LMS')}
      {box(200, 44, 150, 'staging.*', 'landed as delivered')}
      {box(382, 44, 150, '18 quality rules', 'SQL · reject log')}
      {box(564, 44, 150, 'public.* (core)', 'Prisma schema + CHECKs')}
      {box(746, 44, 156, 'analytics.*', 'aggregate views · n ≥ 10', true)}
      {arrow(168, 71, 198, 71)}
      {arrow(350, 71, 380, 71)}
      {arrow(532, 71, 562, 71)}
      {arrow(714, 71, 744, 71)}
      {box(564, 138, 150, 'quality_issue', 'review · override · audit')}
      {arrow(457, 98, 600, 136)}
      {box(746, 138, 156, 'tRPC router', 'Prisma Client · zod')}
      {arrow(824, 98, 824, 136)}
      {arrow(714, 165, 744, 165)}
      {box(382, 222, 150, 'Dashboards', 'React · TanStack Query')}
      {box(564, 222, 150, 'Ask', 'rules or Claude tool use')}
      {box(746, 222, 156, 'SQL console', 'analyst role only')}
      {arrow(800, 192, 470, 220)}
      {arrow(812, 192, 640, 220)}
      {arrow(824, 192, 824, 220)}
      <text className="sub" x={18} y={250}>Same migrations, pipeline and router run in the</text>
      <text className="sub" x={18} y={266}>browser demo, the Node server and the test suite.</text>
    </svg>
  )
}

export function Method() {
  const trpc = useTRPC()
  const ref = useQuery(trpc.meta.reference.queryOptions())
  return (
    <>
      <PageHead eyebrow="Method & privacy" title="How the numbers are made">
        The whole backend runs in this tab: PostgreSQL compiled to WebAssembly, Prisma Client, and a tRPC router. The same code runs on a Node server against PostgreSQL.
      </PageHead>

      <Card title="Architecture">
        <Architecture />
      </Card>

      <div className="grid-2">
        <Card title="Privacy by design" subtitle="People analytics only works if employees and the works council can trust it">
          <ul className="list-plain">{ref.data?.privacy.map(p => <li key={p}>{p}</li>)}</ul>
        </Card>
        <Card title="About the synthetic data" subtitle="What is real and what is planted">
          <ul className="list-plain">
            <li>About 2,600 employees across seven departments and three shifts, with 24 months of hires and exits, 26 weeks of daily attendance and 12 months of training records.</li>
            <li>A few patterns are planted on purpose (Logistics night shift strain, Maintenance overload, a click-through course, contract-heavy battery ramp-up) so you can check that the signal detection finds them. It is tested on that, and on not flagging anything else.</li>
            <li>Realistic defects are injected into the extracts (duplicate badges, unknown codes, future dates, missing punches, out-of-range scores) and every one is caught by a rule.</li>
            <li>The generator is seeded, so every visitor sees the same numbers.</li>
          </ul>
        </Card>
      </div>

      <Card title="Metric definitions" subtitle="One definition per KPI, used everywhere">
        <div className="def-list">
          {ref.data?.metrics.map(m => (
            <div className="def" key={m.id}>
              <div>
                <h3>{m.name}</h3>
                <p className="note" style={{ marginTop: 4 }}>{m.grain}</p>
                <p className="note mono">{m.view}</p>
              </div>
              <div>
                <p className="text-2">{m.definition}</p>
                <span className="formula">{m.formula}</span>
                {m.caveats.length > 0 && <ul>{m.caveats.map(c => <li key={c}>{c}</li>)}</ul>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Run it yourself" foot={<a className="link-btn" href={REPO_URL} target="_blank" rel="noreferrer">Source, tests and README on GitHub →</a>}>
        <pre className="sql">{`npm install
npm run dev            # browser demo (PGlite)
npm test               # pipeline, privacy, insight and drift tests

# server mode: same router over HTTP, real PostgreSQL
docker compose up -d db
DATABASE_URL=postgresql://peopleops:peopleops@localhost:5432/peopleops npm run db:migrate
npm run pipeline && npm run server
VITE_API_URL=http://localhost:3001/trpc npm run dev`}</pre>
      </Card>
    </>
  )
}
