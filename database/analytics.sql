-- Reference analytics queries for the production design.
-- All metrics remain aggregate; no employee-level scoring is used.

-- 1) Monthly attendance rate
WITH monthly_hours AS (
  SELECT date_trunc('month', attendance_date) AS month,
         SUM(worked_hours) AS worked,
         SUM(scheduled_hours) AS scheduled
  FROM attendance
  WHERE attendance_date <= CURRENT_DATE
  GROUP BY 1
)
SELECT month,
       ROUND(100.0 * worked / NULLIF(scheduled, 0), 2) AS attendance_rate
FROM monthly_hours
ORDER BY month;

-- 2) Department attrition
SELECT d.name AS department,
       COUNT(*) FILTER (WHERE e.termination_date IS NOT NULL) AS exits,
       COUNT(*) AS employees_observed,
       ROUND(
         100.0 * COUNT(*) FILTER (WHERE e.termination_date IS NOT NULL)
         / NULLIF(COUNT(*), 0), 2
       ) AS attrition_rate
FROM employees e
JOIN departments d USING (department_id)
GROUP BY d.name
ORDER BY attrition_rate DESC;

-- 3) Training completion
SELECT d.name AS department,
       ROUND(
         100.0 * COUNT(*) FILTER (WHERE tr.completed_at IS NOT NULL)
         / NULLIF(COUNT(*), 0), 2
       ) AS completion_rate
FROM training_records tr
JOIN employees e USING (employee_id)
JOIN departments d USING (department_id)
GROUP BY d.name
ORDER BY completion_rate DESC;

-- 4) Average overtime by department, last 28 days
SELECT d.name AS department,
       ROUND(AVG(a.overtime_hours), 2) AS avg_overtime_hours
FROM attendance a
JOIN employees e USING (employee_id)
JOIN departments d USING (department_id)
WHERE a.attendance_date >= CURRENT_DATE - INTERVAL '28 days'
  AND a.attendance_date <= CURRENT_DATE
GROUP BY d.name
ORDER BY avg_overtime_hours DESC;

-- 5) Quality gate: rows that should be quarantined before KPI calculation
SELECT employee_id::text AS source_record_key,
       'attendance' AS source_table,
       'future_attendance_date' AS rule_name,
       attendance_date::text AS detail
FROM attendance
WHERE attendance_date > CURRENT_DATE

UNION ALL

SELECT employee_id::text,
       'employees',
       'missing_shift_assignment',
       'shift is null'
FROM employees
WHERE shift IS NULL;

-- 6) Open-position visibility
SELECT d.name AS department,
       wp.approved_positions,
       wp.open_positions,
       ROUND(100.0 * wp.open_positions / NULLIF(wp.approved_positions, 0), 2) AS vacancy_rate
FROM workforce_plan wp
JOIN departments d USING (department_id)
WHERE wp.snapshot_month = (SELECT MAX(snapshot_month) FROM workforce_plan)
ORDER BY vacancy_rate DESC;
