import { describe, it, expect } from "vitest";
import {
  calcMonthlySavings,
  calcWeeklyOffHours,
  DEFAULT_OFF_HOURS_PER_WEEK,
  fromDbAction,
  fromDbStatus,
  buildPowerSummary,
  getMockPowerManagementPayload,
  mapScheduleRow,
  normalizePowerState,
  offHoursForVm,
  parseDaysOfWeek,
  resolveHourlyRate,
  serializeDaysOfWeek,
  toDateOnly,
  toDbAction,
  toHhMm,
  assembleLivePowerManagement,
} from "@/services/azureVmPowerManagement.service";
import { BUSINESS_DAYS, HOURS_PER_WEEK, WEEKDAY_KEYS } from "@/types/azurePowerManagement.types";

describe("Power Management — mapeo con la tabla PowerSchedules", () => {
  it("traduce las acciones en ambos sentidos", () => {
    expect(fromDbAction("shutdown")).toBe("STOP_DEALLOCATE");
    expect(fromDbAction("start")).toBe("START");
    expect(fromDbAction("restart")).toBe("RESTART");
    // Las filas viejas sin action_type eran todas de apagado.
    expect(fromDbAction(null)).toBe("STOP_DEALLOCATE");
    expect(toDbAction("STOP_DEALLOCATE")).toBe("shutdown");
    expect(toDbAction("START")).toBe("start");
  });

  it("traduce los estados de ejecución al vocabulario del módulo", () => {
    expect(fromDbStatus("executed")).toBe("SUCCESS");
    expect(fromDbStatus("skipped_cpu")).toBe("SKIPPED_BUSY");
    expect(fromDbStatus("failed")).toBe("FAILED");
    expect(fromDbStatus(null)).toBeUndefined();
  });

  it("un CSV de días vacío significa todos los días, no ninguno", () => {
    expect(parseDaysOfWeek("1,2,3,4,5")).toEqual(BUSINESS_DAYS);
    expect(parseDaysOfWeek(null)).toEqual([...WEEKDAY_KEYS]);
    expect(parseDaysOfWeek("")).toEqual([...WEEKDAY_KEYS]);
    // Un CSV corrupto no debe dejar el schedule sin días y por ende inejecutable.
    expect(parseDaysOfWeek("99,abc")).toEqual([...WEEKDAY_KEYS]);
  });

  it("serializa a null cuando están los siete días: es ausencia de filtro", () => {
    expect(serializeDaysOfWeek(BUSINESS_DAYS)).toBe("1,2,3,4,5");
    expect(serializeDaysOfWeek([...WEEKDAY_KEYS])).toBeNull();
    expect(serializeDaysOfWeek([])).toBeNull();
    // El orden de entrada no altera el CSV.
    expect(serializeDaysOfWeek(["Fri", "Mon"])).toBe("1,5");
  });

  it("normaliza el DATE de mysql2 sin cruzar de día", () => {
    // mysql2 devuelve un objeto Date; String(date) da el formato largo, no ISO.
    expect(toDateOnly(new Date(2026, 6, 15, 0, 0, 0))).toBe("2026-07-15");
    expect(toDateOnly("2026-07-15")).toBe("2026-07-15");
    expect(toDateOnly(null)).toBeNull();
  });

  it("recorta la hora al formato HH:mm", () => {
    expect(toHhMm("19:00:00")).toBe("19:00");
    expect(toHhMm("7:05:00")).toBe("07:05");
    expect(toHhMm(null)).toBe("00:00");
  });

  it("una fila con fecha puntual es ONE_TIME y no arrastra días de semana", () => {
    const item = mapScheduleRow({
      id: 7,
      subscription_id: "sub-1",
      resource_group: "rg-a",
      vm_name: "vm-a",
      action_type: "shutdown",
      shutdown_time: "19:00:00",
      timezone: "America/Argentina/Buenos_Aires",
      schedule_date: "2026-09-01",
      days_of_week: "1,2,3",
      smart_shutdown_enabled: 1,
      max_cpu_percentage: 5,
      last_execution_status: "skipped_cpu",
      last_executed_date: "2026-08-20",
    });
    expect(item.scheduleType).toBe("ONE_TIME");
    expect(item.daysOfWeek).toEqual([]);
    expect(item.scheduleDate).toBe("2026-09-01");
    expect(item.lastExecutionStatus).toBe("SKIPPED_BUSY");
    expect(item.timezoneLabel).toBe("GMT-03:00");
    expect(item.vmResourceId).toContain("/virtualMachines/vm-a");
  });

  it("normaliza el powerState que devuelve Resource Graph", () => {
    expect(normalizePowerState("PowerState/running")).toBe("running");
    expect(normalizePowerState("PowerState/deallocated")).toBe("deallocated");
    expect(normalizePowerState("PowerState/starting")).toBe("starting");
    expect(normalizePowerState(undefined)).toBe("stopped");
  });
});

