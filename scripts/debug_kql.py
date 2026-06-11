import os
import requests
import json

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

def get_subscriptions(token):
    url = "https://management.azure.com/subscriptions?api-version=2020-01-01"
    headers = {
        "Authorization": f"Bearer {token}"
    }
    res = requests.get(url, headers=headers)
    res.raise_for_status()
    return res.json().get("value", [])

def query_resource_graph(token, query, subscriptions):
    url = "https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    payload = {
        "subscriptions": subscriptions,
        "query": query
    }
    res = requests.post(url, headers=headers, json=payload)
    if res.status_code != 200:
        return {"error": res.status_code, "message": res.text}
    return res.json()

def test_tenant(tenant_id, client_id, client_secret, company_name):
    print(f"\n==================================================")
    print(f"Testing Tenant: {company_name} ({tenant_id})")
    print(f"==================================================")
    try:
        token = get_token(tenant_id, client_id, client_secret)
        subs = get_subscriptions(token)
        sub_ids = [sub["subscriptionId"] for sub in subs if "subscriptionId" in sub]
        print(f"Found subscriptions: {sub_ids}")
        
        if len(sub_ids) == 0:
            print("No subscriptions found.")
            return
            
        print("\n--- Listing counts by type ---")
        q = "Resources | summarize count() by type | order by count_ desc"
        result = query_resource_graph(token, q, sub_ids)
        if "error" in result:
            print(f"Error {result['error']}: {result['message']}")
        else:
            print(json.dumps(result.get("data", []), indent=2))
            
    except Exception as e:
        print(f"Failed to test tenant: {e}")

def main():
    tenant_id = os.environ.get("AZURE_TENANT_ID") or "YOUR_TENANT_ID"
    client_id = os.environ.get("AZURE_CLIENT_ID") or "YOUR_CLIENT_ID"
    client_secret = os.environ.get("AZURE_CLIENT_SECRET") or "YOUR_CLIENT_SECRET"
    
    if tenant_id == "YOUR_TENANT_ID" or client_secret == "YOUR_CLIENT_SECRET":
        print("Please configure AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET env variables.")
        return

    test_tenant(tenant_id, client_id, client_secret, "Active Tenant")

if __name__ == "__main__":
    main()
