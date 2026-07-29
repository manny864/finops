"use client";

import { useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useLocale } from "next-intl";
import {
    DEFAULT_TIMEZONE,
    formatInTimeZone,
    formatDateInTimeZone,
    normalizeTimeZone,
} from "@/lib/timezone";

/**
 * Zona horaria del tenant seleccionado.
 *
 * Es el reemplazo de los `new Date(x).toLocaleString()` sueltos que había
 * repartidos por la UI: esos usan la zona del navegador, así que dos personas
 * del mismo equipo en países distintos veían horas distintas para el mismo
 * evento — y peor, la hora que mostraba la UI no era la misma con la que se
 * ejecutaban los horarios de Power Schedules.
 */
export function useTenantTimezone(): string {
    const { selectedTenant } = useTenant();
    return normalizeTimeZone(selectedTenant?.timezone) || DEFAULT_TIMEZONE;
}

/**
 * Formateadores ya atados a la zona del tenant y al locale activo.
 *
 *   const { formatDateTime } = useTenantDateFormat();
 *   <td>{formatDateTime(ticket.created_at)}</td>
 */
export function useTenantDateFormat() {
    const timeZone = useTenantTimezone();
    const locale = useLocale();

    const formatDateTime = useCallback(
        (value: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions) =>
            formatInTimeZone(value, timeZone, locale, options),
        [timeZone, locale]
    );

    const formatDate = useCallback(
        (value: Date | string | number | null | undefined) => formatDateInTimeZone(value, timeZone, locale),
        [timeZone, locale]
    );

    return { timeZone, locale, formatDateTime, formatDate };
}
