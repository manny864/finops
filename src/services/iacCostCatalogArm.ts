import type { Attrs } from "@/services/iacCostCatalog";

/**
 * MEJ-20 — Bicep/ARM: el what-if de un deployment, traducido al catálogo de costos.
 *
 * Bicep no tiene un `terraform plan`. Lo equivalente es el what-if de ARM
 * (`az deployment group what-if --no-pretty-print`), que devuelve cada recurso con su
 * estado antes y después. Este archivo lo convierte a la MISMA forma que usa el
 * catálogo de Terraform (`iacCostCatalog.ts`): cada recurso ARM se traduce a un recurso
 * "tipo Terraform" con los atributos que ese catálogo lee, y desde ahí las reglas de
 * precio son las mismas. Así Terraform y Bicep no pueden divergir en cuánto cuesta una VM.
 *
 * CONTRATO, verificado y no supuesto (2026-10-08):
 *  - Resultado del what-if (Learn, "Deployments - What If", api 2025-04-01):
 *    `status` y los cambios, cada uno con `resourceId`, `changeType`
 *    (Create | Delete | Ignore | Deploy | NoChange | NoEffect | Modify | Unsupported),
 *    `before` y `after`. La CLI con `--no-pretty-print` los entrega en `changes`; la
 *    REST los anida en `properties.changes`: se aceptan las dos formas.
 *  - Los payloads `before`/`after` sólo vienen con `--result-format FullResourcePayloads`
 *    (el valor por defecto). Con `ResourceIdOnly` el cambio es `Deploy` y no hay de dónde
 *    sacar el SKU: el recurso sale "sin tarifar".
 *  - Los nombres de propiedad salen de los esquemas ARM oficiales
 *    (Azure/azure-resource-manager-schemas), de las definiciones REST que trae el propio
 *    Azure CLI y de la referencia de plantillas de Learn. Ver el test.
 *
 * LÍMITE CONOCIDO: el what-if no resuelve la función `reference()`: lo que dependa de ella
 * aparece como cambio de propiedad sin valor. Un SKU calculado así queda "sin tarifar".
 */

export type AccionArm = "create" | "delete" | "update" | "no-op";

export interface ParRecursoArm {
    /** Sufijo para distinguir los recursos que salen de uno (los pools de un AKS). */
    sufijo: string;
    /** Tipo del catálogo de Terraform al que se traduce. */
    tipoTf: string;
    antes: Attrs | null;
    despues: Attrs | null;
}

type Adaptador = (antes: Attrs | null, despues: Attrs | null) => ParRecursoArm[];

const obj = (v: unknown): Attrs => (v && typeof v === "object" && !Array.isArray(v) ? (v as Attrs) : {});
const lista = (v: unknown): Attrs[] => (Array.isArray(v) ? (v as Attrs[]) : []);
const prop = (r: Attrs | null): Attrs => obj(r?.properties);
const sinNulos = (a: Attrs): Attrs => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));

/** `/subscriptions/…/providers/Microsoft.Network/virtualNetworks/v/subnets/s` → `microsoft.network/virtualnetworks/subnets`. */
export function tipoDeResourceId(resourceId: unknown): string {
    const id = String(resourceId || "");
    const i = id.toLowerCase().lastIndexOf("/providers/");
    if (i < 0) return "";
    const seg = id.slice(i + "/providers/".length).split("/").filter(Boolean);
    if (seg.length < 3) return "";
    const tipos = [seg[0]];
    for (let k = 1; k < seg.length; k += 2) tipos.push(seg[k]);
    return tipos.join("/").toLowerCase();
}

/** Un par simple: una traducción de atributos sobre el recurso ARM, antes y después. */
const simple = (tipoTf: string, traducir: (r: Attrs) => Attrs): Adaptador => (antes, despues) => [{
    sufijo: "", tipoTf,
    antes: antes ? sinNulos(traducir(antes)) : null,
    despues: despues ? sinNulos(traducir(despues)) : null,
}];

const esWindows = (osType: unknown) => /^windows$/i.test(String(osType ?? ""));

const discoDelSo = (os: Attrs): Attrs[] | undefined =>
    os && (os.managedDisk || os.diskSizeGB)
        ? [{ storage_account_type: obj(os.managedDisk).storageAccountType, disk_size_gb: os.diskSizeGB }]
        : undefined;

const vm: Adaptador = (antes, despues) => {
    const ref = despues ?? antes;
    const windows = esWindows(obj(obj(prop(ref).storageProfile).osDisk).osType);
    const traducir = (r: Attrs): Attrs => {
        const p = prop(r);
        return {
            location: r.location,
            size: obj(p.hardwareProfile).vmSize,
            priority: p.priority,
            license_type: p.licenseType,
            os_disk: discoDelSo(obj(obj(p.storageProfile).osDisk)),
        };
    };
    return simple(windows ? "azurerm_windows_virtual_machine" : "azurerm_linux_virtual_machine", traducir)(antes, despues);
};

