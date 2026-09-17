#!/usr/bin/env python3
"""
Applies the 'Gestionar en Azure' policy for resources outside the permitted roles.
Follows directivas/remediacion_eliminacion_recursos_sop.md.
"""
import os
import json

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def patch_zombie_catalog():
    path = os.path.join(BASE_DIR, "src/lib/zombieAuditCatalog.ts")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Set manualDelete: true for non-permitted resources
    updates = [
        ('elasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool Vacío", issueType: "cost", manualDelete: false }',
         'elasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool Vacío", issueType: "cost", manualDelete: true }'),
        ('emptySqlElasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool sin bases de datos", issueType: "cost", manualDelete: false }',
         'emptySqlElasticPools: { type: "SQL Elastic Pool", armType: "microsoft.sql/servers/elasticpools", issue: "Pool sin bases de datos", issueType: "cost", manualDelete: true }'),
        ('stoppedFlexibleServers: { type: "Flexible Server", armType: "microsoft.dbforpostgresql/flexibleservers", issue: "Servidor Flexible detenido", issueType: "cost", manualDelete: false }',
         'stoppedFlexibleServers: { type: "Flexible Server", armType: "microsoft.dbforpostgresql/flexibleservers", issue: "Servidor Flexible detenido", issueType: "cost", manualDelete: true }'),
        ('emptyCosmosDbAccounts: { type: "Cosmos DB", armType: "microsoft.documentdb", issue: "Cuenta Cosmos DB sin bases", issueType: "cost", manualDelete: false }',
         'emptyCosmosDbAccounts: { type: "Cosmos DB", armType: "microsoft.documentdb", issue: "Cuenta Cosmos DB sin bases", issueType: "cost", manualDelete: true }'),
        ('emptyEventHubNamespaces: { type: "Event Hub", armType: "microsoft.eventhub", issue: "Namespace Event Hub vacío", issueType: "cost", manualDelete: false }',
         'emptyEventHubNamespaces: { type: "Event Hub", armType: "microsoft.eventhub", issue: "Namespace Event Hub vacío", issueType: "cost", manualDelete: true }'),
        ('emptyServiceBusNamespaces: { type: "Service Bus", armType: "microsoft.servicebus", issue: "Namespace Service Bus vacío", issueType: "cost", manualDelete: false }',
         'emptyServiceBusNamespaces: { type: "Service Bus", armType: "microsoft.servicebus", issue: "Namespace Service Bus vacío", issueType: "cost", manualDelete: true }'),
        ('emptyApiManagement: { type: "API Management", armType: "microsoft.apimanagement", issue: "Instancia API Management vacía", issueType: "cost", manualDelete: false }',
         'emptyApiManagement: { type: "API Management", armType: "microsoft.apimanagement", issue: "Instancia API Management vacía", issueType: "cost", manualDelete: true }'),
        ('emptyAse: { type: "App Service Env", armType: "microsoft.web/hostingenvironments", issue: "ASE vacío", issueType: "cost", manualDelete: false }',
         'emptyAse: { type: "App Service Env", armType: "microsoft.web/hostingenvironments", issue: "ASE vacío", issueType: "cost", manualDelete: true }'),
        ('availabilitySets: { type: "Availability Set", armType: "microsoft.compute/availabilitysets", issue: "Set vacío", issueType: "governance", manualDelete: false }',
         'availabilitySets: { type: "Availability Set", armType: "microsoft.compute/availabilitysets", issue: "Set vacío", issueType: "governance", manualDelete: true }'),
        ('idleVmss: { type: "VM Scale Set", armType: "microsoft.compute/virtualmachinescalesets", issue: "Escalado a 0 instancias", issueType: "governance", manualDelete: false }',
         'idleVmss: { type: "VM Scale Set", armType: "microsoft.compute/virtualmachinescalesets", issue: "Escalado a 0 instancias", issueType: "governance", manualDelete: true }'),
        ('routeTables: { type: "Route Table", armType: "microsoft.network/routetables", issue: "No asignada", issueType: "governance", manualDelete: false }',
         'routeTables: { type: "Route Table", armType: "microsoft.network/routetables", issue: "No asignada", issueType: "governance", manualDelete: true }'),
        ('ipGroups: { type: "IP Group", armType: "microsoft.network/ipgroups", issue: "Sin Firewall", issueType: "governance", manualDelete: false }',
         'ipGroups: { type: "IP Group", armType: "microsoft.network/ipgroups", issue: "Sin Firewall", issueType: "governance", manualDelete: true }'),
        ('emptyRgs: { type: "Resource Group", armType: "microsoft.resources/subscriptions/resourcegroups", issue: "RG Vacío", issueType: "governance", manualDelete: false, isHygiene: true }',
         'emptyRgs: { type: "Resource Group", armType: "microsoft.resources/subscriptions/resourcegroups", issue: "RG Vacío", issueType: "governance", manualDelete: true, isHygiene: true }'),
        ('apiConnections: { type: "API Connection", armType: "microsoft.web/connections", issue: "Desconectada", issueType: "governance", manualDelete: false }',
         'apiConnections: { type: "API Connection", armType: "microsoft.web/connections", issue: "Desconectada", issueType: "governance", manualDelete: true }'),
        ('expiredCerts: { type: "Certificate", armType: "microsoft.web/certificates", issue: "Certificado Expirado", issueType: "governance", manualDelete: false }',
         'expiredCerts: { type: "Certificate", armType: "microsoft.web/certificates", issue: "Certificado Expirado", issueType: "governance", manualDelete: true }'),
        ('emptySqlServers: { type: "SQL Server", armType: "microsoft.sql/servers", issue: "Servidor SQL sin bases", issueType: "governance", manualDelete: false }',
         'emptySqlServers: { type: "SQL Server", armType: "microsoft.sql/servers", issue: "Servidor SQL sin bases", issueType: "governance", manualDelete: true }'),
    ]

    for old, new in updates:
        if old in content:
            content = content.replace(old, new, 1)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Updated src/lib/zombieAuditCatalog.ts with manualDelete flags.")

