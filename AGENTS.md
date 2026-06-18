# Contexto Global: SaaS FinOps (CSCloudSolutions)

- **Stack:** Next.js (App Router), React, Tailwind CSS, TypeScript, MySQL.
- **Regla Cero (Precisión):** Absoluta precisión matemática. Los cálculos de costos, amortizaciones y proyecciones NUNCA deben usar floats; usar tipos exactos (DECIMAL en DB, librerías de precisión en JS si es necesario).
- **Regla UI:** Componentes Server-First. Usar `'use client'` estrictamente solo cuando haya hooks (useState) o interactividad del usuario.
- **Seguridad:** Todas las mutaciones a la base de datos deben pasar por Server Actions con validación estricta y control de RBAC (Role-Based Access Control) por Tenant.