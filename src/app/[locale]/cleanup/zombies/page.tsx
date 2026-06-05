import ZombieResourcesTable from "@/components/ZombieResourcesTable";

export default function ZombiesPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-gray-900">Auditoría de Recursos Zombis</h1>
      <p className="text-sm text-gray-500 mb-6">Motor Omni-Scan: Detección y Remediación de 25 tipos de recursos huérfanos.</p>
      <ZombieResourcesTable />
    </div>
  );
}
