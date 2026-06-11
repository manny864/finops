import os
import requests
import json
import time

def get_token(tenant_id, client_id, client_secret):
    url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = {
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://management.azure.com/.default"
    }
    res = requests.post(url, data=data)
    res.raise_for_status()
    return res.json()["access_token"]

def query_resource_graph_with_retry(token, query, subscriptions):
    url = "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "subscriptions": subscriptions,
        "query": query
    }
    for attempt in range(5):
        res = requests.post(url, headers=headers, json=payload)
        if res.status_code == 200:
            return res.json()
        elif res.status_code == 429:
            print(f"Rate limited. Waiting 6 seconds (attempt {attempt+1}/5)...")
            time.sleep(6)
        else:
            return {"error": res.status_code, "message": res.text}
    return {"error": 429, "message": "Throttled after 5 attempts"}

def main():
    tenant_id = os.environ.get("AZURE_TENANT_ID") or "YOUR_TENANT_ID"
    client_id = os.environ.get("AZURE_CLIENT_ID") or "YOUR_CLIENT_ID"
    client_secret = os.environ.get("AZURE_CLIENT_SECRET") or "YOUR_CLIENT_SECRET"
    
    subscriptions = ["YOUR_SUBSCRIPTION_ID"]
    
    if tenant_id == "YOUR_TENANT_ID" or client_secret == "YOUR_CLIENT_SECRET":
        print("Please configure AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET env variables.")
        return

    print("Obtaining token...")
    token = get_token(tenant_id, client_id, client_secret)
    
    print("\n--- Listing counts by type ---")
    q = "Resources | summarize count() by type | order by count_ desc"
    result = query_resource_graph_with_retry(token, q, subscriptions)
    if "error" in result:
        print(f"Error {result['error']}: {result['message']}")
    else:
        print(json.dumps(result.get("data", []), indent=2))

if __name__ == "__main__":
    main()
