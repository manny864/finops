import os
import shutil

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    env_local = os.path.join(base_dir, ".env.local")
    env_prod = os.path.join(base_dir, ".env.production")
    env_dev = os.path.join(base_dir, ".env.development")
    
    # 1. Read existing .env.local (which contains production credentials)
    with open(env_local, "r") as f:
        prod_content = f.read()
        
    # 2. Write to .env.production
    with open(env_prod, "w") as f:
        f.write(prod_content)
        
    # 3. Create .env.development with local docker credentials
    dev_content = prod_content.replace(
        "DB_USER=u843754295_finopsusr", "DB_USER=finops_user"
    ).replace(
        "DB_PASSWORD=Ma78n02n12Y@2026db", "DB_PASSWORD=finopspassword"
    ).replace(
        "DB_NAME=u843754295_finopsdb", "DB_NAME=finops_app"
    )
    
    with open(env_dev, "w") as f:
        f.write(dev_content)
        
    # 4. Remove .env.local so Next.js uses .env.development for dev and .env.production for start
    if os.path.exists(env_local):
        os.remove(env_local)
        
    print("Variables de entorno configuradas exitosamente.")

if __name__ == "__main__":
    main()
