import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
path = os.path.join(base_dir, "src/components/ZombieResourcesTable.tsx")

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Reemplazar la lógica de throw por toast directo
old_block = """          if (!res.ok) {
              if (json.error === "MISSING_CONTRIBUTOR_ROLE") {
                  throw new Error(`MISSING_CONTRIBUTOR_ROLE|${json.clientId}`);
              }
              throw new Error(json.error || "Fallo al eliminar");
          }"""

new_block = """          if (!res.ok) {
              if (json.error === "MISSING_CONTRIBUTOR_ROLE") {
                  toast.error('¡Operación Denegada!', { description: 'Tu aplicación FinOps solo tiene rol de Lector o faltan permisos en la suscripción.' });
                  addAction({ message: `Fallo de permisos al borrar ${item.resourceName}. Se requiere Rol Contributor.`, status: 'error' }); 
                  setDeletingId(null);
                  return;
              }
              throw new Error(json.error || "Fallo al eliminar");
          }"""

content = content.replace(old_block, new_block)

# Eliminar el console.error que Next.js intercepta y muestra en el overlay
content = content.replace('console.error("Error de eliminación:", err);', 'console.warn("Aviso de eliminación:", err.message);')

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("ZombieResourcesTable error handling patched.")
