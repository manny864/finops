output "job_names" {
  value = { for k, j in azurerm_container_app_job.this : k => j.name }
}

output "schedules" {
  description = "Hora local declarada vs. UTC real. Contrastar la columna local contra `crontab -l` del VPS."
  value = {
    for k, v in var.jobs : k => {
      local = v.cron
      utc   = local.shifted[k]
    }
  }
}
