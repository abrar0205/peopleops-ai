-- PeopleOps AI reference schema (PostgreSQL)
-- Public demo data is synthetic and aggregate-only.

CREATE TABLE departments (
  department_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  plant_area TEXT NOT NULL
);

CREATE TABLE employees (
  employee_id BIGSERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(department_id),
  job_family TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('early', 'late', 'night')),
  hire_date DATE NOT NULL,
  termination_date DATE,
  employment_status TEXT NOT NULL CHECK (employment_status IN ('active','terminated')),
  CHECK (termination_date IS NULL OR termination_date >= hire_date)
);

CREATE TABLE attendance (
  employee_id BIGINT NOT NULL REFERENCES employees(employee_id),
  attendance_date DATE NOT NULL,
  scheduled_hours NUMERIC(5,2) NOT NULL CHECK (scheduled_hours >= 0),
  worked_hours NUMERIC(5,2) NOT NULL CHECK (worked_hours >= 0),
  overtime_hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  absence_type TEXT,
  PRIMARY KEY (employee_id, attendance_date)
);

CREATE TABLE training_records (
  training_record_id BIGSERIAL PRIMARY KEY,
  employee_id BIGINT NOT NULL REFERENCES employees(employee_id),
  program_name TEXT NOT NULL,
  assigned_at DATE NOT NULL,
  completed_at DATE,
  score NUMERIC(5,2) CHECK (score BETWEEN 0 AND 100),
  CHECK (completed_at IS NULL OR completed_at >= assigned_at)
);

CREATE TABLE workforce_plan (
  department_id INT NOT NULL REFERENCES departments(department_id),
  snapshot_month DATE NOT NULL,
  approved_positions INT NOT NULL CHECK (approved_positions >= 0),
  open_positions INT NOT NULL CHECK (open_positions >= 0),
  PRIMARY KEY (department_id, snapshot_month)
);

CREATE TABLE quality_events (
  quality_event_id BIGSERIAL PRIMARY KEY,
  rule_name TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_record_key TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('quarantined','resolved')),
  detail TEXT
);

CREATE INDEX idx_attendance_date ON attendance(attendance_date);
CREATE INDEX idx_employees_department ON employees(department_id);
CREATE INDEX idx_training_employee ON training_records(employee_id);
CREATE INDEX idx_quality_status ON quality_events(status, detected_at);
