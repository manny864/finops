-- Power Schedules: además de apagado recurrente diario, ahora soporta
-- encendido/reinicio y una fecha puntual (one-off) en vez de solo recurrente.
ALTER TABLE PowerSchedules
    ADD COLUMN action_type ENUM('shutdown','start','restart') NOT NULL DEFAULT 'shutdown' AFTER vm_name,
    ADD COLUMN schedule_date DATE NULL AFTER gmt_offset;

-- El UNIQUE original era (tenant,sub,rg,vm) — un solo horario por VM. Ahora
-- una misma VM puede tener un horario de shutdown Y uno de start (o restart)
-- en simultáneo, así que la unicidad pasa a incluir action_type.
ALTER TABLE PowerSchedules DROP INDEX uq_tenant_vm;
ALTER TABLE PowerSchedules ADD UNIQUE KEY uq_tenant_vm_action (tenant_id, subscription_id, resource_group, vm_name, action_type);
