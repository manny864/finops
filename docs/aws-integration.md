# AWS Integration (MVP)

Multi-cloud FinOps: conectar cuentas AWS junto a Azure, normalizando todo via FOCUS para vivir en la misma tabla `CostSnapshots`.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│ Client AWS Account (e.g. 123456789012)                          │
│                                                                  │
│  IAM Role: FinOpsReader                                          │
│  - Trust: arn:aws:iam::<PLATFORM_ACCT>:root + ExternalId         │
│  - Policies: Billing (Cost Explorer), EC2 RO, S3 RO (CUR bucket) │
│                                                                  │
│  Cost Explorer ──┐                                               │
│                  ├──► STS AssumeRole ──► Temp creds              │
│  S3 (CUR Parquet)┘                                               │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ FinOps SaaS                                                      │
│                                                                  │
│  lib/aws/sts.ts        → AssumeRole + cred cache (in-memory)     │
│  lib/aws/costExplorer  → DAILY GetCostAndUsage by SERVICE+REGION │
│  lib/aws/cur.ts        → S3 list manifest.json, stream Parquet   │
│  collectors/aws/...    → mapCeDailyToFocus, mapCurRowToFocus     │
│  collectors/aws/awsProvider → impl. CloudProvider                │
│                                                                  │
│  CostSnapshots (ProviderName='AWS') ─► Dashboards y FOCUS export │
└─────────────────────────────────────────────────────────────────┘
```

## Setup IAM en la cuenta cliente

### 1. Crear el IAM Role

Después de "Conectar cuenta AWS" en `/admin/cloud-accounts`, la UI te muestra el **External ID** (UUID generado por nosotros) y un **Trust Policy** listo para copiar.

#### CloudFormation snippet

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Parameters:
  PlatformAccountId:
    Type: String
    Description: FinOps SaaS AWS Account
  ExternalId:
    Type: String
    Description: External ID provisto en /admin/cloud-accounts
Resources:
  FinOpsReaderRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: FinOpsReader
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              AWS: !Sub 'arn:aws:iam::${PlatformAccountId}:root'
            Action: sts:AssumeRole
            Condition:
              StringEquals:
                'sts:ExternalId': !Ref ExternalId
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/job-function/Billing
        - arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess
Outputs:
  RoleArn:
    Value: !GetAtt FinOpsReaderRole.Arn
```

#### AWS CLI

```bash
aws iam create-role --role-name FinOpsReader \
  --assume-role-policy-document file://trust-policy.json

aws iam attach-role-policy --role-name FinOpsReader \
  --policy-arn arn:aws:iam::aws:policy/job-function/Billing

aws iam attach-role-policy --role-name FinOpsReader \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ReadOnlyAccess
```

donde `trust-policy.json` es el JSON que la UI te muestra al crear la cuenta.

### 2. (Opcional) Configurar CUR S3 export

Activá CUR en AWS Console → **Billing → Cost & Usage Reports → Create Report**:

- **Time granularity**: Hourly o Daily (recomendado Daily)
- **Compression**: Parquet
- **Data integration**: ninguna
- **S3 bucket**: e.g. `acme-cur-exports` (debe permitir el principal `billingreports.amazonaws.com`)
- **Path prefix**: e.g. `cur`
- **Report name**: e.g. `finops-report`

