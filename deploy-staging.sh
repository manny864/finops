#!/bin/bash
# Deploy Staging a Azure — Script Automatizado
# ===============================================
#
# Uso:
#   bash deploy-staging.sh
#
# Prerrequisitos:
#   - az CLI autenticado en la suscripción CSCloudSolutions
#   - terraform 1.8+
#   - git configurado (user.name, user.email)
#   - staging.tfvars completado (sin secretos)

set -e

echo "🚀 CSCloudSolutions FinOps — Staging Deployment"
echo "=================================================="
echo ""

# ============================================================================
# PASO 1: Validar prerequisitos
# ============================================================================
echo "📋 Validando prerequisitos..."

if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI no encontrado. Instalar: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

if ! command -v terraform &> /dev/null; then
    echo "❌ Terraform no encontrado. Instalar: https://www.terraform.io/downloads"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "❌ Git no encontrado. Instalar: https://git-scm.com/downloads"
    exit 1
fi

echo "✅ Az CLI: $(az --version | grep azure-cli)"
echo "✅ Terraform: $(terraform --version | head -1)"
echo "✅ Git: $(git --version)"
echo ""

# ============================================================================
# PASO 2: Validar autenticación en Azure
# ============================================================================
echo "🔐 Validando autenticación en Azure..."

CURRENT_SUB=$(az account show --query id -o tsv 2>/dev/null || echo "")
CURRENT_TENANT=$(az account show --query tenantId -o tsv 2>/dev/null || echo "")

if [ -z "$CURRENT_SUB" ]; then
    echo "❌ No autenticado en Azure. Ejecutar: az login"
    exit 1
fi

echo "ℹ️  Suscripción actual: $CURRENT_SUB"
echo "ℹ️  Tenant actual: $CURRENT_TENANT"
echo ""

read -p "¿Es la suscripción CSCloudSolutions correcta? (s/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "❌ Cambiar a la suscripción correcta: az account set --subscription <SUB_ID>"
    exit 1
fi
echo "✅ Suscripción validada"
echo ""

# ============================================================================
# PASO 3: Validar staging.tfvars
# ============================================================================
echo "📄 Validando staging.tfvars..."

if [ ! -f "infra/terraform/environments/staging/staging.tfvars" ]; then
    echo "❌ staging.tfvars no encontrado. Ejecutar:"
    echo "   cp infra/terraform/environments/staging/staging.tfvars.example \\"
    echo "      infra/terraform/environments/staging/staging.tfvars"
    exit 1
fi

if grep -q "YOUR_AZURE_SUBSCRIPTION_ID\|YOUR_AZURE_TENANT_ID" "infra/terraform/environments/staging/staging.tfvars"; then
    echo "❌ staging.tfvars contiene placeholders. Editar y reemplazar valores."
    exit 1
fi

echo "✅ staging.tfvars válido"
echo ""

# ============================================================================
# PASO 4: Terraform Init
# ============================================================================
echo "🔧 Inicializando Terraform..."

cd infra/terraform/environments/staging

# Obtener nombre de storage account del output de prod
echo "   Detectando backend storage account..."
cd ../prod
STORAGE_ACCOUNT=$(terraform output -raw storage_account_name 2>/dev/null || echo "")
cd ../staging

if [ -z "$STORAGE_ACCOUNT" ]; then
    echo "⚠️  No se pudo obtener storage account de prod. Ingresarlo manualmente:"
    read -p "Storage account name: " STORAGE_ACCOUNT
fi

echo "   Storage account: $STORAGE_ACCOUNT"

terraform init \
    -backend-config="resource_group_name=cscs-finops-prod-westus2-rg" \
    -backend-config="storage_account_name=$STORAGE_ACCOUNT" \
    -backend-config="container_name=tfstate" \
    -backend-config="key=staging/terraform.tfstate" \
    -upgrade

echo "✅ Terraform inicializado"
echo ""

# ============================================================================
# PASO 5: Terraform Plan
# ============================================================================
echo "📊 Ejecutando terraform plan..."

terraform plan \
    -var-file=staging.tfvars \
    -out=tfplan

echo ""
echo "⚠️  REVISIÓN REQUERIDA:"
echo "   El plan anterior muestra los recursos que se crearán/modificarán."
echo "   Asegúrate de que:"
echo "   ✓ Se crea MySQL finops_staging (NUEVA)"
echo "   ✓ Se crea Container App web-staging (NUEVA)"
echo "   ✓ NO se modifica prod (ACR, prod MySQL, Redis, etc)"
echo ""

read -p "¿Aplicar cambios? (s/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "❌ Deploy cancelado por usuario."
    rm tfplan
    exit 1
fi
echo ""

# ============================================================================
# PASO 6: Terraform Apply
# ============================================================================
echo "🚀 Ejecutando terraform apply..."

terraform apply tfplan

rm tfplan

echo "✅ Infraestructura de staging creada"
echo ""

# ============================================================================
# PASO 7: Mostrar outputs
# ============================================================================
echo "📌 Información de Staging:"
echo "=================================================="

terraform output environment_info

echo ""
echo "🌍 URLs:"
echo "   Web: $(terraform output -json web_apps | jq -r '.us.hostname')"
echo ""

echo "🗄️  Credenciales DB:"
MYSQL_HOST=$(terraform output -json mysql_hostnames | jq -r '.us.hostname')
MYSQL_USER=$(terraform output -json mysql_hostnames | jq -r '.us.admin_login')
MYSQL_DB=$(terraform output -json mysql_hostnames | jq -r '.us.database')

echo "   Host: $MYSQL_HOST"
echo "   User: $MYSQL_USER"
echo "   Database: $MYSQL_DB"
echo "   Password: (obtener de Key Vault)"
echo ""

# ============================================================================
# PASO 8: Git Commit
# ============================================================================
cd - > /dev/null  # Volver a root del repo

echo "📝 Commiteando cambios a Git..."

git add -A

git commit -m "infra: add staging environment (Terraform)

- Container Apps (0.5 vCPU, 1 replica, compartido con prod)
- MySQL Staging (B1ms, separada de prod)
- Redis (compartido, prefijo staging:)
- Storage & Key Vault (compartidos)
- CI/CD workflow: deploy-staging.yml

Costo incremental: +\$45-50/mes

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" || echo "ℹ️  Sin cambios para commitear"

echo ""

# ============================================================================
# PASO 9: Git Push
# ============================================================================
echo "🔄 Push a rama staging..."

git branch -M staging 2>/dev/null || git checkout -b staging

git push -u origin staging

echo "✅ Push completado"
echo ""

# ============================================================================
# FINALES
# ============================================================================
echo "🎉 STAGING DEPLOYMENT COMPLETADO"
echo "=================================================="
echo ""
echo "Próximos pasos:"
echo "1. GitHub Actions ejecuta automáticamente (rama staging)"
echo "2. Ver estado en: https://github.com/manny864/finops/actions"
echo "3. Workflow: deploy → test → build → deploy"
echo "4. Health check en: https://$(terraform -chdir=infra/terraform/environments/staging output -json web_apps | jq -r '.us.hostname')"
echo ""
echo "📚 Documentación:"
echo "   - Guía completa: docs/GUIA_IMPLEMENTACION_STAGING.md"
echo "   - Troubleshooting: docs/GUIA_IMPLEMENTACION_STAGING.md#troubleshooting"
echo ""
echo "✅ TODO LISTO"
