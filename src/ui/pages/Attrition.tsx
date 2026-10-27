import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import { departmentName, groupLabel } from '../../api/queries'
import { Card, EvidenceButton, PageHead, Segmented, Select, Skeleton, fmt, fmtMonth, setParams } from '../common'
import { BarList, Heatmap, LineChart } from '../charts'
import { SHIFT_OPTIONS, readFilters, useDepartmentOptions } from './Attendance'

export function Attrition({ params }: { params: URLSearchParams }) {
  const trpc = useTRPC()
  const { dept, shift } = readFilters(params)
  const setFilter = (d: string, s: string) => setParams('attrition', { dept: d === 'ALL' ? undefined : d, shift: s === 'ALL' ? undefined : s })
  const deptOptions = useDepartmentOptions()
  const trend = useQuery(trpc.workforce.attritionTrend.queryOptions({ department: dept, shift }))
  const plant = useQuery(trpc.workforce.attritionTrend.queryOptions({ department: 'ALL', shift: 'ALL' }))
  const byDept = useQuery(trpc.workforce.attritionByGroup.queryOptions({ by: 'department' }))
  const reasons = useQuery(trpc.workforce.exitReasons.queryOptions())
  const early = useQuery(trpc.workforce.earlyAttrition.queryOptions({ by: 'department_shift' }))
  const isPlant = dept === 'ALL' && shift === 'ALL'
  const label = groupLabel(dept, shift)
  const plantNow = byDept.data?.rows.find(r => r.department_code === 'ALL')
  const earlyPlant = early.data?.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')

  return (
    <>
      <PageHead
        eyebrow="Workforce"
        title="Attrition and early exits"
        actions={
          <>
            <Select label="Department" value={dept} options={deptOptions} onChange={d => setFilter(d, shift)} />
            <Segmented label="Shift" value={shift} options={SHIFT_OPTIONS} onChange={s => setFilter(dept, s)} />
          </>
        }
      >
        Trailing-12-month attrition includes resignations, dismissals and fixed-term contract ends. Check how people left before treating a high rate as a retention problem.
      </PageHead>

      <div className="grid-main">
        <Card
          title="Trailing 12-month attrition"
          subtitle={`${label}, by month (current month is month-to-date)`}
          actions={trend.data && plant.data ? <EvidenceButton title={`Attrition: ${label}`} evidence={[trend.data, plant.data]} /> : null}
        >
          {trend.data && plant.data ? (
            <LineChart
              ariaLabel={`Trailing twelve month attrition for ${label}`}
              labels={plant.data.rows.map(r => r.month_start)}
              formatX={fmtMonth}
              unit="%"
              series={[
                { name: isPlant ? 'All exits' : `${label}, all exits`, color: 'series-1', values: trend.data.rows.map(r => r.attrition_rate) },
                { name: isPlant ? 'Resignations only' : `${label}, resignations`, color: 'series-2', values: trend.data.rows.map(r => r.voluntary_attrition_rate) },
                ...(isPlant ? [] : [{ name: 'Plant, all exits', color: 'reference' as const, values: plant.data.rows.map(r => r.attrition_rate) }]),
              ]}
            />
          ) : (
            <Skeleton height={240} />
          )}
        </Card>
        <Card
          title="By department"
          subtitle="Trailing 12 months. Click to filter."
          actions={byDept.data ? <EvidenceButton title="Attrition by department" evidence={[byDept.data]} /> : null}
        >
          {byDept.data && plantNow ? (
            <BarList
              ariaLabel="Attrition by department"
              unit="%"
              reference={{ value: plantNow.attrition_rate ?? 0, label: 'Plant' }}
              onSelect={d => setFilter(d, 'ALL')}
              items={byDept.data.rows
                .filter(r => r.department_code !== 'ALL')
                .sort((a, b) => (b.attrition_rate ?? 0) - (a.attrition_rate ?? 0))
                .map(r => ({ key: r.department_code, label: departmentName(r.department_code), value: r.attrition_rate, focus: r.department_code === dept }))}
            />
          ) : (
            <Skeleton height={220} />
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card
          title="How people left"
          subtitle="Exits in the last 12 months by reason"
          actions={reasons.data ? <EvidenceButton title="Exit reasons" evidence={[reasons.data]} /> : null}
          foot={<span>The data shows how people left, not why. Exit interviews and team conversations answer the why.</span>}
        >
          {reasons.data ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="num">Exits</th>
                    <th className="num">Resigned</th>
                    <th className="num">Contract end</th>
                    <th className="num">Dismissed</th>
                  </tr>
                </thead>
                <tbody>
                  {[...reasons.data.rows].sort((a, b) => b.exits - a.exits).map(r => (
                    <tr key={r.department_code} className={`clickable ${r.department_code === dept ? 'selected' : ''}`} onClick={() => setFilter(r.department_code, 'ALL')}>
                      <td>{departmentName(r.department_code)}</td>
                      <td className="num">{r.exits}</td>
                      <td className="num">{r.voluntary}</td>
                      <td className="num">
                        {r.exits >= 10 && r.contract_end / r.exits >= 0.4 ? (
                          <span className="badge info" title="Most exits are fixed-term contracts ending">{r.contract_end} · {fmt((100 * r.contract_end) / r.exits, 0)}%</span>
                        ) : (
                          r.contract_end
                        )}
                      </td>
                      <td className="num">{r.involuntary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Skeleton height={220} />
          )}
        </Card>
        <Card
          title="New hires leaving within 90 days"
          subtitle="People hired 3–12 months ago, by department × shift"
          actions={early.data ? <EvidenceButton title="90-day attrition" evidence={[early.data]} /> : null}
          foot={earlyPlant ? <span>Plant: {fmt(earlyPlant.early_attrition_rate)}% ({earlyPlant.early_exits} of {earlyPlant.hires} hires). Cells are small; read them as prompts, not proof.</span> : undefined}
        >
          {early.data ? (
            <Heatmap
              caption="90-day attrition by department and shift"
              unit="%"
              rows={deptOptions.filter(d => d.value !== 'ALL').map(d => ({ key: d.value, label: d.label }))}
              cols={SHIFT_OPTIONS.filter(s => s.value !== 'ALL').map(s => ({ key: s.value, label: s.label }))}
              cell={(r, c) => {
                const x = early.data.rows.find(g => g.department_code === r && g.shift === c)
                return x ? { value: x.early_attrition_rate, suppressed: x.suppressed, n: x.hires } : { value: null, suppressed: true, n: 0 }
              }}
              selected={dept !== 'ALL' && shift !== 'ALL' ? { row: dept, col: shift } : undefined}
              onSelect={(r, c) => setFilter(r, c)}
            />
          ) : (
            <Skeleton height={240} />
          )}
        </Card>
      </div>
    </>
  )
}
