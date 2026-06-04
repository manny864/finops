import os

def main():
    base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
    env_file = os.path.join(base_dir, ".env.local")
    
    client_id = "876d8a5b-6023-4484-b3ba-73c186e4a72b"
    env_data = f"\n# Azure FinOps Application\nNEXT_PUBLIC_CLIENT_ID={client_id}\nAZURE_CLIENT_ID={client_id}\n"
    
    with open(env_file, "a") as f:
        f.write(env_data)

    print(f"Se inyectó el Client ID {client_id} en .env.local exitosamente.")

if __name__ == "__main__":
    main()
