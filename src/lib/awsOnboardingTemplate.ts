/**
 * Plantillas de onboarding AWS: CloudFormation y Terraform.
 *
 * Equivalente al script de PowerShell de Azure (`onboardingScriptTemplate.ts`),
 * con el mismo criterio: el cliente ejecuta el artefacto en SU cuenta y crea un
 * rol de mínimo privilegio que la plataforma asume vía STS.
 *
 * PRINCIPIO DE MENOR PRIVILEGIO (AGENTS.md #1)
 * --------------------------------------------
 * La UI anterior le pedía al cliente que adjuntara managed policies de AWS:
 *   - `job-function/Billing`        → mucho más amplio que `ce:GetCostAndUsage`.
 *   - `AmazonEC2ReadOnlyAccess`     → mucho más amplio que `ec2:DescribeInstances`.
 *   - `AmazonS3ReadOnlyAccess`      → **lectura de TODOS los buckets** de la
 *                                     cuenta, cuando sólo hace falta el del CUR.
 *
 * Estas plantillas otorgan exactamente las acciones que el código ejecuta hoy,
 * verificadas una por una contra el uso real del SDK:
 *
 *   | Acción                  | Dónde se usa                                        |
 *   |-------------------------|-----------------------------------------------------|
 *   | `ce:GetCostAndUsage`     | `getCostAndUsage()` — sync de Cost Explorer        |
 *   | `ec2:DescribeInstances`  | `getActiveResources()` — inventario EC2            |
 *   | `ec2:DescribeVolumes`    | `getAwsZombies()` — volúmenes EBS sin adjuntar     |
 *   | `ec2:DescribeAddresses`  | `getAwsZombies()` — IPs elásticas sin asociar      |
 *   | `ec2:DescribeSnapshots`  | `getAwsZombies()` — snapshots antiguos             |
 *   | `budgets:DescribeBudgets`| `getAwsNativeBudgets()` — presupuestos nativos     |
 *   | `budgets:ViewBudget`     | idem (AWS exige las dos para leer un presupuesto)  |
 *   | `s3:ListBucket`          | `ListObjectsV2Command` — localizar el manifest CUR |
 *   | `s3:GetObject`           | `GetObjectCommand` — leer manifest y Parquet       |
 *
 * Las dos de S3 van restringidas al bucket del CUR, no a `*`.
 *
 * IMPORTANTE: no se piden permisos "por si acaso" para features todavía no
 * implementadas (rightsizing vía Compute Optimizer, apagado de instancias,
 * borrado de volúmenes huérfanos). Cuando esas fases se implementen habrá que
 * ampliar la plantilla y pedirle al cliente que la actualice — pedirlos ahora
 * sería exactamente el sobre-aprovisionamiento que este archivo viene a evitar.
 */

export interface AwsOnboardingParams {
    /** Cuenta AWS de la plataforma que asumirá el rol. */
    platformAccountId: string;
    /** ExternalId único por cuenta cliente (anti confused-deputy). */
    externalId: string;
    /** Nombre del rol a crear en la cuenta del cliente. */
    roleName?: string;
    /** Bucket del CUR. Si se omite, se genera sólo el bloque de Cost Explorer + EC2. */
    curBucket?: string;
    /** Prefijo del CUR dentro del bucket (opcional, acota más el permiso). */
    curPrefix?: string;
}

export const DEFAULT_AWS_ROLE_NAME = "CSCloudSolutionsFinOpsRole";

/** Sólo dígitos, 12 caracteres. Evita generar plantillas inválidas o inyectadas. */
export function isValidAwsAccountId(value: string): boolean {
    return /^\d{12}$/.test(value);
}

/**
 * Nombre de bucket S3 válido (RFC-ish de AWS): 3-63 chars, minúsculas, dígitos,
 * puntos y guiones. Se valida porque el valor entra en una plantilla que el
 * cliente ejecuta con permisos de IAM.
 */
export function isValidS3BucketName(value: string): boolean {
    return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value);
}

