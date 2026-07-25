import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';
import {
    generateAwsCloudFormationTemplate,
    generateAwsTerraformTemplate,
    generateAwsCliSnippet,
    isValidAwsAccountId,
    isValidS3BucketName,
    DEFAULT_AWS_ROLE_NAME,
} from '@/lib/awsOnboardingTemplate';

/**
 * El valor de estas plantillas es que otorgan el mínimo privilegio y que el
 * cliente las ejecuta con permisos de IAM. Los tests cubren esas dos cosas:
 * que no se cuele ninguna acción de más, y que no se pueda inyectar estructura
 * a través de los parámetros.
 */

const BASE = {
    platformAccountId: '123456789012',
    externalId: 'ext-0123456789abcdef0123456789abcdef',
};

describe('validadores', () => {
    it('acepta un account id de 12 dígitos y rechaza el resto', () => {
        expect(isValidAwsAccountId('123456789012')).toBe(true);
        expect(isValidAwsAccountId('12345678901')).toBe(false);
        expect(isValidAwsAccountId('1234567890123')).toBe(false);
        expect(isValidAwsAccountId('12345678901a')).toBe(false);
        expect(isValidAwsAccountId('')).toBe(false);
    });

    it('valida nombres de bucket S3', () => {
        expect(isValidS3BucketName('mi-bucket-cur')).toBe(true);
        expect(isValidS3BucketName('MiBucket')).toBe(false);
        expect(isValidS3BucketName('ab')).toBe(false);
    });
});

describe('CloudFormation', () => {
    it('otorga sólo las acciones que la plataforma ejecuta', () => {
        const tpl = generateAwsCloudFormationTemplate(BASE);

        expect(tpl).toContain('ce:GetCostAndUsage');
        expect(tpl).toContain('ec2:DescribeInstances');

        // Las managed policies sobre-permisivas que usaba la UI anterior no
        // pueden reaparecer: son el motivo por el que existe esta plantilla.
        expect(tpl).not.toContain('job-function/Billing');
        expect(tpl).not.toContain('AmazonEC2ReadOnlyAccess');
        expect(tpl).not.toContain('AmazonS3ReadOnlyAccess');

        // Nada de escritura ni de borrado. (`iam:[A-Z]` apunta a acciones como
        // iam:CreateUser; no confundir con el ARN `arn:aws:iam::...:root` del
        // principal de confianza, que es legítimo y necesario.)
        expect(tpl).not.toMatch(/\b(ec2:TerminateInstances|ec2:DeleteVolume|s3:PutObject|s3:DeleteObject|iam:[A-Z])/);
    });

    it('exige el ExternalId en la condición de confianza', () => {
        const tpl = generateAwsCloudFormationTemplate(BASE);
        expect(tpl).toContain('sts:ExternalId');
        expect(tpl).toContain(BASE.externalId);
        expect(tpl).toContain(`arn:aws:iam::${BASE.platformAccountId}:root`);
    });

    it('no incluye permisos de S3 si no hay bucket de CUR', () => {
        const tpl = generateAwsCloudFormationTemplate(BASE);
        expect(tpl).not.toContain('s3:GetObject');
        expect(tpl).not.toContain('s3:ListBucket');
    });

    it('acota S3 al bucket y prefijo del CUR, nunca a "*"', () => {
        const tpl = generateAwsCloudFormationTemplate({
            ...BASE,
            curBucket: 'mi-bucket-cur',
            curPrefix: 'reports',
        });

        expect(tpl).toContain('arn:aws:s3:::mi-bucket-cur/reports/*');
        expect(tpl).toContain('arn:aws:s3:::mi-bucket-cur');
        // El comodín global sobre S3 sería equivalente a AmazonS3ReadOnlyAccess.
        expect(tpl).not.toContain('arn:aws:s3:::*');
    });

    it('normaliza el prefijo termine o no en barra', () => {
        const conBarra = generateAwsCloudFormationTemplate({ ...BASE, curBucket: 'b-cur', curPrefix: 'r/' });
        const sinBarra = generateAwsCloudFormationTemplate({ ...BASE, curBucket: 'b-cur', curPrefix: 'r' });
        expect(conBarra).toContain('arn:aws:s3:::b-cur/r/*');
        expect(sinBarra).toContain('arn:aws:s3:::b-cur/r/*');
    });

    it('usa el nombre de rol por defecto y admite override', () => {
        expect(generateAwsCloudFormationTemplate(BASE)).toContain(DEFAULT_AWS_ROLE_NAME);
        expect(generateAwsCloudFormationTemplate({ ...BASE, roleName: 'OtroRol' })).toContain('OtroRol');
    });
});

describe('rechazo de parámetros inválidos', () => {
    it('rechaza un account id que no sea de 12 dígitos', () => {
        expect(() => generateAwsCloudFormationTemplate({ ...BASE, platformAccountId: 'no-valido' }))
            .toThrow(/12 dígitos/);
    });

    it('rechaza un externalId corto', () => {
        expect(() => generateAwsCloudFormationTemplate({ ...BASE, externalId: 'corto' }))
            .toThrow(/externalId/);
    });

    it('no deja inyectar estructura YAML a través del externalId', () => {
        // Sin validación, esto cerraría la condición y agregaría sentencias
        // propias a una policy de IAM que el cliente ejecuta.
        expect(() => generateAwsCloudFormationTemplate({
            ...BASE,
            externalId: "abc'\n              - Effect: Allow\n                Action: '*",
        })).toThrow(/caracteres no permitidos/);
    });

    it('no deja inyectar a través del bucket ni del prefijo', () => {
        expect(() => generateAwsCloudFormationTemplate({ ...BASE, curBucket: 'bucket"raro' }))
            .toThrow(/bucket/);
        expect(() => generateAwsCloudFormationTemplate({ ...BASE, curBucket: 'ok-bucket', curPrefix: 'a"b' }))
            .toThrow(/curPrefix/);
    });

    it('rechaza un roleName inválido para IAM', () => {
        expect(() => generateAwsCloudFormationTemplate({ ...BASE, roleName: 'rol con espacios y $' }))
            .toThrow(/roleName/);
    });
});

