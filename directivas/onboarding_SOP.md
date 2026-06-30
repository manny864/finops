# Onboarding Module SOP

- **Role-Based Access Control (RBAC)**: Se automatiza un principio de Privilegio Mínimo (Least Privilege). La aplicación usa los Roles Incorporados de Azure ('Reader', 'Cost Management Reader', 'Monitoring Reader') combinados con un Rol Personalizado en el que solo se incluyen `Actions` de escritura y borrado estrictamente necesarias.
- **Herramienta de Automatización Python**: Se utiliza `scripts/onboarding_automator.py` para asignar los roles automáticamente usando `azure-identity` y `azure-mgmt-authorization`.
- **Experiencia Frontend (UX)**: El panel de PowerShell se renderiza usando Tailwind imitando una terminal nativa de macOS, permitiendo a los clientes confiar en la plataforma SaaS.
- **Clipboard API**: Para evitar que los clientes corrompan el script al seleccionarlo manualmente con el mouse, el botón `navigator.clipboard.writeText` asegura la integridad del comando powershell.

## Acciones del Rol Personalizado
Para evitar dar `Contributor`, el Rol Personalizado de remediación incluye exclusivamente:
- `Microsoft.Compute/virtualMachines/deallocate/action`
- `Microsoft.Compute/virtualMachines/start/action`
- `Microsoft.Compute/virtualMachines/restart/action`
- `Microsoft.Resources/tags/write`
- `Microsoft.Compute/disks/delete`
- `Microsoft.Compute/snapshots/delete`
- `Microsoft.Network/networkInterfaces/delete`
- `Microsoft.Network/networkSecurityGroups/delete`
- `Microsoft.Network/publicIPAddresses/delete`
- `Microsoft.Web/serverfarms/delete`

### Restricciones/Casos Borde
- **Nota PowerShell: No usar `-DisplayName` junto con `New-AzADAppCredential`, ni usar el ObjectId del Service Principal, porque causa el error 'Parameter set cannot be resolved'.** En su lugar, obtener la Application mediante `Get-AzADApplication -AppId $sp.AppId`, extraer su `Id` (Application Object ID), y pasarlo al parámetro `-ObjectId` junto con `-StartDate` y `-EndDate` únicamente.
- **Nota Python Automator:** Se debe instanciar `AuthorizationManagementClient` pasando la credencial y la suscripción. La creación de roles personalizados requiere generar un GUID (`uuid.uuid4()`) como nombre del rol (role definition name).