def patch_onboarding_script():
    path = os.path.join(BASE_DIR, "src/lib/onboardingScriptTemplate.ts")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Revert additions outside standard roles
    target = """    "Microsoft.Network/networkWatchers/delete",
    "Microsoft.Network/networkWatchers/flowLogs/delete",
    // Conexiones de Logic Apps / iPaaS y otros recursos eliminables desde Remediación
    "Microsoft.Web/connections/delete",
    "Microsoft.Web/certificates/delete",
    "Microsoft.Sql/servers/elasticPools/delete",
    "Microsoft.Compute/availabilitySets/delete",
    "Microsoft.Network/routeTables/delete",
    "Microsoft.Network/ipGroups/delete",
];"""

    clean = """    "Microsoft.Network/networkWatchers/delete",
    "Microsoft.Network/networkWatchers/flowLogs/delete",
];"""

    if target in content:
        content = content.replace(target, clean, 1)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Reverted non-standard permissions from src/lib/onboardingScriptTemplate.ts")

def patch_translations():
    locales = [
        ("es.json", "Gestionar en Azure", "Por seguridad y políticas de mínimo privilegio, este recurso debe gestionarse directamente en Azure Portal."),
        ("en.json", "Manage in Azure", "For security and least-privilege policies, this resource must be managed directly in the Azure Portal."),
        ("pt-BR.json", "Gerenciar no Azure", "Por segurança e políticas de privilégio mínimo, este recurso deve ser gerenciado diretamente no Portal do Azure.")
    ]

    for filename, manage_text, tooltip_text in locales:
        path = os.path.join(BASE_DIR, "messages", filename)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if "Zombies" in data:
            data["Zombies"]["manageInAzure"] = manage_text
            data["Zombies"]["manageInAzureTooltip"] = tooltip_text
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"Updated messages/{filename} with manageInAzure keys.")

