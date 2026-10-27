# PeopleOps AI

**Operational people analytics and metric-grounded insight demo for manufacturing teams.**

PeopleOps AI is a compact portfolio project that demonstrates how workforce data can move from raw operational records to trustworthy KPIs, visible data-quality controls, and decision-ready summaries.

**Live demo:** `https://abrar0205.github.io/peopleops-ai/`

> All data in this repository is synthetic. The project does not predict, rank, or score individual employees.

## What the demo includes

- Workforce KPI dashboard: headcount, attendance, attrition, training, overtime
- Department-level operational analytics and shift coverage
- Automated data-quality checks with quarantine-style handling
- Metric-grounded workforce Q&A
- Weekly management brief with traceable evidence
- Responsive React + TypeScript interface
- PostgreSQL reference schema and analytical SQL queries
- GitHub Pages deployment workflow

## Product idea

People teams often spend too much time reconciling attendance, training, and HR-system data before they can answer the real operational question. The project follows a simple sequence:

1. Define the decision a stakeholder needs to make.
2. Build reproducible KPI logic.
3. Validate data before interpreting trends.
4. Surface aggregate signals through a focused internal application.
5. Add a language layer only after metrics are verified.

The public demo runs fully in the browser so it needs no credentials or external API keys. The `database/` folder shows how the same concepts map to a PostgreSQL implementation.

## Architecture

```text
Synthetic workforce sources
          |
          v
   Ingestion / validation
          |
          v
      PostgreSQL
          |
   +------+-------+
   |              |
Quality rules   KPI / SQL layer
   |              |
   +------+-------+
          |
          v
     Application API
          |
          v
  React + TypeScript UI
          |
   +------+-------+
   |              |
Dashboards   Grounded summaries
```

## AI pattern

The public demo uses deterministic, metric-grounded responses. In a production implementation, an LLM would receive approved aggregate KPI outputs and metadata—not raw employee records—and generated summaries would link back to the KPI definition or source query.

That keeps the language layer useful without making it the source of truth.

## Data quality

The demo makes data reliability visible rather than silently cleaning problems away. Example rules cover:

- identifier uniqueness
- department reference integrity
- valid attendance dates
- training completion ranges
- required shift assignments

Failed records are modeled as quarantined for review before they reach KPI calculations.

## Tech

React · TypeScript · Vite · SQL · PostgreSQL design · Data Quality · GitHub Actions · GitHub Pages

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Repository structure

```text
src/                     React application and synthetic analytics data
database/schema.sql      PostgreSQL reference model
database/analytics.sql   KPI and quality queries
.github/workflows/       GitHub Pages deployment
```

## Design principles

- Aggregate workforce analytics, not employee surveillance
- Reproducible KPI definitions before narrative generation
- Visible data quality before decision-making
- Small, explainable components over unnecessary complexity
- Synthetic data only in the public demo
