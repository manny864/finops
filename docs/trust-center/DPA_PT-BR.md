# Acordo de Tratamento de Dados (DPA)

Acordo de Tratamento de Dados em conformidade com o Artigo 28 do RGPD

## 1. Definições (Art. 4º, RGPD)
- Controlador: a organização do cliente, que determina as finalidades e os meios do tratamento de dados pessoais.
- Operador: a CSCloudSolutions, que trata dados pessoais em nome do cliente.
- Dados pessoais: qualquer informação relacionada a uma pessoa natural identificada ou identificável.
- Tratamento: qualquer operação realizada sobre dados pessoais (coleta, registro, análise, eliminação, etc.).

## 2. Objeto e Duração (Art. 28(3))
- Objeto: tratamento de dados de custo do Azure e metadados associados.
- Duração: durante a vigência da assinatura com a CSCloudSolutions. O tratamento cessa após a rescisão, salvo exigência legal.
- Natureza: armazenamento, análise e elaboração de relatórios de dados de faturamento e governança do cliente.
- Finalidade: prestar serviços de otimização FinOps, análise de custos e governança.

## 3. Categorias de Titulares e Dados Pessoais (Art. 28(3)(a))
**Titulares dos dados:**
- Funcionários do cliente com assinaturas do Azure
- Proprietários de recursos e administradores
- Usuários finais do cliente aos quais os custos são atribuídos

**Categorias de dados pessoais:**
- Endereços de e-mail e nomes de exibição
- IDs de objeto do Azure AD (OID)
- Tags de recursos contendo identificadores de usuário
- Padrões de uso e atribuição de custos

## 4. Subprocessadores (Art. 28(2) e (4))
A CSCloudSolutions contrata os seguintes subprocessadores. Você é notificado sobre alterações e pode se opor no prazo de 30 dias.

| Subencargado | Finalidad |
|---|---|
| Microsoft Azure | Computação e Armazenamento |
| MySQL Provider | Hospedagem de Banco de Dados |
| Paddle | Processamento de Pagamentos |
| WorkOS | Autenticação/SSO |

## 5. Direitos dos Titulares (Art. 28(3)(e))
Auxiliamos você no atendimento a solicitações de titulares de dados nos termos dos Artigos 15 a 22 do RGPD (acesso, retificação, eliminação, restrição, portabilidade, oposição). As solicitações devem ser enviadas para privacy@cscloudsolutions.com.ar dentro de 10 dias úteis.

## 6. Medidas de Segurança (Art. 28(3)(c) e 32)
A CSCloudSolutions implementa:
- Criptografia: TLS 1.2+ em trânsito; AES-256 em repouso
- Controle de acesso: RBAC, integração com MSAL/Entra ID, MFA obrigatório
- Monitoramento: monitoramento de segurança contínuo e detecção de intrusões
- Registros de auditoria: todo acesso é registrado e retido por 7 anos
- Recuperação de desastres: backups geo-redundantes; RTO < 4 horas

## 7. Direitos de Auditoria (Art. 28(3)(h))
Você (ou um auditor independente) pode realizar auditorias das práticas de segurança e conformidade da CSCloudSolutions. Relatórios de auditoria SOC 2 Tipo II anuais estão disponíveis mediante solicitação para clientes Enterprise.

## 8. Devolução/Eliminação de Dados (Art. 28(3)(g))
Após a rescisão da assinatura, você pode solicitar a eliminação dos dados dentro de 30 dias. Todos os dados serão excluídos permanentemente por meio de apagamento criptográfico. Os backups são retidos para recuperação de desastres e excluídos após 90 dias.

## Anexo 1: Tabela de Subprocessadores
Veja a lista completa de Subprocessadores (finops.cscloudsolutions.com/legal/subprocessors).

## Anexo 2: Medidas Técnicas e Organizacionais (TOMs)
- Medidas técnicas: criptografia, firewalls, IDS/IPS, SIEM, práticas de codificação segura
- Medidas organizacionais: controles de acesso, treinamento de funcionários, plano de resposta a incidentes, avaliação de fornecedores
- Detalhes disponíveis no relatório SOC 2 Tipo II mediante solicitação.

---
Última atualização: 7/28/2026