describe("Power Management — horas apagada por semana", () => {
  it("L-V 19:00 → 07:00 son 108 h, no las 118 h del enunciado", () => {
    // 4 noches L-J × 12 h = 48, más viernes 19:00 → lunes 07:00 = 60. Total 108.
    // Las 118 saldrían de contar 5 noches × 12 h MÁS el fin de semana entero,
    // duplicando el viernes a la noche y la madrugada del lunes.
    const h = calcWeeklyOffHours(
      { time: "19:00", daysOfWeek: BUSINESS_DAYS },
      { time: "07:00", daysOfWeek: BUSINESS_DAYS }
    );
    expect(h).toBe(108);
    // Y cierra con el complemento: 5 días × 12 h encendida.
    expect(HOURS_PER_WEEK - h).toBe(60);
    expect(DEFAULT_OFF_HOURS_PER_WEEK).toBe(108);
  });

  it("sin encendido programado la VM queda apagada toda la semana", () => {
    const h = calcWeeklyOffHours({ time: "19:00", daysOfWeek: BUSINESS_DAYS }, null);
    expect(h).toBe(HOURS_PER_WEEK);
  });

  it("apagado y encendido todos los días dan la ventana nocturna exacta", () => {
    const h = calcWeeklyOffHours(
      { time: "22:00", daysOfWeek: [...WEEKDAY_KEYS] },
      { time: "06:00", daysOfWeek: [...WEEKDAY_KEYS] }
    );
    expect(h).toBe(7 * 8);
  });

  it("una ventana que no cruza medianoche también se mide bien", () => {
    // Apaga a las 05:00 y enciende a las 23:00 el mismo día: 18 h apagada.
    const h = calcWeeklyOffHours(
      { time: "05:00", daysOfWeek: [...WEEKDAY_KEYS] },
      { time: "23:00", daysOfWeek: [...WEEKDAY_KEYS] }
    );
    expect(h).toBe(7 * 18);
  });

  it("sin apagado programado no hay horas ahorradas", () => {
    expect(calcWeeklyOffHours(null, { time: "07:00", daysOfWeek: BUSINESS_DAYS })).toBe(0);
    expect(calcWeeklyOffHours({ time: "19:00", daysOfWeek: [] }, null)).toBe(0);
  });

  it("empareja los horarios de la VM por nombre", () => {
    const schedules = getMockPowerManagementPayload("demo-tenant-4444").summary.schedules;
    const conPar = offHoursForVm("vm-qa-selenium-02", schedules);
    expect(conPar).toBe(108);
    // Una VM sin ninguna regla no acumula horas.
    expect(offHoursForVm("vm-inexistente", schedules)).toBe(0);
  });
});

describe("Power Management — ahorro", () => {
  it("proyecta el ahorro mensual con precisión decimal", () => {
    // 0.384 USD/h × 108 h = 41.472 USD/sem × 4.33 sem = 179.573… → 179.57
    expect(calcMonthlySavings(0.384, 108)).toBe(179.57);
  });

  it("no proyecta ahorro sin tarifa ni sin horas", () => {
    expect(calcMonthlySavings(0, 108)).toBe(0);
    expect(calcMonthlySavings(1.5, 0)).toBe(0);
    expect(calcMonthlySavings(-1, 108)).toBe(0);
  });

  it("acota las horas a una semana: no se puede apagar más de 168 h", () => {
    expect(calcMonthlySavings(1, 500)).toBe(calcMonthlySavings(1, HOURS_PER_WEEK));
  });

  it("prefiere el precio de lista y sólo deriva del gasto si no lo hay", () => {
    expect(resolveHourlyRate(0.5, 999, 100)).toBe(0.5);
    expect(resolveHourlyRate(0, 200, 400)).toBe(0.5);
    // Sin gasto ni precio no se inventa una tarifa.
    expect(resolveHourlyRate(0, 0, 400)).toBe(0);
    expect(resolveHourlyRate(0, 200, 0)).toBe(0);
  });
});

