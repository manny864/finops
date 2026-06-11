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
    for attempt in range(4):
        res = requests.post(url, headers=headers, json=payload)
        if res.status_code == 200:
            return res.json()
        elif res.status_code == 429:
            time.sleep(5)
        else:
            return {"error": res.status_code, "message": res.text}
    return {"error": 429, "message": "Throttled"}

def main():
    tenant_id = os.environ.get("AZURE_TENANT_ID") or "YOUR_TENANT_ID"
    client_id = os.environ.get("AZURE_CLIENT_ID") or "YOUR_CLIENT_ID"
    client_secret = os.environ.get("AZURE_CLIENT_SECRET") or "YOUR_CLIENT_SECRET"
    
    subscriptions = ["YOUR_SUBSCRIPTION_ID"]
    
    if tenant_id == "YOUR_TENANT_ID" or client_secret == "YOUR_CLIENT_SECRET":
        print("Please configure AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET env variables.")
        return

    token = get_token(tenant_id, client_id, client_secret)
    
    kql_catalog = {
        "allVirtualMachines": "Resources | where type =~ 'microsoft.compute/virtualmachines' | project id, name, location, resourceGroup, subscriptionId",
        "staleSnapshots": "Resources | where type =~ 'microsoft.compute/snapshots' | project id, name, location, resourceGroup, subscriptionId",
        "unattachedDisks": "Resources | where type =~ 'microsoft.compute/disks' | where properties.diskState == 'Unattached' | project id, name, location, resourceGroup, subscriptionId",
        "unusedIps": "Resources | where type =~ 'microsoft.network/publicipaddresses' | where properties.ipConfiguration == '' or isnull(properties.ipConfiguration) | project id, name, location, resourceGroup, subscriptionId",
        "orphanedNics": "Resources | where type =~ 'microsoft.network/networkinterfaces' | where isnull(properties.virtualMachine) | project id, name, location, resourceGroup, subscriptionId",
        "orphanedNsgs": "Resources | where type =~ 'microsoft.network/networksecuritygroups' | where isnull(properties.networkInterfaces) and isnull(properties.subnets) | project id, name, location, resourceGroup, subscriptionId",
        "emptyAppServicePlans": "Resources | where type =~ 'microsoft.web/serverfarms' | where properties.numberOfSites == 0 | project id, name, location, resourceGroup, subscriptionId",
        "availabilitySets": "Resources | where type =~ 'microsoft.compute/availabilitysets' | where isnull(properties.virtualMachines) or array_length(properties.virtualMachines) == 0 | project id, name, location, resourceGroup, subscriptionId",
        "elasticPools": "resources | where type =~ 'microsoft.sql/servers/elasticpools'",
        "routeTables": "Resources | where type =~ 'microsoft.network/routetables' | where isnull(properties.subnets) or array_length(properties.subnets) == 0 | project id, name, location, resourceGroup, subscriptionId",
        "loadBalancers": "Resources | where type =~ 'microsoft.network/loadbalancers' | where isnull(properties.backendAddressPools) or array_length(properties.backendAddressPools) == 0 | project id, name, location, resourceGroup, subscriptionId",
        "emptyVnets": "resources | where type =~ 'microsoft.network/virtualnetworks' | where properties.subnets == '[]' | project id, name, location, resourceGroup, subscriptionId",
        "natGateways": "Resources | where type =~ 'microsoft.network/natgateways' | where isnull(properties.subnets) or array_length(properties.subnets) == 0 | project id, name, location, resourceGroup, subscriptionId",
        "privateDnsZones": "resources | where type =~ 'microsoft.network/privatednszones' | where properties.numberOfVirtualNetworkLinks == 0 | project id, name, location, resourceGroup, subscriptionId",
        "privateEndpoints": "resources | where type =~ 'microsoft.network/privateendpoints'",
        "vnetGateways": "resources | where type =~ 'microsoft.network/virtualnetworkgateways'",
        "stoppedVirtualMachines": "Resources | where type =~ 'microsoft.compute/virtualmachines' | where properties.extended.instanceView.powerState.code in~ ('PowerState/deallocated', 'PowerState/stopped') | project id, name, location, resourceGroup, subscriptionId"
    }
    
    print("Running queries...")
    for name, query in kql_catalog.items():
        result = query_resource_graph(token, query, subscriptions)
        if "error" in result:
            print(f"{name}: ERROR: {result['message']}")
        else:
            items = result.get("data", [])
            print(f"{name}: Found {len(items)} items.")
            if len(items) > 0:
                print(f"   Names: {[x.get('name') for x in items]}")
        time.sleep(2)

if __name__ == "__main__":
    main()
