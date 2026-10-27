import { useMemo, useState, type CSSProperties, type FormEvent, type ReactElement } from 'react'
import { answerQuestion, departments, kpis, monthly, qualityChecks, shiftMix, weeklyBrief } from './data'

type Nav = 'Overview' | 'Workforce' | 'Data Quality' | 'Insights'
type TrendKey = 'attendance' | 'training' | 'attrition'

const Icon = ({ name }: { name: 'home' | 'people' | 'quality' | 'spark' | 'github' | 'download' | 'arrow' | 'database' }) => {
  const paths: Record<string, ReactElement> = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M9.5 20v-6h5v6"/></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    quality: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    spark: <><path d="m12 3-1.8 4.2L6 9l4.2 1.8L12 15l1.8-4.2L18 9l-4.2-1.8L12 3Z"/><path d="m5 14-.9 2.1L2 17l2.1.9L5 20l.9-2.1L8 17l-2.1-.9L5 14Z"/><path d="m19 15-.6 1.4-1.4.6 1.4.6L19 19l.6-1.4L21 17l-1.4-.6L19 15Z"/></>,
    github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 2a13.4 13.4 0 0 0-7 0C4.8.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 8 18v4"/><path d="M8 19c-3 .9-3-1.5-4-2"/></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v7c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12v7c0 1.7 4 3 9 3s9-1.3 9-3v-7"/></>,
  }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function MetricCard({ label, value, delta, context, tone = 'neutral' }: { label: string; value: string; delta: string; context: string; tone?: 'good' | 'warn' | 'neutral' }) {
  return <article className="metric-card">
    <div className="metric-top"><span>{label}</span><span className={`delta ${tone}`}>{delta}</span></div>
    <strong>{value}</strong>
    <p>{context}</p>
  </article>
}