describe("Power Management — resumen", () => {
  const payload = getMockPowerManagementPayload("demo-tenant-4444");

  it("el dataset demo es determinista y escala por tier", () => {
    expect(payload.source).toBe("mock");
    expect(getMockPowerManagementPayload("demo-tenant-4444").summary.vms.length).toBe(payload.summary.vms.length);
    const pro = getMockPowerManagementPayload("demo-1111");
    expect(payload.summary.vms.length).toBeGreaterThan(pro.summary.vms.length);
  });

  it("cuenta VMs con schedule, no reglas: apagado + encendido son una sola VM", () => {
    const s = payload.summary;
    const vmsConRegla = new Set(s.schedules.map((x) => x.vmName));
    expect(s.activeSchedulesCount).toBe(vmsConRegla.size);
    expect(s.schedules.length).toBeGreaterThan(s.activeSchedulesCount);
  });

  it("el ahorro realizado sólo suma VMs con horario; el resto es oportunidad", () => {
    const s = payload.summary;
    const conHorario = s.vms.filter((v) => v.scheduledOffHoursPerWeek > 0);
    const esperado = Number(
      conHorario.reduce((a, v) => a + v.offHoursPotentialSavingsUSD, 0).toFixed(2)
    );
    expect(s.totalOffHoursSavingsMonthlyUSD).toBeCloseTo(esperado, 2);
    expect(s.untappedSavingsMonthlyUSD).toBeGreaterThan(0);
  });

  it("una VM ya apagada sin horario no cuenta como oportunidad", () => {
    // Apagarla otra vez no ahorra nada: ya no está facturando cómputo.
    const s = buildPowerSummary({
      schedules: [],
      smartShutdownAvoidedOutagesCount: 0,
      vms: [
        {
          id: "/vm/a", name: "a", resourceGroup: "rg", subscriptionId: "s", subscriptionName: "S",
          location: "eastus", vmSize: "Standard_D2s_v5", powerState: "deallocated",
          currentCpuPercentage: 0, monthlySpendUSD: 0, offHoursPotentialSavingsUSD: 100,
          hasActiveSchedule: false, scheduledOffHoursPerWeek: 0,
        },
      ],
    });
    expect(s.untappedSavingsMonthlyUSD).toBe(0);
    expect(s.deallocatedVmsCount).toBe(1);
    expect(s.runningVmsCount).toBe(0);
  });

  it("las horas evitadas son las horas semanales llevadas al mes", () => {
    const s = buildPowerSummary({
      schedules: [],
      smartShutdownAvoidedOutagesCount: 0,
      vms: [
        {
          id: "/vm/b", name: "b", resourceGroup: "rg", subscriptionId: "s", subscriptionName: "S",
          location: "eastus", vmSize: "Standard_D2s_v5", powerState: "running",
          currentCpuPercentage: 2, monthlySpendUSD: 50, offHoursPotentialSavingsUSD: 30,
          hasActiveSchedule: true, scheduledOffHoursPerWeek: 108,
        },
      ],
    });
    expect(s.totalMonthlyAvoidedHours).toBeCloseTo(108 * 4.33, 1);
    expect(s.totalOffHoursSavingsMonthlyUSD).toBe(30);
  });

  it("reporta los apagados pospuestos por CPU", () => {
    expect(payload.summary.smartShutdownAvoidedOutagesCount).toBeGreaterThan(0);
    expect(payload.summary.schedules.some((s) => s.lastExecutionStatus === "SKIPPED_BUSY")).toBe(true);
  });

  it("un tenant sin VMs devuelve el estado vacío, nunca el dataset demo", () => {
    const p = assembleLivePowerManagement({
      schedules: [],
      vms: [],
      availableSubscriptions: [],
      smartShutdownAvoidedOutagesCount: 0,
    });
    expect(p.source).toBe("live");
    expect(p.summary.vms).toEqual([]);
    expect(p.summary.totalOffHoursSavingsMonthlyUSD).toBe(0);
    expect(p.summary.runningVmsCount).toBe(0);
  });

  it("el gasto demo refleja el patrón de apagado: menos horas, menos factura", () => {
    const s = payload.summary;
    const conHorario = s.vms.find((v) => v.name === "vm-qa-selenium-02")!;
    const sinHorario = s.vms.find((v) => v.name === "vm-legacy-fileserver")!;
    expect(conHorario.scheduledOffHoursPerWeek).toBeGreaterThan(0);
    expect(sinHorario.scheduledOffHoursPerWeek).toBe(0);
  });
});
