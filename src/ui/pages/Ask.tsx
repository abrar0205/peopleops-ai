import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTRPC, useTRPCClient } from '../../browser/trpc'
import type { Evidence } from '../../api/context'
import { askClaude, MODELS } from '../../browser/llm'
import { Card, EvidenceButton, Icon, PageHead, Segmented, Select } from '../common'

interface Turn {
  id: number
  question: string
  pending: boolean
  text?: string
  error?: string
  kind?: 'answer' | 'refusal' | 'help'
  tools?: { name: string; input?: unknown }[]
  evidence?: Evidence[]
  followUps?: string[]
  engine: 'rules' | 'claude'
  model?: string
}

const STARTERS = [
  'What should I look at this week?',
  'Which department has the highest unplanned absence?',
  'How has absence on Logistics night shift changed?',
  'Where are new hires leaving within 90 days?',
  'Why are people leaving Cell Manufacturing?',
  'Which training programs are effective?',
  'Can I trust the data?',
  'Which employees are likely to quit?',
]

export function Ask({ params }: { params: URLSearchParams }) {
  const trpc = useTRPC()
  const client = useTRPCClient()
  const status = useQuery(trpc.meta.status.queryOptions())
  const [engine, setEngine] = useState<'rules' | 'claude'>('rules')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState<string>(MODELS[0].id)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const nextId = useRef(1)
  const bottom = useRef<HTMLDivElement>(null)
  const asked = useRef<string | null>(null)

  const ask = async (question: string) => {
    const q = question.trim()
    if (!q) return
    if (engine === 'claude' && !apiKey.trim()) {
      setTurns(t => [...t, { id: nextId.current++, question: q, pending: false, engine, error: 'Add an Anthropic API key above, or switch to the built-in engine.' }])
      return
    }
    const id = nextId.current++
    setTurns(t => [...t, { id, question: q, pending: true, engine }])
    setDraft('')
    try {
      if (engine === 'rules') {
        const a = await client.insights.ask.mutate({ question: q })
        setTurns(t => t.map(x => (x.id === id ? { ...x, pending: false, text: a.text, kind: a.kind, tools: a.tools, evidence: a.evidence, followUps: a.followUps } : x)))
      } else {
        const a = await askClaude({ client, apiKey: apiKey.trim(), model, question: q, asOf: status.data?.asOf ?? '' })
        setTurns(t => t.map(x => (x.id === id ? { ...x, pending: false, text: a.text, kind: 'answer', tools: a.toolCalls, evidence: a.evidence, model: a.model } : x)))
      }
    } catch (e) {
      setTurns(t => t.map(x => (x.id === id ? { ...x, pending: false, error: e instanceof Error ? e.message : String(e) } : x)))
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
      <PageHead
        eyebrow="Ask"
        title="Ask the data, keep the evidence"
        actions={<Segmented label="Engine" value={engine} onChange={setEngine} options={[{ value: 'rules', label: 'Built-in (no LLM)' }, { value: 'claude', label: 'Claude' }]} />}
      >
        Answers come only from approved aggregate queries. Every answer lists the tools it called and the SQL they ran. Questions about individual people are declined by design.
      </PageHead>

      {engine === 'claude' && (
        <Card title="Claude mode" subtitle="Claude chooses which approved tools to call and writes the answer. It never sees a table, only tool results.">
          <div className="filters">
            <input
              className="input"
              type="password"
              autoComplete="off"
              placeholder="Anthropic API key (sk-ant-…)"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              style={{ flex: '1 1 260px' }}
              aria-label="Anthropic API key"
            />
            <Select label="Model" value={model} onChange={setModel} options={MODELS.map(m => ({ value: m.id, label: m.label }))} />
          </div>
          <p className="note" style={{ marginTop: 8 }}>
            <Icon name="lock" /> The key stays in this tab&apos;s memory and is sent only to api.anthropic.com. It is never stored. In production this call would run on the server.
          </p>
        </Card>
      )}

      <div className="chat" aria-live="polite">
        {turns.length === 0 && (
          <Card title="Try one of these" subtitle={engine === 'rules' ? 'The built-in engine routes questions to tools with simple rules. No API key needed.' : 'The same questions work with Claude.'}>
            <div className="suggestions">
              {STARTERS.map(s => (
                <button key={s} className="suggestion" onClick={() => void ask(s)}>{s}</button>
              ))}
            </div>
          </Card>
        )}
        {turns.map(t => (
          <div key={t.id} className="chat">
            <div className="msg-user">{t.question}</div>
            <div className="msg-bot">
              {t.pending && <span className="muted"><span className="spinner" style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 8 }} />Querying the analytics views…</span>}
              {t.error && <p className="error">{t.error}</p>}
              {t.text && <div className="answer">{t.text}</div>}
              {!t.pending && !t.error && (
                <div className="msg-meta">
                  <span className={`badge ${t.kind === 'refusal' ? 'warn' : 'neutral'}`}>{t.kind === 'refusal' ? 'declined: individual-level' : t.engine === 'rules' ? 'built-in engine' : MODELS.find(m => m.id === t.model)?.label}</span>
                  {t.tools?.map((x, i) => <span key={i} className="badge info mono">{x.name}</span>)}
                  {t.evidence && t.evidence.length > 0 && <EvidenceButton title={t.question} evidence={t.evidence} label={`Evidence (${new Set(t.evidence.map(e => e.sql)).size} queries)`} />}
                </div>
              )}
              {t.followUps && t.followUps.length > 0 && (
                <div className="suggestions">
                  {t.followUps.map(f => (
                    <button key={f} className="suggestion" onClick={() => void ask(f)}>{f}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        className="ask-box"
        onSubmit={e => {
          e.preventDefault()
          void ask(draft)
        }}
        style={{ position: 'sticky', bottom: 12 }}
      >
        <input className="input" placeholder="Ask about absence, overtime, attrition, training or data quality…" value={draft} onChange={e => setDraft(e.target.value)} aria-label="Question" />
        <button className="btn primary" type="submit" disabled={!draft.trim()}>
          <Icon name="send" /> Ask
        </button>
      </form>
    </>
  )
}