function TrendChart({ metric }: { metric: TrendKey }) {
  const width = 760, height = 250, padX = 34, padY = 34
  const values = monthly.map(m => m[metric])
  const min = Math.min(...values), max = Math.max(...values)
  const range = Math.max(max - min, 1)
  const points = monthly.map((m, i) => {
    const x = padX + i * (width - padX * 2) / (monthly.length - 1)
    const y = height - padY - ((m[metric] - min + range * .15) / (range * 1.3)) * (height - padY * 2)
    return { x, y, value: m[metric], month: m.month }
  })
  const poly = points.map(p => `${p.x},${p.y}`).join(' ')
  const labels = { attendance: 'Attendance', training: 'Training completion', attrition: 'Attrition' }
  return <div className="trend-chart">
    <div className="chart-title-row"><span>{labels[metric]}</span><strong>{values.at(-1)?.toFixed(metric === 'training' ? 0 : 1)}%</strong></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${labels[metric]} six month trend`}>
      <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".16"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
      {[0,1,2,3].map(i => <line key={i} x1={padX} x2={width-padX} y1={padY+i*52} y2={padY+i*52} className="gridline" />)}
      <polygon points={`${padX},${height-padY} ${poly} ${width-padX},${height-padY}`} fill="url(#fill)" className="chart-fill"/>
      <polyline points={poly} className="trend-line" fill="none" />
      {points.map(p => <g key={p.month}><circle cx={p.x} cy={p.y} r="4.5" className="dot"/><text x={p.x} y={height-7} textAnchor="middle" className="axis-label">{p.month}</text></g>)}
    </svg>
  </div>
}

function Overview() {
  const [metric, setMetric] = useState<TrendKey>('attendance')
  const brief = weeklyBrief()
  return <>
    <section className="hero">
      <div className="hero-copy">
        <div className="kicker"><span className="live-dot"/> LIVE DEMO · SYNTHETIC DATA</div>
        <h1>Workforce intelligence,<br/><em>made actionable.</em></h1>
        <p>Operational people analytics for manufacturing teams. Monitor workforce health, validate data quality, and turn verified metrics into decision-ready insights.</p>
        <div className="hero-actions">
          <button className="primary-btn" onClick={() => document.getElementById('weekly-brief')?.scrollIntoView({ behavior: 'smooth' })}>View weekly brief <Icon name="arrow"/></button>
          <a className="secondary-btn" href="https://github.com/abrar0205/peopleops-ai" target="_blank" rel="noreferrer"><Icon name="github"/> Source</a>
        </div>
      </div>
      <div className="hero-signal">
        <div className="signal-ring" style={{'--score': `${kpis.qualityScore * 3.6}deg`} as CSSProperties}><div><strong>{kpis.qualityScore}%</strong><span>DATA HEALTH</span></div></div>
        <div className="signal-meta"><span>Last refresh</span><strong>{kpis.lastRefresh}</strong></div>
      </div>
    </section>

    <section className="metric-grid">
      <MetricCard label="Active workforce" value={kpis.headcount.toLocaleString()} delta="+1.8%" context="vs. previous month" tone="good" />
      <MetricCard label="Attendance" value={`${kpis.attendance}%`} delta="+0.4 pts" context="six-month trend improving" tone="good" />
      <MetricCard label="Attrition" value={`${kpis.attrition}%`} delta="−0.7 pts" context="annualized aggregate rate" tone="good" />
      <MetricCard label="Training complete" value={`${kpis.training}%`} delta="+8 pts" context="since May" tone="good" />
    </section>

    <section className="dashboard-grid">
      <article className="panel trend-panel">
        <div className="panel-head">
          <div><span className="section-label">PERFORMANCE TREND</span><h2>Six-month workforce pulse</h2></div>
          <div className="segmented">{(['attendance','training','attrition'] as TrendKey[]).map(x => <button key={x} onClick={() => setMetric(x)} className={metric === x ? 'active' : ''}>{x === 'training' ? 'Training' : x[0].toUpperCase()+x.slice(1)}</button>)}</div>
        </div>
        <TrendChart metric={metric}/>
      </article>
      <article className="panel watch-panel">
        <div className="panel-head"><div><span className="section-label">OPERATIONAL WATCHLIST</span><h2>Where to look next</h2></div><span className="status-pill amber">3 signals</span></div>
        {[...departments].sort((a,b)=>b.trend-a.trend).slice(0,3).map((d,i) => <div className="watch-row" key={d.department}>
          <span className="rank">0{i+1}</span><div><strong>{d.department}</strong><p>{d.attendance.toFixed(1)}% attendance · {d.overtime.toFixed(1)}h overtime</p></div><span className={`move ${d.trend > 1 ? 'bad':'mid'}`}>+{d.trend.toFixed(1)} pts</span>
        </div>)}
        <div className="panel-note">Aggregate signals prioritize investigation. They do not score individual employees or automate employment decisions.</div>
      </article>
    </section>

    <section className="panel weekly" id="weekly-brief">
      <div className="weekly-left"><span className="section-label">WEEKLY PEOPLE BRIEF</span><h2>{brief.headline}</h2><p>Generated from verified KPI outputs and quality checks—not raw employee-level records.</p></div>
      <div className="weekly-right"><ul>{brief.bullets.map(x => <li key={x}>{x}</li>)}</ul><div className="recommend"><span>RECOMMENDED INVESTIGATION</span><strong>{brief.recommendation}</strong></div></div>
    </section>
  </>
}

function Workforce() {
  const [filter, setFilter] = useState('All')
  const rows = filter === 'All' ? departments : departments.filter(d => d.department === filter)
  const maxHeadcount = Math.max(...departments.map(d => d.headcount))
  return <>
    <section className="page-intro"><div><span className="section-label">WORKFORCE ANALYTICS</span><h1>See the operation behind the averages.</h1><p>Compare attendance, workload, training, and retention signals across functional areas.</p></div><div className="filter-block"><label>Department</label><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option>{departments.map(d=><option key={d.department}>{d.department}</option>)}</select></div></section>
    <section className="workforce-grid">
      <article className="panel bars-panel"><div className="panel-head"><div><span className="section-label">HEADCOUNT MIX</span><h2>Workforce distribution</h2></div><span className="status-pill">{kpis.headcount.toLocaleString()} total</span></div>
        <div className="bar-list">{departments.map(d => <div className="bar-row" key={d.department}><div className="bar-meta"><span>{d.department}</span><strong>{d.headcount.toLocaleString()}</strong></div><div className="bar-track"><span style={{width:`${d.headcount/maxHeadcount*100}%`}}/></div></div>)}</div>
      </article>
      <article className="panel shift-panel"><div className="panel-head"><div><span className="section-label">SHIFT MIX</span><h2>Coverage profile</h2></div></div><div className="donut-wrap"><div className="donut"/><div className="legend">{shiftMix.map((s,i)=><div key={s.label}><span className={`legend-dot d${i}`}/><strong>{s.value}%</strong><small>{s.label}</small></div>)}</div></div><div className="mini-stats"><div><span>Open roles</span><strong>{kpis.openRoles}</strong></div><div><span>Avg. overtime</span><strong>{kpis.overtime}h</strong></div></div></article>
    </section>
    <section className="panel table-panel"><div className="panel-head"><div><span className="section-label">DEPARTMENT VIEW</span><h2>Operational people metrics</h2></div><span className="status-pill">Aggregated</span></div><div className="table-wrap"><table><thead><tr><th>Department</th><th>Headcount</th><th>Attendance</th><th>Attrition</th><th>Training</th><th>OT hrs/wk</th><th>Movement</th></tr></thead><tbody>{rows.map(d=><tr key={d.department}><td><strong>{d.department}</strong></td><td>{d.headcount.toLocaleString()}</td><td>{d.attendance.toFixed(1)}%</td><td>{d.attrition.toFixed(1)}%</td><td>{d.training}%</td><td>{d.overtime.toFixed(1)}</td><td><span className={`move ${d.trend>1?'bad':d.trend>0?'mid':'good'}`}>{d.trend>0?'+':''}{d.trend.toFixed(1)} pts</span></td></tr>)}</tbody></table></div></section>
  </>
}

function DataQuality() {
  const flagged = qualityChecks.reduce((sum, q) => sum + q.records, 0)
  return <>
    <section className="page-intro"><div><span className="section-label">DATA RELIABILITY</span><h1>Trust the metric before acting on it.</h1><p>Quality rules make source issues visible and keep failed records out of KPI calculations until reviewed.</p></div><div className="quality-hero"><strong>{kpis.qualityScore}%</strong><span>HEALTH SCORE</span></div></section>
    <section className="quality-layout"><article className="panel quality-panel"><div className="panel-head"><div><span className="section-label">AUTOMATED CHECKS</span><h2>Pipeline health</h2></div><span className="status-pill amber">{flagged} records isolated</span></div><div className="quality-list">{qualityChecks.map(q=><div className="quality-row" key={q.name}><span className={`quality-icon ${q.status}`}>{q.status==='pass'?'✓':'!'}</span><div><strong>{q.name}</strong><p>{q.detail}</p></div><div className="quality-count"><strong>{q.records}</strong><span>flagged</span></div><span className={`quality-badge ${q.status}`}>{q.status}</span></div>)}</div></article>
      <aside className="panel rules-panel"><span className="section-label">QUALITY CONTRACT</span><h2>What happens on failure?</h2><ol><li><strong>Detect</strong><span>Rule runs during ingestion or transformation.</span></li><li><strong>Quarantine</strong><span>Invalid records are isolated, never silently dropped.</span></li><li><strong>Trace</strong><span>Source and rule metadata stay attached for review.</span></li><li><strong>Release</strong><span>Only validated data reaches KPI calculations.</span></li></ol><div className="schema-chip"><Icon name="database"/><div><strong>PostgreSQL reference model</strong><span>See database/schema.sql</span></div></div></aside></section>
  </>
}

function Insights() {
  const prompts = ['Which department has the biggest attendance concern?', 'Where is attrition highest?', 'How is training changing?', 'Where is workload highest?', 'Can I trust the data?']
  const [question, setQuestion] = useState(prompts[0])
  const [draft, setDraft] = useState('')
  const answer = useMemo(()=>answerQuestion(question),[question])
  const brief = weeklyBrief()
  const submit = (e: FormEvent) => { e.preventDefault(); if (draft.trim()) { setQuestion(draft.trim()); setDraft('') } }
  const downloadBrief = () => {
    const text = [`PeopleOps AI — Weekly People Brief`, '', brief.headline, '', ...brief.bullets.map(x=>`• ${x}`), '', `Recommended investigation: ${brief.recommendation}`, '', 'Synthetic portfolio data. Aggregate metrics only.'].join('\n')
    const blob = new Blob([text], {type:'text/plain'})
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='peopleops-weekly-brief.txt'; a.click(); URL.revokeObjectURL(url)
  }
  return <>
    <section className="page-intro"><div><span className="section-label">METRIC-GROUNDED INSIGHTS</span><h1>Ask the data. Keep the evidence.</h1><p>The public demo answers from verified aggregate metrics. A production LLM layer would receive approved KPI outputs—not raw employee records.</p></div><button className="secondary-btn download" onClick={downloadBrief}><Icon name="download"/> Export brief</button></section>
    <section className="insights-grid"><article className="panel assistant-panel"><div className="assistant-head"><div className="assistant-mark"><Icon name="spark"/></div><div><strong>People Insight Assistant</strong><span>Grounded in current demo metrics</span></div><span className="online">ONLINE</span></div><div className="chat"><div className="user-msg">{question}</div><div className="assistant-msg"><span className="mini-label">METRIC-GROUNDED ANSWER</span><p>{answer}</p><div className="evidence-row"><span>Source</span><strong>Aggregate KPI layer · Oct 2026</strong></div></div></div><form className="ask-form" onSubmit={submit}><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ask about attendance, attrition, training, workload…"/><button aria-label="Ask question"><Icon name="arrow"/></button></form><div className="prompt-chips">{prompts.map(p=><button key={p} onClick={()=>setQuestion(p)}>{p}</button>)}</div></article>
      <aside className="panel architecture-panel"><span className="section-label">SAFE AI PATTERN</span><h2>Metrics first. Language second.</h2><div className="arch-flow"><div><span>01</span><strong>Source systems</strong><small>Attendance · Training · HRIS</small></div><b>↓</b><div><span>02</span><strong>Validated SQL layer</strong><small>Quality rules · KPI definitions</small></div><b>↓</b><div><span>03</span><strong>Approved aggregates</strong><small>No raw employee records</small></div><b>↓</b><div className="accent-step"><span>04</span><strong>Insight layer</strong><small>Summary · Q&A · Evidence links</small></div></div></aside></section>
  </>
}

export default function App() {
  const [nav, setNav] = useState<Nav>('Overview')
  const navItems: {label:Nav; icon:'home'|'people'|'quality'|'spark'}[] = [
    {label:'Overview',icon:'home'}, {label:'Workforce',icon:'people'}, {label:'Data Quality',icon:'quality'}, {label:'Insights',icon:'spark'},
  ]
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">P</div><div><strong>PeopleOps</strong><span>workforce intelligence</span></div></div><nav>{navItems.map(i=><button key={i.label} onClick={()=>setNav(i.label)} className={nav===i.label?'active':''}><Icon name={i.icon}/><span>{i.label}</span></button>)}</nav><div className="side-bottom"><div className="demo-badge"><span className="live-dot"/><div><strong>Portfolio demo</strong><span>Synthetic workforce data</span></div></div><a href="https://github.com/abrar0205/peopleops-ai" target="_blank" rel="noreferrer"><Icon name="github"/> GitHub <span>↗</span></a></div></aside>
    <div className="workspace"><header className="topbar"><div><span className="top-label">PEOPLE ANALYTICS</span><strong>Operational Excellence</strong></div><div className="top-actions"><span className="refresh">Updated {kpis.lastRefresh}</span><a href="https://github.com/abrar0205/peopleops-ai" target="_blank" rel="noreferrer" className="top-github"><Icon name="github"/></a></div></header><main>{nav==='Overview'&&<Overview/>}{nav==='Workforce'&&<Workforce/>}{nav==='Data Quality'&&<DataQuality/>}{nav==='Insights'&&<Insights/>}</main><footer><span>PeopleOps AI · synthetic portfolio demonstration</span><span>React · TypeScript · SQL · PostgreSQL design · Data Quality</span></footer></div>
    <nav className="mobile-nav">{navItems.map(i=><button key={i.label} onClick={()=>setNav(i.label)} className={nav===i.label?'active':''}><Icon name={i.icon}/><span>{i.label==='Data Quality'?'Quality':i.label}</span></button>)}</nav>
  </div>
}
