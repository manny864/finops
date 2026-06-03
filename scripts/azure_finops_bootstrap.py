import os
import subprocess
import sys

def run_command(cmd, cwd=None):
    print(f"Ejecutando: {' '.join(cmd)}")
    try:
        subprocess.run(cmd, cwd=cwd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error al ejecutar comando: {e}")
        sys.exit(1)

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    print(f"Iniciando bootstrap del proyecto en {base_dir}...")
    
    # 1. Initialize Next.js
    print("\n--- 1. Inicializando Next.js ---")
    if not os.path.exists(os.path.join(base_dir, "package.json")):
        temp_dir = "finops-project"
        run_command([
            "npx", "-y", "create-next-app@latest", temp_dir, 
            "--typescript", "--tailwind", "--eslint", 
            "--app", "--src-dir", "--import-alias", "@/*", "--yes"
        ], cwd=base_dir)
        
        # Mover archivos al directorio principal (incluyendo ocultos)
        print("Moviendo archivos generados al directorio base...")
        run_command(["sh", "-c", f"cp -a {temp_dir}/. . && rm -rf {temp_dir}"], cwd=base_dir)
    else:
        print("El proyecto ya se encuentra inicializado. Omitiendo create-next-app.")
    
    # 2. Configure Standalone
    print("\n--- 2. Configurando standalone en next.config.ts ---")
    next_config_path = os.path.join(base_dir, "next.config.ts")
    if os.path.exists(next_config_path):
        with open(next_config_path, "r") as f:
            config_content = f.read()
        
        if "output:" not in config_content:
            config_content = config_content.replace(
                "const nextConfig: NextConfig = {", 
                "const nextConfig: NextConfig = {\n  output: 'standalone',"
            )
            with open(next_config_path, "w") as f:
                f.write(config_content)
            print("next.config.ts actualizado a standalone.")
    else:
        print("ADVERTENCIA: No se encontró next.config.ts")

    # 3. Docker Setup
    print("\n--- 3. Configurando Docker ---")
    dockerfile_content = """FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]
"""
    with open(os.path.join(base_dir, "Dockerfile"), "w") as f:
        f.write(dockerfile_content)
        
    dockerignore_content = """node_modules
.next
.git
.env*
"""
    with open(os.path.join(base_dir, ".dockerignore"), "w") as f:
        f.write(dockerignore_content)
    print("Dockerfile y .dockerignore creados.")
        
    # 4. Skill Injection
    print("\n--- 4. Inyectando Skill de Azure FinOps ---")
    skill_dir = os.path.join(base_dir, ".agent", "skills", "azure-finops-expert")
    os.makedirs(skill_dir, exist_ok=True)
    
    skill_content = """# Azure FinOps Expert

You are an expert Azure FinOps Developer and Cloud Architect.

## Core Directives
1. **Identify Zombie Resources**: Prioritize identifying unattached disks, unused public IPs, and orphaned resources.
2. **Right-Sizing**: Recommend right-sizing based on actual metrics.
3. **Tagging Policies**: Enforce tagging policies for accurate billing assignment.

## Azure SDK Requirements
- Use the `@azure/arm-consumption` SDK for fetching billing and cost data.
- Use the `@azure/arm-compute` SDK for checking the actual usage and state of compute resources.
"""
    with open(os.path.join(skill_dir, "SKILL.md"), "w") as f:
        f.write(skill_content)
    print("Skill creado.")
        
    # 5. Base Architecture
    print("\n--- 5. Creando estructura base de Azure ---")
    src_lib_dir = os.path.join(base_dir, "src", "lib")
    os.makedirs(src_lib_dir, exist_ok=True)
    with open(os.path.join(src_lib_dir, "azure.ts"), "w") as f:
        f.write("// Azure SDK client initialization\nexport {};\n")
        
    api_consumption_dir = os.path.join(base_dir, "src", "app", "api", "consumption")
    os.makedirs(api_consumption_dir, exist_ok=True)
    with open(os.path.join(api_consumption_dir, "route.ts"), "w") as f:
        f.write("// API Route for fetching billing data\nexport {};\n")
        
    api_recommendations_dir = os.path.join(base_dir, "src", "app", "api", "recommendations")
    os.makedirs(api_recommendations_dir, exist_ok=True)
    with open(os.path.join(api_recommendations_dir, "route.ts"), "w") as f:
        f.write("// API Route for zombie resource detection\nexport {};\n")
    print("Archivos base creados.")
        
    print("\nBootstrap completado exitosamente.")

if __name__ == "__main__":
    main()
