# 🚀 DEPLOY A STAGING — Guía Rápida (5 MINUTOS)

**Estado:** Infraestructura Terraform lista, solo falta ejecutar  
**Prerequisito:** Credenciales de Azure (CSCloudSolutions)  
**Tiempo:** ~5 minutos

---

## ⚡ OPCIÓN 1: DEPLOY AUTOMATIZADO (Recomendado)

### Windows
```powershell
cd C:\Users\cm012192\Projects\finops
.\deploy-staging.bat
```

### macOS / Linux
```bash
cd ~/Projects/finops
bash deploy-staging.sh
```

**Qué hace el script:**
1. ✅ Valida Azure CLI autenticado
2. ✅ Valida staging.tfvars
3. ✅ `terraform init` (backend remoto)
4. ✅ `terraform plan` (mostrar qué se va a crear)
5. ✅ `terraform apply` (crear infraestructura)
6. ✅ `git push` rama staging (trigger CI/CD automático)
7. ✅ Muestra URLs, credenciales, etc

---

## ⚠️ PASO 0: Cambiar a suscripción CSCloudSolutions

**Problema actual:** Estás autenticado en `BCBA-Testing` (Banco Ciudad), no en CSCloudSolutions.

### Opción A: Cambiar de suscripción

```bash
az account list --output table  # Ver todas las suscripciones

az account set --subscription <SUBSCRIPTION_ID>  # Cambiar a CSCloudSolutions

az account show  # Verificar
```

### Opción B: Re-login con otra cuenta

```bash
az logout
az login  # Ingresa con tu cuenta de CSCloudSolutions
```

---

## 📋 PASO 1: Preparar staging.tfvars

### Copiar template

```bash
cd C:\Users\cm012192\Projects\finops
copy infra\terraform\environments\staging\staging.tfvars.example `
     infra\terraform\environments\staging\staging.tfvars
```

### Editar con tus valores

```bash
notepad infra\terraform\environments\staging\staging.tfvars
```

**Reemplazar estos valores:**

```hcl
subscription_id = "6b7a3455-48f3-4319-81a4-ef6ddb3e7321"  # ← Tu subscription ID
tenant_id       = "99d6b2c5-1dda-4246-b042-ef21eb53f345"  # ← Tu tenant ID

acr_name                = "cscsfinopsprodglobalcr"  # ← Nombre del ACR de prod
acr_resource_group_name = "cscs-finops-prod-westus2-rg"  # ← RG de prod

alert_email = "operations-staging@cscloudsolutions.com.ar"

# IMPORTANTE: Cambiar estos si es necesario
key_vault_secret_ids = {
  paddle_api_key  = "/subscriptions/YOUR_SUB/..."
  # ... agregar más según corresponda
}
```

**Para obtener subscription_id y tenant_id:**

```bash
az account show --query "{subscriptionId: id, tenantId: tenantId}"
```

---

## 🔐 PASO 2: Verificar ACR y backend

### Obtener nombre del ACR de prod

```bash
cd infra\terraform\environments\prod
terraform output acr_login_server
# Output: cscsfinopsprodglobalcr.azurecr.io
# Usar: cscsfinopsprodglobalcr
```

### Obtener storage account

```bash
terraform output storage_account_name
# Output: cscsfinopsprodstorage  (ó similar)
```

---

## 🚀 PASO 3: Ejecutar deploy

### Windows

```powershell
cd C:\Users\cm012192\Projects\finops
.\deploy-staging.bat
```

### macOS / Linux

```bash
cd ~/Projects/finops
bash deploy-staging.sh
```

**El script te pedirá confirmación en cada paso.**

---

## 🔍 PASO 4: Monitorear

### Ver logs del deploy en GitHub Actions

1. Ir a: https://github.com/manny864/finops/actions
2. Workflow: "Deploy to Staging"
3. Ver pasos: test → build → deploy → health-check

### Ver logs en Azure

```bash
# Container App logs
az containerapp logs show \
  -n cscs-finops-staging-westus2-web \
  -g cscs-finops-staging-westus2-rg \
  --follow

# Migration logs
az containerapp job execution show \
  -n cscs-finops-staging-wus2-migrate \
  -g cscs-finops-staging-westus2-rg \
  --execution-id <ID>
```

---

## ✅ PASO 5: Validar

### Health check

```bash
# Debería retornar 200 OK
curl https://cscs-finops-staging-westus2-web.azurecontainerapps.io/api/health
```

### Conectar a MySQL staging

```bash
# Obtener password
az keyvault secret show \
  --vault-name cscs-finops-prod-kv \
  --name mysql-finops-staging-password \
  --query value -o tsv

# Conectar
mysql -h cscs-finops-staging.mysql.database.azure.com \
      -u finops_admin \
      -p \
      finops_staging

# En MySQL:
SELECT COUNT(*) FROM Users;  # Verificar BD vacía
SHOW TABLES;
```

---

## 🐛 TROUBLESHOOTING

### "No autenticado en Azure"

```bash
az login
az account set --subscription <CSCloudSolutions_SUB>
```

### "staging.tfvars contiene placeholders"

Editar el archivo y reemplazar `YOUR_AZURE_...` con valores reales.

### "Storage account no encontrado"

```bash
# Obtener de prod
cd infra/terraform/environments/prod
terraform output storage_account_name

# Copiar a staging.tfvars.example → staging.tfvars
```

### "Terraform plan falla"

```bash
cd infra/terraform/environments/staging
terraform validate
terraform fmt

# Si aún falla:
terraform plan -var-file=staging.tfvars -out=tfplan 2>&1 | tail -20
```

### "Git push falla: 'staging' branch not found"

```bash
git branch -M staging
git push -u origin staging
```

---

## 📊 COSTOS

Esperado por mes:

```
MySQL Staging (B1ms): $30
CAE WEB (0.5 vCPU): $10-15
Total: $45-50 USD
```

Monitorear en: Azure Portal → Subscriptions → Cost Analysis

---

## 📚 DOCUMENTACIÓN

Después del deploy, ver:

- **Guía completa:** `GUIA_IMPLEMENTACION_STAGING.md` (session-state/files/)
- **Arquitectura:** `STAGING_RESUMEN_EJECUTIVO.md` (session-state/files/)
- **Análisis de opciones:** Primeros documentos generados en esta sesión

---

## 🎯 SIGUIENTES PASOS

1. ✅ **Hoy:** Deploy a staging (este documento)
2. ⏱️ **Mañana:** Hacer cambios en rama `staging`, ver auto-deploy en GitHub Actions
3. 📅 **Esta semana:** Testing, validación de data isolation
4. 🚀 **Próximas semanas:** Merge staging → main, deploy a prod

---

**¿Listo?**

```bash
az account set --subscription <CSCloudSolutions_SUB>
./deploy-staging.bat    # Windows
# bash deploy-staging.sh  # Mac/Linux
```

---

**¿Ayuda?** Ver GUIA_IMPLEMENTACION_STAGING.md → sección Troubleshooting
