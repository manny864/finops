import M365UsersBoard from "@/components/dashboard/M365UsersBoard";
import MockBanner from "@/components/MockBanner";

// Fusión de "Usuarios y Licencias" (M365/Entra ID) + "Licencias" (AHUB +
// métricas por SKU). Antes vivían en /overview/users-licenses y
// /intelligence/licenses por separado; ver /overview/users-licenses/page.tsx
// para el redirect que preserva enlaces viejos.
export default function LicensesPage() {
    return (
        <div className="p-6 w-full flex flex-col gap-5">
            <MockBanner />
            <M365UsersBoard />
        </div>
    );
}
