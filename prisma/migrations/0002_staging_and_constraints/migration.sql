-- Landing zone for source-system extracts, plus constraints Prisma cannot express.
--
-- Staging tables are deliberately permissive (no keys, no FKs, no checks):
-- they hold exactly what the source delivered so that quality rules can
-- inspect it. Only rows that pass the rules are copied into the core tables,
-- and the CHECK constraints below make sure a rule gap cannot leak bad
-- values into KPIs.

CREATE SCHEMA IF NOT EXISTS staging;

-- HR master data export (one row per employment record)
CREATE TABLE staging.hris_employee (
    row_no        INTEGER NOT NULL,
    badge_id      TEXT,
    dept_code     TEXT,
    job_family    TEXT,
    shift         TEXT,
    contract      TEXT,
    hire_date     DATE,
    exit_date     DATE,
    exit_reason   TEXT
);

-- Time & attendance export (one row per badge per scheduled day)
CREATE TABLE staging.timeclock_day (
    row_no          INTEGER NOT NULL,
    badge_id        TEXT,
    work_date       DATE,
    scheduled_hours NUMERIC,
    worked_hours    NUMERIC,
    overtime_hours  NUMERIC,
    absence_code    TEXT
);

-- Learning management system export (one row per assignment)
CREATE TABLE staging.lms_assignment (
    row_no        INTEGER NOT NULL,
    badge_id      TEXT,
    program_code  TEXT,
    assigned_on   DATE,
    due_on        DATE,
    completed_on  DATE,
    pre_score     INTEGER,
    post_score    INTEGER
);

-- Row-level rejects written by the quality rules of the current run.
CREATE TABLE staging.reject (
    source     TEXT    NOT NULL,
    row_no     INTEGER NOT NULL,
    rule_code  TEXT    NOT NULL,
    source_key TEXT    NOT NULL,
    detail     TEXT    NOT NULL,
    -- true: the row is held back from the core tables.
    -- false: the row loads but is flagged (or excluded later by the analytics layer).
    blocking   BOOLEAN NOT NULL
);
CREATE INDEX reject_source_row_idx ON staging.reject (source, row_no);

-- Defence in depth on the core tables
ALTER TABLE "employee"
    ADD CONSTRAINT employee_exit_after_hire CHECK ("exit_date" IS NULL OR "exit_date" >= "hire_date"),
    ADD CONSTRAINT employee_exit_type_with_date CHECK (("exit_date" IS NULL) = ("exit_type" IS NULL));

ALTER TABLE "attendance_day"
    ADD CONSTRAINT attendance_scheduled_range CHECK ("scheduled_hours" BETWEEN 0 AND 12),
    ADD CONSTRAINT attendance_worked_range CHECK ("worked_hours" BETWEEN 0 AND 12),
    ADD CONSTRAINT attendance_overtime_range CHECK ("overtime_hours" BETWEEN 0 AND 6),
    ADD CONSTRAINT attendance_absence_consistent CHECK ("absence_code" IS NULL OR "worked_hours" = 0);

ALTER TABLE "training_assignment"
    ADD CONSTRAINT training_due_after_assigned CHECK ("due_on" >= "assigned_on"),
    ADD CONSTRAINT training_completed_after_assigned CHECK ("completed_on" IS NULL OR "completed_on" >= "assigned_on"),
    ADD CONSTRAINT training_pre_score_range CHECK ("pre_score" BETWEEN 0 AND 100),
    ADD CONSTRAINT training_post_score_range CHECK ("post_score" BETWEEN 0 AND 100);
