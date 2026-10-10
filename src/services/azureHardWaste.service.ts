/**
 * El desperdicio duro vigente de un tenant, tal como lo cuentan la pantalla de Recursos Zombis y el reporte ejecutivo:
 * categoría HARD_WASTE y sin eximidos (lo que `assembleLiveZombieAudit` deja aparte como higiene de etiquetas,
 * SOFT_WASTE_TAGS, no entra), de mayor a menor plata.
 *
 * Lo leen las tools del MCP, el feed de Power BI y el buscador. Ninguna tabla guarda este dato: sólo existe el escaneo
 * de Resource Graph (`azureZombieScan.service`) y su caché de 15 minutos, la misma que usa la pantalla. Antes estas
 * tres lo pedían a `ZombieResources` / `zombies`, que no existen, y un `catch` lo volvía "no hay desperdicio".
 */
import { getWithStaleWhileRevalidate, peekSwr } from "@/lib/cache";
import { scanLiveZombies, zombieScanCacheKey, ZOMBIE_SCAN_TTL_S, ZOMBIE_SCAN_SOFT_TTL_S } from "@/services/azureZombieScan.service";
import { assembleLiveZombieAudit, getLocalTagsCache, getZombieExemptions } from "@/services/azureZombieAudit.service";
import type { ZombieResourceItem } from "@/types/azureZombieAudit.types";

async function desperdicioDuroDe(tenantId: string, rawItems: unknown[]): Promise<ZombieResourceItem[]> {
  const [exemptions, localTags] = await Promise.all([getZombieExemptions(tenantId), getLocalTagsCache(tenantId)]);
  return assembleLiveZombieAudit({ rawItems, exemptions, localTags })
    .metrics.resources.filter((r) => !r.isExempted && r.category === "HARD_WASTE")
    .sort((a, b) => b.monthlySavingsUSD - a.monthlySavingsUSD);
}

/**
 * Con el escaneo y la caché que comparten la pantalla y el reporte. En frío ESPERA el escaneo de Resource Graph (30 s
 * o más: el catálogo de KQL corre en lotes de 5 con 2,5 s de pausa entre lotes) y LANZA si falla: quien lo muestre tiene que decir que no
 * pudo leerlo, no devolver una lista vacía que se lea como "sin desperdicio".
 */
export async function getActiveHardWaste(tenantId: string): Promise<ZombieResourceItem[]> {
  const rawItems = await getWithStaleWhileRevalidate(
    zombieScanCacheKey(tenantId),
    () => scanLiveZombies(tenantId),
    ZOMBIE_SCAN_TTL_S,
    ZOMBIE_SCAN_SOFT_TTL_S
  );
  return desperdicioDuroDe(tenantId, rawItems);
}

/**
 * Lo mismo, pero SÓLO de la caché: `null` si no hay un escaneo reciente. Nunca llama a Azure ni espera: es para el
 * buscador, que se dispara en cada tecla.
 */
export async function peekActiveHardWaste(tenantId: string): Promise<ZombieResourceItem[] | null> {
  const rawItems = await peekSwr<unknown[]>(zombieScanCacheKey(tenantId));
  return rawItems ? desperdicioDuroDe(tenantId, rawItems) : null;
}
