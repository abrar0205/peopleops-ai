# PeopleOps

**A manufacturing people-analytics demo built to turn workforce data into clear, trustworthy operational decisions.**

**Live demo:** https://abrar0205.github.io/peopleops-ai/

PeopleOps combines a real analytical backend with a deliberately simple front end. The public demo answers three questions first:

1. **What changed?** — headline workforce KPIs and statistically detected signals.
2. **Where should the team look?** — focused drill-downs for attendance, attrition, training and workload.
3. **Can the numbers be trusted?** — visible data-quality checks before records reach KPI calculations.

All data is synthetic. No employee-level prediction or scoring is used.

---

## What the demo shows

- Workforce KPIs for headcount, unplanned absence, attrition and mandatory training.
- Operational signals that highlight where investigation is useful.
- Department and shift drill-downs for attendance, overtime and retention.
- A data-quality gate with 18 SQL rules and traceable held-back records.
- A metric-grounded insight assistant over approved aggregate queries.
- Evidence links from dashboard metrics back to the SQL that produced them.
- Privacy controls that suppress groups smaller than 10.

The interface is intentionally compact. Deeper engineering details remain available in the repository and the Technical section of the demo.

---

## Stack

**Frontend:** React · TypeScript · TanStack Query  
**API:** tRPC · Zod  
**Database:** PostgreSQL / PGlite · Prisma  
**Analytics:** SQL views · window functions · aggregate metrics  
**Quality:** staging → validation → quarantine → trusted analytics  
**Delivery:** GitHub Actions · GitHub Pages · Docker server mode

The browser demo runs PostgreSQL locally through PGlite, so the application can demonstrate the full data flow without external credentials or a hosted database.

---

## Architecture

```text
Synthetic source extracts
        │
        ▼
      Staging
        │
        ▼
18 data-quality rules
        │
   ┌────┴─────┐
   │          │
Held back   Clean core data
              │
              ▼
      Aggregate SQL views
              │
              ▼
          tRPC API
              │
       ┌──────┴──────┐
       │             │
 React dashboard   Insight tools
```

Every dashboard and assistant query runs against the aggregate analytics layer rather than raw employee records.

---

## Why this project exists

A people-analytics product is only useful if the underlying numbers are reliable and the output helps a stakeholder decide what to investigate next.

The project therefore prioritizes:

- **clear operational questions** before charts;
- **reproducible SQL metrics** before narrative summaries;
- **visible data quality** before KPI interpretation;
- **aggregate workforce signals** rather than employee surveillance;
- **traceable evidence** behind every important number.

---

## Example data-quality flow

The synthetic generator deliberately introduces realistic source issues such as:

- duplicate badge IDs;
- invalid department references;
- impossible employment dates;
- incomplete punch data;
- malformed time units;
- invalid training scores.

Failed rows remain traceable in staging and are held back from the trusted analytical layer. Database constraints act as an additional backstop.

---

## Privacy by design

- Aggregate analytics only.
- Groups under 10 people are suppressed.
- Raw employee tables are not exposed to the analytics role.
- Individual-level prediction questions are declined.
- The public demo contains synthetic data only.

---

## Mapping to a People Analytics / Data role

| Role requirement | Evidence in PeopleOps |
| --- | --- |
| SQL analysis | PostgreSQL analytics views, CTEs, window functions and KPI queries |
| Dashboards & reporting | React workforce dashboard with drill-down analytics |
| Data pipelines | Source extracts → staging → validation → core model → analytics |
| Data quality | 18 validation rules, quarantine and traceable issue handling |
| PostgreSQL | Real schema, migrations, constraints and analytical views |
| Prisma / tRPC | Typed data model and API layer |
| TypeScript / React | End-to-end application UI |
| AI / LLM concepts | Metric-grounded question answering over approved analytical tools |
| Docker / deployment | PostgreSQL server mode and CI-gated GitHub Pages deployment |

---

## Run locally

```bash
npm install
npm run dev
```

Production checks:

```bash
npm run typecheck
npm test
npm run build
```

Server mode with PostgreSQL:

```bash
docker compose up -d db
export DATABASE_URL=postgresql://peopleops:peopleops@localhost:5432/peopleops
npm run db:migrate
npm run pipeline
npm run server
```

---

## Repository structure

```text
prisma/          schema and migrations
src/domain/      synthetic scenario, validation rules and pipeline
src/api/         tRPC router, analytics queries and insight tools
src/browser/     in-browser PostgreSQL runtime
src/ui/          React interface and charts
server/          Node/PostgreSQL server mode
tests/           pipeline, privacy, insights and schema-drift tests
```

## Notes

This is a portfolio demonstration, not a production HR system. The data and workforce patterns are synthetic. The engineering goal is to demonstrate how analytics, software development, data quality and applied AI can be combined into a small decision-support product.