const vmss: Adaptador = (antes, despues) => {
    const ref = despues ?? antes;
    const perfil = (r: Attrs | null) => obj(prop(r).virtualMachineProfile);
    const windows = esWindows(obj(obj(perfil(ref).storageProfile).osDisk).osType);
    const traducir = (r: Attrs): Attrs => {
        const pf = perfil(r);
        return {
            location: r.location,
            sku: obj(r.sku).name,
            instances: obj(r.sku).capacity,
            priority: pf.priority,
            license_type: pf.licenseType,
            os_disk: discoDelSo(obj(obj(pf.storageProfile).osDisk)),
        };
    };
    return simple(windows ? "azurerm_windows_virtual_machine_scale_set" : "azurerm_linux_virtual_machine_scale_set", traducir)(antes, despues);
};

/**
 * Un clúster de AKS es varios recursos de costo: los nodos de cada pool y el SLA del
 * plano de control. El primer pool hace de `default_node_pool` (lleva el SLA); los demás
 * salen como node pools sueltos, emparejados por nombre entre el antes y el después.
 */
const aks: Adaptador = (antes, despues) => {
    const pools = (r: Attrs | null) => lista(prop(r).agentPoolProfiles);
    const aPool = (p: Attrs, location: unknown): Attrs => ({
        location,
        vm_size: p.vmSize,
        node_count: p.count,
        min_count: p.minCount,
        auto_scaling_enabled: p.enableAutoScaling,
        os_type: p.osType,
        priority: /^spot$/i.test(String(p.scaleSetPriority ?? "")) ? "Spot" : undefined,
    });
    const traducirCluster = (r: Attrs): Attrs => {
        const [primero] = pools(r);
        return {
            location: r.location,
            sku_tier: obj(r.sku).tier,
            default_node_pool: primero
                ? [{ vm_size: primero.vmSize, node_count: primero.count, min_count: primero.minCount, auto_scaling_enabled: primero.enableAutoScaling }]
                : undefined,
        };
    };
    const salida: ParRecursoArm[] = [{
        sufijo: "", tipoTf: "azurerm_kubernetes_cluster",
        antes: antes ? sinNulos(traducirCluster(antes)) : null,
        despues: despues ? sinNulos(traducirCluster(despues)) : null,
    }];

    const nombre = (p: Attrs, i: number) => String(p.name ?? `pool${i}`);
    const resto = (r: Attrs | null) => new Map(pools(r).slice(1).map((p, i) => [nombre(p, i + 1), p] as const));
    const a = resto(antes);
    const d = resto(despues);
    for (const n of new Set([...a.keys(), ...d.keys()])) {
        salida.push({
            sufijo: `#pool/${n}`, tipoTf: "azurerm_kubernetes_cluster_node_pool",
            antes: a.has(n) ? sinNulos(aPool(a.get(n)!, antes?.location)) : null,
            despues: d.has(n) ? sinNulos(aPool(d.get(n)!, despues?.location)) : null,
        });
    }
    return salida;
};

const serverfarm: Adaptador = simple("azurerm_service_plan", (r) => {
    const p = prop(r);
    const kind = String(r.kind ?? "").toLowerCase();
    // `reserved: true` es Linux; `isXenon` o `kind` con "container" son planes de contenedores.
    const so = p.isXenon || /container|xenon/.test(kind) ? "WindowsContainer" : p.reserved || /linux/.test(kind) ? "Linux" : "Windows";
    return { location: r.location, sku_name: obj(r.sku).name, os_type: so, worker_count: obj(r.sku).capacity };
});

const redis: Adaptador = simple("azurerm_redis_cache", (r) => {
    const p = prop(r);
    return { location: r.location, sku_name: obj(p.sku).name, family: obj(p.sku).family, capacity: obj(p.sku).capacity, shard_count: p.shardCount };
});

const firewall: Adaptador = simple("azurerm_firewall", (r) => ({
    location: r.location, sku_name: obj(prop(r).sku).name, sku_tier: obj(prop(r).sku).tier,
}));

const bastion: Adaptador = simple("azurerm_bastion_host", (r) => ({
    location: r.location, sku: obj(r.sku).name, scale_units: prop(r).scaleUnits,
}));

const gateway: Adaptador = simple("azurerm_virtual_network_gateway", (r) => ({
    location: r.location, type: prop(r).gatewayType, sku: obj(prop(r).sku).name,
}));

