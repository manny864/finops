"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { IconLoader2, IconShieldLock } from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";

/**
 * Guard de todo el segmento /superadmin.
 *
 * Antes cada página se protegía (o no) por su cuenta: de 14, sólo 2 tenían
 * chequeo. El resto se abría con escribir la URL, aunque sus APIs sí exigieran
 * requireSuperAdmin. Un layout cubre las 14 de una y las que se agreguen
 * después nacen protegidas.
 *
 * El gate es por ROL (`Users.system_role`, resuelto server-side y expuesto por
 * TenantProvider), nunca por dominio del email. Y espera `authzResolved`:
 * `systemRole` arranca en 'USER', así que evaluarlo antes echaría al SuperAdmin
 * real antes de que responda el backend.
 *
 * Esto es la capa de UX/defensa en profundidad — la autorización real vive en
 * `requireSuperAdmin` de cada API, que es lo que protege los DATOS.
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const t = useTranslations("Navigation");
    const { systemRole, authzResolved } = useTenant();

    const isSuperAdmin = systemRole === "SUPERADMIN";

    useEffect(() => {
        if (!authzResolved || isSuperAdmin) return;
        toast.error(t("superadminOnly"));
        router.replace("/");
    }, [authzResolved, isSuperAdmin, router, t]);

    if (!authzResolved) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500 dark:text-slate-400">
                <IconLoader2 size={28} className="animate-spin text-[#0078D4]" />
                <p className="text-sm">{t("checkingPermissions")}</p>
            </div>
        );
    }

    // No se renderizan los children mientras el redirect está en camino: si no,
    // la página alcanzaría a montarse y disparar sus fetches.
    if (!isSuperAdmin) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500 dark:text-slate-400">
                <IconShieldLock size={28} className="text-slate-400 dark:text-slate-500" />
                <p className="text-sm">
                    {t("superadminOnly")}
                </p>
            </div>
        );
    }

    return <>{children}</>;
}
