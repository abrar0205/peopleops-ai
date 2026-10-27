import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import { groupLabel } from '../../api/queries'
import { DEPARTMENTS } from '../../domain/scenario'
import { Card, EvidenceButton, PageHead, Segmented, Select, Skeleton, fmtDate, setParams } from '../common'
import { BarList, Heatmap, LineChart } from '../charts'

export const SHIFT_OPTIONS = [
  { value: 'ALL', label: 'All shifts' },
  { value: 'EARLY', label: 'Early' },
  { value: 'LATE', label: 'Late' },
  { value: 'NIGHT', label: 'Night' },
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
type ShiftFilter = 'ALL' | 'EARLY' | 'LATE' | 'NIGHT'

/** Read department/shift filters from the URL, falling back to "ALL" for anything unknown. */
export function readFilters(params: URLSearchParams): { dept: string; shift: ShiftFilter } {
  const d = params.get('dept') ?? 'ALL'
  const s = params.get('shift') ?? 'ALL'
  return {
    dept: DEPARTMENTS.some(x => x.code === d) ? d : 'ALL',
    shift: (['EARLY', 'LATE', 'NIGHT'].includes(s) ? s : 'ALL') as ShiftFilter,
  }
}

export function useDepartmentOptions() {
  const trpc = useTRPC()
  const ref = useQuery(trpc.meta.reference.queryOptions())
  return [{ value: 'ALL', label: 'All departments' }, ...(ref.data?.departments.map(d => ({ value: d.code, label: d.name })) ?? [])]
}

export function Attendance({ params }: { params: URLSearchParams }) {
  const trpc = useTRPC()
  const { dept, shift } = readFilters(params)
  const setFilter = (d: string, s: string) => setParams('attendance', { dept: d === 'ALL' ? undefined : d, shift: s === 'ALL' ? undefined : s })
  const [metric, setMetric] = useState<'unplanned_absence_rate' | 'overtime_hours_per_head'>('unplanned_absence_rate')
  const [weeks, setWeeks] = useState(4)
  const deptOptions = useDepartmentOptions()

  const selected = useQuery(trpc.attendance.weekly.queryOptions({ department: dept, shift }))
  const plant = useQuery(trpc.attendance.weekly.queryOptions({ department: 'ALL', shift: 'ALL' }))
  const grid = useQuery(trpc.attendance.byGroup.queryOptions({ by: 'department_shift', weeks }))
  const weekday = useQuery(trpc.attendance.weekday.queryOptions({ department: dept }))
  const weekdayPlant = useQuery(trpc.attendance.weekday.queryOptions({ department: 'ALL' }))
  const quality = useQuery(trpc.quality.overview.queryOptions())

  const isPlant = dept === 'ALL' && shift === 'ALL'
  const label = groupLabel(dept, shift)
  const excludedDay = quality.data?.excluded.rows[0]?.work_date
  const band = (() => {
    if (!excludedDay || !plant.data) return undefined
    const idx = plant.data.rows.findIndex(r => r.week_start <= excludedDay && excludedDay < new Date(Date.parse(r.week_start) + 7 * 864e5).toISOString().slice(0, 10))
    return idx >= 0 ? { index: idx, label: `${fmtDate(excludedDay)} excluded` } : undefined
  })()

  const trend = (key: 'unplanned_absence_rate' | 'overtime_hours_per_head', title: string, unit: string, digits: number) => (
    <Card
      title={title}
      subtitle={`${label}, weekly${isPlant ? '' : ', compared with the plant'}`}
      actions={selected.data && plant.data ? <EvidenceButton title={`${title}: ${label}`} evidence={isPlant ? [selected.data] : [selected.data, plant.data]} /> : null}
    >
      {selected.data && plant.data ? (
        <LineChart
          ariaLabel={`${title} for ${label}`}
          labels={plant.data.rows.map(r => r.week_start)}
          series={[
            ...(isPlant ? [] : [{ name: label, color: 'series-1' as const, values: plant.data.rows.map(p => selected.data.rows.find(r => r.week_start === p.week_start)?.[key] ?? null) }]),
            { name: 'Plant', color: isPlant ? ('series-1' as const) : ('reference' as const), values: plant.data.rows.map(r => r[key]) },
          ]}
          unit={unit}
          digits={digits}
          formatX={fmtDate}
          band={band}
        />
      ) : (
        <Skeleton height={220} />
      )}
    </Card>
  )

  const rows = deptOptions.filter(d => d.value !== 'ALL').map(d => ({ key: d.value, label: d.label }))
  const cols = SHIFT_OPTIONS.filter(s => s.value !== 'ALL').map(s => ({ key: s.value, label: s.label }))
  const unit = metric === 'unplanned_absence_rate' ? '%' : ' h'
  const plantRow = grid.data?.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')

  return (
    <>
      <PageHead
        eyebrow="Attendance"
        title="Absence and overtime"
        actions={
          <>
            <Select label="Department" value={dept} options={deptOptions} onChange={d => setFilter(d, shift)} />
            <Segmented label="Shift" value={shift} options={SHIFT_OPTIONS} onChange={s => setFilter(dept, s)} />
          </>
        }
      >
        Unplanned absence counts sickness and unexcused absence (including no-shows) against scheduled hours; vacation is planned and excluded from both sides.
      </PageHead>

      <div className="grid-2">
        {trend('unplanned_absence_rate', 'Unplanned absence', '%', 1)}
        {trend('overtime_hours_per_head', 'Overtime per head', ' h', 2)}
      </div>

      <div className="grid-main">
        <Card
          title="Where it concentrates"
          subtitle={`Department × shift, last ${weeks} weeks. Click a cell to filter.`}
          actions={
            <>
              <Segmented label="Metric" value={metric} onChange={setMetric} options={[{ value: 'unplanned_absence_rate', label: 'Absence %' }, { value: 'overtime_hours_per_head', label: 'Overtime h' }]} />
              <Segmented label="Window" value={weeks} onChange={setWeeks} options={[{ value: 4, label: '4 wks' }, { value: 13, label: '13 wks' }, { value: 26, label: '26 wks' }]} />
            </>
          }
          foot={
            <>
              {plantRow && <span>Plant: {metric === 'unplanned_absence_rate' ? `${plantRow.unplanned_absence_rate}%` : `${plantRow.overtime_hours_per_head} h per head per week`}</span>}
              {grid.data && <EvidenceButton title="Department × shift" evidence={[grid.data]} />}
            </>
          }
        >
          {grid.data ? (
            <Heatmap
              caption="Department by shift"
              rows={rows}
              cols={cols}
              unit={unit}
              digits={metric === 'unplanned_absence_rate' ? 1 : 2}
              cell={(r, c) => {
                const x = grid.data.rows.find(g => g.department_code === r && g.shift === c)
                return x ? { value: x[metric], suppressed: x.suppressed, n: x.employees } : undefined
              }}
              selected={dept !== 'ALL' && shift !== 'ALL' ? { row: dept, col: shift } : undefined}
              onSelect={(r, c) => setFilter(r, c)}
            />
          ) : (
            <Skeleton height={280} />
          )}
        </Card>
        <Card
          title="By weekday"
          subtitle={`Unplanned absence, ${dept === 'ALL' ? 'plant' : groupLabel(dept, 'ALL')}, full period`}
          actions={weekday.data ? <EvidenceButton title="Absence by weekday" evidence={[weekday.data]} /> : null}
          foot={<span>Monday and Friday peaks are typical; compare the shape, not just the level.</span>}
        >
          {weekday.data && weekdayPlant.data ? (
            <BarList
              ariaLabel="Unplanned absence by weekday"
              unit="%"
              items={weekday.data.rows.map(r => ({ key: String(r.iso_weekday), label: WEEKDAYS[r.iso_weekday - 1], value: r.unplanned_absence_rate, focus: r.unplanned_absence_rate === Math.max(...weekday.data.rows.map(x => x.unplanned_absence_rate ?? 0)) }))}
              reference={dept === 'ALL' ? undefined : { value: (weekdayPlant.data.rows.reduce((s, r) => s + (r.unplanned_absence_rate ?? 0), 0) / weekdayPlant.data.rows.length), label: 'Plant average' }}
            />
          ) : (
            <Skeleton height={180} />
          )}
        </Card>
      </div>
    </>
  )
}
