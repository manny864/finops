@echo off
REM Deploy Staging a Azure — Script Automatizado (Windows)
REM ==================================================
REM
REM Uso:
REM   deploy-staging.bat
REM
REM Prerrequisitos:
REM   - az CLI autenticado en la suscripción CSCloudSolutions
REM   - terraform 1.8+
REM   - git configurado (user.name, user.email)
REM   - staging.tfvars completado (sin secretos)

setlocal enabledelayedexpansion

echo ========================================================
echo CSCloudSolutions FinOps - Staging Deployment
echo ========================================================
echo.

REM PASO 1: Validar prerequisitos
echo Validando prerequisitos...

where az >nul 2>&1
if errorlevel 1 (
    echo Error: Azure CLI no encontrado
    echo Instalar desde: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli
    exit /b 1
)

where terraform >nul 2>&1
if errorlevel 1 (
    echo Error: Terraform no encontrado
    echo Instalar desde: https://www.terraform.io/downloads
    exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
    echo Error: Git no encontrado
    echo Instalar desde: https://git-scm.com/downloads
    exit /b 1
)

echo OK: Azure CLI, Terraform y Git encontrados
echo.

REM PASO 2: Validar autenticacion en Azure
echo Validando autenticacion en Azure...

for /f "tokens=*" %%i in ('az account show --query id -o tsv 2^>nul') do set CURRENT_SUB=%%i

if "%CURRENT_SUB%"=="" (
    echo Error: No autenticado en Azure
    echo Ejecutar: az login
    exit /b 1
)

echo Suscripcion actual: !CURRENT_SUB!
set /p CONFIRM="Es la suscripcion CSCloudSolutions correcta? (s/n): "

if /i not "%CONFIRM%"=="s" (
    echo Cambiar a la suscripcion correcta: az account set --subscription ^<SUB_ID^>
    exit /b 1
)

echo OK: Suscripcion validada
echo.

REM PASO 3: Validar staging.tfvars
echo Validando staging.tfvars...

if not exist "infra\terraform\environments\staging\staging.tfvars" (
    echo Error: staging.tfvars no encontrado
    echo Ejecutar:
    echo   copy infra\terraform\environments\staging\staging.tfvars.example ^
    echo        infra\terraform\environments\staging\staging.tfvars
    exit /b 1
)

findstr /M "YOUR_AZURE_SUBSCRIPTION_ID" "infra\terraform\environments\staging\staging.tfvars" >nul
if not errorlevel 1 (
    echo Error: staging.tfvars contiene placeholders
    echo Editar y reemplazar valores
    exit /b 1
)

echo OK: staging.tfvars valido
echo.

REM PASO 4: Terraform Init
echo Inicializando Terraform...

cd infra\terraform\environments\staging

for /f "tokens=*" %%i in ('terraform -chdir=..\prod output -raw storage_account_name 2^>nul') do set STORAGE_ACCOUNT=%%i

if "%STORAGE_ACCOUNT%"=="" (
    set /p STORAGE_ACCOUNT="Storage account name: "
)

echo Storage account: !STORAGE_ACCOUNT!

terraform init ^
    -backend-config="resource_group_name=cscs-finops-prod-westus2-rg" ^
    -backend-config="storage_account_name=!STORAGE_ACCOUNT!" ^
    -backend-config="container_name=tfstate" ^
    -backend-config="key=staging/terraform.tfstate" ^
    -upgrade

if errorlevel 1 (
    echo Error: Terraform init fallo
    exit /b 1
)

echo OK: Terraform inicializado
echo.

REM PASO 5: Terraform Plan
echo Ejecutando terraform plan...

terraform plan -var-file=staging.tfvars -out=tfplan

if errorlevel 1 (
    echo Error: Terraform plan fallo
    exit /b 1
)

echo.
echo REVISION REQUERIDA:
echo El plan anterior muestra los recursos que se crearan/modificaran
echo Asegurate que:
echo   - Se crea MySQL finops_staging (NUEVA)
echo   - Se crea Container App web-staging (NUEVA)
echo   - NO se modifica prod (ACR, prod MySQL, Redis, etc)
echo.

set /p CONFIRM2="Aplicar cambios? (s/n): "

if /i not "%CONFIRM2%"=="s" (
    echo Deploy cancelado por usuario
    del tfplan
    exit /b 1
)

echo.

REM PASO 6: Terraform Apply
echo Ejecutando terraform apply...

terraform apply tfplan

if errorlevel 1 (
    echo Error: Terraform apply fallo
    exit /b 1
)

del tfplan

echo OK: Infraestructura de staging creada
echo.

REM PASO 7: Mostrar outputs
echo Informacion de Staging:
echo ==================================================

terraform output environment_info

echo.
echo URLs:
for /f "tokens=*" %%i in ('terraform output -json web_apps ^| jq -r ".us.hostname" 2^>nul') do echo   Web: %%i

echo.
echo Credenciales DB:
for /f "tokens=*" %%i in ('terraform output -json mysql_hostnames ^| jq -r ".us.hostname" 2^>nul') do echo   Host: %%i
for /f "tokens=*" %%i in ('terraform output -json mysql_hostnames ^| jq -r ".us.admin_login" 2^>nul') do echo   User: %%i
for /f "tokens=*" %%i in ('terraform output -json mysql_hostnames ^| jq -r ".us.database" 2^>nul') do echo   Database: %%i
echo   Password: (obtener de Key Vault)

echo.

cd ..\..\..\

REM PASO 8: Git Commit
echo Commiteando cambios a Git...

git add -A

git commit -m "infra: add staging environment (Terraform)" || echo Info: Sin cambios para commitear

echo.

REM PASO 9: Git Push
echo Push a rama staging...

git branch -M staging 2>nul || git checkout -b staging

git push -u origin staging

if errorlevel 1 (
    echo Error: Git push fallo
    exit /b 1
)

echo OK: Push completado
echo.

echo ========================================================
echo STAGING DEPLOYMENT COMPLETADO
echo ========================================================
echo.
echo Proximos pasos:
echo 1. GitHub Actions ejecuta automaticamente (rama staging)
echo 2. Ver estado en: https://github.com/manny864/finops/actions
echo 3. Workflow: deploy ^> test ^> build ^> deploy
echo.
echo Documentacion:
echo   - Guia: docs/GUIA_IMPLEMENTACION_STAGING.md
echo   - Troubleshooting: docs/GUIA_IMPLEMENTACION_STAGING.md#troubleshooting
echo.
echo OK: TODO LISTO
echo.
