import os

def main():
    env_path = "/Users/manuelchavez/Documents/FinOpsProyect/.env.local"
    secret = "AZURE_CLIENT_SECRET=NZL8Q~jzqUrAugtyyWm~fPSqyrLVq~KXRvg1EcAE\n"
    
    with open(env_path, "r") as f:
        content = f.read()
        
    if "AZURE_CLIENT_SECRET" not in content:
        with open(env_path, "a") as f:
            f.write("\n" + secret)
        print("Secreto inyectado exitosamente.")
    else:
        print("El secreto ya existe. Ignorando.")

if __name__ == "__main__":
    main()
