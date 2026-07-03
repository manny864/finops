-- Horarios de apagado programado de VMs ("Power Schedules").
-- Antes esta feature era un stub de UI (alert() sin persistencia ni ejecucion
-- real). Esta tabla persiste un schedule por VM y el cron
-- /api/cron/power-schedules la consulta periodicamente para ejecutar el
-- apagado real (deallocateVirtualMachine) cuando corresponde.
CREATE TABLE IF NOT EXISTS PowerSchedules (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id              VARCHAR(64)  NOT NULL,
    subscription_id        VARCHAR(64)  NOT NULL,
    resource_group         VARCHAR(128) NOT NULL,
    vm_name                VARCHAR(128) NOT NULL,
    shutdown_time          TIME         NOT NULL,
    gmt_offset             VARCHAR(6)   NOT NULL DEFAULT '+00:00',
    enabled                TINYINT(1)   NOT NULL DEFAULT 1,
    smart_shutdown_enabled TINYINT(1)   NOT NULL DEFAULT 0,
    max_cpu_percentage     INT          NOT NULL DEFAULT 10,
    idle_duration_minutes  INT          NOT NULL DEFAULT 60,
    last_executed_date     DATE         NULL,
    last_execution_status  VARCHAR(32)  NULL,
    last_execution_error   VARCHAR(500) NULL,
    created_by             VARCHAR(255) NULL,
    created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_vm (tenant_id, subscription_id, resource_group, vm_name),
    KEY idx_tenant (tenant_id),
    KEY idx_enabled_time (enabled, shutdown_time)
);