function assertParams(params: AwsOnboardingParams): void {
    if (!isValidAwsAccountId(params.platformAccountId)) {
        throw new Error("platformAccountId debe ser un ID de cuenta AWS de 12 dígitos.");
    }
    if (!params.externalId || params.externalId.length < 16) {
        throw new Error("externalId ausente o demasiado corto.");
    }
    // El ExternalId va dentro de una condición IAM; caracteres fuera de este set
    // romperían el YAML/HCL o permitirían inyectar estructura.
    if (!/^[A-Za-z0-9+/=_:.-]+$/.test(params.externalId)) {
        throw new Error("externalId contiene caracteres no permitidos.");
    }
    if (params.roleName && !/^[A-Za-z0-9+=,.@_-]{1,64}$/.test(params.roleName)) {
        throw new Error("roleName inválido para IAM.");
    }
    if (params.curBucket && !isValidS3BucketName(params.curBucket)) {
        throw new Error("curBucket no es un nombre de bucket S3 válido.");
    }
    if (params.curPrefix && !/^[A-Za-z0-9!_.*'()/-]*$/.test(params.curPrefix)) {
        throw new Error("curPrefix contiene caracteres no permitidos.");
    }
}

function normalizePrefix(prefix?: string): string {
    if (!prefix) return "";
    return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

/** Plantilla CloudFormation (YAML). Es el camino recomendado: un clic en la consola. */
export function generateAwsCloudFormationTemplate(params: AwsOnboardingParams): string {
    assertParams(params);
    const roleName = params.roleName || DEFAULT_AWS_ROLE_NAME;
    const prefix = normalizePrefix(params.curPrefix);

    const curStatements = params.curBucket
        ? `
              # Lectura del CUR, acotada al bucket y prefijo informados. Nunca
              # con comodín global sobre S3, que equivaldría a la managed policy
              # AmazonS3ReadOnlyAccess (todos los buckets de la cuenta).
              - Sid: LeerManifestYParquetDelCUR
                Effect: Allow
                Action:
                  - s3:GetObject
                Resource: arn:aws:s3:::${params.curBucket}/${prefix}*
              - Sid: ListarSoloElBucketDelCUR
                Effect: Allow
                Action:
                  - s3:ListBucket
                Resource: arn:aws:s3:::${params.curBucket}
                Condition:
                  StringLike:
                    s3:prefix:
                      - '${prefix}*'`
        : "";

    return `AWSTemplateFormatVersion: '2010-09-09'
Description: >-
  Rol de solo lectura para CSCloudSolutions FinOps. Otorga unicamente las
  acciones que la plataforma ejecuta: Cost Explorer, inventario EC2 y (si se
  informa un bucket) lectura del Cost and Usage Report.

Parameters:
  RoleName:
    Type: String
    Default: ${roleName}
    Description: Nombre del rol que se creara en esta cuenta.

Resources:
  CSCloudSolutionsFinOpsRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Ref RoleName
      Description: Acceso de solo lectura para analisis FinOps de CSCloudSolutions.
      MaxSessionDuration: 3600
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          # El ExternalId evita el problema del "confused deputy": sin el, otro
          # cliente de la plataforma podria pedir que se asuma ESTE rol.
          - Effect: Allow
            Principal:
              AWS: arn:aws:iam::${params.platformAccountId}:root
            Action: sts:AssumeRole
            Condition:
              StringEquals:
                sts:ExternalId: '${params.externalId}'
      Policies:
        - PolicyName: CSCloudSolutionsFinOpsReadOnly
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              # Costos agregados. Cost Explorer no admite permisos por recurso:
              # '*' es el unico Resource valido para ce:*.
              - Sid: LeerCostosDeCostExplorer
                Effect: Allow
                Action:
                  - ce:GetCostAndUsage
                Resource: '*'
              # Inventario para correlacionar costo con recursos vivos y
              # detectar los ociosos. Las acciones Describe* de EC2 no admiten
              # permisos por recurso: '*' es el unico Resource valido.
              - Sid: InventarioEC2SoloLectura
                Effect: Allow
                Action:
                  - ec2:DescribeInstances
                  - ec2:DescribeVolumes
                  - ec2:DescribeAddresses
                  - ec2:DescribeSnapshots
                Resource: '*'
              # Presupuestos nativos. AWS exige las dos acciones para leer un
              # presupuesto: DescribeBudgets lista y ViewBudget autoriza el
              # detalle. Ninguna permite crear ni modificar.
              - Sid: LeerPresupuestosNativos
                Effect: Allow
                Action:
                  - budgets:DescribeBudgets
                  - budgets:ViewBudget
                Resource: !Sub 'arn:aws:budgets::\${AWS::AccountId}:budget/*'${curStatements}

Outputs:
  RoleArn:
    Description: Pegar este ARN en CSCloudSolutions para completar la conexion.
    Value: !GetAtt CSCloudSolutionsFinOpsRole.Arn
  ExternalId:
    Description: ExternalId asociado a esta conexion (ya viene embebido en el rol).
    Value: '${params.externalId}'
`;
}

/** Equivalente en Terraform, para clientes con IaC. */
export function generateAwsTerraformTemplate(params: AwsOnboardingParams): string {
    assertParams(params);
    const roleName = params.roleName || DEFAULT_AWS_ROLE_NAME;
    const prefix = normalizePrefix(params.curPrefix);

    const curStatements = params.curBucket
        ? `
  statement {
    sid       = "LeerManifestYParquetDelCUR"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${params.curBucket}/${prefix}*"]
  }

  statement {
    sid       = "ListarSoloElBucketDelCUR"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${params.curBucket}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${prefix}*"]
    }
  }
`
        : "";

    return `# Rol de solo lectura para CSCloudSolutions FinOps.
# Aplicar con:  terraform init && terraform apply
# Al terminar, pegar el output "role_arn" en CSCloudSolutions.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${params.platformAccountId}:root"]
    }

    # El ExternalId evita el problema del "confused deputy".
    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = ["${params.externalId}"]
    }
  }
}

data "aws_iam_policy_document" "finops_readonly" {
  statement {
    sid       = "LeerCostosDeCostExplorer"
    effect    = "Allow"
    actions   = ["ce:GetCostAndUsage"]
    # Cost Explorer no admite permisos por recurso.
    resources = ["*"]
  }

  statement {
    sid    = "InventarioEC2SoloLectura"
    effect = "Allow"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeVolumes",
      "ec2:DescribeAddresses",
      "ec2:DescribeSnapshots",
    ]
    # Las acciones Describe* de EC2 no admiten permisos por recurso.
    resources = ["*"]
  }

  statement {
    sid    = "LeerPresupuestosNativos"
    effect = "Allow"
    # AWS exige las dos acciones para leer un presupuesto; ninguna permite
    # crearlo ni modificarlo.
    actions = [
      "budgets:DescribeBudgets",
      "budgets:ViewBudget",
    ]
    resources = ["arn:aws:budgets::\${data.aws_caller_identity.current.account_id}:budget/*"]
  }
${curStatements}}

resource "aws_iam_role" "cscloudsolutions_finops" {
  name                 = "${roleName}"
  description          = "Acceso de solo lectura para analisis FinOps de CSCloudSolutions."
  assume_role_policy   = data.aws_iam_policy_document.assume_role.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "cscloudsolutions_finops" {
  name   = "CSCloudSolutionsFinOpsReadOnly"
  role   = aws_iam_role.cscloudsolutions_finops.id
  policy = data.aws_iam_policy_document.finops_readonly.json
}

output "role_arn" {
  description = "Pegar este ARN en CSCloudSolutions para completar la conexion."
  value       = aws_iam_role.cscloudsolutions_finops.arn
}
`;
}

/** Comando de un solo paso, para quien prefiere la CLI antes que la consola. */
export function generateAwsCliSnippet(params: AwsOnboardingParams): string {
    assertParams(params);
    const roleName = params.roleName || DEFAULT_AWS_ROLE_NAME;
    return `# Requiere AWS CLI v2 con credenciales de administrador en la cuenta a conectar.
# Guardar la plantilla CloudFormation como finops-role.yaml y ejecutar:

aws cloudformation deploy \\
  --stack-name cscloudsolutions-finops \\
  --template-file finops-role.yaml \\
  --capabilities CAPABILITY_NAMED_IAM \\
  --parameter-overrides RoleName=${roleName}

# El ARN del rol queda en los outputs del stack:
aws cloudformation describe-stacks \\
  --stack-name cscloudsolutions-finops \\
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" \\
  --output text
`;
}
