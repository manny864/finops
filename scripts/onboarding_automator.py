import os
import sys
import uuid
import argparse
from azure.identity import DefaultAzureCredential
from azure.mgmt.authorization import AuthorizationManagementClient
from azure.mgmt.authorization.models import RoleDefinition, RoleAssignmentCreateParameters

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

def create_role_assignment(client: AuthorizationManagementClient, scope: str, role_def_id: str, principal_id: str):
    assignment_id = str(uuid.uuid4())
    print(f"[{scope}] Asignando rol {role_def_id} al principal {principal_id}...")
    
    parameters = RoleAssignmentCreateParameters(
        role_definition_id=f"{scope}/providers/Microsoft.Authorization/roleDefinitions/{role_def_id}",
        principal_id=principal_id,
        principal_type="ServicePrincipal"
    )
    
    try:
        assignment = client.role_assignments.create(scope, assignment_id, parameters)
        print(f" OK: Asignación creada con ID {assignment.name}")
        return assignment
    except Exception as e:
        print(f" ERROR al asignar el rol: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Automatizador de Onboarding para CSCloudSolutions FinOps Agent")
    parser.add_argument("--subscription-id", required=True, help="ID de la suscripción del cliente")
    parser.add_argument("--principal-id", required=True, help="Object ID del Service Principal (Enterprise Application) en el tenant del cliente")
    
    args = parser.parse_args()
    
    subscription_id = args.subscription_id
    principal_id = args.principal_id
    scope = f"/subscriptions/{subscription_id}"
    
    print(f"Iniciando Onboarding Automático en Suscripción: {subscription_id}")
    
    # Authenticate using DefaultAzureCredential (requires az login, managed identity, or env vars)
    credential = DefaultAzureCredential()
    client = AuthorizationManagementClient(credential, subscription_id)
    
    # 1. Asignar roles incorporados (Built-in)
    print("\n--- 1. Asignando Roles Incorporados ---")
    for role_name, role_id in BUILT_IN_ROLES.items():
        print(f"Configurando rol: {role_name}")
        create_role_assignment(client, scope, role_id, principal_id)
        
    # 2. Crear Rol Personalizado de Remediación
    print("\n--- 2. Creando Rol Personalizado de Remediación ---")
    custom_role_id = str(uuid.uuid4())
    custom_role_name = "CSCloudSolutions Remediation Role"
    
    role_def = RoleDefinition(
        role_name=custom_role_name,
        description="Permite a CSCloudSolutions ejecutar acciones limitadas de FinOps (apagar, encender, etiquetar, eliminar huérfanos)",
        assignable_scopes=[scope],
        permissions=[{"actions": CUSTOM_ROLE_ACTIONS, "not_actions": [], "data_actions": [], "not_data_actions": []}]
    )
    
    try:
        print(f"Creando definición del rol {custom_role_name}...")
        created_role_def = client.role_definitions.create_or_update(
            scope,
            custom_role_id,
            role_def
        )
        print(f" OK: Rol personalizado creado con ID {created_role_def.name}")
        
        # 3. Asignar el rol personalizado
        print("\n--- 3. Asignando Rol Personalizado ---")
        # El ID de definición para la asignación debe excluir la parte del scope si se pasa en el create,
        # pero la API de SDK espera el ID corto en `role_def_id`.
        create_role_assignment(client, scope, created_role_def.name, principal_id)
        
    except Exception as e:
        print(f" ERROR al crear o asignar el rol personalizado: {e}")

    print("\n==============================================================================")
    print("¡Automatización de Onboarding Completada!")
    print("==============================================================================")

if __name__ == "__main__":
    main()
