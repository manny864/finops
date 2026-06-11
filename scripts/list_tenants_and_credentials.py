import os
import mysql.connector
import json

def main():
    # Load credentials from environment
    db_host = os.environ.get("DB_HOST") or "127.0.0.1"
    db_user = os.environ.get("DB_USER") or "finops_user"
    db_password = os.environ.get("DB_PASSWORD") or "finopspassword"
    db_name = os.environ.get("DB_NAME") or "finops_app"
    
    try:
        conn = mysql.connector.connect(
            host=db_host,
            user=db_user,
            password=db_password,
            database=db_name
        )
        print("Connected to database successfully.")
    except Exception as e:
        print(f"Failed to connect to database: {e}")
        return
            
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT tenant_id, company_name, client_id, webhook_url FROM Tenants")
    rows = cursor.fetchall()
    print("Tenants in database:")
    print(json.dumps(rows, indent=2))
    
    cursor.close()
    conn.close()

if __name__ == "__main__":
    main()