const appGateway: Adaptador = simple("azurerm_application_gateway", (r) => {
    const s = obj(prop(r).sku);
    const a = obj(prop(r).autoscaleConfiguration);
    return {
        location: r.location,
        sku: [{ name: s.name, tier: s.tier, capacity: s.capacity }],
        autoscale_configuration: Object.keys(a).length ? [{ min_capacity: a.minCapacity, max_capacity: a.maxCapacity }] : undefined,
    };
});

const registry: Adaptador = simple("azurerm_container_registry", (r) => ({ location: r.location, sku: obj(r.sku).name }));
const nat: Adaptador = simple("azurerm_nat_gateway", (r) => ({ location: r.location, sku_name: obj(r.sku).name }));
const lb: Adaptador = simple("azurerm_lb", (r) => ({ location: r.location, sku: obj(r.sku).name, sku_tier: obj(r.sku).tier }));
const publicIp: Adaptador = simple("azurerm_public_ip", (r) => ({
    location: r.location, sku: obj(r.sku).name, sku_tier: obj(r.sku).tier,
    allocation_method: prop(r).publicIPAllocationMethod, ip_version: prop(r).publicIPAddressVersion,
}));
const disk: Adaptador = simple("azurerm_managed_disk", (r) => ({
    location: r.location, storage_account_type: obj(r.sku).name, disk_size_gb: prop(r).diskSizeGB,
}));

/** Tipos ARM (en minúsculas) con costo y cómo se traducen. */
export const CATALOGO_ARM: Record<string, Adaptador> = {
    "microsoft.compute/virtualmachines": vm,
    "microsoft.compute/virtualmachinescalesets": vmss,
    "microsoft.compute/disks": disk,
    "microsoft.containerservice/managedclusters": aks,
    "microsoft.web/serverfarms": serverfarm,
    "microsoft.cache/redis": redis,
    "microsoft.network/azurefirewalls": firewall,
    "microsoft.network/bastionhosts": bastion,
    "microsoft.network/virtualnetworkgateways": gateway,
    "microsoft.network/applicationgateways": appGateway,
    "microsoft.containerregistry/registries": registry,
    "microsoft.network/natgateways": nat,
    "microsoft.network/loadbalancers": lb,
    "microsoft.network/publicipaddresses": publicIp,
};

/** No generan cargo por sí mismos (ver SIN_COSTO en el catálogo de Terraform). */
export const SIN_COSTO_ARM = new Set([
    "microsoft.network/virtualnetworks",
    "microsoft.network/virtualnetworks/subnets",
    "microsoft.network/networkinterfaces",
    "microsoft.network/networksecuritygroups",
    "microsoft.network/routetables",
    "microsoft.managedidentity/userassignedidentities",
    "microsoft.authorization/roleassignments",
    "microsoft.resources/deployments",
    "microsoft.web/sites",
    "microsoft.compute/virtualmachines/extensions",
]);

/** Se cobran por consumo. */
export const POR_USO_ARM = new Set([
    "microsoft.storage/storageaccounts",
    "microsoft.operationalinsights/workspaces",
    "microsoft.insights/components",
    "microsoft.keyvault/vaults",
    "microsoft.servicebus/namespaces",
    "microsoft.eventhub/namespaces",
    "microsoft.documentdb/databaseaccounts",
    "microsoft.cognitiveservices/accounts",
    "microsoft.datafactory/factories",
]);

/** Claves que leen los adaptadores: lo único que el script de CI deja salir del runner. */
export function camposArm(): string[] {
    return [
        "location", "sku", "name", "tier", "capacity", "kind", "properties",
        "hardwareProfile", "vmSize", "storageProfile", "osDisk", "osType", "diskSizeGB", "managedDisk",
        "storageAccountType", "priority", "licenseType", "virtualMachineProfile",
        "publicIPAllocationMethod", "publicIPAddressVersion",
        "agentPoolProfiles", "count", "minCount", "enableAutoScaling", "scaleSetPriority",
        "reserved", "isXenon", "family", "shardCount", "gatewayType", "scaleUnits",
        "autoscaleConfiguration", "minCapacity", "maxCapacity",
    ].sort();
}

export function accionDeCambio(changeType: unknown): AccionArm | "no-soportado" {
    switch (String(changeType ?? "")) {
        case "Create": return "create";
        case "Delete": return "delete";
        case "Modify":
        // `Deploy` es lo que devuelve ResourceIdOnly: sin payload, no hay SKU que leer.
        // Se trata como update para que el recurso salga "sin tarifar" y no desaparezca.
        case "Deploy": return "update";
        case "NoChange":
        case "NoEffect":
        case "Ignore": return "no-op";
        case "Unsupported": return "no-soportado";
        default: return "no-op";
    }
}
