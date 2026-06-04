import ExpiredSandboxTable from "@/components/dashboard/ExpiredSandboxTable";

export default function TtlPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Expiraciones TTL</h1>
      <ExpiredSandboxTable />
    </div>
  );
}
