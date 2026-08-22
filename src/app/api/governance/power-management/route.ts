/**
 * GET /api/governance/power-management
 * Control de Máquinas Virtuales y Horarios de Apagado — resumen del módulo.
 *
 * Agrega en una sola respuesta lo que la página necesita: inventario de VMs
 * (ARG), CPU actual (Azure Monitor), horarios persistidos (`PowerSchedules`) y
 * el cálculo de ahorro fuera de horario. Las mutaciones siguen en
 * `/api/power` (start/stop/restart) y `/api/power/schedule` (CRUD de horarios).
 *
 * RBAC: `isMockTenant` ANTES del guard — la rama mock devuelve literales puros
 * de `getMockPowerManagementPayload`, sin tocar MySQL ni Azure.
 * Tier mínimo: Business (`/governance/power` en routeTiers.ts).
 * RBAC Azure mínimo: `Reader` + `Monitoring Reader`. Sin permisos de escritura.
 */

import { NextRequest, NextResponse } from "next/server";
import { MonitorClient } from "@azure/arm-monitor";
import { AuthError, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { withArgLimit } from "@/lib/argConcurrency";
import { getSubscriptionNameMap } from "@/lib/azureSubscriptionNames";
import { getResourceCostsById } from "@/services/azureResourcesInventory.service";
import { listPowerSchedules } from "@/services/powerScheduleService";
import { errorMessage } from "@/lib/apiErrors";
import {
  assembleLivePowerManagement,
  calcMonthlySavings,
  DEFAULT_OFF_HOURS_PER_WEEK,
  getMockPowerManagementPayload,
  mapScheduleRow,
  normalizePowerState,
  offHoursForVm,
  resolveHourlyRate,
  type RawScheduleRow,
} from "@/services/azureVmPowerManagement.service";
import { HOURS_PER_WEEK, WEEKS_PER_MONTH, type VmInventoryItem } from "@/types/azurePowerManagement.types";

const VM_QUERY = `
  Resources
  | where type =~ 'microsoft.compute/virtualmachines'
  | project id, name, location, resourceGroup, subscriptionId,
            vmSize = tostring(properties.hardwareProfile.vmSize),
            powerState = tostring(properties.extended.instanceView.powerState.code)
`;

/**
 * CPU promedio de los últimos 30 min por VM. Best-effort y acotado: se pide
 * sólo para las VMs encendidas (una desasignada no emite métricas y devolvería
 * una serie vacía en la que igual se gastaría una llamada) y con un tope, para
 * no disparar cientos de requests a Monitor en tenants grandes.
 */
const MAX_CPU_PROBES = 60;

async function fetchCurrentCpu(
  tenantId: string,
  vms: Array<{ id: string; subscriptionId: string; powerState: string }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const running = vms.filter((v) => v.powerState === "running").slice(0, MAX_CPU_PROBES);
  if (running.length === 0) return out;

  const credential = await getAzureCredential(tenantId);
  const now = new Date();
  const past = new Date(now.getTime() - 30 * 60000);
  const timespan = `${past.toISOString()}/${now.toISOString()}`;

  const bySub = new Map<string, typeof running>();
  for (const vm of running) {
    if (!bySub.has(vm.subscriptionId)) bySub.set(vm.subscriptionId, []);
    bySub.get(vm.subscriptionId)!.push(vm);
  }

  await Promise.all(
    Array.from(bySub.entries()).map(async ([subId, items]) => {
      const client = new MonitorClient(credential, subId);
      await Promise.all(
        items.map(async (vm) => {
          try {
            const metrics = await client.metrics.list(vm.id, {
              timespan,
              interval: "PT5M",
              metricnames: "Percentage CPU",
            });
            const series = metrics.value?.[0]?.timeseries?.[0]?.data || [];
            let sum = 0;
            let count = 0;
            for (const p of series) {
              if (p.average !== undefined) {
                sum += p.average;
                count++;
              }
            }
            // Sin puntos NO se escribe la clave: la UI muestra "s/d" en vez de
            // un 0% que se leería como "ociosa" y llevaría a apagarla.
            if (count > 0) out.set(vm.id.toLowerCase(), Number((sum / count).toFixed(1)));
          } catch {
            // Falta de Monitoring Reader sobre esa VM: se omite, no se inventa.
          }
        })
      );
    })
  );

  return out;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

    if (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    ) {
      return NextResponse.json(getMockPowerManagementPayload(tenantId));
    }

    // requireTenantTier delega en requireTenantAccess y además valida el tier:
    // /governance/power está registrada como Business en routeTiers.ts.
    await requireTenantTier(request, tenantId, "Business");

    const payload = await getWithStaleWhileRevalidate(
      `power-management:v1:${tenantId}`,
      async () => {
        const credential = await getAzureCredential(tenantId).catch(() => null);
        if (!credential) {
          // Estado vacío legítimo: nunca el dataset demo (Directiva 24.1).
          return assembleLivePowerManagement({
            schedules: [],
            vms: [],
            availableSubscriptions: [],
            smartShutdownAvoidedOutagesCount: 0,
          });
        }

        const subscriptions = await getSubscriptionsForTenant(tenantId, credential);
        if (subscriptions.length === 0) {
          return assembleLivePowerManagement({
            schedules: [],
            vms: [],
            availableSubscriptions: [],
            smartShutdownAvoidedOutagesCount: 0,
          });
        }

        const client = await getResourceGraphClient(tenantId);
        const [argRes, rawSchedules, subNames] = await Promise.all([
          withArgLimit(() => client.resources({ query: VM_QUERY, subscriptions })),
          listPowerSchedules(tenantId).catch((e) => {
            console.warn("[PowerManagement] no se pudieron leer los horarios:", errorMessage(e));
            return [];
          }),
          getSubscriptionNameMap(tenantId, credential).catch(() => new Map<string, string>()),
        ]);

        const rows = (argRes.data || []) as Array<Record<string, unknown>>;
        const normalized = rows.map((r) => ({
          id: String(r.id || ""),
          name: String(r.name || ""),
          location: String(r.location || ""),
          resourceGroup: String(r.resourceGroup || ""),
          subscriptionId: String(r.subscriptionId || ""),
          vmSize: String(r.vmSize || "—"),
          powerState: normalizePowerState(r.powerState),
        }));

        const [cpuByVm, costByVm] = await Promise.all([
          fetchCurrentCpu(tenantId, normalized).catch(() => new Map<string, number>()),
          getResourceCostsById(
            tenantId,
            normalized.map((v) => ({ id: v.id, subscriptionId: v.subscriptionId }))
          ).catch(() => new Map<string, number>()),
        ]);

        const schedules = (rawSchedules as unknown as RawScheduleRow[]).map((row) =>
          mapScheduleRow(row, subNames)
        );

        const vms: VmInventoryItem[] = normalized.map((v) => {
          const scheduledOffHours = offHoursForVm(v.name, schedules);
          const monthlySpend = costByVm.get(v.id.toLowerCase()) || 0;
          // Horas efectivamente facturadas este mes, para derivar la tarifa
          // horaria cuando no hay precio de lista disponible.
          const billedHours = (HOURS_PER_WEEK - scheduledOffHours) * WEEKS_PER_MONTH;
          const hourlyRate = resolveHourlyRate(0, monthlySpend, billedHours);
          return {
            ...v,
            subscriptionName: subNames.get(v.subscriptionId.toLowerCase()) || v.subscriptionId,
            currentCpuPercentage: cpuByVm.get(v.id.toLowerCase()) ?? -1,
            monthlySpendUSD: monthlySpend,
            offHoursPotentialSavingsUSD: calcMonthlySavings(
              hourlyRate,
              scheduledOffHours > 0 ? scheduledOffHours : DEFAULT_OFF_HOURS_PER_WEEK
            ),
            hasActiveSchedule: schedules.some((s) => s.vmName === v.name),
            scheduledOffHoursPerWeek: scheduledOffHours,
          };
        });

        return assembleLivePowerManagement({
          schedules,
          vms,
          availableSubscriptions: subscriptions.map((id) => ({
            id,
            name: subNames.get(id.toLowerCase()) || id,
          })),
          smartShutdownAvoidedOutagesCount: schedules.filter(
            (s) => s.lastExecutionStatus === "SKIPPED_BUSY"
          ).length,
        });
      },
      300,
      120
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API PowerManagement] Error:", errorMessage(error));
    return NextResponse.json({ error: "Error interno procesando el control de VMs" }, { status: 500 });
  }
}
