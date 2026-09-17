import os
import sys
import uuid
import argparse
from azure.identity import DefaultAzureCredential
from azure.mgmt.authorization import AuthorizationManagementClient
from azure.mgmt.authorization.models import RoleDefinition, RoleAssignmentCreateParameters
import requests

# Azure Built-in Role IDs (canónicos — no cambian entre tenants)
BUILT_IN_ROLES_ESSENTIAL = {
    "Reader":                 "acdd72a7-3385-48ef-bd42-f606fba81ae7",  # Resource Graph, Advisor, audit KQL
    "Cost Management Reader": "72fafb9e-0641-4937-9268-a91bfd8191a3",  # Cost Management API
    "Monitoring Reader":      "43d0d8ad-25c7-4714-9337-8ba259a9fe05",  # Métricas / rightsizing
    "Billing Reader":         "fa23ad8b-c56e-40d8-ac0c-ce449e1d2c64",  # Facturación MCA-friendly
}

BUILT_IN_ROLES_PROFESSIONAL = {
    **BUILT_IN_ROLES_ESSENTIAL,
    "Tag Contributor":        "4a9ae827-6dc8-4573-8ac7-8239d42aa03f",  # Auto-tagging
}

BUILT_IN_ROLES_BUSINESS = {
    **BUILT_IN_ROLES_PROFESSIONAL,
    # Custom Remediation Role added separately (see CUSTOM_ROLE_ACTIONS)
}

BUILT_IN_ROLES_ENTERPRISE = {
    **BUILT_IN_ROLES_BUSINESS,
    "Monitoring Contributor": "749f88d5-cbae-40b8-bcfc-e573ddc772fa",  # Workbooks deploy + advanced metrics
}

ROLES_BY_TIER = {
    "essential":    BUILT_IN_ROLES_ESSENTIAL,
    "professional": BUILT_IN_ROLES_PROFESSIONAL,
    "business":     BUILT_IN_ROLES_BUSINESS,
    "enterprise":   BUILT_IN_ROLES_ENTERPRISE,
}

CUSTOM_ROLE_ACTIONS = [
    "Microsoft.Compute/virtualMachines/deallocate/action",
    "Microsoft.Compute/virtualMachines/start/action",
    "Microsoft.Compute/virtualMachines/restart/action",
    "Microsoft.Resources/tags/write",
    "Microsoft.Compute/disks/delete",
    "Microsoft.Compute/snapshots/delete",
    "Microsoft.Network/networkInterfaces/delete",
    "Microsoft.Network/networkSecurityGroups/delete",
    "Microsoft.Network/publicIPAddresses/delete",
    "Microsoft.Web/serverfarms/delete",
    "Microsoft.Resources/deployments/*",
    "microsoft.insights/workbooks/write",
    "Microsoft.Resources/subscriptions/resourcegroups/write"
]

# App ID de CSCloudSolutions-FinOps-Agent
FINOPS_APP_ID = "876d8a5b-6023-4484-b3ba-73c186e4a72b"


def resolve_service_principal_object_id(credential, tenant_id: str, app_id: str) -> str:
    """
    Dado un App (client) ID, resuelve el Object ID real del Service Principal 
    en el tenant actual usando Microsoft Graph.
    
    NOTA CRÍTICA: El Object ID del Enterprise App cambia cada vez que se 
    borra y recrea el Service Principal. Los roles RBAC se vinculan al 
    Object ID, NO al App ID. Por eso SIEMPRE debemos resolver el Object ID 
    actual antes de asignar roles.
    """
    print(f"\n[Auto-Detect] Resolviendo Object ID del Service Principal para App ID: {app_id}")
    
    token = credential.get_token("https://graph.microsoft.com/.default")
    headers = {"Authorization": f"Bearer {token.token}"}
    
    url = f"https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '{app_id}'&$select=id,appId,displayName"
    
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"[Auto-Detect] ERROR: Graph API devolvió {response.status_code}: {response.text}")
        raise Exception(f"No se pudo resolver el Service Principal. Graph API status: {response.status_code}")
    
    data = response.json()
    sps = data.get("value", [])
    
    if len(sps) == 0:
        raise Exception(
            f"No se encontró Service Principal con App ID {app_id} en el tenant {tenant_id}. "
            f"Ejecuta 'az ad sp create --id {app_id}' primero."
        )
    
    sp = sps[0]
    object_id = sp["id"]
    display_name = sp.get("displayName", "Desconocido")
    
    print(f"[Auto-Detect] ✓ Encontrado: '{display_name}' con Object ID: {object_id}")
    return object_id


