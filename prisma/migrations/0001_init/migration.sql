-- Core operational tables. Mirrors prisma/schema.prisma;
-- tests/schema-drift.test.ts fails if the two diverge.

-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('EARLY', 'LATE', 'NIGHT');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('PERMANENT', 'FIXED_TERM');

-- CreateEnum
CREATE TYPE "ExitType" AS ENUM ('VOLUNTARY', 'INVOLUNTARY', 'END_OF_CONTRACT');

-- CreateEnum
CREATE TYPE "AbsenceCode" AS ENUM ('SICK', 'UNEXCUSED', 'VACATION');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('ERROR', 'WARNING');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'OVERRIDDEN');

-- CreateTable
CREATE TABLE "department" (
    "id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" SERIAL NOT NULL,
    "badge_id" TEXT NOT NULL,
    "department_id" INTEGER NOT NULL,
    "job_family" TEXT NOT NULL,
    "shift" "Shift",
    "contract_type" "ContractType" NOT NULL,
    "hire_date" DATE NOT NULL,
    "exit_date" DATE,
    "exit_type" "ExitType",

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_day" (
    "employee_id" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "scheduled_hours" DECIMAL(4,2) NOT NULL,
    "worked_hours" DECIMAL(4,2) NOT NULL,
    "overtime_hours" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "absence_code" "AbsenceCode",

    CONSTRAINT "attendance_day_pkey" PRIMARY KEY ("employee_id","work_date")
);

-- CreateTable
CREATE TABLE "training_program" (
    "id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL,
    "pass_score" INTEGER NOT NULL DEFAULT 80,

    CONSTRAINT "training_program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_assignment" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "program_id" INTEGER NOT NULL,
    "assigned_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "completed_on" DATE,
    "pre_score" INTEGER,
    "post_score" INTEGER,

    CONSTRAINT "training_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_run" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "as_of" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "stats" JSONB,

    CONSTRAINT "pipeline_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_issue" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "rule_code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 1,
    "detail" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,

    CONSTRAINT "quality_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "department_code_key" ON "department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_badge_id_key" ON "employee"("badge_id");

-- CreateIndex
CREATE INDEX "employee_department_id_idx" ON "employee"("department_id");

-- CreateIndex
CREATE INDEX "attendance_day_work_date_idx" ON "attendance_day"("work_date");

-- CreateIndex
CREATE UNIQUE INDEX "training_program_code_key" ON "training_program"("code");

-- CreateIndex
CREATE INDEX "training_assignment_program_id_idx" ON "training_assignment"("program_id");

-- CreateIndex
CREATE INDEX "training_assignment_employee_id_idx" ON "training_assignment"("employee_id");

-- CreateIndex
CREATE INDEX "quality_issue_status_rule_code_idx" ON "quality_issue"("status", "rule_code");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_assignment" ADD CONSTRAINT "training_assignment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_assignment" ADD CONSTRAINT "training_assignment_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "training_program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_issue" ADD CONSTRAINT "quality_issue_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "pipeline_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
