import os
import subprocess
import time
import sys

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    os.chdir(base_dir)
    
    print("--- Levantando Contenedores ---")
    try:
        subprocess.run("docker compose up -d || docker-compose up -d", shell=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Error al ejecutar docker compose: {e}")
        sys.exit(1)
    
    print("\n--- Esperando inicialización del motor MySQL 8.0 (15 segundos) ---")
    time.sleep(15)
    
    print("\n--- Verificando conectividad con mysql2 (Node.js) ---")
    js_code = """
const mysql = require('mysql2/promise');

async function testConnection() {
    let retries = 5;
    while(retries > 0) {
        try {
            const connection = await mysql.createConnection('mysql://finops_user:finopspassword@localhost:3306/finops_app');
            const [rows] = await connection.query('SELECT 1 as result');
            console.log("\\x1b[32m[SUCCESS] Conexión establecida y autenticada con la base de datos 'finops_app'.\\x1b[0m");
            await connection.end();
            process.exit(0);
        } catch(e) {
            console.error(`Fallo de conexión. Reintentando en 3s... (Restantes: ${retries - 1}). Error: ${e.message}`);
            retries--;
            await new Promise(res => setTimeout(res, 3000));
        }
    }
    console.error("\\x1b[31m[ERROR] No se pudo conectar a la base de datos tras múltiples intentos.\\x1b[0m");
    process.exit(1);
}

testConnection();
"""
    with open("test_db.js", "w") as f:
        f.write(js_code)
        
    result = subprocess.run(["node", "test_db.js"])
    
    # Cleanup script temporal
    if os.path.exists("test_db.js"):
        os.remove("test_db.js")
        
    if result.returncode != 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
