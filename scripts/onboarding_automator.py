import os
import sys
import uuid
import argparse
from azure.identity import DefaultAzureCredential
from azure.mgmt.authorization import AuthorizationManagementClient
from azure.mgmt.authorization.models import RoleDefinition, RoleAssignmentCreateParameters
import requests

# Azure Built-in Role IDs
BUILT_IN_ROLES = {
    "Reader": "acdd72a7-3385-48ef-bd42-f606fba81ae7",
    "Cost Management Reader": "72fafb9e-0641-4937-9268-a91bfd8191a3",
    "Monitoring Reader": "43d0d8ad-25c7-4714-9337-8ba259a9fe05"
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
    "Microsoft.Web/serverfarms/delete"
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
        epilog="Ejemplo: python onboarding_automator.py --subscription-id 0beb7800-... [--principal-id xxx]"
    )
    parser.add_argument("--subscription-id", required=True, help="ID de la suscripción del cliente")
    parser.add_argument(
        "--principal-id", 
        required=False,
        help="(Opcional) Object ID del Service Principal. Si no se proporciona, se auto-detecta via Microsoft Graph."
    )
    
    args = parser.parse_args()
    
    subscription_id = args.subscription_id
    scope = f"/subscriptions/{subscription_id}"
    
    print("=" * 70)
    print("  CSCloudSolutions FinOps Agent - Onboarding Automático")
    print("=" * 70)
    print(f"  Suscripción: {subscription_id}")
    print(f"  Scope: {scope}")
    
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
        # We need to figure out the tenant ID from the subscription
        from azure.mgmt.resource import SubscriptionClient
        sub_client = SubscriptionClient(credential)
        sub_info = sub_client.subscriptions.get(subscription_id)
        tenant_id = sub_info.tenant_id
        print(f"  Tenant ID: {tenant_id}")
        
        principal_id = resolve_service_principal_object_id(credential, tenant_id, FINOPS_APP_ID)
    
    print("=" * 70)
    
    client = AuthorizationManagementClient(credential, subscription_id)
    
    # 1. Assign built-in roles
    print("\n--- Paso 1: Asignando Roles Incorporados ---")
    for role_name, role_id in BUILT_IN_ROLES.items():
        print(f"\n  Rol: {role_name}")
        create_role_assignment(client, scope, role_id, principal_id)
        
    # 2. Create Custom Remediation Role
    print("\n--- Paso 2: Creando Rol Personalizado de Remediación ---")
    custom_role_id = str(uuid.uuid4())
    custom_role_name = "CSCloudSolutions Remediation Role"
    
    role_def = RoleDefinition(
        role_name=custom_role_name,
        description="Permite a CSCloudSolutions ejecutar acciones limitadas de FinOps (apagar, encender, etiquetar, eliminar huérfanos)",
        assignable_scopes=[scope],
        permissions=[{"actions": CUSTOM_ROLE_ACTIONS, "not_actions": [], "data_actions": [], "not_data_actions": []}]
    )
    
    try:
        print(f"  Creando definición: {custom_role_name}...")
        created_role_def = client.role_definitions.create_or_update(
            scope,
            custom_role_id,
            role_def
        )
        print(f"  ✓ Rol personalizado creado: {created_role_def.name}")
        
        # 3. Assign the custom role
        print("\n--- Paso 3: Asignando Rol Personalizado ---")
        create_role_assignment(client, scope, created_role_def.name, principal_id)
        
    except Exception as e:
        error_msg = str(e)
        if "RoleDefinitionWithSameNameExists" in error_msg:
            print(f"  ℹ El rol personalizado ya existe. Buscando su ID para asignarlo...")
            # Find the existing custom role and assign it
            for rd in client.role_definitions.list(scope):
                if rd.role_name == custom_role_name:
                    print(f"  ✓ Encontrado: {rd.name}")
                    create_role_assignment(client, scope, rd.name, principal_id)
                    break
        else:
            print(f"  ✗ ERROR: {e}")

    print("\n" + "=" * 70)
    print("  ✓ Onboarding Completado")
    print("=" * 70)
    print(f"\n  El Service Principal (Object ID: {principal_id})")
    print(f"  tiene los siguientes roles en la suscripción {subscription_id}:")
    for role_name in BUILT_IN_ROLES:
        print(f"    • {role_name}")
    print(f"    • {custom_role_name}")
    print(f"\n  La aplicación FinOps debería poder leer la suscripción en ~30 segundos.")

if __name__ == "__main__":
    main()
