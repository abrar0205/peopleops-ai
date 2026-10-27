# PeopleOps

**People analytics for a manufacturing plant, built on a real stack: PostgreSQL, Prisma, tRPC, TypeScript and React. The whole backend runs in your browser.**

**Live demo:** https://abrar0205.github.io/peopleops-ai/

![Overview](docs/overview.png)

Opening the demo starts PostgreSQL 18 inside the browser tab (PGlite, compiled to WebAssembly). It then:

1. lands three synthetic source-system extracts (HR master data, time clock, LMS), about 340,000 rows;
2. runs 18 data-quality rules and holds back what fails;
3. loads the rest into Prisma-modelled core tables;
4. builds an aggregate-only analytics layer;
5. serves it to the React UI through a tRPC router.

Every number on screen comes from SQL and links to the exact query that produced it.

All data is synthetic. Nothing leaves the browser.

---

## What to look at (5 minutes)

| Try this | What it shows |
| --- | --- |
| **Overview**, then any **Evidence** link | KPIs and detected signals, each with the SQL and rows behind it |
| **Attendance** → Logistics, Night | A shift-level problem that plant averages hide; small teams shown as `<10` |
| **Data quality** → *Include the day anyway* | A day with missing punch data. Overriding the check recomputes every KPI (absence jumps from 7% to 18% for that week), and the override is audited |
| **Ask** → *Which employees are likely to quit?* | Grounded Q&A that declines individual-level questions by design |
| **SQL console** → last example | The database role boundary: raw employee tables are not readable |

## How it maps to the role

| Responsibility | Where it is in this project |
| --- | --- |
| Dashboards for attrition, attendance and training effectiveness | Attendance, Attrition and Training pages; trailing-12m attrition, 90-day new-hire attrition, unplanned absence, pre/post-test score uplift |
| Query, clean and analyse large datasets with SQL | ~340k rows; analytics views with grouping sets, window functions, a materialized view ([`0003_analytics`](prisma/migrations/0003_analytics/migration.sql)) |
| Ship features end-to-end: TypeScript, React, tRPC, Prisma, PostgreSQL | Example: quality-issue review. Prisma mutation → tRPC procedure → React UI, recomputing KPIs ([`router.ts`](src/api/router.ts)) |
| Data pipelines and data-quality checks | Staging → 18 SQL rules → quarantine → core load, in one transaction ([`pipeline.ts`](src/domain/pipeline.ts), [`rules.ts`](src/domain/rules.ts)) |
| Applied LLM solutions | The Ask page routes questions to approved aggregate "tools". Optional mode: Claude calls the same tools via tool use ([`insights.ts`](src/api/insights.ts), [`llm.ts`](src/browser/llm.ts)) |
| Present findings to HR and business stakeholders | Signals written for a manager, with method and caveats; weekly brief export (Markdown); CSV export for Power BI / Tableau |
| Docker / PostgreSQL | Server mode: same router over HTTP against PostgreSQL in `docker compose`; CI runs it against Postgres 17 |

## Architecture

```mermaid
flowchart LR
  subgraph PostgreSQL["PostgreSQL (PGlite in the browser, Postgres 17 in server mode)"]
    S[staging.*<br/>raw extracts] --> R[18 quality rules<br/>reject log]
    R --> C[public.*<br/>Prisma schema + CHECKs]
    R --> Q[quality_issue]
    C --> A[analytics.*<br/>aggregate views, n ≥ 10]
  end
  A --> T[tRPC router<br/>Prisma Client + zod]
  Q --> T
  T --> UI[React + TanStack Query]
  T --> Ask[Ask: rule router or Claude tool use]
  T --> SQL[SQL console]
```

- **One codebase, three runtimes.** The same migrations, pipeline and router run in the browser demo (PGlite + tRPC `localLink`), in the Node server (`node-postgres` + tRPC HTTP), and in the test suite.
- **Prisma owns the operational schema** ([`schema.prisma`](prisma/schema.prisma)). Two clients are generated from it: one for Node, one edge build that runs in the browser. Typed app queries (pipeline runs, quality issues, reviews) use Prisma Client. Analytics are plain SQL views, because that is what SQL is for.
- **Least privilege by construction.** Every dashboard, assistant and console query runs as `peopleops_analyst` inside a `READ ONLY` transaction. That role can only `SELECT` from `analytics`. The privacy rules are enforced by the database, not by the UI.

## Data quality

![Data quality](docs/quality.png)

The generator injects realistic defects into the extracts:

- duplicate badge IDs
- legacy department codes
- exit dates before hire dates
- future-dated punches
- minutes exported as hours
- unmapped absence codes
- contractor badges
- re-sent batches
- out-of-range assessment scores
- **a day whose punch data never arrived**

