import { getAzureCredential } from '@/lib/azure';

export interface LicenseSku {
    id: string;
    skuPartNumber: string;
    total: number;
    consumed: number;
    available: number;
    underutilized: number; 
    wastedCost: number; 
}

export interface InactiveUser {
    userPrincipalName: string;
    assignedProducts: string;
    lastActivityDate: string | null;
    daysInactive: number;
}

export async function getTenantLicensesAndInactiveUsers(tenantId: string): Promise<{ licenses: LicenseSku[], inactiveUsers: InactiveUser[] }> {
    const credential = await getAzureCredential(tenantId);
    const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
    
    if (!tokenResponse) {
        throw new Error("Unable to authenticate with Microsoft Graph");
    }

    const headers = {
        "Authorization": `Bearer ${tokenResponse.token}`
    };

    // 1. Fetch Subscribed SKUs
    const skuRes = await fetch("https://graph.microsoft.com/v1.0/subscribedSkus", { headers });
    let skus: any[] = [];
    if (!skuRes.ok) {
        const err = await skuRes.text();
        console.error('GRAPH API HTTP ERROR (subscribedSkus):', skuRes.status, err);
        throw new Error(`Graph API Error (subscribedSkus): ${skuRes.status} ${err}`);
    } else {
        const json = await skuRes.json();
        console.log('GRAPH API SUCCESS (subscribedSkus), RAW DATA:', JSON.stringify(json).substring(0, 200));
        skus = json.value || [];
    }

    // 2. Fetch Active User Details (CSV)
    const reportRes = await fetch("https://graph.microsoft.com/v1.0/reports/getOffice365ActiveUserDetail(period='D30')", { headers });
    let inactiveUsers: InactiveUser[] = [];
    
    if (!reportRes.ok) {
        const err = await reportRes.text();
        console.error('GRAPH API HTTP ERROR (getOffice365ActiveUserDetail):', reportRes.status, err);
        throw new Error(`Graph API Error (getOffice365ActiveUserDetail): ${reportRes.status} ${err}`);
    } else {
        const text = await reportRes.text();
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        if (lines.length > 1) {
            const headerLine = lines[0].split(',');
            const upnIdx = headerLine.findIndex(h => h.includes('User Principal Name'));
            const assignedIdx = headerLine.findIndex(h => h.includes('Assigned Products'));
            const exchIdx = headerLine.findIndex(h => h.includes('Exchange Last Activity Date'));
            const odIdx = headerLine.findIndex(h => h.includes('OneDrive Last Activity Date'));
            const spIdx = headerLine.findIndex(h => h.includes('SharePoint Last Activity Date'));

            for (let i = 1; i < lines.length; i++) {
                // Handle commas within quotes for Assigned Products
                const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(x => x.replace(/^"|"$/g, '')) || [];
                
                if (row.length > Math.max(upnIdx, assignedIdx)) {
                    const upn = row[upnIdx];
                    const products = row[assignedIdx] || '';
                    if (!products) continue; // Only process licensed users

                    const exchDate = row[exchIdx] || '';
                    const odDate = row[odIdx] || '';
                    const spDate = row[spIdx] || '';

                    // Find most recent activity
                    const dates = [exchDate, odDate, spDate].filter(d => d).map(d => new Date(d).getTime());
                    let daysInactive = 999;
                    let lastActivityStr: string | null = null;

                    if (dates.length > 0) {
                        const mostRecent = Math.max(...dates);
                        daysInactive = Math.floor((Date.now() - mostRecent) / (1000 * 60 * 60 * 24));
                        lastActivityStr = new Date(mostRecent).toISOString().split('T')[0];
                    }

                    if (daysInactive >= 30) {
                        inactiveUsers.push({
                            userPrincipalName: upn,
                            assignedProducts: products,
                            lastActivityDate: lastActivityStr,
                            daysInactive
                        });
                    }
                }
            }
        }
    }

    // 3. Correlate Underutilized SKUs
    const skuWasteCount: Record<string, number> = {};
    inactiveUsers.forEach(u => {
        // Products string might be like: "ENTERPRISEPACK, VISIOCLIENT"
        const prods = u.assignedProducts.split(',').map(p => p.trim());
        prods.forEach(p => {
            if (!skuWasteCount[p]) skuWasteCount[p] = 0;
            skuWasteCount[p]++;
        });
    });

    const licenses = skus.map((sku: any) => {
        const total = sku.prepaidUnits?.enabled || 0;
        const consumed = sku.consumedUnits || 0;
        const available = total - consumed;
        
        // Exact count from real M365 usage report
        const underutilized = skuWasteCount[sku.skuPartNumber] || 0; 
        const wastedCost = underutilized * 20; // Simulated $20 cost

        return {
            id: sku.id,
            skuPartNumber: sku.skuPartNumber,
            total,
            consumed,
            available,
            underutilized,
            wastedCost
        };
    });

    return { licenses, inactiveUsers };
}