def create_role_assignment(client: AuthorizationManagementClient, scope: str, role_def_id: str, principal_id: str):
    assignment_id = str(uuid.uuid4())
    print(f"  Asignando rol al principal {principal_id}...")
    
    parameters = RoleAssignmentCreateParameters(
        role_definition_id=f"{scope}/providers/Microsoft.Authorization/roleDefinitions/{role_def_id}",
        principal_id=principal_id,
        principal_type="ServicePrincipal"
    )
    
    try:
        assignment = client.role_assignments.create(scope, assignment_id, parameters)
        print(f"  ✓ Asignación creada: {assignment.name}")
        return assignment
    except Exception as e:
        error_msg = str(e)
        if "RoleAssignmentExists" in error_msg:
            print(f"  ℹ El rol ya estaba asignado (OK)")
        else:
            print(f"  ✗ ERROR: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Automatizador de Onboarding para CSCloudSolutions FinOps Agent",
        epilog="Ejemplo: python onboarding_automator.py --subscription-id <id-de-suscripcion-del-cliente> --tier essential"
    )
    parser.add_argument("--subscription-id", required=True, help="ID de la suscripción del cliente")
    parser.add_argument(
        "--tier",
        required=False,
        default="essential",
        choices=["essential", "professional", "business", "enterprise"],
        help="Tier del tenant (default: essential). Determina el set de roles a asignar."
    )
    parser.add_argument(
        "--principal-id", 
        required=False,
        help="(Opcional) Object ID del Service Principal. Si no se proporciona, se auto-detecta via Microsoft Graph."
    )
    
    args = parser.parse_args()
    
    subscription_id = args.subscription_id
    tier = args.tier.lower()
    scope = f"/subscriptions/{subscription_id}"
    built_in_roles = ROLES_BY_TIER[tier]
    requires_custom_role = tier in ("business", "enterprise")
    
    print("=" * 70)
    print("  CSCloudSolutions FinOps Agent - Onboarding Automático")
    print("=" * 70)
    print(f"  Suscripción: {subscription_id}")
    print(f"  Tier:        {tier.capitalize()}")
    print(f"  Scope:       {scope}")
    
    # Authenticate using DefaultAzureCredential (requires az login)
    credential = DefaultAzureCredential()
    
    # Resolve the correct Object ID
    if args.principal_id:
        principal_id = args.principal_id
        print(f"  Principal ID (manual): {principal_id}")
        print("  ⚠ ADVERTENCIA: Si borró y recreó el Service Principal, el Object ID")
        print("    puede haber cambiado. Considere omitir --principal-id para auto-detectar.")
    else:
        # Auto-detect: query Graph API to get the CURRENT Object ID
        # First, get the tenant ID from the subscription
        token_mgmt = credential.get_token("https://management.azure.com/.default")
        sub_res = requests.get(
            f"https://management.azure.com/subscriptions/{subscription_id}?api-version=2020-01-01",
            headers={"Authorization": f"Bearer {token_mgmt.token}"}
        )
        if sub_res.status_code == 200:
            tenant_id = sub_res.json().get("tenantId", "")
        else:
            # Fallback: ask user or use az account
            import subprocess
            result = subprocess.run(["az", "account", "show", "--query", "tenantId", "-o", "tsv"], capture_output=True, text=True)
            tenant_id = result.stdout.strip()
        
        if not tenant_id:
            print("  ✗ ERROR: No se pudo determinar el Tenant ID. Usa --principal-id manualmente.")
            sys.exit(1)
        
        print(f"  Tenant ID: {tenant_id}")
        
        principal_id = resolve_service_principal_object_id(credential, tenant_id, FINOPS_APP_ID)
    
    print("=" * 70)
    
    client = AuthorizationManagementClient(credential, subscription_id)
    
    # 1. Assign built-in roles for the selected tier
    print(f"\n--- Paso 1: Asignando Roles Built-in ({tier.capitalize()}: {len(built_in_roles)} roles) ---")
    for role_name, role_id in built_in_roles.items():
        print(f"\n  Rol: {role_name}")
        create_role_assignment(client, scope, role_id, principal_id)

    # 1b. Cost Management Reader en el MANAGEMENT GROUP raíz.
    #
    # No alcanza con tenerlo por suscripción. Con el scope de MG, el costo de
    # TODAS las suscripciones se consulta en UNA llamada a Cost Management; sin
    # él, la plataforma degrada a una consulta por suscripción y Azure devuelve
    # 429 (Too many requests), dejando los paneles de histórico y proyección
    # degradados o vacíos.
    #
    # Best-effort a propósito: falla si quien corre el script no es Owner ni
    # User Access Administrator del MG, y eso NO debe abortar el onboarding.
    print("\n--- Paso 1b: Cost Management Reader en el Management Group raíz (recomendado) ---")
    mg_tenant_id = locals().get("tenant_id") or ""
    if not mg_tenant_id:
        # Con --principal-id no se resolvió el tenant más arriba.
        try:
            token_mgmt = credential.get_token("https://management.azure.com/.default")
            sub_res = requests.get(
                f"https://management.azure.com/subscriptions/{subscription_id}?api-version=2020-01-01",
                headers={"Authorization": f"Bearer {token_mgmt.token}"}
            )
            if sub_res.status_code == 200:
                mg_tenant_id = sub_res.json().get("tenantId", "")
        except Exception:
            mg_tenant_id = ""

    if not mg_tenant_id:
        print("  ⚠ No se pudo determinar el Tenant ID; se omite el paso del Management Group.")
    else:
        mg_scope = f"/providers/Microsoft.Management/managementGroups/{mg_tenant_id}"
        print(f"  Scope: {mg_scope}")
        mg_client = AuthorizationManagementClient(credential, subscription_id)
        resultado_mg = create_role_assignment(
            mg_client, mg_scope, BUILT_IN_ROLES_ESSENTIAL["Cost Management Reader"], principal_id
        )
        if resultado_mg is None:
            print("  ⚠ Sin este rol el costo se consulta suscripción por suscripción y aparecen los 429.")
            print("    Requiere ser Owner o User Access Administrator en el MG raíz. Pedirle a esa persona:")
            print(f"    az role assignment create --assignee {principal_id} \\")
            print(f"      --role 'Cost Management Reader' --scope '{mg_scope}'")
        
    # 2. Create Custom Remediation Role (Business / Enterprise only)
    custom_role_assigned = False
    custom_role_name = "CSCloudSolutions Remediation Role"
    if requires_custom_role:
        print("\n--- Paso 2: Creando Rol Personalizado de Remediación ---")
        custom_role_id = str(uuid.uuid4())
        role_def = RoleDefinition(
            role_name=custom_role_name,
            description="Permite a CSCloudSolutions ejecutar acciones limitadas de FinOps (apagar, encender, etiquetar, eliminar huérfanos)",
            assignable_scopes=[scope],
            permissions=[{"actions": CUSTOM_ROLE_ACTIONS, "not_actions": [], "data_actions": [], "not_data_actions": []}]
        )
        try:
            print(f"  Creando definición: {custom_role_name}...")
            created_role_def = client.role_definitions.create_or_update(scope, custom_role_id, role_def)
            print(f"  ✓ Rol personalizado creado: {created_role_def.name}")
            print("\n--- Paso 3: Asignando Rol Personalizado ---")
            create_role_assignment(client, scope, created_role_def.name, principal_id)
            custom_role_assigned = True
        except Exception as e:
            error_msg = str(e)
            if "RoleDefinitionWithSameNameExists" in error_msg:
                print(f"  ℹ El rol personalizado ya existe. Buscando su ID para asignarlo...")
                for rd in client.role_definitions.list(scope):
                    if rd.role_name == custom_role_name:
                        print(f"  ✓ Encontrado: {rd.name}")
                        create_role_assignment(client, scope, rd.name, principal_id)
                        custom_role_assigned = True
                        break
            else:
                print(f"  ✗ ERROR creando rol personalizado: {e}")

    print("\n" + "=" * 70)
    print("  ✓ Onboarding Completado")
    print("=" * 70)
    print(f"\n  Service Principal (Object ID: {principal_id})")
    print(f"  Tier: {tier.capitalize()} | Suscripción: {subscription_id}")
    print(f"\n  Roles asignados:")
    for role_name in built_in_roles:
        print(f"    • {role_name}")
    if custom_role_assigned:
        print(f"    • {custom_role_name} (rol personalizado)")
    print(f"\n  La aplicación FinOps debería poder leer la suscripción en ~30 segundos.")

if __name__ == "__main__":
    main()