Each defect is caught by a named rule, and the tests check the exact counts. Rows are **held back, not dropped**: they stay in staging with the rule that caught them. Dependent rows wait for their HR record instead of becoming orphans. `CHECK` and foreign-key constraints on the core tables are the backstop.

## Signals, not surveillance

Signals are detected statistically and written for a manager:

| Signal | Method |
| --- | --- |
| Absence and overtime shifts | Gap to the plant, last 6 weeks vs. the previous 12, in standard errors (z ≥ 3), so plant-wide seasonality does not trigger alerts |
| New hires leaving early | Two-proportion z-test against the rest of the plant |
| Training that is completed but not learned | High on-time completion with less than 3 points pre/post score uplift |
| Overdue mandatory training | Cross-checked against overtime, to separate capacity from willingness |
| Attrition explained by contract ends | Exit reasons, separating fixed-term contract ends from resignations |

The synthetic plant has a few patterns planted on purpose (see [`scenario.ts`](src/domain/scenario.ts)). The tests check that detection finds exactly those and flags nothing else.

**Privacy rules, enforced in the database:**

- aggregates only;
- groups under 10 people are suppressed everywhere, including the SQL console;
- no individual scores or predictions.

This is what makes people analytics workable under GDPR and a works-council agreement.

![Evidence drawer](docs/evidence.png)

## The assistant

![Ask](docs/ask.png)

- **Built-in (default, no API key):** a transparent rule-based router maps questions to approved tools and writes the answer from their results. Every answer lists the tools it called and the SQL they ran.
- **Claude (optional):** paste an Anthropic API key and Claude decides which tools to call through tool use. It only ever sees tool results, which are aggregates with small groups already suppressed. The key stays in memory for the tab.
  - This is a demo convenience. In production, this call belongs on the server.

## Metric definitions

| Metric | Definition |
| --- | --- |
| Unplanned absence | (sick + unexcused hours) / (scheduled − vacation hours). Days with missing punch data are excluded until reviewed |
| Overtime per head | 5 × overtime hours / scheduled person-days |
| Attrition, trailing 12m | exits / average headcount over 12 months. Includes contract ends; the voluntary rate is reported separately |
| 90-day attrition | share of hires (90–365 days ago) who left within 90 days |
| Training on time / uplift | completed by due date / due; avg(post − pre score) |

Full definitions and caveats are on the *Method & privacy* page.

## Run it

```bash
npm install
npm run dev          # browser demo at http://localhost:5173
npm test             # 54 tests: pipeline, privacy, insights, schema drift
npm run build
```

Server mode, the same API over HTTP against PostgreSQL:

```bash
docker compose up -d db
export DATABASE_URL=postgresql://peopleops:peopleops@localhost:5432/peopleops
npm run db:migrate   # prisma migrate deploy
npm run pipeline     # load synthetic extracts through the quality rules
npm run server       # tRPC on http://localhost:3001/trpc
VITE_API_URL=http://localhost:3001/trpc npm run dev
```

## Tests and CI

`npm test` runs the full stack in-process (PGlite + Prisma + tRPC caller):

- **pipeline:** every injected defect caught with exact counts; only clean rows loaded; reruns are idempotent; data is deterministic.
- **privacy:** the analyst role cannot read raw tables or write; every view nulls groups under 10; the console boundary holds; individual-level questions are declined.
- **insights:** the planted patterns and nothing else are flagged; KPIs match independent recalculations from core tables; overriding a quality issue changes KPIs and reopening it restores them.
- **schema drift:** the migrations and `schema.prisma` describe the same tables, columns and enums.

GitHub Actions runs:

- typecheck and tests;
- a job against a real PostgreSQL 17 service (`prisma migrate deploy`, `prisma migrate diff --exit-code`, pipeline, API smoke test);
- the Pages deploy, which only happens after tests pass.

## Repository

```text
prisma/schema.prisma           operational data model (source of truth)
prisma/migrations/             core tables, staging + constraints, analytics layer
src/domain/                    scenario, synthetic generator, quality rules, pipeline
src/api/                       tRPC router, analytics queries, signals + assistant, SQL console
src/browser/                   in-browser boot (PGlite + Prisma), tRPC client, Claude tool use
src/ui/                        React pages and SVG charts
server/                        Node server and pipeline CLI for PostgreSQL
tests/                         Vitest suites
```

## Limitations

- **The data is synthetic and the patterns are planted.** The point is that the pipeline, metrics and detection would work the same on real extracts, not the numbers themselves.
- **Migration SQL is hand-written.** Prisma's schema engine is not used to generate it. The drift test and the CI `migrate diff` check keep it aligned with `schema.prisma`.
- **No authentication or row-level access by HR business partner.** In a real deployment, those would sit in the tRPC context.
