/**
 * Lo que no cumple en un escaneo de Tag Governance, agrupado para corregirlo en
 * lote: valores no permitidos (por etiqueta y valor) y etiquetas libres que
 * faltan (CostCenter, Department). Puro: lo usan la pantalla y el servicio de
 * IA, que vuelve a escanear en el servidor en vez de confiar en el cliente.
 */
import { findInvalidTagValues, type TagNormalizationResult, type TagValueAlias } from "@/lib/tagValueNormalizer";
import type {
  ResourceGroupTagAuditItem,
  ResourceTagAuditItem,
  TagPolicyRule,
} from "@/types/azureTagGovernance.types";

export const RESOURCE_GROUP_TYPE = "Microsoft.Resources/resourceGroups";

/** Valor de una etiqueta buscando la clave sin distinguir mayúsculas; null si falta o está vacía. */
export function tagValueOf(tags: Record<string, string> | undefined, tagName: string): string | null {
  const lower = tagName.toLowerCase();
  const key = Object.keys(tags || {}).find((k) => k.toLowerCase() === lower);
  const value = key ? tags![key] : undefined;
  return typeof value === "string" && value.trim() ? value : null;
}

/** Obligatorias que faltan o están vacías. */
export function missingTagsOf(tags: Record<string, string>, policies: readonly TagPolicyRule[]): string[] {
  return policies.filter((p) => p.isRequired && tagValueOf(tags, p.tagName) === null).map((p) => p.tagName);
}

/**
 * Recalcula faltantes, valores no permitidos y estado tras cambiar las etiquetas
 * (actualización optimista). El cliente no tiene los alias del tenant: para un
 * valor que no cambió conserva la sugerencia que calculó el servidor.
 */
export function withTags<T extends ResourceTagAuditItem | ResourceGroupTagAuditItem>(
  item: T,
  tags: Record<string, string>,
  policies: readonly TagPolicyRule[],
  aliasesByTag?: ReadonlyMap<string, TagValueAlias[]>,
): T {
  const missingTags = missingTagsOf(tags, policies);
  const before = new Map((item.invalidTags ?? []).map((i) => [`${i.tagName}\u0000${i.value}`, i.suggestion]));
  const invalidTags = findInvalidTagValues(tags, policies, aliasesByTag).map((i) => {
    const suggestion = before.get(`${i.tagName}\u0000${i.value}`);
    return suggestion ? { ...i, suggestion } : i;
  });
  return {
    ...item,
    currentTags: tags,
    missingTags,
    invalidTags,
    complianceStatus: missingTags.length === 0 && invalidTags.length === 0 ? "COMPLIANT" : "NON_COMPLIANT",
  };
}

export interface NonConformingTarget {
  id: string;
  name: string;
  resourceType: string;
  /** Clave tal como está escrita en ese recurso: es la que se corrige. */
  tagKey: string;
}

export interface NonConformingValueGroup {
  tagName: string;
  value: string;
  /** Canónico sugerido por el normalizador; igual para todo el grupo. */
  suggestion: TagNormalizationResult;
  targets: NonConformingTarget[];
}

/** Valores no permitidos agrupados por etiqueta y valor, de más a menos recursos afectados. */
export function groupNonConformingValues(
  resources: readonly ResourceTagAuditItem[],
  resourceGroups: readonly ResourceGroupTagAuditItem[],
): NonConformingValueGroup[] {
  const groups = new Map<string, NonConformingValueGroup>();
  const visit = (item: ResourceTagAuditItem | ResourceGroupTagAuditItem, name: string, resourceType: string) => {
    for (const inv of item.invalidTags ?? []) {
      const key = `${inv.tagName}\u0000${inv.value}`;
      let group = groups.get(key);
      if (!group) {
        group = { tagName: inv.tagName, value: inv.value, suggestion: inv.suggestion, targets: [] };
        groups.set(key, group);
      }
      group.targets.push({ id: item.id, name, resourceType, tagKey: inv.tagKey });
    }
  };
  for (const r of resources) visit(r, r.resourceName, r.resourceType);
  for (const rg of resourceGroups) visit(rg, rg.resourceGroupName, RESOURCE_GROUP_TYPE);
  return [...groups.values()].sort(
    (a, b) => b.targets.length - a.targets.length || a.tagName.localeCompare(b.tagName) || a.value.localeCompare(b.value),
  );
}

export interface MissingTagCandidate {
  resource: ResourceTagAuditItem;
  /** Valor de esa etiqueta en su grupo de recursos; null = no hay de dónde heredarlo. */
  inheritedValue: string | null;
}

const rgKey = (subscriptionId: string, resourceGroup: string) =>
  `${subscriptionId.toLowerCase()}::${resourceGroup.toLowerCase()}`;

/** Recursos a los que les falta `tagName` (nombre de la política), con lo que podrían heredar de su grupo. */
export function findMissingTag(
  resources: readonly ResourceTagAuditItem[],
  resourceGroups: readonly ResourceGroupTagAuditItem[],
  tagName: string,
): MissingTagCandidate[] {
  const rgValues = new Map(
    resourceGroups.map((rg) => [rgKey(rg.subscriptionId, rg.resourceGroupName), tagValueOf(rg.currentTags, tagName)]),
  );
  return resources
    .filter((r) => r.missingTags.includes(tagName))
    .map((resource) => ({
      resource,
      inheritedValue: rgValues.get(rgKey(resource.subscriptionId, resource.resourceGroup))?.trim() || null,
    }));
}

/** Valores que el tenant ya usa para `tagName` (recursos y grupos), de más a menos usados. */
export function tagVocabulary(
  resources: readonly ResourceTagAuditItem[],
  resourceGroups: readonly ResourceGroupTagAuditItem[],
  tagName: string,
  max = 100,
): string[] {
  const counts = new Map<string, number>();
  for (const item of [...resources, ...resourceGroups]) {
    const value = tagValueOf(item.currentTags, tagName)?.trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([value]) => value);
}
