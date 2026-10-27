/** Metric definitions shown next to every KPI. One place, one wording. */
export interface MetricDefinition {
  id: string
  name: string
  definition: string
  formula: string
  grain: string
  view: string
  caveats: string[]
}

export const METRICS: MetricDefinition[] = [
  {
    id: 'unplanned_absence',
    name: 'Unplanned absence rate',
    definition: 'Share of scheduled hours lost to sickness or unexcused absence (including no-shows). Vacation is planned and excluded from both sides of the ratio.',
    formula: '(sick + unexcused hours) / (scheduled hours − vacation hours) × 100',
    grain: 'Week × department × shift',
    view: 'analytics.attendance_weekly',
    caveats: [
      'Days with incomplete punch data are excluded until a reviewer overrides the quality issue.',
      'A scheduled shift with no punches and no absence code counts as a no-show (unexcused).',
    ],
  },
  {
    id: 'overtime',
    name: 'Overtime per head',
    definition: 'Overtime hours per scheduled person-day, scaled to a five-day week: roughly the overtime one employee works in a normal week.',
    formula: '5 × overtime hours / scheduled person-days',
    grain: 'Week × department × shift',
    view: 'analytics.attendance_weekly',
    caveats: ['Days lost to vacation or sickness count as scheduled person-days, so overtime per head dips in holiday weeks.'],
  },
  {
    id: 'attrition',
    name: 'Attrition, trailing 12 months',
    definition: 'Exits in the last 12 months divided by average headcount over the same months. Includes resignations, dismissals and fixed-term contract ends; the voluntary rate counts resignations only.',
    formula: 'exits (12m) / avg((headcount at month start + month end) / 2) × 100',
    grain: 'Month × department × shift',
    view: 'analytics.attrition_12m',
    caveats: ['The current month is month-to-date.', 'Contract ends are a staffing-model decision, not a retention signal; check exit reasons before acting.'],
  },
  {
    id: 'early_attrition',
    name: '90-day attrition of new hires',
    definition: 'Of people hired 90 to 365 days before the as-of date, the share who left within their first 90 days. A leading indicator for onboarding and team fit.',
    formula: 'hires leaving < 90 days / hires in cohort × 100',
    grain: 'Department × shift',
    view: 'analytics.early_attrition',
    caveats: ['Cohorts are small. Treat differences as prompts for conversation, not proof.'],
  },
  {
    id: 'training_on_time',
    name: 'Training completed on time',
    definition: 'Share of assignments due by the as-of date that were completed by their due date.',
    formula: 'completed by due date / assignments due × 100',
    grain: 'Program × department',
    view: 'analytics.training_program_stats',
    caveats: ['Overdue = due and not completed at all; late completions count as completed but not on time.'],
  },
  {
    id: 'training_uplift',
    name: 'Training effectiveness (score uplift)',
    definition: 'Mean difference between post- and pre-assessment score for completed assignments. Measures learning, not attendance.',
    formula: 'avg(post score − pre score)',
    grain: 'Program × department',
    view: 'analytics.training_program_stats',
    caveats: ['A low uplift with high pre-scores often means the content is already known or the test is too easy.'],
  },
  {
    id: 'data_health',
    name: 'Data reaching KPIs',
    definition: 'Share of source rows delivered in the latest run that currently flow into KPIs, after quality rules and day exclusions.',
    formula: 'usable rows / received rows × 100',
    grain: 'Source system',
    view: 'analytics.data_health',
    caveats: ['Overriding an excluded day raises this number; acknowledging an issue does not.'],
  },
]

export const PRIVACY_RULES = [
  'Aggregates only: no view, API response or assistant answer describes a single person.',
  'Groups smaller than 10 people are suppressed everywhere, including the SQL console.',
  'Every analytics query runs as a read-only role that cannot see staging or core tables.',
  'No individual risk scores or predictions. Signals point to teams and processes for a human to follow up.',
  'Synthetic data only in this public demo.',
]
