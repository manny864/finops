output "lock_enabled" {
  value = var.environment == "prod"
}
