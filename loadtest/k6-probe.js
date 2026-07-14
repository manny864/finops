// Prueba de carga EXTERNA contra la infraestructura real (app + MySQL +
// Redis), autenticada como Service Principal (client credentials — sin
// usuario, sin MFA). Ver docs/loadtest.md para el setup completo del lado
// de Azure Entra ID y las env vars necesarias.
//
// Uso:
//   El CLIENT_SECRET vive en Key Vault (secret "loadtest-sp-client-secret",
//   NO en .env/scripts — ver docs/loadtest.md §1c), se trae recién al
//   momento de correr la prueba:
//
//   export CLIENT_SECRET=$(az keyvault secret show \
//     --vault-name cscs-kv-finops-saas-prod \
//     --name loadtest-sp-client-secret --query value -o tsv)
//
//   k6 run -e TENANT_ID=... -e CLIENT_ID=... -e CLIENT_SECRET=$CLIENT_SECRET \
//          -e APP_SCOPE=api://<NEXT_PUBLIC_CLIENT_ID>/.default \
//          -e TARGET_URL=https://finops.cscloudsolutions.com.ar/api/loadtest/probe \
//          --vus 20 --duration 30s loadtest/k6-probe.js
//
//   ⚠️ APP_SCOPE va con el Client ID de NEXT_PUBLIC_CLIENT_ID (el App
//   Registration donde loguean los usuarios), NO con AZURE_CLIENT_ID (ese
//   es el SP de envío de correos en este VPS — ver docs/loadtest.md §2).

import http from 'k6/http';
import { check, sleep } from 'k6';

const TENANT_ID = __ENV.TENANT_ID;
const CLIENT_ID = __ENV.CLIENT_ID;
const CLIENT_SECRET = __ENV.CLIENT_SECRET;
const APP_SCOPE = __ENV.APP_SCOPE; // ej: api://<NEXT_PUBLIC_CLIENT_ID>/.default (NO AZURE_CLIENT_ID)
const TARGET_URL = __ENV.TARGET_URL || 'https://finops.cscloudsolutions.com.ar/api/loadtest/probe';

// setup() corre UNA vez (no por VU/iteración) — obtiene un único token y lo
// comparte entre todos los VUs, tal como haría un cliente real (no tiene
// sentido pedir un token nuevo por request; el flujo real es "autenticate
// una vez, después mandá tráfico con ese token hasta que expire").
export function setup() {
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !APP_SCOPE) {
        throw new Error('Faltan env vars: TENANT_ID, CLIENT_ID, CLIENT_SECRET, APP_SCOPE');
    }

    const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
    const res = http.post(tokenUrl, {
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: APP_SCOPE,
    });

    check(res, { 'token obtenido (200)': (r) => r.status === 200 });
    const body = JSON.parse(res.body);
    if (!body.access_token) {
        throw new Error(`No se pudo obtener access_token: ${res.body}`);
    }
    return { token: body.access_token };
}

export const options = {
    // Sobreescribible por CLI (--vus / --duration / --stage), estos son
    // valores conservadores de arranque.
    vus: 10,
    duration: '30s',
    thresholds: {
        http_req_duration: ['p(95)<1000'], // alerta visual si p95 > 1s
        http_req_failed: ['rate<0.05'],    // alerta visual si error rate > 5%
    },
};

export default function (data) {
    const res = http.get(TARGET_URL, {
        headers: { Authorization: `Bearer ${data.token}` },
    });
    check(res, {
        'status 200': (r) => r.status === 200,
        'respuesta OK': (r) => {
            try { return JSON.parse(r.body).status === 'ok'; } catch { return false; }
        },
    });
    sleep(0.1);
}
