/**
 * Optional LLM mode: Claude answers questions by calling the same approved
 * tools the rule-based router uses. The model never sees a table, only tool
 * results, which are aggregates with small groups already suppressed.
 *
 * The API key stays in memory for this tab and is sent only to
 * api.anthropic.com. For a real deployment this call belongs on the server.
 */
import type { ApiClient } from './trpc'
import type { Evidence } from '../api/context'

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const

const SYSTEM = (asOf: string) => `You are the people-analytics assistant for a vehicle and battery plant. Data is as of ${asOf}.

Rules:
- Use only numbers returned by the tools. Never estimate or invent a figure. If the tools cannot answer, say so.
- Everything is aggregated; groups under 10 people are suppressed (null). Never try to identify, list, rank or predict individual employees, and decline such requests politely, offering an aggregate alternative.
- Prefer comparing a group with the plant. Mention sample sizes when they are small, and treat small differences as prompts for a conversation, not conclusions.
- If a number looks surprising, check data_quality before interpreting it.
- Unplanned absence = sickness + unexcused (incl. no-shows) over scheduled hours excluding vacation. Attrition is trailing 12 months and includes fixed-term contract ends; use exit_reasons to separate them.
- Answer in at most 150 words, plain text, no markdown tables. End with one concrete next step for a manager or HR business partner.`

interface ContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

export interface LlmAnswer {
  text: string
  toolCalls: { name: string; input: unknown }[]
  evidence: Evidence[]
  model: string
}

export async function askClaude(opts: { client: ApiClient; apiKey: string; model: string; question: string; asOf: string }): Promise<LlmAnswer> {
  const tools = await opts.client.insights.tools.query()
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: opts.question }]
  const toolCalls: LlmAnswer['toolCalls'] = []
  const evidence: Evidence[] = []

  for (let round = 0; round < 6; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: opts.model, max_tokens: 1024, system: SYSTEM(opts.asOf), tools, messages }),
    })
    if (!res.ok) {
      const body = await res.text()
      let message = body
      try {
        message = JSON.parse(body).error?.message ?? body
      } catch {
        /* keep raw body */
      }
      throw new Error(`Claude API ${res.status}: ${message}`)
    }
    const data = (await res.json()) as { content: ContentBlock[]; stop_reason: string }
    messages.push({ role: 'assistant', content: data.content })
    const uses = data.content.filter(b => b.type === 'tool_use')
    if (data.stop_reason !== 'tool_use' || uses.length === 0) {
      return { text: data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), toolCalls, evidence, model: opts.model }
    }
    const results = []
    for (const u of uses) {
      toolCalls.push({ name: u.name!, input: u.input })
      try {
        const r = await opts.client.insights.runTool.mutate({ name: u.name!, input: u.input })
        evidence.push(...r.evidence)
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r.data).slice(0, 15_000) })
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: e instanceof Error ? e.message : String(e) })
      }
    }
    messages.push({ role: 'user', content: results })
  }
  throw new Error('The model kept calling tools without answering; try a narrower question.')
}
