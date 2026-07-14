import { redirect } from "next/navigation";

// "Configuración de Pagos" (solo superadmin) era un subconjunto de lo que ya
// hace "Facturación" (/admin/billing, cualquier tenant Admin, y accesible
// para superadmin vía el selector de tenant) — se eliminó por duplicado.
export default async function PaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    redirect(`/${locale}/admin/billing`);
}
