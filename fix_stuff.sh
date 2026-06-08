#!/bin/bash

# 1. Update build_translations.js
sed -i '' 's/"tenant_admin": "Tenant (Admin Propietario)",/"tenant_admin": "Tenant (Admin Propietario)",\n            "scope": "Alcance",/g' scripts/build_translations.js

sed -i '' 's/"tenant_admin": "Tenant (Admin Owner)",/"tenant_admin": "Tenant (Admin Owner)",\n            "scope": "Scope",/g' scripts/build_translations.js

sed -i '' 's/"tenant_admin": "Tenant (Admin Proprietário)",/"tenant_admin": "Tenant (Admin Proprietário)",\n            "scope": "Alcance",/g' scripts/build_translations.js

node scripts/build_translations.js

# 2. Swap page.tsx and billing/page.tsx
cp src/app/\[locale\]/page.tsx src/app/\[locale\]/intelligence/billing/page.tsx
cp /tmp/old_page.tsx src/app/\[locale\]/page.tsx
