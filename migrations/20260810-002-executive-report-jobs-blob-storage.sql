ALTER TABLE ExecutiveReportJobs
    ADD COLUMN report_stored_name VARCHAR(255) NULL AFTER report_markdown;
