# SOP: Optimización de Consumo de Memoria RAM en Compilación y Desarrollo Next.js / Node.js

## Contexto y Diagnóstico
En entornos macOS (especialmente con procesadores Apple Silicon y memoria unificada de 16GB, 32GB, 64GB o 128GB), el motor V8 de Node.js no establece un techo bajo de memoria por defecto, infiriendo que puede utilizar la mayor parte de la RAM física libre antes de disparar el *Garbage Collector* (GC).

Esto produce escenarios donde la terminal o el servidor de desarrollo (`npm run dev` o `npm run build`) escala hasta 20-25+ GB de RAM consumida, causando degradación o lentitud en el sistema operativo.

A esto se suma el costo computacional de paquetes de frontend y SDKs masivos con miles de exportaciones individuales (`@tabler/icons-react`, `lucide-react`, `@azure/arm-*`), los cuales inflan el AST (*Abstract Syntax Tree*) y la caché de módulos en RAM si no se cargan bajo demanda.

---

## Directiva de Mitigación y Buenas Prácticas

### 1. Límite de Heap V8 en Scripts (`package.json`)
Todos los comandos de ejecución, desarrollo y build en `package.json` deben incluir explícitamente el flag `--max-old-space-size=4096` (o `2048` para runtime liviano) para forzar a Node a recolectar basura y liberar memoria de forma proactiva:

```json
"scripts": {
  "dev": "NODE_OPTIONS='--max-old-space-size=4096' next dev -p 3000",
  "dev:clean": "lsof -ti:3000 | xargs kill -9 2>/dev/null; NODE_OPTIONS='--max-old-space-size=4096' next dev -p 3000",
  "dev:3003": "PORT=3003 NODE_OPTIONS='--max-old-space-size=4096' next dev -p 3003",
  "build": "NODE_OPTIONS='--max-old-space-size=4096' next build",
  "start": "NODE_OPTIONS='--max-old-space-size=2048' next start -p 3000"
}
```

### 2. Optimización de Paquetes Masivos en `next.config.ts`
En `next.config.ts`, bajo la clave `experimental.optimizePackageImports`, se deben registrar todas las librerías con árboles de exportación extensos:

```typescript
experimental: {
  optimizePackageImports: [
    '@tabler/icons-react',
    'lucide-react',
    'recharts',
    '@azure/arm-compute',
    '@azure/arm-costmanagement',
    '@azure/arm-network',
    '@azure/arm-resources',
    '@azure/arm-subscriptions',
    '@azure/arm-advisor',
    '@azure/arm-monitor',
    '@azure/arm-consumption',
    '@azure/arm-appservice',
    '@azure/identity',
  ],
},
```

### 3. Liberación de Páginas Inactivas en Desarrollo (`onDemandEntries`)
Para evitar que las páginas visitadas durante la sesión de desarrollo permanezcan indefinidamente en la memoria del proceso Next.js:

```typescript
onDemandEntries: {
  maxInactiveAge: 60 * 1000, // Libera páginas inactivas a los 60s
  pagesBufferLength: 5,      // Mantiene máximo 5 páginas en buffer
},
```

### 4. Configuración Global para Terminales macOS (`~/.zshrc`)
Para desarrolladores que ejecutan comandos directos sin pasar por `npm run dev` (ej. CLI tools o scripts auxiliares), se recomienda persistir en su shell:

```bash
# En ~/.zshrc o ~/.bashrc
export NODE_OPTIONS="--max-old-space-size=4096"
```

---

## Restricciones y Trampas Conocidas
- **No asignar menos de 2048MB para `build`**: La compilación de producción con internacionalización de 3 idiomas y generación de rutas estáticas puede fallar por OOM si se fija un límite inferior a 2GB. 4096MB (4GB) es el punto dulce entre contención y estabilidad.
- **Limpieza de carpetas `.next-*` acumuladas**: Si se utilizan múltiples puertos con `PORT=3003` o similares, verificar que no queden carpetas huérfanas `.next-300*` indexadas por el servidor de TypeScript en `tsconfig.json`.
