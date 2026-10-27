import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import { departmentName } from '../../api/queries'
import { Card, EvidenceButton, PageHead, Skeleton, fmt } from '../common'
import { BarList, Scatter } from '../charts'

export function Training() {
  const trpc = useTRPC()
  const programs = useQuery(trpc.training.programs.queryOptions())
  const overdue = useQuery(trpc.training.overdueByDepartment.queryOptions())
  const plantOverdue = overdue.data ? (100 * overdue.data.rows.reduce((s, r) => s + r.overdue, 0)) / overdue.data.rows.reduce((s, r) => s + r.assignments_due, 0) : 0
  const weak = (p: { on_time_completion_rate: number | null; avg_score_uplift: number | null }) => (p.on_time_completion_rate ?? 0) >= 90 && (p.avg_score_uplift ?? 99) < 3

  return (
    <>
      <PageHead eyebrow="Learning" title="Training compliance and effectiveness">
        Completion shows who sat the course. The change between pre- and post-assessment shows whether anyone learned something. Report both.
      </PageHead>

      <div className="grid-main">
        <Card
          title="Completion vs. learning"
          subtitle="Each dot is a program: on-time completion (x) against mean score uplift (y)"
          actions={programs.data ? <EvidenceButton title="Training programs" evidence={[programs.data]} /> : null}
        >
          {programs.data ? (
            <Scatter
              ariaLabel="Training programs by on-time completion and score uplift"
              xLabel="On-time completion"
              yLabel="Score uplift (pts)"
              xUnit="%"
              yUnit=" pts"
              points={programs.data.rows.filter(p => p.on_time_completion_rate != null && p.avg_score_uplift != null).map(p => ({ key: p.program_code, label: p.program_name, x: p.on_time_completion_rate!, y: p.avg_score_uplift!, focus: weak(p) }))}
              guides={{ y: 3, note: <>Below the line (under 3 points uplift) a course is mostly confirming what people already know. Highlighted in orange: high completion, little learning.</> }}
            />
          ) : (
            <Skeleton height={280} />
          )}
        </Card>
        <Card
          title="Mandatory training overdue"
          subtitle="Share of due assignments not completed, by department"
          actions={overdue.data ? <EvidenceButton title="Mandatory training overdue" evidence={[overdue.data]} /> : null}
          foot={<span>Cross-check with overtime: a team with no slack cannot attend training.</span>}
        >
          {overdue.data ? (
            <BarList
              ariaLabel="Overdue mandatory training by department"
              unit="%"
              reference={{ value: plantOverdue, label: 'Plant' }}
              items={overdue.data.rows.map((r, i) => ({ key: r.department_code, label: departmentName(r.department_code), value: r.overdue_rate, focus: i === 0, note: `${r.overdue} of ${r.assignments_due} overdue` }))}
            />
          ) : (
            <Skeleton height={220} />
          )}
        </Card>
      </div>

      <Card title="Programs" subtitle="Assignments due by the as-of date">
        {programs.data ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Category</th>
                  <th className="num">Due</th>
                  <th className="num">On time</th>
                  <th className="num">Overdue</th>
                  <th className="num">Score uplift</th>
                  <th className="num">Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {programs.data.rows.map(p => (
                  <tr key={p.program_code}>
                    <td>
                      {p.program_name} {p.mandatory && <span className="badge neutral">mandatory</span>} {weak(p) && <span className="badge warn">little learning</span>}
                    </td>
                    <td className="text-2">{p.category}</td>
                    <td className="num">{p.assignments_due.toLocaleString('en-US')}</td>
                    <td className="num">{fmt(p.on_time_completion_rate)}%</td>
                    <td className="num">{p.overdue}</td>
                    <td className="num">+{fmt(p.avg_score_uplift)}</td>
                    <td className="num">{fmt(p.pass_rate)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Skeleton height={200} />
        )}
      </Card>
    </>
  )
}