def patch_zombie_table():
    path = os.path.join(BASE_DIR, "src/components/ZombieResourcesTable.tsx")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Add IconExternalLink import if needed
    if "IconExternalLink," not in content:
        target_import = "  IconDatabase,\n}"
        replacement_import = "  IconDatabase,\n  IconExternalLink,\n}"
        if target_import in content:
            content = content.replace(target_import, replacement_import, 1)
            print("Added IconExternalLink import in ZombieResourcesTable.tsx")

    # 2. Render 'Gestionar en Azure' link when item.manualDelete is true
    old_buttons = """                {canDeleteDirect ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    disabled={deletingId === item.id || (item.issueType === "governance" && isTagCompliance)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 ${
                      deletingId === item.id
                        ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-wait"
                        : item.issueType === "governance" && isTagCompliance
                        ? "bg-slate-50 text-slate-300 border border-slate-200 cursor-not-allowed"
                        // Rojo solido, el mismo estilo destructivo que ya usa el
                        // confirm de purga masiva mas abajo en este archivo: borrar un
                        // recurso es irreversible y el contorno lo hacia parecer una
                        // accion secundaria mas.
                        : "bg-rose-600 hover:bg-rose-700 text-white border border-rose-600 hover:border-rose-700 cursor-pointer active:scale-95"
                    }`}
                  >
                    {deletingId === item.id ? (
                      <IconLoader2 className="w-3.5 h-3.5 animate-spin stroke-[2]" />
                    ) : (
                      <IconTrash className="w-3.5 h-3.5 stroke-[1.5]" />
                    )}
                    {deletingId === item.id ? t("deleting") : t("delete")}
                  </button>
                ) : canRequestDelete ? ("""

    new_buttons = """                {item.manualDelete ? (
                  <a
                    href={item.id ? (item.id.startsWith('/') ? `https://portal.azure.com/#@/resource${item.id}` : `https://portal.azure.com/#@/resource/${item.id}`) : "https://portal.azure.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 bg-white dark:bg-slate-900 text-[#0078D4] dark:text-sky-400 border border-[#0078D4]/40 hover:bg-sky-50/70 dark:hover:bg-sky-950/40 cursor-pointer active:scale-95 shrink-0"
                    title={t("manageInAzureTooltip")}
                  >
                    <IconExternalLink className="w-3.5 h-3.5 stroke-[1.5]" />
                    <span>{t("manageInAzure")}</span>
                  </a>
                ) : canDeleteDirect ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    disabled={deletingId === item.id || (item.issueType === "governance" && isTagCompliance)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all flex items-center gap-1 ${
                      deletingId === item.id
                        ? "bg-slate-50 text-slate-400 border border-slate-200 cursor-wait"
                        : item.issueType === "governance" && isTagCompliance
                        ? "bg-slate-50 text-slate-300 border border-slate-200 cursor-not-allowed"
                        // Rojo solido, el mismo estilo destructivo que ya usa el
                        // confirm de purga masiva mas abajo en este archivo: borrar un
                        // recurso es irreversible y el contorno lo hacia parecer una
                        // accion secundaria mas.
                        : "bg-rose-600 hover:bg-rose-700 text-white border border-rose-600 hover:border-rose-700 cursor-pointer active:scale-95"
                    }`}
                  >
                    {deletingId === item.id ? (
                      <IconLoader2 className="w-3.5 h-3.5 animate-spin stroke-[2]" />
                    ) : (
                      <IconTrash className="w-3.5 h-3.5 stroke-[1.5]" />
                    )}
                    {deletingId === item.id ? t("deleting") : t("delete")}
                  </button>
                ) : canRequestDelete ? ("""

    if old_buttons in content:
        content = content.replace(old_buttons, new_buttons, 1)
        print("Replaced delete button with 'Gestionar en Azure' link for manualDelete resources in ZombieResourcesTable.tsx")
    else:
        print("Warning: old_buttons snippet not found in ZombieResourcesTable.tsx")

    # 3. Disable checkbox for manualDelete resources in cell
    old_checkbox_cell = """        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedIds.has(row.original.id)}
            onChange={() => toggleSelected(row.original.id)}
            disabled={isPending(row.original.id)}
            className={`rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4] cursor-pointer ${
              isPending(row.original.id) ? "opacity-50 cursor-not-allowed" : ""
            }`}
          />
        ),"""

    new_checkbox_cell = """        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={selectedIds.has(row.original.id)}
            onChange={() => toggleSelected(row.original.id)}
            disabled={isPending(row.original.id) || row.original.manualDelete}
            title={row.original.manualDelete ? t("manageInAzureTooltip") : ""}
            className={`rounded border-slate-300 text-[#0078D4] focus:ring-[#0078D4] cursor-pointer ${
              isPending(row.original.id) || row.original.manualDelete ? "opacity-40 cursor-not-allowed" : ""
            }`}
          />
        ),"""

    if old_checkbox_cell in content:
        content = content.replace(old_checkbox_cell, new_checkbox_cell, 1)
        print("Updated row checkbox in ZombieResourcesTable.tsx to disable for manualDelete items.")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    patch_zombie_catalog()
    patch_onboarding_script()
    patch_translations()
    patch_zombie_table()
    print("Policy application complete.")
