import PowerSchedules from "@/components/dashboard/PowerSchedules";

export default function PowerPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Horarios de Apagado</h1>
      <PowerSchedules />
    </div>
  );
}
