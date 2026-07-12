"use client";
import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

// "Usuarios y Licencias" se fusionó con "Licencias" en /intelligence/licenses.
// Este redirect preserva enlaces/bookmarks viejos a esta ruta. useRouter de
// @/i18n/routing ya antepone el locale activo automáticamente.
export default function UsersLicensesRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/intelligence/licenses");
    }, [router]);
    return null;
}
