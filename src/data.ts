export type DepartmentMetric = {
  department: string
  headcount: number
  attendance: number
  attrition: number
  training: number
  overtime: number
  trend: number
  vacancies: number
}

export type MonthlyMetric = {
  month: string
  attendance: number
  training: number
  attrition: number
  overtime: number
}

export type QualityCheck = {
  name: string
  status: 'pass' | 'warning'
  detail: string
  records: number
}

export const departments: DepartmentMetric[] = [
  { department: 'Assembly', headcount: 1420, attendance: 93.8, attrition: 9.4, training: 86, overtime: 11.8, trend: 1.4, vacancies: 34 },
  { department: 'Logistics', headcount: 780, attendance: 92.9, attrition: 10.2, training: 82, overtime: 12.6, trend: 2.1, vacancies: 27 },
  { department: 'Quality', headcount: 510, attendance: 96.3, attrition: 5.9, training: 95, overtime: 6.8, trend: -0.8, vacancies: 8 },
  { department: 'Maintenance', headcount: 430, attendance: 95.6, attrition: 6.2, training: 93, overtime: 10.1, trend: 0.2, vacancies: 11 },
  { department: 'Production Systems', headcount: 860, attendance: 94.6, attrition: 7.5, training: 88, overtime: 9.1, trend: 0.6, vacancies: 16 },
  { department: 'Operations Support', headcount: 1180, attendance: 95.1, attrition: 6.8, training: 91, overtime: 8.3, trend: -0.4, vacancies: 19 },
]

export const monthly: MonthlyMetric[] = [
  { month: 'May', attendance: 94.2, training: 81, attrition: 8.6, overtime: 10.8 },
  { month: 'Jun', attendance: 94.5, training: 83, attrition: 8.4, overtime: 10.5 },
  { month: 'Jul', attendance: 94.1, training: 84, attrition: 8.7, overtime: 10.9 },
  { month: 'Aug', attendance: 94.7, training: 86, attrition: 8.2, overtime: 10.1 },
  { month: 'Sep', attendance: 94.4, training: 88, attrition: 8.0, overtime: 9.8 },
  { month: 'Oct', attendance: 94.8, training: 89, attrition: 7.9, overtime: 9.6 },
]

export const qualityChecks: QualityCheck[] = [
  { name: 'Employee identifier uniqueness', status: 'pass', detail: 'No duplicate active identifiers detected', records: 0 },
  { name: 'Department reference integrity', status: 'pass', detail: 'All department references map to the master table', records: 0 },
  { name: 'Attendance date validity', status: 'warning', detail: 'Future-dated records isolated for source review', records: 7 },
  { name: 'Training completion range', status: 'pass', detail: 'Completion values remain within 0–100%', records: 0 },
  { name: 'Shift assignment completeness', status: 'warning', detail: 'Records missing a source-system shift assignment', records: 23 },
]

export const kpis = {
  headcount: departments.reduce((sum, d) => sum + d.headcount, 0),
  attendance: 94.8,
  attrition: 7.9,
  training: 89,
  overtime: 9.6,
  openRoles: departments.reduce((sum, d) => sum + d.vacancies, 0),
  qualityScore: 98.7,
  lastRefresh: '27 Oct 2026 · 11:42',
}

export const shiftMix = [
  { label: 'Early', value: 38 },
  { label: 'Late', value: 34 },
  { label: 'Night', value: 28 },
]

export function weeklyBrief() {
  const risk = [...departments].sort((a, b) => b.trend - a.trend)[0]
  const strongest = [...departments].sort((a, b) => b.training - a.training)[0]
  const lowestOvertime = [...departments].sort((a, b) => a.overtime - b.overtime)[0]
  return {
    headline: 'Workforce health is stable, with one operational signal worth investigating.',
    bullets: [
      `Overall attendance closed at ${kpis.attendance.toFixed(1)}%, slightly above the six-month average.`,
      `${risk.department} shows the strongest adverse movement: ${risk.trend.toFixed(1)} pts with attrition at ${risk.attrition.toFixed(1)}%.`,
      `${strongest.department} leads training completion at ${strongest.training}%.`,
      `${lowestOvertime.department} has the lowest average weekly overtime at ${lowestOvertime.overtime.toFixed(1)} hours.`,
    ],
    recommendation: `Review ${risk.department} shift-level absence and overtime patterns before changing staffing or policy assumptions.`,
  }
}

export function answerQuestion(question: string) {
  const lower = question.toLowerCase()
  const lowestAttendance = [...departments].sort((a, b) => a.attendance - b.attendance)[0]
  const highestAttrition = [...departments].sort((a, b) => b.attrition - a.attrition)[0]
  const bestTraining = [...departments].sort((a, b) => b.training - a.training)[0]
  const highestOvertime = [...departments].sort((a, b) => b.overtime - a.overtime)[0]

  if (lower.includes('attendance') || lower.includes('absence')) {
    return `${lowestAttendance.department} has the lowest attendance at ${lowestAttendance.attendance.toFixed(1)}%. Average overtime there is ${lowestAttendance.overtime.toFixed(1)} hours per employee/week, so shift and workload patterns are a sensible next investigation.`
  }
  if (lower.includes('attrition') || lower.includes('retention')) {
    return `${highestAttrition.department} has the highest aggregate attrition rate at ${highestAttrition.attrition.toFixed(1)}%. This demo deliberately avoids individual-level prediction; the metric is used only to prioritize human investigation.`
  }
  if (lower.includes('training')) {
    return `${bestTraining.department} leads training completion at ${bestTraining.training}%. Overall completion improved from ${monthly[0].training}% in May to ${monthly.at(-1)!.training}% in October.`
  }
  if (lower.includes('overtime') || lower.includes('workload')) {
    return `${highestOvertime.department} has the highest average weekly overtime at ${highestOvertime.overtime.toFixed(1)} hours. Its attendance is ${highestOvertime.attendance.toFixed(1)}%, making workload and shift patterns worth reviewing together.`
  }
  if (lower.includes('quality') || lower.includes('data')) {
    const flagged = qualityChecks.filter(x => x.status === 'warning').reduce((sum, x) => sum + x.records, 0)
    return `The aggregate data-health score is ${kpis.qualityScore.toFixed(1)}%. ${flagged} records are quarantined across two checks, so they remain visible without contaminating KPI calculations.`
  }
  return `Current workforce signals: attendance ${kpis.attendance.toFixed(1)}%, attrition ${kpis.attrition.toFixed(1)}%, training completion ${kpis.training}%, and average overtime ${kpis.overtime.toFixed(1)} hours/week. Ask about attendance, attrition, training, overtime, or data quality for a traceable answer.`
}
