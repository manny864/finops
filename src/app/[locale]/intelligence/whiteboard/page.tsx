"use client";
import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

// El White Board se convirtió en el Dashboard Ejecutivo y se movió a
// Visibilidad (/overview/whiteboard). Este redirect preserva enlaces/
// bookmarks viejos a esta ruta. useRouter de @/i18n/routing ya antepone el
// locale activo automáticamente.
export default function WhiteboardRedirect() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/overview/whiteboard");
    }, [router]);
    return null;
}