Adjuntá al Role la policy mínima para leer el bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::acme-cur-exports",
        "arn:aws:s3:::acme-cur-exports/*"
      ]
    }
  ]
}
```

### 3. Conectar en FinOps SaaS

En `/admin/cloud-accounts`:

- AWS Account ID: `123456789012`
- Role ARN: `arn:aws:iam::123456789012:role/FinOpsReader`
- Alias: `prod-us-east`
- (CUR opcional) Bucket: `acme-cur-exports`, Prefix: `cur`, Report Name: `finops-report`

Hacé click en **Test** para validar trust policy + Cost Explorer + CUR bucket.

## APIs

| Método | Path | Descripción |
|--------|------|-------------|
| GET    | `/api/aws/accounts?tenantId=X` | Lista cuentas (no devuelve external_id ni secretos) |
| POST   | `/api/aws/accounts` | Crea cuenta. Devuelve `externalId` UNA VEZ |
| DELETE | `/api/aws/accounts/[id]?tenantId=X` | Elimina cuenta (no borra CostSnapshots históricos) |
| POST   | `/api/aws/accounts/[id]/test?tenantId=X` | Valida assume-role + CE + CUR reachability |
| POST   | `/api/sync/aws/[id]/ce?tenantId=X&days=30` | Sync Cost Explorer (rápido) |
| POST   | `/api/sync/aws/[id]/cur?tenantId=X` | Sync CUR S3 (alta fidelidad, último periodo) |

Auth: requiere rol ADMIN o OWNER del tenant. SUPERADMIN bypassa.

## Cost Explorer vs CUR S3

| | Cost Explorer | CUR S3 |
|---|---|---|
| Setup cliente | Solo Role | Role + S3 bucket + CUR export config |
| Latencia datos | ~24h | ~24h |
| Granularidad | Daily, agrupado por service+region | Hourly, por resource individual |
| Fidelidad de costos | Buena (incluye amortizado) | Total (línea por uso, todos los campos FOCUS) |
| Costo API | $0.01/request | $0.005/GB-month S3 + GET requests |
| Volumen típico | ~100 filas/día | 10k-1M filas/día |
| Recomendado para | Onboarding, dashboards generales | Showback, chargeback fino, reservas |

MVP soporta ambos; podés usar CE como default y agregar CUR cuando necesites resource-level.

## Mapping CUR → FOCUS

`mapCurRowToFocus` produce:

| FOCUS Column | Source |
|---|---|
| ProviderName | `'AWS'` |
| BillingAccountId | payer account (assume-role target) |
| SubAccountId | `lineItem/UsageAccountId` (linked account) |
| ServiceName | `product/ProductName` ?? `lineItem/ProductCode` |
| ServiceCategory | heurística sobre `lineItem/ProductCode` |
| Region | `product/region` |
| ResourceId | `lineItem/ResourceId` |
| ResourceType | `product/instanceType` |
| ChargePeriodStart/End | `lineItem/UsageStartDate`/`EndDate` |
| BillingPeriodStart/End | `bill/BillingPeriodStartDate`/`EndDate` |
| BilledCost | `lineItem/UnblendedCost` |
| EffectiveCost | `reservation/EffectiveCost` ?? `savingsPlan/SavingsPlanEffectiveCost` ?? BilledCost |
| PricingCategory | derivado de `LineItemType` + `pricing/term` |
| ChargeCategory | Usage / Tax / Credit / Fee / Adjustment |
| Tags | `resourceTags/user:*` → `{key:value}` |

## Variables de entorno

```env
# Platform creds (necesario para que nuestro server pueda llamar STS)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_PLATFORM_ACCOUNT_ID=999988887777   # aparece en el Trust Policy del cliente

# UI mostrar al cliente (mismo valor pero NEXT_PUBLIC_ para SSR)
NEXT_PUBLIC_AWS_PLATFORM_ACCOUNT_ID=999988887777

# Reuso de la key de MFA para encriptar External IDs (64 hex chars = 32 bytes)
MFA_ENCRYPTION_KEY=<64 hex chars>
```

En prod recomendado: usar IAM role del compute (ECS/Fargate task role, EKS IRSA) en vez de access keys hardcoded.

## Tests

`__tests__/unit/aws.test.ts` — 20 tests:
- `awsServiceToCategory` (6 casos de mapping)
- `mapCeDailyToFocus` (3 casos)
- `mapCurRowToFocus` (6 casos: On-Demand, Reserved, Savings Plan, Spot, Tax/Credit, tags)
- `parseManifestJson` (2 casos: well-formed, defaults)
- External ID crypto (3 casos: round-trip, uniqueness, tamper detection via GCM)

## Limitaciones MVP / Roadmap v2

- **CUR sync procesa todo el periodo de facturación entero**, no incremental por día. Para CURs grandes (>1GB) puede tardar minutos. v2: ingesta incremental por partición + scheduled cron.
- **Sin Reserved Instances / Savings Plans utilization deep-dive**. Cost Explorer tiene APIs específicas (`GetReservationUtilization`, `GetSavingsPlansUtilization`) que sumaremos en v2.
- **Resource discovery solo EC2**. RDS, S3, Lambda van en v2.
- **Sin AWS Organizations roll-up multi-account**. MVP: una cuenta por entry. v2: detección automática de linked accounts.
- **Sin Trusted Advisor**. Requiere AWS Business o Enterprise Support ($100+/mes en la cuenta cliente).
- **Pricing data hardcoded a USD**. v2: detección de currency desde CUR header.
- **Vulnerabilidad transitiva**: `@dsnp/parquetjs` depende de `thrift` con CVE de uncontrolled recursion (no exploitable en nuestro caso porque solo parseamos CURs del propio cliente del tenant). Tracking upstream para fix.