describe('Terraform', () => {
    it('refleja exactamente los mismos permisos que CloudFormation', () => {
        const tf = generateAwsTerraformTemplate({ ...BASE, curBucket: 'b-cur', curPrefix: 'r' });

        expect(tf).toContain('"ce:GetCostAndUsage"');
        expect(tf).toContain('"ec2:DescribeInstances"');
        expect(tf).toContain('"ec2:DescribeVolumes"');
        expect(tf).toContain('"budgets:DescribeBudgets"');
        // El ARN del presupuesto se resuelve en Terraform, no en el generador:
        // si se interpolara acá saldría vacío.
        expect(tf).toContain('${data.aws_caller_identity.current.account_id}');
        expect(tf).toContain('"s3:GetObject"');
        expect(tf).toContain('arn:aws:s3:::b-cur/r/*');
        expect(tf).toContain('sts:ExternalId');
        expect(tf).not.toContain('AmazonS3ReadOnlyAccess');
    });

    it('aplica las mismas validaciones', () => {
        expect(() => generateAwsTerraformTemplate({ ...BASE, platformAccountId: '1' })).toThrow();
    });
});

describe('CLI', () => {
    it('despliega el stack con capacidad de IAM nombrado', () => {
        const cli = generateAwsCliSnippet(BASE);
        expect(cli).toContain('CAPABILITY_NAMED_IAM');
        expect(cli).toContain('cloudformation deploy');
    });
});

describe('el YAML generado es sintácticamente válido', () => {
    // Una plantilla mal indentada parece correcta al leerla y falla recién
    // cuando el cliente la sube a CloudFormation. Ya pasó una vez: el bloque
    // del CUR se interpolaba con menos indentación que las sentencias base.
    const parse = (tpl: string) => {
        // CloudFormation usa tags cortos (!Ref, !GetAtt) que el parser estricto
        // desconoce; se registran como strings para poder validar la estructura.
        const schema = yaml.DEFAULT_SCHEMA.extend(
            ['scalar', 'sequence', 'mapping'].map(
                (kind) => new yaml.Type('!', {
                    kind: kind as 'scalar' | 'sequence' | 'mapping',
                    multi: true,
                    construct: (data) => data,
                })
            )
        );
        return yaml.load(tpl, { schema }) as Record<string, never>;
    };

    it('parsea sin bucket de CUR', () => {
        expect(() => parse(generateAwsCloudFormationTemplate(BASE))).not.toThrow();
    });

    it('parsea con bucket de CUR y expone exactamente los permisos mínimos', () => {
        const doc = parse(generateAwsCloudFormationTemplate({
            ...BASE, curBucket: 'mi-bucket-cur', curPrefix: 'reports',
        })) as unknown as {
            Resources: Record<string, {
                Properties: {
                    Policies: Array<{ PolicyDocument: { Statement: Array<{ Action: string[]; Resource: string }> } }>;
                    AssumeRolePolicyDocument: { Statement: Array<{ Condition: Record<string, Record<string, string>> }> };
                };
            }>;
        };

        const role = doc.Resources.CSCloudSolutionsFinOpsRole;
        const statements = role.Properties.Policies[0].PolicyDocument.Statement;
        const actions = statements.flatMap((s) => s.Action).sort();

        // Lista cerrada a proposito: es el guardian del menor privilegio. Cada
        // accion que se agregue tiene que corresponder a una llamada que el
        // codigo ya ejecuta, no a una feature planificada.
        expect(actions).toEqual([
            'budgets:DescribeBudgets',  // getAwsNativeBudgets
            'budgets:ViewBudget',       // idem: AWS exige las dos para leer
            'ce:GetCostAndUsage',
            'ce:GetReservationPurchaseRecommendation', // getAwsRateRecommendations: RI
            'ce:GetSavingsPlansPurchaseRecommendation', // idem: Savings Plans       // sync de Cost Explorer
            'ec2:DescribeAddresses',    // getAwsZombies: IPs elasticas sueltas
            'ec2:DescribeInstances',    // inventario EC2
            'ec2:DescribeSnapshots',    // getAwsZombies: snapshots antiguos
            'ec2:DescribeVolumes',      // getAwsZombies: EBS sin adjuntar
            's3:GetObject',             // manifest y Parquet del CUR
            's3:ListBucket',            // localizar el manifest del CUR
            'tag:GetResources',         // inventario transversal por etiquetas
            'tag:GetTagKeys',           // claves de etiqueta en uso
        ]);

        // Ninguna accion de escritura: el rol no puede crear, modificar ni
        // borrar nada en la cuenta del cliente.
        for (const a of actions) {
            expect(a).not.toMatch(/:(Create|Update|Delete|Put|Modify|Terminate|Stop|Start|Release|Detach)/);
        }

        const s3Statements = statements.filter((s) => s.Action.some((a) => a.startsWith('s3:')));
        for (const s of s3Statements) {
            expect(s.Resource).toContain('mi-bucket-cur');
        }

        expect(role.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['sts:ExternalId'])
            .toBe(BASE.externalId);
    });
});
