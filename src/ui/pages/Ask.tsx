import { useEffect, useRef, useState } from 'react'
import { useTRPCClient } from '../../browser/trpc'
import type { Evidence } from '../../api/context'
import { EvidenceButton, Icon, PageHead } from '../common'

interface Turn {
  id: number
  question: string
  pending: boolean
  text?: string
  error?: string
  kind?: 'answer' | 'refusal' | 'help'
  evidence?: Evidence[]
  followUps?: string[]
}

const STARTERS = [
  'What should I look at this week?',
  'Which department has the highest unplanned absence?',
  'Where are new hires leaving within 90 days?',
  'Which training programs are effective?',
  'Can I trust the data?',
]

export function Ask({ params }: { params: URLSearchParams }) {
  const client = useTRPCClient()
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const nextId = useRef(1)
  const bottom = useRef<HTMLDivElement>(null)
  const asked = useRef<string | null>(null)

  const ask = async (question: string) => {
    const q = question.trim()
    if (!q) return
    const id = nextId.current++
    setTurns(t => [...t, { id, question: q, pending: true }])
    setDraft('')
    try {
      const a = await client.insights.ask.mutate({ question: q })
      setTurns(t => t.map(x => x.id === id ? {
        ...x,
        pending: false,
        text: a.text,
        kind: a.kind,
        evidence: a.evidence,
        followUps: a.followUps,
      } : x))
    } catch (e) {
      setTurns(t => t.map(x => x.id === id ? {
        ...x,
        pending: false,
        error: e instanceof Error ? e.message : String(e),
      } : x))
    }
  }

  useEffect(() => {
    const q = params.get('q')
    if (q && asked.current !== q) {
      asked.current = q
      void ask(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  return (
    <>
      <PageHead eyebrow="Insights" title="Ask a workforce question">
        The assistant answers only from approved aggregate metrics and keeps the supporting query evidence available. Individual employee prediction is intentionally out of scope.
      </PageHead>

      <section className="insight-shell">
        <aside className="insight-starters">
          <span className="section-kicker-clean">START WITH A BUSINESS QUESTION</span>
          <h2>Ask what changed, where, and why it matters.</h2>
          <p>No API key is required. The public demo uses a deterministic routing layer over approved analytical queries.</p>
          <div className="insight-suggestions">
            {STARTERS.map(s => (
              <button key={s} onClick={() => void ask(s)}>{s}<Icon name="arrow" /></button>
            ))}
          </div>
          <div className="insight-guardrail">
            <Icon name="lock" />
            <div><strong>Aggregate only</strong><span>Groups under 10 are suppressed and individual-level scoring is declined.</span></div>
          </div>
        </aside>

        <div className="insight-chat">
          <div className="insight-chat-head">
            <div><span className="live-dot" /><strong>People Insight Assistant</strong></div>
            <span>Grounded demo</span>
          </div>

          <div className="insight-messages" aria-live="polite">
            {turns.length === 0 && (
              <div className="insight-empty">
                <Icon name="ask" size={26} />
                <strong>Ask the data, not a dashboard.</strong>
                <p>Choose a question on the left or type your own below.</p>
              </div>
            )}

            {turns.map(t => (
              <div key={t.id} className="insight-turn">
                <div className="msg-user">{t.question}</div>
                <div className="msg-bot insight-answer">
                  {t.pending && <span className="muted"><span className="spinner" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 8 }} />Checking approved metrics…</span>}
                  {t.error && <p className="error">{t.error}</p>}
                  {t.text && <div className="answer">{t.text}</div>}
                  {!t.pending && !t.error && (
                    <div className="insight-meta">
                      <span className={`badge ${t.kind === 'refusal' ? 'warn' : 'good'}`}>{t.kind === 'refusal' ? 'Privacy guardrail' : 'Metric-grounded'}</span>
                      {t.evidence && t.evidence.length > 0 && (
                        <EvidenceButton title={t.question} evidence={t.evidence} label="View evidence" />
                      )}
                    </div>
                  )}
                  {t.followUps && t.followUps.length > 0 && (
                    <div className="suggestions compact">
                      {t.followUps.slice(0, 3).map(f => <button key={f} className="suggestion" onClick={() => void ask(f)}>{f}</button>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>

          <form className="insight-input" onSubmit={e => { e.preventDefault(); void ask(draft) }}>
            <input placeholder="Ask about absence, overtime, attrition, training or data quality…" value={draft} onChange={e => setDraft(e.target.value)} aria-label="Question" />
            <button type="submit" disabled={!draft.trim()} aria-label="Ask question"><Icon name="send" /></button>
          </form>
        </div>
      </section>
    </>
  )
}
