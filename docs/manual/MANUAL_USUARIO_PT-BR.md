<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">Manual do Usuário</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Versão 2.1 · Outubro 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. Todos os direitos reservados.</p>
</div>

# 📘 Manual do Usuário — FinOps SaaS (CSCloudSolutions)

**Versão:** 2.1 (detalhada)
**Idioma:** Português Brasileiro
**Última atualização:** Outubro 2026
**Público:** usuários técnicos (Cloud Admin, DevOps, FinOps Analyst) e não técnicos (financeiro, gerência, product owners)

---

## Atualizações recentes (Setembro – Outubro 2026)

- **Perspectives e alcance por equipe.** Agora você cria Perspectives pela tela —por Tag, Padrão de nome, Assinatura, Grupo de recursos ou Tipo de recurso—, vê quanto do gasto cai dentro de cada grupo e restringe com um seletor transversal os painéis de Cost Groups, Centros de Custo, Gastos e Projeção, Armazenamento, o Whiteboard e o simulador What-If. Um Admin também pode **atribuir um alcance a um usuário** em **Usuários e Acessos**: a API devolve só a sua parcela, não é um filtro de tela (5.3 e 8.2). As **Visões salvas** lembram uma combinação de alcance para voltar a ela com um clique, e podem ser **compartilhadas com a equipe** ou marcadas como **padrão** (3.4).
- **Leaderboard de times e margem bruta.** Um ranking que ordena por melhoria —não por quem gasta menos—, a divisão custo dos produtos vendidos (COGS) / despesa operacional (OpEx) —cada grupo é classificado na própria tabela— e a margem bruta quando você carrega a receita (5.2).
- **Assinaturas de relatórios.** A aba **Assinaturas** de Relatórios e Exportação envia o relatório por e-mail na cadência que você escolher, com link, gráfico e CSV (8.6).
- **Ano fiscal e transferência de orçamento.** O exercício do tenant deixa de estar fixo em janeiro —escolhe-se em **Configuração → Geral**— e um orçamento pode transferir ao mês seguinte o que não foi gasto, com teto, na própria tabela de orçamentos (5.1.5).
- **Maturidade FinOps.** Você escolhe se na pontuação vale a autoavaliação da equipe, a telemetria do Azure ou uma média, e cada dimensão mostra as duas leituras (4.4).
- **Fim de suporte.** O que roda sobre uma versão que o Azure aposenta, quando, e quanto custa hoje: AKS, PostgreSQL e MySQL Flexible Server (7.9).
- **Compromissos.** Aviso de concentração de vencimentos, **ESR** (taxa efetiva de economia), simulador de ponto de equilíbrio com mix ótimo, controle do limite anual de devoluções de reservas e **avisos automáticos 90, 60 e 30 dias antes do vencimento de cada reserva** (5.4.4).
- **Shift-Left FinOps.** O custo de um `terraform plan` dentro do Pull Request, antes do merge, com limites por repositório; fica em **Governança → Shift-Left (PRs)** (7.10).
- **Cosmos DB com telemetria real** e otimizador de RU/s: manual vs autoscale vs serverless, e partições quentes (5.5).
- **Redes: Tráfego e egress, e Capacidade de enlaces** (ExpressRoute e VPN superdimensionados) (5.8).
- **Azure Virtual Desktop** dentro de Computação: host pools, session hosts, perfis FSLogix e custo por usuário (5.6).
- **Armazenamento** como hub próprio: Storage Accounts, Managed Disk, Backups e Data Lake Gen2 (5.7).
- **Whiteboard com intervalo de tempo:** mês atual, últimos 30 dias ou últimos 90 dias, com o histórico guardado na base da plataforma (4.1).
- **Marketplace de módulos e capacidades à la carte**, para somar uma função ou uma cota sem mudar de plano (8.10).
- **FinOps Copilot com conversa contínua** entre páginas e botão **Nova conversa** (9).
- **App móvel (PWA)** com Resumo, Alertas, Aprovações, Suporte e Perfil (11.12).
- **Anomalias com responsável e acompanhamento** (14) e **assinaturas fora do limite do seu plano** (15).
- **Anomalias: o que mudou e explicação com IA.** Em **Detecção de Anomalias** (Enterprise), **Ver Causa Raiz** mostra qual medidor do serviço subiu e se foi por consumo, por preço ou por algo novo, com os passos a verificar. A IA pode contar isso em palavras. O detalhe chega pela sincronização com o Azure e também pelos exports de custos (14.4).
- **CSV que não está no formato FOCUS:** agora **todas** as linhas são processadas. A IA só identifica as colunas e a plataforma lê os valores. O relatório com IA do envio sai no seu idioma e na moeda do arquivo, e se a IA não estiver disponível você vê um resumo por serviço (5.1.7).
- **Etiquetas com valores não conformes.** Em **Governança de Etiquetas**, Environment e Role têm uma lista de valores permitidos. **Valores Não Conformes** encontra os que não a cumprem, como `Production` ou `PRD`, e sugere o correto: primeiro por regra e, para o que a regra não resolve, com IA. Você confirma e ele é corrigido no Azure. Por isso o % de conformidade pode cair sem que nada mude no Azure (7.1.1).

**Novidades de agosto 2026**

- **Novo módulo Azure Integration Services (iPaaS):** hub com abas de Logic Apps, APIM, Service Bus, Event Grid, Event Hubs e ADF.
- **Conectores Enterprise em Logic Apps:** seção dedicada para distinguir conectores Standard vs Enterprise e seu impacto operacional/custo.
- **IA Enterprise (Azure IA):** a configuração global de IA suporta **endpoint URL** + deployment para Azure IA em vez de depender só do nome do recurso.
- **Padrão de tabelas FinOps/CMP (SaaS):** todas as tabelas do padrão incluem filtros base (**Recurso, Região, Tipo, Grupo de recursos**), ordenação (A-Z/Z-A/custo), paginação **15/30/45/60**, design responsivo, largura total e colunas redimensionáveis.
- **Monitoramento e Segurança homologados:** usam o mesmo padrão visual/operacional de Bancos de Dados e Computação, com foco em leitura rápida para decisões FinOps.
- **AI Cost Analytics corrigido:** o painel de Microsoft Foundry/Azure OpenAI prioriza consumo real, mantém a tendência MTD desde o dia 1 do mês e corrige inconsistências de cache/fontes.
- **Cron de pré-aquecimento de Segurança:** `GET /api/cron/prewarm-security-finops` pré-aquece Defender + famílias de Segurança para acelerar o carregamento.
- **Inteligência de Bancos de Dados reforçada:** Redis, MySQL, PostgreSQL, Cosmos DB, MongoDB e SQL/Managed Instance mostram estado e métricas com fallback por métrica para evitar `N/A/unknown` por telemetria parcial do Azure.
- **Refresh visual de navegação e módulos FinOps:** cartões-chave de Inteligência, Consumo, Governança, Cleanup, Overview e Copilot M365 migraram para iconografia Tabler e cabeçalhos sem fundo azul.

## Como usar este manual

Cada seção explica **o que é** a funcionalidade, **quem** pode usá-la (papel e tier de assinatura), e o **fluxo de uso passo a passo** — botões concretos, rotas de URL, campos de formulário e o resultado esperado. Se você é usuário não técnico, pode ir direto à seção que precisa: cada uma é independente.

---

## 📑 Índice

1. [Primeiros Passos](#1-primeiros-passos)
2. [Papéis e Permissões](#2-papéis-e-permissões)
3. [Navegação Principal](#3-navegação-principal)
4. [Seção Visibilidade](#4-seção-visibilidade)
5. [Seção Inteligência Financeira](#5-seção-inteligência-financeira)
6. [Seção Limpeza de Nuvem](#6-seção-limpeza-de-nuvem)
7. [Seção Governança](#7-seção-governança)
8. [Seção Administração](#8-seção-administração)
9. [FinOps Copilot (assistente de IA)](#9-finops-copilot-assistente-de-ia)
10. [Segurança da Conta (MFA)](#10-segurança-da-conta-mfa)
11. [Funcionalidades Avançadas e Integrações](#11-funcionalidades-avançadas-e-integrações)
12. [Melhores Práticas](#12-melhores-práticas)
13. [Avisos da plataforma](#13-avisos-da-plataforma)
14. [Anomalias de gasto: quem as atende](#14-anomalias-de-gasto-quem-as-atende)
15. [Assinaturas fora do limite do seu plano](#15-assinaturas-fora-do-limite-do-seu-plano)

---

## 1. Primeiros Passos

### 1.1. Acesso e login

A plataforma é um SaaS B2B. A autenticação é integrada ao **Microsoft Entra ID** (Azure Active Directory):

1. Acesse a URL da plataforma.
2. Clique em **"Entrar com Microsoft"**.
3. Autentique-se com sua conta corporativa. A plataforma reconhece automaticamente seu tenant do Azure e sua identidade.
4. **Modo Demo:** se quiser testar a plataforma sem conectar seu ambiente real, escolha um dos perfis comerciais pré-configurados na tela principal — eles vêm com dados e métricas simuladas realistas, para você explorar cada módulo sem risco. As credenciais da demo são `demo` / `demo`.

### 1.2. O assistente de onboarding (primeira vez)

Se você é administrador e é a primeira vez que sua organização usa a plataforma, ao fazer login o **Assistente de Configuração** (`/onboarding`) abre automaticamente — um wizard linear de 5 passos com barra de progresso:

| Passo | O que você faz | Resultado |
|---|---|---|
| **1. Boas-vindas e dados da empresa** | Confirma nome da empresa, provedor de nuvem principal (Azure), moeda de exibição (USD/EUR/GBP) e fuso horário | Suas preferências iniciais são salvas |
| **2. Conectar assinatura do Azure** | Cola **Client ID**, **Client Secret** e **Azure Tenant ID** do Service Principal (gerado com o script PowerShell fornecido pela CSCloudSolutions) e clica em **"Validar"** | O sistema verifica em tempo real se o Service Principal tem os papéis mínimos necessários; se faltar algum, mostra em vermelho qual é |
| **3. Executar a primeira sincronização de dados** | Clica em **"Executar Sincronização"** | Traz seu primeiro conjunto de dados de custos do Azure (pode levar até 60 segundos) |
| **4. Criar seu primeiro orçamento** | Preenche nome, limite mensal ($) e limite de alerta (%) | Seu primeiro orçamento ativo é criado |
| **5. Configurar notificações** | Clica em **"Configurar"** (abre `/admin/notifications` em nova aba) | Adiciona pelo menos um canal (email, Slack ou Teams) para receber alertas |

Você pode **pular (skip)** qualquer passo e voltar depois — o wizard continua aparecendo até você completar ou pular os 5. O progresso (%) é calculado como `(completos + pulados) / 5 × 100`. Se preferir o formulário de configuração avançada em vez do wizard, `/admin/onboarding` continua disponível em paralelo.

### 1.3. Verificação da conexão com o Azure

Quando você conecta sua assinatura do Azure (passo 2 do assistente de onboarding, ou em `/admin/onboarding`), o Service Principal precisa ter certos papéis do Azure atribuídos para que a plataforma consiga ler seus dados de custos. Esta seção ajuda você a verificar e diagnosticar essa conexão.

**Papéis do Azure necessários, por tier contratado:**

| Tier | Papéis built-in | Papel personalizado (*CSCloudSolutions Remediation Role*) |
|---|---|---|
| Professional (piso da plataforma) | Reader, Cost Management Reader, Monitoring Reader, Billing Reader, Security Reader e, no nível do tenant, Reservations Reader | — (somente leitura) |
| Business | Professional + Tag Contributor | Ligar, desligar, reiniciar e desalocar VMs; gravar tags; gerenciar orçamentos do Azure; e **excluir** os recursos órfãos que a Limpeza de Nuvem detecta (VMs, discos, snapshots, planos do App Service, NICs, IPs públicos, NSGs e os demais tipos de rede de Zumbis de Rede) |
| Enterprise | Business + Monitoring Contributor | Business + criar grupos de recursos |

Além disso, o script concede à identidade **permissões de leitura do Microsoft Graph** em todos os planos (`Directory.Read.All`, `Reports.Read.All`, `User.Read.All` e `Organization.Read.All`) e, conforme o plano: `Application.ReadWrite.OwnedBy` (Business+, para rotacionar segredos: só alcança as App Registrations das quais a identidade é *owner*), `AuditLog.Read.All` (Enterprise, atividade de login para *Usuários e Licenças*) e `ExternalConnection.ReadWrite.OwnedBy` (Enterprise, conector do Copilot M365).

**Reservations Reader** é atribuído em `/providers/Microsoft.Capacity`, no nível do tenant e não por assinatura: sem ele, as reservas não aparecem em Otimização e Economia e os seus avisos de vencimento não chegam. Atribuí-lo exige ser *Reservations Administrator*, ou Owner / User Access Administrator nesse escopo; se o script o marcar como `[FAIL]`, alguém com essa permissão tem que atribuí-lo.

> ⚠️ **Reader, Cost Management Reader, Monitoring Reader e Billing Reader são o mínimo absoluto** para que a página Consumo Real mostre dados. Se faltar `Cost Management Reader` ou `Billing Reader`, o Azure retorna 0 linhas silenciosamente. O `Security Reader` soma a leitura da postura de segurança (Defender/WAF).

> ℹ️ **AI Cost Analytics (Microsoft Foundry / Azure OpenAI)** usa os mesmos papéis base (`Reader`, `Cost Management Reader`, `Monitoring Reader`, `Billing Reader`): **não requer papel adicional**.

> ⚠️ **Assinaturas EA/MCA** (Enterprise Agreement / Microsoft Customer Agreement) exigem que o Billing Admin do cliente atribua também `Enrollment Reader` ou `Billing Account Reader` ao Service Principal no escopo da billing account — o script não pode fazer isso automaticamente, precisa ser coordenado com o cliente.

**Verificar se as permissões foram atribuídas corretamente**, depois que o cliente executar o script:

- **Opção rápida (recomendada):** `GET /api/admin/check-sp-roles?tenantId=<tenant-id>` — retorna quantas assinaturas têm todos os papéis necessários ✅, quais estão incompletas ⚠️ e quais não têm nenhum papel ❌, com o detalhe do que falta em cada uma.
- **Opção manual:** no Azure Portal → Assinatura → **Access control (IAM)** → **Role assignments** → filtre pelo App Registration `CSCloudSolutions-FinOps-Agent` e confirme que aparecem os papéis do tier contratado.

**Troubleshooting — "Consumo Real não mostra dados":**

| Mensagem de erro | Causa | Solução |
|---|---|---|
| `NO_COST_PERMISSION` | Falta `Cost Management Reader` | Atribuir o papel ao SP nessa assinatura |
| `NO_SUBSCRIPTION_ACCESS` | Falta `Reader` | Atribuir `Reader` ou reexecutar o script |
| `SUBSCRIPTION_INACTIVE` | A assinatura não tem consumo nem no mês atual nem nos últimos 30 dias | Verificar se é a assinatura correta |
| `NO_SUBSCRIPTIONS` | O SP não vê nenhuma assinatura | Atribuir `Reader` em pelo menos uma |
| `NO_CONSUMPTION` | Tudo OK mas sem consumo no ciclo atual | Aguardar o fechamento do ciclo ou verificar outra assinatura |

### 1.4. Nota operacional

A gestão comercial e de associação de partner (PAL/CPOR) é administrada internamente pela CSCloudSolutions e não exige ações dos usuários finais do tenant.

---

## 2. Papéis e Permissões

A plataforma separa **dois conceitos independentes**, que se combinam mas não se substituem:

### 2.1. Papel (o que você PODE FAZER)

| Papel | Capacidade |
|---|---|
| **Owner** | Dono do tenant. Acesso completo, incluindo mudança de plano e faturamento. |
| **Admin** | Visibilidade financeira completa, mudanças de configuração, ações corretivas (desligar VMs, excluir recursos). |
| **Colaborador** | Vê inteligência financeira e visibilidade; pode sugerir mudanças mas não administra faturamento nem usuários. |
| **Reader** | Somente leitura em painéis e relatórios. Não aplica mudanças nem vê configuração sensível. |

### 2.2. Permissões de domínio (quais páginas você VÊ)

Além do papel, cada usuário pode ter uma ou mais **permissões de domínio** atribuídas, que determinam quais seções do menu lateral ele vê — independente do papel:

| Permissão | Para quem serve | O que habilita ver |
|---|---|---|
| **FinOps** | Analista FinOps | Páginas de custos e recomendações |
| **CloudAdmin** | Administrador de nuvem | Páginas de execução/escrita sobre infraestrutura |
| **Security** | Auditor de segurança | Auditoria de conformidade, credenciais, governança |
| **ProductOwner** | Líder de projeto/produto | Visibilidade por Centro de Custos ou aplicação |

**Como se combinam:** um usuário com papel **Reader** e permissão **FinOps** pode *ver* as páginas de FinOps, mas não pode modificar nem excluir nada nelas — o papel continua controlando as ações. O filtro por permissões é opcional: se um usuário não tiver nenhuma permissão atribuída, ele vê tudo que seu papel e tier permitem (comportamento padrão, sem restrição de domínio). Os papéis **Admin/Owner** sempre veem tudo que seu tier permite, independente das permissões atribuídas. O **Dashboard** (`/`) e o **Suporte** (`/support`) estão sempre visíveis para todos.

**Como atribuir permissões:** vá em `/admin/users` → selecione o usuário → ative/desative os toggles de permissão na tabela, ou atribua ao criar um usuário novo manualmente. (Nota: usuários importados em massa do Entra ID ficam sem permissões atribuídas por padrão — atribua depois pela tabela principal.)

> ⚠️ As permissões de domínio **não** habilitam ações de escrita no backend — isso continua sendo controlado exclusivamente pelo papel. Um usuário com permissão `CloudAdmin` mas papel `Reader` pode *ver* essas páginas, mas qualquer ação de escrita retornará erro 403 se o papel não autorizar.

---

## 3. Navegação Principal

O menu lateral esquerdo agrupa tudo em 5 pilares (seções recolhíveis — a seção da página ativa se expande automaticamente):

- **Visibilidade** — Whiteboard, Academia FinOps, Azure Advisor, Maturidade FinOps, Progresso Histórico, TOP Despesas, Recursos, Green FinOps, Economia Capturada e Vazamentos Financeiros.
- **Inteligência Financeira** — Consumo e Orçamento, Leaderboard de times, Perspectives, Otimização e Economia, Bancos de Dados, Computação, Armazenamento, Redes, Usuários e Licenças, Azure AI, Azure Integration Services, Monitoramento, Segurança e Analítica Avançada.
- **Limpeza de Nuvem** — Recursos Zumbi, Zumbis de Rede, Expirações TTL e Backups Órfãos.
- **Governança** — Conformidade de Tags, Alertas Self-Service, Agendas de Desligamento, Políticas Auto-Block, Relatórios de Governança, Alta Disponibilidade, Fim de suporte, Shift-Left (PRs), Credenciais a Expirar e Aprovações.
- **Administração** — Suporte, Usuários e Acessos, Configuração, Relatórios e Exportação, Integrações e API, Faturamento e Auditoria e Marketplace.

**O que você vê depende de três coisas:** seu **plano** (cada tela indica a partir de qual está disponível), seu **papel** (o que você pode fazer) e suas **permissões de domínio** (quais páginas aparecem para você). O que o seu plano não inclui aparece marcado com um cadeado e um aviso de upgrade, ou pode ser adicionado avulso no **Marketplace** (8.10).

Uma **busca** no topo do menu lateral permite encontrar páginas pelo nome sem navegar pelas categorias, e só lista o que você pode abrir.

### 3.1. Botão "Histórico" — evolução temporal de qualquer métrica

No Dashboard, Descontos por Compromisso, Rightsizing, Anomalias, Orçamentos, Alta Disponibilidade e Governança de Etiquetas você vai encontrar um botão **Histórico** no canto superior direito. Ao abri-lo:

1. Escolhe um intervalo de datas (até **1 ano atrás**).
2. Vê a evolução diária das métricas daquela página como **gráfico de linhas** e **tabela**.

A plataforma salva automaticamente uma foto diária de cada página (retenção de ~13 meses) — você não precisa ativar nada, já está rodando em segundo plano.

### 3.2. Seu perfil

Clique no seu **avatar** (círculo com sua inicial, canto superior direito) para abrir:

- **Nome completo** — editável com o ícone de lápis.
- **Email e papel** dentro do tenant (somente leitura).
- **Moeda de exibição** — seletor de moeda.
- **Aparência** — Claro / Escuro / Automático (segue o tema do sistema operacional).
- **Sair.**

### 3.3. Hubs com abas

Muitas entradas do menu são **hubs**: uma tela com abas que agrupa as visões de um mesmo tema. Você entra pelo hub e se move entre as abas sem voltar ao menu; a aba ativa fica na URL, então você pode compartilhar o link exato. São hubs, entre outros, **Consumo e Orçamento**, **Otimização e Economia**, **Bancos de Dados**, **Computação**, **Armazenamento**, **Redes**, **Monitoramento**, **Segurança**, **Azure AI**, **Azure Integration Services**, **Analítica Avançada** e, em Administração, **Usuários e Acessos**, **Configuração**, **Relatórios e Exportação**, **Integrações e API** e **Faturamento e Auditoria**.

As URLs anteriores aos hubs (por exemplo `/intelligence/billing` ou `/admin/users`) continuam funcionando: abrem a mesma tela ou redirecionam para a aba correspondente, então os favoritos antigos não quebram.

### 3.4. A barra de alcance: assinatura, Perspective e Visões

No cabeçalho há três seletores que restringem o que os painéis mostram:

- **Alcance (tenant e assinatura).** Você escolhe o tenant inteiro ou uma assinatura do Azure. Se sua organização tem mais de um tenant, você também troca de tenant daqui.
- **Perspective e grupo.** Aparece só se o seu plano é Enterprise e o tenant tem Perspectives definidas (5.3). Você escolhe uma Perspective e um grupo —por exemplo *Times → Engenharia*— e os painéis que suportam isso mostram só essa parcela do gasto. A escolha viaja na URL: pode ser compartilhada por link e sobrevive a um refresh.
- **Visões** (ícone de marcador). Com uma Perspective escolhida, *Salvar a visão atual…* lembra a combinação —Perspective e grupo— com o nome que você der, e você a aplica de novo com um clique no mesmo seletor. Ao salvá-la você pode marcá-la para **abrir por padrão ao entrar** —aplica-se sozinha quando a URL não indica um alcance— e, se for Admin ou Owner, **compartilhá-la com toda a equipe**. A estrela de cada visão a marca ou desmarca como padrão. As compartilhadas são vistas por todo o tenant e só Admin e Owner as alteram ou excluem. Se houver uma padrão sua e outra da equipe, vale a sua. O seletor só é mostrado quando há visões salvas ou uma Perspective ativa para salvar.

> Se a sua conta tem um **alcance atribuído** por um Admin (8.2), o seletor de Perspective fica fixo no seu grupo, com cadeado, e o de Visões não é mostrado: o seu recorte não é escolhido, salvo nem alterado por você.

### 3.5. Atalhos e app móvel

- **Paleta de comandos:** `⌘K` (Mac) ou `Ctrl+K` (Windows/Linux) abre uma busca de telas, ações rápidas e também de recursos do seu ambiente (digite pelo menos dois caracteres).
- **Manual:** o ícone de ajuda (**?**) do cabeçalho abre este manual em PDF, no idioma que você tiver ativo.
- **Celular:** em telas estreitas a plataforma oferece uma experiência móvel dedicada (11.12).

---

## 4. Seção Visibilidade

### 4.1. Dashboard (White Board)

Seu painel executivo de entrada. Reúne Custo Atual, forecast, Recursos Zumbi, Economia Potencial e Impacto Ambiental, junto com orçamentos, serviços dominantes, governança, Advisor e Quick Wins.

**Como usar:**
1. Escolha o **período** no seletor do cabeçalho: **Mês Atual (MTD)**, **Últimos 30 dias** ou **Últimos 90 dias**. O mês atual é consultado ao vivo no Azure Cost Management (com a base da plataforma como respaldo se o Azure não responder); os intervalos de 30 e 90 dias são lidos do histórico que a plataforma guarda toda noite, então respondem na hora e não gastam cota de consultas do Azure. O cartão de custo principal muda de rótulo conforme o intervalo.
2. Confira a barra de sincronização e use **Atualizar** para ignorar o cache e consultar o ciclo vigente.
3. Compare o gasto com os orçamentos por centro de custos e ajuste a taxa do forecast de 12 meses.
4. Fixe/desafixe widgets pelo ícone de pin para levá-los a **Meu Dashboard**.
5. Em **Top Quick Wins**, escolha **Otimizar** para abrir o modal de remediação com scripts CLI, PowerShell e Terraform.

O Whiteboard respeita o **alcance** da barra superior (3.4): com uma Perspective e um grupo escolhidos, os números são os dessa parcela do gasto.

### 4.2. Gastos e Projeção (aba do hub Consumo e Orçamento, plano Enterprise)

Esta tela vive como aba do hub **Consumo e Orçamento** e é descrita em 5.1.6. O Dashboard mostra um cartão-resumo do mesmo conteúdo com o link **"Ver detalhe completo"**.

### 4.3. Azure Advisor

Sincronização direta com as recomendações nativas da Microsoft, classificadas em Custo, Segurança, Confiabilidade, Desempenho e Excelência Operacional. As recomendações são exibidas no idioma que você tem ativo na plataforma (não no idioma original do Azure).

**Como usar:** filtre por categoria, revise o impacto potencial de economia de cada recomendação, execute a remediação ou gerencie seu ciclo de vida:
- **Adiar por 30 ou 90 dias:** Se a otimização necessita de validação prévia ou de uma janela de manutenção futura. A recomendação desaparece das listas ativas e não soma às economias pendentes nem conta como aberta no **Índice de Otimização (COIN)**. Ao expirar o prazo, a plataforma a reabre automaticamente se continuar pendente.
- **Descartar (Permanente):** Se a recomendação não se aplica à arquitetura da sua organização. Passa ao estado *Descartada* por tempo indeterminado e não volta a aparecer nas listas ativas.

> ℹ️ **Esclarecimento sobre o escopo do descarte em relação ao Portal do Azure:**
> - **Sincronização Azure → Plataforma:** Se você suprimir uma recomendação diretamente no Portal do Microsoft Azure, nossa plataforma a detecta automaticamente e a oculta na interface.
> - **Governança Plataforma → Azure:** Ao suprimir ou descartar a partir da plataforma FinOps, a ação é registrada e governada no banco de dados do tenant sob o princípio do menor privilégio (sem exigir permissões de escrita no Azure). Por este motivo, a recomendação **poderá continuar visível no Portal nativo do Azure**, enquanto na plataforma FinOps permanece formalmente suprimida, auditada e fora dos cálculos de economia.

### 4.3.1. Azure AI Document Intelligence

Em `Inteligência Financeira → Azure AI → Document Intelligence`, revise custo MTD, páginas processadas, uso Prebuilt/Custom e horas de treinamento. Selecione MTD/30D/90D, filtre a tabela por modelo, Resource Group ou assinatura e abra **Otimizar** para avaliar Commitment Tier, F0 ou migração Custom→Prebuilt. Um tenant real sem contas mostra estado vazio e nunca dados demo.

### 4.4. Maturidade FinOps

Posiciona sua organização em **Engatinhar / Caminhar / Correr** —o modelo Crawl-Walk-Run da FinOps Foundation— em seis dimensões: Visibilidade e Informação, Otimização de Taxa, Otimização de Uso, Governança e Alocação, Automação e Cultura FinOps. O radar mostra a pontuação de cada uma (Engatinhar abaixo de 40, Caminhar de 40 a 75, Correr acima de 75), com o roteiro dos próximos marcos.

Cada dimensão tem **duas leituras**: a **telemetria** que a plataforma mede no seu Azure e a **autoavaliação** que a equipe preenche com **Refazer Avaliação** (uma pergunta por dimensão). Quando existem as duas, a linha as mostra juntas (*Equipe 70 · Azure 45*), e se elas se afastam mais de 20 pontos o plano de ação o sinaliza: ou a equipe está se dando por madura sem evidência, ou há capacidades implementadas que ninguém documentou.

**Como a pontuação é calculada.** Acima do radar escolhe-se qual leitura vale. Admin e Owner a escolhem; os demais veem qual está ativa.

| Opção | O que faz | Para quem |
|---|---|---|
| **Vale a autoavaliação da equipe** (padrão) | A pontuação de cada dimensão é o que a equipe declarou | Uma equipe em adoção, que quer medir a própria leitura |
| **Vale a telemetria do Azure** | A pontuação é o medido; o declarado fica como contraste | Um cliente auditado, onde o declarado não basta |
| **Média 50/50** | Metade de cada leitura | Um meio-termo |

Alterá-la recalcula o radar na hora e não apaga nenhuma resposta.

### 4.5. Academia FinOps

Centro de aprendizagem interativa sobre FinOps e otimização do Azure — cursos estruturados, vídeos, glossário e recursos para download.

> ⚠️ **Gate obrigatório:** usuários novos devem completar a Academia antes de acessar o resto da plataforma (com um aviso explicando o motivo). O progresso é registrado **por usuário**, não por organização — cada pessoa nova do tenant precisa completar, e uma vez completado não pode ser refeito.

### 4.6-4.10. Progresso Histórico, TOP Despesas, Recursos, Green FinOps, Economia Capturada, Vazamentos Financeiros (Professional/Business+)

- **Progresso Histórico:** gráficos de tendência mensal, marcos de economia alcançados, comparativos mês a mês e ano a ano. Você pode adicionar anotações manuais sobre eventos que expliquem uma mudança (ex.: "migração para reservas").
- **TOP Despesas:** ranking das suas maiores fontes de gasto por serviço, assinatura ou grupo de recursos, com drilldown até o nível de recurso individual.
- **Recursos** (Business+): inventário completo — filtro e busca avançada, tagueamento em massa, exportação. Um recurso filho sem cobrança própria (por exemplo, a extensão de uma VM) não soma seu custo duas vezes: aparece em cinza como *em <recurso pai> · $valor*, e o valor conta uma única vez, no pai.
- **Green FinOps** (Professional+): estimativa de pegada de carbono por serviço, comparativo das regiões mais eficientes, recomendações de sustentabilidade.
- **Economia Capturada** (Professional+): acompanhamento das economias reais já obtidas via RIs, Savings Plans e Hybrid Benefit, com cálculo de ROI. O histórico inclui também o que sua equipe economizou **diretamente no Azure**, sem passar pela plataforma (um disco apagado pelo portal, uma VM desligada por CLI): é detectado porque o gasto do recurso cai e, quando o Activity Log do Azure ainda guarda o evento (90 dias), mostra quem fez e quando.
- **Vazamentos Financeiros** (Professional+): identifica dinheiro mal gasto (recursos abandonados, superdimensionamento, redundância desnecessária) com calendário de remediação.

---

## 5. Seção Inteligência Financeira

Aqui está a análise de custos e de otimização do Azure. Quase toda entrada do menu é um **hub com abas** (3.3). O plano mínimo aparece junto de cada nome; se o seu não o inclui, a tela avisa e oferece o upgrade ou o módulo avulso do Marketplace (8.10).

| Hub | Plano | Para que serve |
|---|---|---|
| **Consumo e Orçamento** | Professional+ | Gasto real, orçamentos, grupos de custos e projeção |
| **Leaderboard de times** | Enterprise | Qual time melhorou, custo dos produtos vendidos e margem bruta |
| **Perspectives** | Enterprise | Dividir o gasto pelas suas próprias dimensões |
| **Otimização e Economia** | Enterprise | Rightsizing, tarifas, compromissos, Hybrid Benefit, custo zero |
| **Bancos de Dados** | Business+ | Cosmos DB, SQL, PostgreSQL, MySQL, MongoDB, Redis e Fabric |
| **Computação** | Business+ | VMs, VMSS, App Service, Functions, AVD, contêineres, Kubernetes e OpenShift |
| **Armazenamento** | Enterprise | Storage Accounts, discos, backups e Data Lake |
| **Redes** | Business+ | Análise de rede, conectividade, balanceamento, egress e capacidade de enlaces |
| **Usuários e Licenças** | Enterprise | Licenças M365 e atividade de usuários |
| **Azure AI** | Enterprise | Custo e consumo dos serviços de IA do Azure |
| **Azure Integration Services** | Enterprise | Logic Apps, APIM, Service Bus, Event Grid, Event Hubs e ADF |
| **Monitoramento** | Enterprise | Application Insights, Log Analytics, Monitor, Sentinel e alertas |
| **Segurança** | Enterprise | Defender, Sentinel, Key Vault, Entra ID, WAF e DDoS |
| **Analítica Avançada** | Enterprise | Unit Economics, rateio, scorecard, anomalias, saúde, What-If e MACC |

### 5.1. Consumo e Orçamento (`/intelligence/consumo-y-presupuesto`)

Oito abas: **Consumo Real**, **Por Categoria**, **Orçamentos**, **Grupos de Custos**, **Orçamento por Grupos de Custos**, **Gastos e Projeção**, **Ingestão CSV** e **Gastos externos**.

#### 5.1.1. Consumo Real (Professional+)

O painel de faturamento detalhado, em tempo real direto do Azure.

**Como usar:**
1. Filtre por período, assinatura e grupo de recursos.
2. Dê zoom em um serviço específico para ver o detalhamento por recurso.
3. Baixe a fatura ou exporte os dados para Excel pelo botão correspondente.
4. Crie alertas de limite na mesma página (leva você ao formulário de Alertas Self-Service com o contexto pré-carregado).

> Se um recurso gasta em dois serviços do Azure (uma storage account em *Storage* e em *Bandwidth*, uma VM em *Virtual Machines* e em *Managed Disks*), ele aparece **completo sob o seu serviço principal** em vez de repartido. O detalhamento nunca soma mais do que o total do seu cartão, mas um recurso pode estar atribuído a um serviço que não é o único onde ele gasta.

#### 5.1.2. Por Categoria (Business+)

Distribuição do custo por categorias FinOps (Computação, Storage, Redes, AI etc.), para responder "em que família de serviços vai a minha fatura?" sem percorrer serviço por serviço.

#### 5.1.3. Orçamentos (Professional+)

1. **Criar orçamento:** nome, período (mensal/trimestral/anual), limite em $.
2. **Limite de alerta:** você define em que % do orçamento quer ser notificado (ex.: 75%).
3. O sistema acompanha automaticamente — você vê consumo real vs. orçamento em tempo real, com histórico dos períodos anteriores.

#### 5.1.4. Grupos de Custos — Cost Groups (Business+)

Agrupamento personalizado de custos conforme a sua própria lógica de negócio (por projeto, linha de negócio, aplicação ou ambiente).

1. Você cria um grupo com regras de nomenclatura (quais recursos entram, por padrão de nome ou tag).
2. Atribui recursos manualmente se precisar ajustar.
3. Ao clicar em um grupo abre-se um modal com abas: **Custos**, **Ações**, **Recursos**, **Governança** — cada uma com o detalhe correspondente a esse grupo.
4. Você compara grupos entre si na visão de lista. Entre os períodos disponíveis está o **Ano Fiscal** do seu tenant (5.1.5).

Esta tela e o seu detalhe respeitam o **alcance de Perspective** da barra superior (3.4).

#### 5.1.5. Orçamento por Grupos de Custos (Enterprise)

Você define centros de custo, atribui recursos (manualmente ou em massa) e o sistema rateia o gasto automaticamente para gerar **chargeback interno** por departamento, contra o orçamento mensal de cada centro.

**Transferência de orçamento (rollover).** Um orçamento pode transferir ao mês seguinte o que não foi gasto, com um teto. O mês é medido contra a soma do orçamento base mais o que foi transferido, e o cartão mostra isso com um selo e o seu detalhamento: *«Orçamento base X mais Y transferidos de meses anteriores do exercício»*. Regras que convém saber:

- Um mês no vermelho transfere **zero**, nunca um saldo negativo: um estouro pontual não endivida os meses seguintes sem que ninguém decida.
- O teto é aplicado **a cada passo**, mês a mês.
- Com a transferência desligada —o valor padrão— o painel é idêntico ao de sempre.
- Liga-se por centro de custo na própria tabela: o lápis da coluna de orçamento abre o valor **base** junto com **Transferir o não gasto** e o seu **Teto (USD)** (vazio = sem teto). Admin e Owner o alteram. Pela API é `PUT /api/intelligence/cost-centers` com `rolloverEnabled` e `rolloverCapUsd`, e um salvamento que não os envia conserva o que havia.

**Ano fiscal.** Os acumulados anuais —o do Whiteboard, o período *Ano Fiscal* de Cost Groups e a projeção— contam a partir do mês em que começa o **exercício do seu tenant**, que por padrão é janeiro. Se o seu começa em outro mês (por exemplo abril), você o escolhe em **Configuração → Geral → Ano fiscal** (Admin ou Owner), e os painéis o usam na hora. Pela API é `PUT /api/admin/tenant-settings` com `fiscalYearStartMonth`, de 1 a 12. A projeção anual divide pelos dias do exercício e não pelos dias desde janeiro, de modo que não sai baixa quando o exercício não é o ano civil.

**Sob um alcance de Perspective** (3.4) o orçamento **não é recortado**: está definido para o centro inteiro, e compará-lo com uma parcela mostraria uma folga que não existe. A tela avisa em vez de deixar a célula vazia.

#### 5.1.6. Gastos e Projeção (Enterprise)

Combina duas ferramentas em uma página:

- **Histograma de custos:** distribuição diária do gasto, com seletor de intervalo desde o último mês até **13 meses atrás** (tudo o que o Azure Cost Management permite consultar), em cache no Redis para resposta instantânea.
- **Projeção de Gastos:** calcule quanto você vai gastar no futuro.
  1. O sistema toma a média mensal dos últimos 12 meses como base.
  2. Você informa um **% de crescimento anual esperado** (pode usar valores negativos para simular um cenário de otimização/economia).
  3. Escolhe o horizonte: 3, 6, 12 ou 24 meses.
  4. O resultado mostra: média base, taxa mensal equivalente e o total projetado, com um gráfico de linha real vs. projetado.

Há um cartão-resumo disso no Dashboard com o link **"Ver detalhe completo"**. Os dois cartões respeitam o alcance de Perspective; a comparação com o orçamento não (5.1.5).

#### 5.1.7. Ingestão CSV (Business+)

Importação manual ou programada de arquivos de custos no padrão **FOCUS** e de exports do Azure: você sobe o CSV de faturamento de terceiros e o analisa junto com os seus dados do Azure.

Se o arquivo já está no formato FOCUS, ele é carregado direto. Se não, a IA olha os cabeçalhos e uma amostra de 20 linhas, com os dados sensíveis ocultos, e decide qual coluna é o custo, o serviço, a data etc. Depois a plataforma aplica esse mapeamento a **todas** as linhas:

- **Os valores e as datas são lidos pela plataforma, nunca pela IA.** Uma data que não dá para ler sem adivinhar fica vazia.
- **O mapeamento fica guardado.** Se você subir de novo um arquivo com as mesmas colunas, a IA não é usada e não se consome cota.
- **Cota mensal da organização:** 150 formatos novos no Business. É ilimitada no Enterprise ou com a sua própria chave de IA (BYOK).
- **Se a IA não estiver disponível** (desativada, sem cota ou com pedidos demais em sequência), o arquivo não é carregado e a tela diz por quê. Subir no formato FOCUS evita a IA.

**O relatório com IA.** Depois de ler o arquivo, a IA redige um relatório no idioma da tela e na moeda que o arquivo indica; se o arquivo não indica a moeda, o relatório não a supõe. Ele tem a sua própria cota mensal: 150 relatórios no Business, sem limite no Enterprise ou com BYOK. Se a IA estiver desativada, sem cota ou com pedidos demais em sequência, em vez do relatório você vê o **Resumo do arquivo**: o custo por serviço e categoria calculado pela plataforma, com o motivo.

#### 5.1.8. Gastos externos (Business+)

Faturas e contratos de fornecedores que não passam pelo faturamento do Azure: licenças, SaaS, consultoria. O Document Intelligence os lê, você revisa o que foi extraído e o que você aprova é reportado à parte, com a etiqueta **Fora do custo do Azure**. Nunca se mistura com o custo do Azure nem com a detecção de anomalias (14): é outra fonte, com outra precisão.

Todos veem a tela. Enviar, revisar e cadastrar compromissos cabe a um **Admin** ou **Owner**, porque o que é aprovado entra nos relatórios.

**Enviar.** Em **Enviar fatura ou contrato** você escolhe o **Tipo de documento** (**Fatura** ou **Contrato**), clica em **Escolher arquivo** e depois em **Enviar e analisar**.

- PDF, JPEG, PNG ou TIFF de até **10 MB**. São lidas as primeiras **20 páginas**.
- **Cota mensal da organização:** 150 documentos no Business e 500 no Enterprise. Vale mesmo que você tenha a sua própria chave de IA (BYOK), porque a análise roda na conta da plataforma.
- O mesmo arquivo não entra duas vezes: se já está na lista, a tela avisa. Um documento **Rejeitado** ou que **Falhou** pode ser enviado de novo, por exemplo com o tipo correto, e substitui o anterior.

**Status.** **Enviado** → **Analisando** → **A revisar** → **Aprovado** ou **Rejeitado**. **Falhou** se não foi possível analisar. Uma fatura de uma ou duas páginas costuma ficar pronta em segundos. Se demorar mais, a análise continua em segundo plano e a lista se atualiza sozinha.

**Revisar.** **Revisar** abre o que a IA extraiu, com **Baixar original** à mão:

- **Dados da fatura:** fornecedor, número, data, vencimento, período, moeda, subtotal, impostos e total.
- **Linhas:** descrição, quantidade, preço unitário, valor, **Categoria** e **Centro de custo**. Elas são corrigidas no lugar, e há **Adicionar linha** e **Remover linha**.
- O que foi lido com **confiança baixa** (menos de 80%) fica marcado: confira com o original.
- Se o modelo não reconhece campos, você vê o **Texto do documento** para copiar o que precisar.

**Observações da validação.** Quem as calcula é a plataforma, não a IA: que a soma das linhas dê o subtotal e que subtotal mais impostos dê o total (com 0,5% de margem por arredondamento), que as datas sejam coerentes e que não haja outra fatura do mesmo fornecedor com o mesmo número. São avisos, porque quem revisa conhece o documento melhor do que a regra. As marcadas **Impede a aprovação** são quatro: falta o total, falta a data, a moeda não é um código ISO 4217 (USD, EUR…) ou essa mesma fatura já está aprovada em outro documento. Sem total, data e moeda não há como reportá-la, e aprová-la duas vezes a contaria em dobro.

**Aprovar ou rejeitar.** **Salvar alterações** salva e valida de novo. **Aprovar** salva o que estiver pendente e, a partir desse momento, a fatura entra no gasto externo. **Rejeitar** a deixa de fora. Uma fatura aprovada também pode ser rejeitada, com confirmação, e deixa de entrar. Um contrato aprovado não: o compromisso dele continuaria avisando. Para desfazer, exclua o compromisso.

**Taxa de câmbio.** Ao aprovar, a plataforma fixa o equivalente em USD com a taxa da data da fatura (ou a mais próxima que tiver) e a mostra: *Equivalente em USD: … (1 USD = …, taxa de …)*. Ela fica fixa, para que um relatório fechado não mude sozinho. Se a plataforma não tiver taxas carregadas, usa uma de referência sem data e avisa. As moedas conversíveis são USD, EUR, GBP, ARS, BRL, MXN, CLP, COP, PEN, CAD, AUD, JPY, CHF, CNY e INR. Uma fatura em outra moeda é aprovada do mesmo jeito, mas não entra no total em USD, e o resumo a conta à parte.

**Contratos e compromissos.** O modelo de contratos lê partes, datas, renovação e duração (**Termos do contrato**), mas não valores. Ao revisar um contrato, você preenche **Cadastrar como compromisso** com o valor comprometido; ao salvá-lo, o contrato fica aprovado. Um compromisso sem documento é cadastrado com **Novo compromisso**: fornecedor, tipo (Enterprise Agreement, MACC, Savings plan, Reserva, Assinatura SaaS ou Outro), valor, moeda, início, fim, renovação (opcional), dias de aviso prévio e se tem renovação automática. Os compromissos não são editados: se algo mudou, exclua e cadastre de novo.

**Avisos de renovação (90, 60 e 30 dias).** O **Prazo de aviso prévio** é a renovação (ou o fim, se não houver renovação) menos os dias de aviso prévio: o último dia para cancelar ou renegociar. A plataforma avisa quando um compromisso entra na janela de **90 dias** antes desse prazo, de novo aos **60** e de novo aos **30**: uma vez por degrau. Chega ao **sino** de todo o tenant e aos **canais de Notificações** (8.5), com o fornecedor, a data e se ele se renova sozinho. A 30 dias ou menos é **crítico**, com ou sem renovação automática: a data para cancelar não muda. **Excluir compromisso** corta os avisos dele.

**Resumo.** **Gasto externo aprovado (USD)** soma só as faturas aprovadas, **Por fornecedor** e **Por mês** (o do período faturado ou, se a fatura não o traz, o da data dela; os últimos 12). Ao lado você vê quantos documentos estão **A revisar**, os compromissos e o próximo prazo de aviso prévio.

**O original.** É excluído **365 dias** após o envio; os dados extraídos e revisados ficam. Um documento que continua **A revisar** mantém o arquivo.

**Se a análise não estiver disponível** (desativada na plataforma ou para a sua organização, sem cota ou com documentos demais em sequência), não dá para enviar e a tela diz por quê. Você ainda pode revisar o que já enviou e cadastrar compromissos manualmente. Se a instalação não tem Document Intelligence, a tela diz que a análise de documentos não está configurada.

**Na demo** você vê faturas e um contrato de exemplo em status diferentes, e três compromissos. Nenhum arquivo é enviado e nenhuma alteração é salva.

> Não é o mesmo que *Azure AI → Document Intelligence* (4.3.1). Lá você vê quanto custam as suas próprias contas de Document Intelligence no Azure. Aqui a plataforma usa a dela para ler os seus documentos, sem custo na sua assinatura.

### 5.2. Leaderboard de times (`/intelligence/leaderboard`, Enterprise)

**Quem melhorou, não quem gasta menos.** O painel compara os **grupos de uma Perspective** (3.3 e 5.3) e os ordena por melhoria, que é o comportamento que se quer premiar: um ranking por gasto absoluto puniria o time que roda produção e premiaria o pequeno.

| Coluna | O que mostra |
|---|---|
| **Time** | O grupo da Perspective |
| **Gasto** | O que foi gasto no período |
| **Variação** | Contra o período anterior |
| **Orçamento usado** | Quanto do orçamento consumiu |
| **Economia capturada** | Remediações aprovadas **e executadas** no Azure para esse grupo |
| **Classificação** | COGS, OpEx ou Sem classificar. Admin e Owner a alteram ali mesmo; para os demais é somente leitura |

**Como se ordena.** Pela queda percentual contra o período anterior e, com variação igual, pela economia capturada. Dois casos ficam **fora da ordem** mas à vista, com o seu motivo: um grupo *sem período anterior com o qual comparar* (não melhorou nem piorou) e um *pequeno demais para ranquear sem que seja ruído* (abaixo de 1% do gasto: um que passa de 1 para 0,50 dólar não ganha de quem cortou milhares). Cada linha tem **Ver detalhamento** para chegar ao detalhe desse grupo: um ranking que não se pode explicar gera discussão, não otimização.

Três coisas que esclarecem os números:

- **O orçamento é cruzado por nome.** Um grupo de Perspective e um centro de custo são coisas distintas; se o nome do grupo coincide com o de um centro de custo, mostra-se o seu orçamento, e se não, a célula fica vazia em vez de mostrar o de outro time.
- **A economia capturada sai do que foi executado**, não do simplesmente aprovado. Como as remediações não guardam tags, em uma Perspective definida por tags essa economia cai em *não atribuído*.
- **O gasto não atribuído** (nenhuma regra o alcança) entra no total, mas em nenhum time, e é informado à parte.

**Custo dos produtos vendidos e despesa operacional.** Um cartão divide o gasto em **COGS**, **OpEx** e **Não classificado**, e a soma fecha com o total. Cada grupo é classificado na coluna **Classificação** da tabela (COGS, OpEx ou Sem classificar): Admin e Owner a escolhem, e a divisão e a margem são recalculadas na hora. Para os demais papéis a coluna é somente leitura. Pela API é `PUT /api/intelligence/leaderboard` (`perspectiveId`, `groupName`, `classification`).

**Margem bruta.** Quando você carrega a **receita**, o cartão calcula *receita − COGS*. Ela é enviada com `POST /api/unit-metrics/ingest`, com uma API Key pública com a permissão `write:metrics` e `metricType` = `REVENUE` (11.11). Regras de honestidade do cálculo:

- **Sem receita não há margem**, não 0%: o cartão explica como enviá-la.
- **Se há gasto não classificado, a margem é uma faixa**: junto do melhor caso mostra-se o pior (tudo o que não foi classificado contado como COGS), porque um COGS subestimado faz a margem sair melhor do que é.
- Uma **margem negativa** é mostrada como é: gastar mais do que entra é justamente o que esta tela existe para mostrar.

Sem Perspectives definidas o painel avisa e leva você a **Definir uma**. Não o veem os usuários com alcance atribuído: um ranking compara grupos entre si e o seu recorte é justamente não ver os demais.

### 5.3. Perspectives (`/intelligence/perspectives`, Enterprise)

Uma **Perspective** divide o gasto por uma dimensão do seu negócio —times, produtos, ambientes, centros de custo— sem mexer nas tags do Azure. Cada uma é um conjunto **ordenado** de regras que atribuem um recurso a um grupo.

Três propriedades que a tornam auditável:

1. **Um recurso cai em um único grupo por Perspective**, e quem decide é a **primeira regra que coincide**: a ordem importa e se edita.
2. **O mesmo recurso pode estar em grupos de Perspectives distintas.** O mesmo disco pode ser «Produção» em *Ambientes* e «Engenharia» em *Centros de Custo*.
3. **A soma dos grupos mais o *Não atribuído* dá exatamente o total do período.** O grupo *Não atribuído* é sempre mostrado, com seu valor e porcentagem: uma Perspective que cobre 60% do gasto e não diz isso seria lida como se fosse o total.

**Criar uma Perspective.**
1. Em **Nova Perspective** digite o nome (por exemplo *Times*, *Produtos* ou *Ambientes*) e pressione **Criar**. Ela nasce **sem regras**, de propósito: com uma regra vazia a divisão mostraria um grupo sem nome e 100% não atribuído, o que se lê como se algo tivesse falhado.
2. Adicione regras com **Adicionar regra**. Cada regra tem um **Grupo** (o nome do time, produto ou ambiente) e um critério:

   | Tipo de regra | O que compara |
   |---|---|
   | **Tag** | Chave e valor de uma tag do recurso (o valor aceita `*`) |
   | **Padrão de nome** | O nome do recurso |
   | **Assinatura** | A assinatura do Azure |
   | **Grupo de recursos** | O grupo de recursos |
   | **Tipo de recurso** | O tipo de recurso do Azure |

3. Ordene-as com **Subir** e **Descer**: vence a primeira que coincide.
4. **Ver divisão** calcula, sem salvar nada, quanto do gasto do período cai em cada grupo e quanto fica *Não atribuído*, com a porcentagem de cobertura. Mudar a ordem das regras muda a divisão na prévia.
5. **Salvar** aplica as regras.

**Excluir** uma Perspective pede confirmação com o nome à vista: as regras também são apagadas, e quem a tinha atribuída como alcance deixa de tê-la.

**«Não atribuído» e «Sem dados para avaliar» não são a mesma coisa.** *Não atribuído* é o gasto que nenhuma regra alcançou: é o que falta taguear ou regra por escrever. *Sem dados para avaliar* aparece quando as regras precisam de um dado que a plataforma ainda não ingere para essas linhas —por exemplo, regras por tag em um tenant cuja sincronização de custos não traz tags em nível de recurso—: não é um problema do seu tagueamento. Configurar o **export FOCUS do Azure** completa essas tags.

**Onde se aplica.** Com uma Perspective e um grupo escolhidos na barra superior (3.4), restringem o seu conteúdo: Cost Groups e o seu detalhe, Orçamento por Grupos de Custos e o seu inventário de recursos, Gastos e Projeção, o Whiteboard, Armazenamento, o simulador What-If e o export FOCUS (`/api/exports/focus?perspective=&pgroup=`, útil para entregar ao financeiro só a parcela de um time). Quando uma tela **não consegue restringir** com exatidão, não mostra uma parcela duvidosa: avisa (*«Não foi possível restringir por Perspective… os números abaixo são os do painel completo»*).

**Alcance atribuído a uma pessoa.** Um Admin pode deixar um usuário *restrito* a um grupo (8.2). Para essa pessoa o recorte não é uma preferência: a API o aplica, então mudar um parâmetro no navegador não mostra mais, e as telas que não sabem restringir respondem com acesso negado em vez de mostrar o painel inteiro.

Na demo as Perspectives são de exemplo e não se salvam alterações.

### 5.4. Otimização e Economia (`/intelligence/optimizacion-y-ahorro`, Enterprise)

Sete abas: **Rightsizing**, **Otimização de Tarifas**, **Benefícios Híbridos**, **Reservas de Instâncias (RIs)**, **Saving Plan**, **Custo Zero** e **Índice de Otimização**.

#### 5.4.1. Rightsizing

Analisa 30 dias de uso real e recomenda o SKU ideal; mostra a economia estimada antes de você aprovar a mudança. Verticais dedicadas em `/intelligence/rightsizing/{vmss,appservice,sqldb,storage}`.

#### 5.4.2. Otimização de Tarifas

Oportunidades de tarifa —planos de economia, Spot e descontos por volume—, comparando suas tarifas atuais com benchmarks de mercado para preparar uma negociação com a Microsoft.

#### 5.4.3. Benefícios Híbridos (AHB)

Mostra quais VMs poderiam usar licenças com Software Assurance (Windows Server e SQL Server) e quanto você economizaria ao ativá-lo; acompanhamento do que já o usa.

#### 5.4.4. Reservas de Instâncias (RIs) — Descontos por Compromisso

Além da cobertura e utilização global, a tabela **Reservas Ativas** replica o blade *Reservations* do Azure: Nome, Status, Expiração, Escopo, Tipo, Produto, Região, Renovação, Quantidade, e utilização do último dia e dos últimos 7 dias.

- Clique no botão de **Renovação** → modal para **ativar/desativar a renovação automática** dessa reserva. A mudança é aplicada diretamente no Azure — requer papel Admin/Owner do tenant **e** permissões `Reservations Contributor/Owner` no Azure.
- Clique em qualquer **porcentagem de utilização** → modal com detalhe de último dia / 7 dias / 30 dias e a tendência diária.
- As **reservas órfãs** —continuam faturando sem consumo real— são marcadas com um alerta para você revisar se o recurso existe ou cancelar a reserva.

Acima do painel, três leituras da carteira:

- **Taxa efetiva de economia (ESR).** Quanto você economiza de verdade contra pagar tudo a preço de tabela: `(preço de tabela − custo efetivo) / preço de tabela`, nos últimos 30 dias. O custo efetivo **inclui o compromisso que não foi usado**, então comprar demais não melhora o número. É calculada só sobre o gasto que tem preço de tabela, e a tela diz sobre que porcentagem: o que não pôde ser valorizado fica de fora em vez de contar como zero de desconto. Se o tenant ainda não tem o **export FOCUS** de custos configurado, não há preço de tabela e o ESR não é desenhado.
- **Vence junto.** Que parte do valor comprometido vence no mesmo mês ou em uma janela de três meses corridos: se toda a carteira vence ao mesmo tempo, o gasto volta ao preço de tabela de uma vez. É ponderado por **valor**, não por quantidade (dez reservas pequenas não pesam como uma grande), e avisa quantas reservas ficaram sem custo ou sem data para não minimizar o risco.
- **Limite anual de devolução (US$ 50.000).** A Microsoft limita os cancelamentos e reembolsos de reservas a **US$ 50.000 por ano** e por Billing Account, em uma janela móvel de 12 meses. Uma barra mostra quanto da cota você consumiu e quanto resta, e avisa ao passar de 80%.

**Simulador de ponto de equilíbrio e mix ótimo.** Escolha o tipo de carga (**Mix Geral**, **Computação Flexível** ou **Bancos de Dados**) e o seu gasto mensal sob demanda (PAYG): o simulador calcula em que mês uma reserva de **1 ano** (~38% de desconto de referência) ou de **3 anos** (~62%) supera pagar sob demanda, quanto você economiza por mês depois desse ponto, e sugere um **mix em 3 camadas**: Savings Plans para a flexibilidade, reservas para as cargas estáveis como os bancos de dados, e um colchão de pagamento sob demanda (*PAYG elástico*) para absorver os picos.

**Avisos de vencimento (90, 60 e 30 dias).** Todo dia a plataforma revisa a data de vencimento de cada reserva ativa e avisa quando uma entra na janela de **90 dias**, de novo aos **60** e de novo aos **30**: uma vez por degrau, ainda que a verificação rode todos os dias, e se um dia ela não roda, o aviso sai no seguinte. Chega ao **sino** de todo o tenant e aos **canais de Notificações** que você tiver configurado (Slack, Teams, e-mail ou webhook, 8.5), com o nome, a data e se a reserva **se renova sozinha**. É **crítico** quando uma reserva sem renovação automática está a 30 dias ou menos; uma com renovação automática avisa como informativa, porque não deixa de cobrir. Se a reserva for renovada ou estendida, a escada recomeça com a nova data. Usa a mesma leitura desta tabela: se aqui você não vê suas reservas —falta o papel *Reservations Reader* (1.3)—, os avisos também não chegam. Não se aplica aos tenants conectados por Azure Lighthouse, porque as reservas são de nível de tenant e o Lighthouse delega por assinatura.

#### 5.4.5. Saving Plan

Comparador **Savings Plan vs Reserva**: simule as duas opções de compra com os seus números reais e compare a economia em 1 e 3 anos antes de se comprometer. Os Savings Plans for Compute são compromissos flexíveis de gasto por hora.

#### 5.4.6. Custo Zero

Inventário de recursos zumbis, órfãos e desligados que geram custos residuais, e quais recursos são gratuitos na sua assinatura (free tier, créditos) para aproveitá-los ao máximo.

#### 5.4.7. Índice de Otimização (COIN)

Indicador consolidado de eficiência e aproveitamento do gasto: pontuação 0-100 composta, com a taxa de adoção das recomendações, o funil de estados (pendentes, aceitas, implementadas, adiadas, descartadas), o detalhamento pelos 5 pilares do Well-Architected Framework e a série histórica contra o benchmark de excelência.

### 5.5. Bancos de Dados (`/intelligence/bases-de-datos`, Business+)

Visibilidade, métricas e recomendações de custo para os bancos de dados do Azure. Sete abas:

| Aba | O que cobre |
|---|---|
| **CosmosDB** | Consumo de RUs, particionamento e custos |
| **Azure SQL / Managed Instance** | DTUs, vCores, Elastic Pools e Managed Instances |
| **PostgreSQL** | Custos, IOPS e escalabilidade no Flexible Server |
| **MongoDB** | Clusters Mongo e compatibilidade de API no Cosmos DB for MongoDB |
| **Azure Cache for Redis** | Memória, taxa de acerto e dimensionamento; inclui o monitoramento detalhado das 12 métricas críticas do Azure Cache for Redis |
| **MySQL** | Computação, armazenamento e alta disponibilidade no Flexible Server |
| **Microsoft Fabric** | Capacidades F-SKU, armazenamento OneLake e consumo analítico |

Como no resto dos cockpits, se o Azure não devolve uma métrica a plataforma mostra **«sem dado»** e não um zero: um zero seria lido como «ocioso» e levaria a reduzir algo que talvez esteja trabalhando.

**Cosmos DB: telemetria real e otimizador de RU/s.** Cada conta é medida com as métricas reais do Azure Monitor (RU normalizada, throughput provisionado, requisições e as limitadas com erro 429, armazenamento, latência) e o painel emite três decisões, sempre com a economia derivada do que foi medido e das tarifas publicadas:

1. **Baixar o RU/s manual** quando está superdimensionado: dimensiona-se pelo **percentil 95 de uso com 25% de margem** —não pela média, que deixa o banco curto em cada pico— e nunca abaixo do mínimo de 400 RU/s.
2. **Migrar para Autoscale** quando o uso médio é baixo em relação ao teto: o limite (~66%) sai do quociente entre as duas tarifas publicadas, não é um número escolhido.
3. **Passar para Serverless** quando a conta consome pouco e de forma intermitente: decide-se com as RUs realmente consumidas extrapoladas para o mês, e o teto de 5.000 RU/s é medido contra o **pico real**, não contra o provisionado.

Também detecta **partições quentes** (uma partição física que concentra o consumo enquanto as demais sobram). Essa recomendação vai com economia **zero** de propósito: distribuir melhor a chave evita os erros 429, não baixa a fatura por si só, e pôr um número ali seria inventá-lo.

### 5.6. Computação (`/intelligence/computo`, Business+)

Eficiência e custos das plataformas de computação. Nove abas:

| Aba | O que cobre |
|---|---|
| **Eficiência de Computação** (Enterprise) | Custo unitário por core, benchmark regional e otimização de compromissos. Na tabela **Por SKU e Arquitetura**, *vCPU/VM* e *RAM/VM* são a ficha de **uma** instância do SKU, *Instâncias* diz quantas você tem e as razões *$/Core* e *$/GiB* dividem o custo total pela frota desse SKU |
| **Kubernetes** (Enterprise) | Clusters AKS: nós ativos, utilização real vs. superprovisionamento, custo de infraestrutura e de planos de controle, custo por pod, recomendações de auto-scaling e **chargeback por namespace** (você atribui namespaces a times e calcula-se quanto cada um gasta, para faturamento interno) |
| **Estrutura de Contêineres** | Azure Container Apps, Registries e Environments: inventário financeiro, forecast e rightsizing; custo mensal por app, CPU/memória e réplicas, e oportunidades de *scale-to-zero* (apps com réplica mínima ≥ 1 que poderiam ser desligadas sem tráfego) |
| **Web Apps & App Services** | Cockpit de App Service Plans e Web Apps com densidade de apps, consolidação e detecção de instâncias subutilizadas |
| **Function Apps** | Invocações, GB-s, auditoria de logs, planos dedicados e flexíveis, e playbooks de sampling/downgrade |
| **Azure Virtual Machines** | Custo de computação separado do armazenamento persistente (vazamentos em VMs desalocadas), AHUB, rightsizing para Série B, schedules 8x5, descarte de VMs abandonadas e oportunidades de Spot e Savings Plans |
| **Azure Virtual Desktop** | Veja abaixo |
| **Virtual Machine Scale Sets** | Elasticidade, políticas de autoscale e Spot instances |
| **Azure Red Hat OpenShift** | Governança de custos, capacidade de nós e TCO de clusters ARO |

**Azure Virtual Desktop.** Inventário de **Host Pools** e seus **Session Hosts** (a VM subjacente e seu custo real), com KPIs de host pools, session hosts, sessões ativas, custo de computação mensal e custo do **armazenamento de perfis FSLogix** (detectado pelo nome do recurso: o Azure não oferece um vínculo direto). Por usuário mostra horas de conexão, pico de usuários simultâneos e **custo por usuário** dos últimos dias; além disso lista os *application groups*, os *workspaces* e as atribuições de usuários. Um host pool cujos grupos de aplicações não estão publicados em nenhuma workspace é marcado **INALCANÇÁVEL**: ninguém consegue se conectar a ele embora continue custando. As recomendações de remediação trazem o botão **Ver remediação**.

### 5.7. Armazenamento (`/intelligence/almacenamiento`, Enterprise)

Visibilidade e otimização de custos dos serviços de armazenamento. Quatro abas: **Storage Accounts**, **Managed Disk**, **Backups** e **Data Lake Gen2**.

Cada uma é um *cockpit* com o mesmo esquema: KPIs de custo MTD, forecast de fim de mês, economia potencial, variação contra o mês anterior, recursos avaliados, eficiência, baixa utilização e saúde operacional; filtros por recurso, tier e grupo de recursos; ordenação e recomendações priorizadas.

Além das abas, a **eficiência de storage** (`/intelligence/storage-efficiency`) simula a economia de mover blobs entre tiers Hot/Cool/Archive antes de aplicar. Com um alcance de Perspective ativo (3.4), o painel é recortado com o custo que pode ser atribuído por recurso; se não há com o que recortar, avisa em vez de mostrar «seu grupo não tem storage».

### 5.8. Redes (`/intelligence/redes`, Business+)

Análise de rede, conectividade, balanceamento e acesso à internet. Oito abas:

| Aba | O que cobre |
|---|---|
| **Análise de Rede** | Detalhamento por recurso de todos os serviços de rede do tenant: largura de banda, gateways, load balancers e IPs públicos; picos de transferência e IPs ociosos para dar baixa |
| **Redes Básicas** | Topologia, conectividade privada e observabilidade de custos em Virtual Networks, Private Endpoints, DNS, NSGs e tabelas de roteamento (UDR) |
| **Conectividade Híbrida** | ExpressRoute, Virtual WAN, VPN Gateways e conexões: otimização de túneis, arbitragem de ExpressRoute, gateways ociosos e túneis caídos |
| **Balanceamento e Publicação** | Application Gateways / WAF, Azure Front Door, Load Balancers e Traffic Manager: balanceadores órfãos, autoscale e arbitragem de Front Door |
| **Acesso à Internet** | IPs públicos, NAT Gateways, Azure Firewall e DDoS Protection: IPs órfãos, planos DDoS e rightsizing de firewalls |
| **Tráfego e egress** | Veja abaixo |
| **Capacidade de enlaces** | Veja abaixo |
| **Proteção DDoS** | Planos DDoS IP Protection e Network Protection |

**Tráfego e egress.** Para onde vai o dinheiro de mover dados, que não aparece no custo dos recursos de rede. Classifica o custo faturado de transferência em **saída para a internet**, **entre zonas de disponibilidade**, **processado pelo NAT Gateway**, **entre regiões do continente**, **entre continentes** e **entrada**, com custo e volume por região e medidor, em uma janela dos últimos N dias. O custo é o faturado pelo Azure, não uma estimativa. Dá sugestões para os dois tráfegos evitáveis: o tráfego **entre zonas** é pago nas duas direções e costuma vir de réplicas ou balanceamento espalhados sem necessidade; o **NAT Gateway** cobra por GB processado e, se o destino é um serviço do Azure, um Private Endpoint ou um Service Endpoint o evita por completo. Uma limitação que a tela declara: o **volume é um piso** (as linhas sem cobrança, como a faixa gratuita de saída, não são ingeridas), enquanto o custo é o total.

**Capacidade de enlaces.** Compara a largura de banda **contratada** de cada circuito ExpressRoute e gateway de VPN contra o **P95 do uso real dos últimos 30 dias**. Os que usam menos de **15%** do contratado são marcados como **superdimensionados**: podem ser reduzidos de SKU. A regra que manda é a segurança: **sem métricas não se recomenda reduzir**. Um enlace sem amostras não está ocioso, provavelmente falta a permissão de leitura ou é novo, e baixar o SKU de um saturado cortaria o enlace; esses enlaces são contados à parte e avisados acima da tabela. O P95 é calculado sobre as amostras horárias (o Azure Monitor não oferece percentis), e a tela mostra a data de revisão do catálogo de SKUs.

### 5.9. Usuários e Licenças (`/intelligence/licenses`, Enterprise)

Três abas: **Dashboard** (KPIs de M365 e Entra ID), **Atividade de Usuários** (tabela filtrável) e **Otimização de Licenças** (recursos sem Hybrid Benefit via Resource Graph e métricas por SKU via Microsoft Graph).

> ℹ️ **Com Azure Lighthouse estas abas não mostram dados.** O Lighthouse delega a administração das suas assinaturas, não o seu diretório, então a plataforma não consegue ler usuários, licenças nem atividade do Microsoft 365: no lugar dos dados você verá o aviso *Não disponível com Azure Lighthouse*. O mesmo vale para a aba **Entra ID** de Segurança (5.13), para a busca e a sincronização de usuários do Entra ID (8.2) e para o Copilot M365 (8.7). Para usá-las, o tenant precisa se conectar com o script de onboarding (1.3).

### 5.10. Azure AI (`/intelligence/azure-ai`, Enterprise)

Plataforma de inteligência artificial do Azure: busca vetorial, processamento de documentos, transcrição, visão, moderação, MLOps e analítica distribuída. Nove abas: **Visão Geral**, **Azure Foundry**, **AI Search**, **Document Intelligence**, **Speech & Language**, **Vision & Video**, **Content Safety**, **Machine Learning** e **Databricks**.

A aba **Azure Foundry** é o *AI Cost Analytics*: custo por modelo e consumo de tokens no Microsoft Foundry / Azure OpenAI, com recomendações de otimização de chamadas. Para Document Intelligence veja 4.3.1.

### 5.11. Azure Integration Services (`/intelligence/integration-services`, Enterprise)

Operação e custo de integrações empresariais. Seis abas: **Azure Logic Apps** (com a distinção entre conectores Standard e Enterprise e seu impacto no custo), **Azure API Management (APIM)**, **Azure Service Bus**, **Azure Event Grid**, **Azure Event Hubs** e **Azure Data Factory (ADF)**.

### 5.12. Monitoramento (`/intelligence/monitoreo`, Enterprise)

Observabilidade e operação dos serviços de monitoramento. Oito abas: **Application Insights**, **Log Analytics Workspace**, **Azure Monitor**, **Microsoft Sentinel**, **Alerts**, **Action Groups**, **Workbooks** e **Network Watcher**.

Em **Log Analytics Workspace** você controla custo mensal, retenção e ingestão estimada por workspace; detecta ingestão massiva desnecessária (workspaces sem limite diário), retenção excessiva e oportunidades de *Commitment Tier*, com economia potencial estimada. Também aparece como cartão no White Board.

### 5.13. Segurança (`/intelligence/seguridad`, Enterprise)

Visibilidade e controle de custos nos serviços de segurança. Seis abas: **Defender for Cloud** (planos de proteção por recurso: Servers, Containers, SQL, Storage), **Microsoft Sentinel** (ingestão de logs e compromissos de capacidade), **Key Vault**, **Entra ID** (licenciamento P1/P2 e identidades de carga de trabalho), **WAF** e **DDoS Protection**. Um cron de pré-aquecimento acelera o carregamento. Com Azure Lighthouse, a aba Entra ID mostra o mesmo aviso (ver 5.9).

### 5.14. Analítica Avançada (`/intelligence/analitica-avanzada`, Enterprise)

Modelos avançados de alocação, anomalias, saúde e simulação financeira. Sete abas:

| Aba | O que faz |
|---|---|
| **Unit Economics** | Você define a sua própria métrica unitária (custo por transação, por usuário, por MB processado) e o sistema calcula o custo unitário sobre os seus dados do Azure: gasto total do período dividido pelo volume total, não a média das médias diárias. O volume de negócio é carregado à mão na configuração da tela ou automatizado a partir do seu pipeline com o endpoint de ingestão (11.11) |
| **Rateio (Allocation)** | Regras de distribuição de custos compartilhados entre áreas, centros de custo e times (por uso real, proporcional ou fixo) |
| **Scorecard (Fama)** | Pontuação 0-100 da sua saúde financeira com indicadores individuais (economia, cobertura de reserva, eficiência) e avaliação de maturidade em *Inform, Optimize e Operate* (framework FAMA); você pode definir metas |
| **Detecção de Anomalias** | Identifica picos ou quedas anormais de gasto (Z-Score) e permite criar alertas ajustando a sensibilidade. Cada anomalia tem responsável e acompanhamento (14) |
| **Saúde do Tenant** | Índice integral de saúde arquitetural e de governança: problemas detectados, consistência de faturamento, cobertura de reservas e conformidade de políticas |
| **Simulador (What If)** | Veja 5.14.1 |
| **MACC Tracking** | Acompanhamento do compromisso mínimo anual (EA/MCA) — consumido vs. comprometido, burn-rate e projeção de cumprimento |

#### 5.14.1. Simulador What-If

Simule o impacto de escalar computação/storage, variar o tráfego de rede ou ativar o Azure Hybrid Benefit sobre o seu custo atual, **antes de aplicar a mudança real**.

**Fluxo completo:**
1. Você move os sliders: escala de computação, escala de storage, % de aumento do tráfego de rede, ativar/desativar AHB.
2. Pressiona **"Executar Simulação"** — vê o detalhamento: custo base, custo projetado, delta e % de mudança.
3. **Salvar o cenário:** botão **"Salvar atual"** → você dá um nome e notas opcionais. O cenário fica congelado com esses números (não é recalculado depois, mesmo que o seu custo base real mude com o tempo — assim você pode comparar cenários salvos em momentos distintos entre si de forma consistente).
4. Repita o processo 2-3 vezes com sliders diferentes para ter vários cenários salvos.
5. **Comparar:** marque de 2 a 4 cenários nos checkboxes → botão **"Comparar"** → abre-se um modal lado a lado com cada cenário como cartão, indicando qual é a linha base.
6. **Exportar:** escolha o formato (CSV, PDF ou Markdown) junto dos botões de download — você pode exportar um cenário individual, todos os salvos, ou a comparação completa com o delta de cada um contra a base.
7. **Apagar:** ícone de lixeira em cada linha (só o criador do cenário ou um Admin/Owner pode apagá-lo).

> O mix de cálculo assumido é Azure-first: 60% do custo é computação, 25% storage, 15% rede; o AHB aplica um desconto flat de 18% sobre o total se estiver ativado.

**Com um alcance de Perspective ativo**, o gasto base dos últimos 30 dias é o dessa parcela: «o que acontece se o meu time crescer 20%?» responde-se sobre o gasto do time e não sobre o do tenant. A lista de cenários salvos continua sendo a do tenant.

---

## 6. Seção Limpeza de Nuvem

### 6.1. Recursos Zumbi (`/cleanup/zombies`, Professional+; remediação Business+)

Detecta recursos órfãos e subutilizados em 25 tipos de infraestrutura Azure (discos não anexados, IPs públicos órfãos, NICs sem VM, App Service Plans vazios, Elastic Pools sem bancos, VMSS ociosos, snapshots antigos e VMs desalocadas com storage ativo).

**Capacidades e fluxo:**
1. **Omni-Scan de 25 Resource Types:** Análise exaustiva no Azure Resource Graph.
2. **Classificação Hard vs Soft Waste:** Diferenciação visual entre desperdício monetário direto (Hard Waste) e desalinhamento de governança/tags (Soft Waste).
3. **Resolução de assinaturas:** Mostra sempre o nome amigável da assinatura (ex.: `CSCS-LandingZone`).
4. **Tabela personalizável:** Colunas com alças de largura interativas (`col-resize`) e seletor suspenso `Personalizar Colunas` (`IconColumns`) persistente por navegador.
5. **Remediação segura:** Criação de snapshots preventivos e execução de playbooks CLI/PowerShell.

### 6.2. Zumbis de Rede (`/cleanup/zombies/networking`, Professional+; remediação Business+)

Auditoria especializada em infraestrutura de rede:
- **Gateways VPN / ExpressRoute ociosos:** Detecção de gateways sem conexões ativas nem túneis IPsec configurados.
- **IPs públicos órfãos:** Identificação de IPs atribuídos sem associação a NICs nem balanceadores (excluindo os Network Watchers do sistema).
- **Private Endpoints desconectados:** Diagnóstico de endpoints privados com estado `Disconnected` ou apontando para recursos excluídos.
- **NAT Gateways e Firewalls:** Detecção de NAT Gateways sem sub-redes e Firewalls/Application Gateways sem regras de roteamento nem backend pools.

### 6.3. Expirações TTL — Time-To-Live (`/cleanup/ttl`, Business+)

Controle automatizado do ciclo de vida de recursos efêmeros (ambientes de teste, laboratórios de desenvolvimento e sandboxes):
1. **Políticas TTL centralizadas:** Definição de vida útil máxima por tipo de recurso e ambiente.
2. **Tag `ExpireOn`:** Aplicação otimista de tags de expiração com validação de datas.
3. **Semáforos de vencimento:** Indicadores em tempo real (`CRITICAL` vencidos, `WARNING` prestes a vencer em menos de 72h, `ACTIVE` vigentes).
4. **Prorrogações interativas:** Extensão rápida do tempo de vida (+7d, +14d, +30d) para recursos que precisam de mais tempo de teste.
5. **Auditoria imutável:** Histórico inalterável dos desprovisionamentos executados em `TtlDeletions`.

### 6.4. Backups Órfãos (`/cleanup/backup-orphans`, Professional+; remediação Business+)

Gestão de armazenamento, custos acumulados e conformidade legal de cópias de segurança em **Recovery Services Vaults**:
1. **Detecção de Protected Items desvinculados:** Identificação de instâncias protegidas cujo recurso original já foi excluído do Azure mas que continuam acumulando tarifas de armazenamento e custos base.
2. **Cálculo de custo composto:** Detalhamento do custo mensal exato somando a tarifa base por tipo de item (`AzureIaasVM`, `AzureWorkload`, `AzureStorage`, `AzureDisk`) e o consumo de armazenamento no cofre a \$0.0224/GB/mês.
3. **Purga segura com Soft Delete:** Modal de confirmação estrita com verificação por nome e alerta sobre a janela preventiva de 14 dias de Soft Delete antes da exclusão definitiva.
4. **Isenções por conformidade legal:** Drawer lateral para registrar tickets de auditoria (SOX, fiscal, regulatório) com retenções de 1 a 10 anos ou indefinidas, excluindo o item do desperdício ativo.
5. **Transferência para Archive Tier:** Movimento para a camada de armazenamento frio para obter até 85% de redução no custo de retenção de longo prazo.

---

## 7. Seção Governança

### 7.1. Governança de Etiquetas — Azure Tag Governance Engine (`/governance/tags`, Professional+)

Painel abrangente de auditoria, sugestão e propagação de metadados corporativos no Azure.

**Principais capacidades:**
- **Auditoria Dupla de Conformidade:** Telas dedicadas para auditar tanto **Recursos Individuais** quanto **Grupos de Recursos (Resource Groups)**.
- **Políticas de etiquetagem:** se a sua organização não definiu as próprias, são avaliadas as 4 tags essenciais de FinOps. Environment e Role têm, além disso, uma lista de valores permitidos (7.1.1):
  - `Environment` (ambiente): `prod`, `stg`, `dev`, `qa` ou `sandbox`.
  - `Role` (função do recurso): `database`, `api`, `frontend`, `backup`, `orchestrator`, `network`, `storage` ou `worker`.
  - `CostCenter` (centro de custo contábil): valor livre.
  - `Department` (área ou unidade de negócio responsável): valor livre.
- **Sugestão pela convenção de nomes (1-clique):** O botão **Sugerir pela convenção de nomes** preenche as tags faltantes do formulário de edição a partir do nome do recurso, do seu grupo de recursos e do seu tipo. Por exemplo, `dev` no nome sugere `Environment = dev`. Só sugere valores permitidos e, se o nome, o tipo e o grupo não dão pistas, não sugere nada. É uma regra fixa, não IA: revise a sugestão, que só é aplicada quando você salvar.
- **Herança em Lote do RG (Merge Seguro):** Com o botão "Herdar do RG", recursos filhos adotam as tags do Resource Group pai sem sobrescrever nem apagar tags preexistentes.
- **Edição de etiquetas:** **Editar Etiquetas** grava no Azure as etiquetas de um recurso, sem apagar as demais, e a tela as mostra na hora, sem esperar o Azure informá-las. Environment e Role são escolhidos da lista de valores permitidos; se a política não tem lista, são digitados livremente. Se o recurso tem um valor que não está na lista, ele aparece como **{valor} (não permitido)**, para você vê-lo e trocá-lo.
- **Padrão CMP e Personalização:** Tabelas com redimensionamento de colunas (`col-resize`, 100px - 600px), seletor de colunas visíveis em `z-[100]` e persistência automática por tenant em `localStorage`.

#### 7.1.1. Valores Não Conformes

Uma etiqueta pode estar presente e mesmo assim não servir: `Production`, `PRD` e `prod` são o mesmo ambiente, mas um relatório agrupado por Environment os conta como três. Esta seção encontra esses valores, sugere o correto e, quando você confirma, corrige no Azure.

**Valores permitidos.** Cada política pode ter uma lista de valores permitidos. Se tiver, o valor precisa estar escrito igual ao da lista: `Prod` ou `production` não cumprem em Environment. Sem lista, a política é de **Valor livre** e só exige que a etiqueta esteja presente. Os cartões de **Políticas de Etiquetagem Globais Ativas** e **Gerenciar Políticas** mostram a lista de cada política, ou **Valor livre**, e **OPCIONAL** se ela não for obrigatória. Na tela elas são exibidas, mas não editadas: por enquanto, um Admin ou Owner as altera pela API (`/api/governance/policies`). Se a sua organização define uma única política própria, ela substitui as 4 padrão, então convém definir todas.

**O % de conformidade pode cair.** A partir desta versão, um valor fora da lista conta como não conformidade, igual a uma etiqueta faltante. Se os seus recursos usam `production` ou `Prod`, a **Conformidade Global de Tags** cai sem que nada tenha mudado no Azure. Não é um erro: são os valores que esta seção ajuda a corrigir. Na auditoria, a coluna **Faltantes ou Não Permitidas** mostra os valores não permitidos em âmbar, com o valor sugerido ao passar o mouse, e o CSV ganha a coluna **Valores Não Permitidos**.

**A tabela.** Agrupa por etiqueta e valor: **Etiqueta**, **Valor atual**, quantos **Recursos** o usam (ao passar o mouse você vê os nomes), **Corrigir para**, **Sugestão** e **Ações**.

**Sugestões e confiança.** Primeiro são testadas regras fixas, sem IA. A coluna **Sugestão** diz qual delas encontrou o valor e com que confiança:

- **Formato** (100 %): o mesmo valor escrito de outro jeito, como `Prod` ou `PROD` para `prod`, ou `Front-End` para `frontend`. A comparação ignora maiúsculas, acentos, espaços e hifens.
- **Alias** (95 %): um sinônimo conhecido. `production`, `produccion` ou `prd` vão para `prod`; `staging` ou `preprod`, para `stg`; `web`, para `frontend`; `k8s`, para `orchestrator`. Primeiro contam os aliases da sua organização e depois os da plataforma.
- **Parecido:** um erro de digitação em um valor de 5 letras ou mais, como `prodution`. Admite uma letra de diferença até 7 letras e duas a partir de 8, e a confiança cai a cada uma. Se dois valores ficam igualmente próximos, não sugere nenhum.
- **IA:** para o que as regras não resolveram, **Sugerir com IA** pede à IA os valores não resolvidos daquela etiqueta. Para cada um, ela escolhe um valor da lista ou responde que não sabe (**A IA não soube**). Nunca inventa um valor. A sugestão aparece com **IA** e a sua confiança, e é aplicada como as outras.

**Aplicar.** **Corrigir para** começa na sugestão, e você pode escolher outro valor da lista. **Aplicar** abre **Confirmar alterações no Azure**, com a alteração e os recursos afetados. **Confirmar e aplicar** grava a etiqueta no Azure nesses recursos, sem mexer nas outras etiquetas deles. A linha some quando o Azure aceita a alteração; se alguns recursos falharem, a tela diz quantos.

**Salvar como alias.** A confirmação oferece *Salvar “x” → “y” como alias da sua organização, para que da próxima vez seja corrigido automaticamente*. Se você marcar, esse valor passa a ser sugerido por regra, sem IA, em qualquer recurso da sua organização. O alias é só da sua organização. Não é oferecido quando a diferença é de formato, porque isso já se resolve sozinho.

**Descartar.** Oculta o valor até a próxima varredura. Se havia uma sugestão, ela conta como rejeitada. Não é uma exceção permanente: se o valor continua no Azure, ele volta na próxima varredura.

**Etiquetas Livres Faltantes.** As etiquetas obrigatórias sem lista (por padrão, CostCenter e Department) não têm um valor para corrigir: estão faltando. Esta parte aparece quando há recursos sem a etiqueta.

- **Herdar do grupo (N)** grava em cada recurso o valor que o seu grupo de recursos tem. Vem primeiro porque não adivinha nada.
- **Propor com IA (N)** é para os recursos que não podem herdar. A IA propõe um valor por recurso, olhando o seu nome, o seu tipo e o seu grupo, e só entre os valores que a sua organização já usa para essa etiqueta. Você revisa cada linha (**Valor proposto**, **Confiança**), troca o valor se precisar e marca **Aprovar**.
- **Aplicar aprovadas (N)** grava no Azure só o que você aprovou. Uma proposta nunca é aplicada sozinha.

**Quem pode o quê.** Todos veem a seção e podem pedir sugestões à IA, que só propõe. Aplicar, herdar, aplicar aprovadas e descartar ficam com um **Admin** ou **Owner**, porque alteram etiquetas no Azure ou contam nos indicadores. Aplicar, herdar e aplicar aprovadas exigem também o plano **Business**, como o resto da correção de etiquetas: no Professional você vê as sugestões, mas não as aplica. Se um botão está desabilitado, ao passar o mouse ele diz por quê.

**Indicadores.** No canto superior direito da seção, duas linhas resumem os últimos 90 dias: quantos recursos foram corrigidos e que parte foi **por regra**, **com IA** e **manualmente** (sem sugestão ou com um valor diferente do sugerido), e a **Aceitação de sugestões**: quantas sugestões foram aplicadas como vieram, entre as aplicadas ou descartadas. O botão **Histórico** (3.1) mostra a evolução diária da conformidade, dos recursos não conformes e dos que têm valores não permitidos. A foto do dia é tirada ao varrer todas as assinaturas, não ao filtrar uma.

**Cota da IA.** 50 pedidos por mês para a sua organização no Professional e 150 no Business; o Enterprise não tem cota. Cada **Sugerir com IA** ou **Propor com IA** que chega à IA conta um. Se a plataforma já tem a resposta para esse mesmo lote, não conta. Com a sua própria chave de IA (BYOK) não há cota.

**Se a IA não estiver disponível** (desativada na plataforma ou para a sua organização, sem cota, com pedidos demais em sequência, ou porque a sua organização não compartilha etiquetas ou nomes de recursos com a IA), o botão mostra o motivo. As regras e a correção manual continuam funcionando igual.

**O que a IA vê.** Uma etiqueta por pedido, e até 50 valores ou recursos. Para corrigir valores: os valores não resolvidos, a lista de permitidos e, se a sua organização compartilha nomes de recursos, alguns nomes e tipos dos recursos que os usam. Para propor valores faltantes: o nome, o tipo e o grupo de cada recurso, as suas etiquetas das outras políticas e os valores que você já usa. Nunca o resto das suas etiquetas, que podem trazer nomes ou e-mails. O que se compartilha é configurado em **Configuração de IA → Quais Dados São Compartilhados**.

**Na demo** você vê valores não conformes e etiquetas faltantes de exemplo, com sugestões por regra e por IA. A IA não é chamada de verdade, e aplicar só altera os dados de exemplo.

### 7.2. Relatório de Governança (`/governance/reporting`, Enterprise+)

Painel executivo unificado. No centro está o **Score de Segurança Financeira**, um índice de 0 a 100 que
pondera quatro pilares: conformidade do Azure Policy (40%), higiene de etiquetas obrigatórias (30%), higiene
das atribuições RBAC (20%) e controle de recursos zumbis (10%).

**Quando um pilar não pode ser medido** —porque o Service Principal não tem permissões, ou porque não há
políticas atribuídas— ele não conta como 0 nem como 100: fica marcado como "não mensurável" e seu peso é
redistribuído entre os demais. "Ver detalhamento por pilar" mostra o peso nominal e o efetivo de cada um.

**O que mais você encontra:**
- Conformidade do Azure Policy com detalhe expansível dos recursos não conformes.
- Inventário de recursos por tipo e por região, com o que fica fora do topo agrupado em "Outros" para que a
  soma feche com o total.
- Atribuições RBAC por tipo de principal, com **auditoria de SIDs órfãos**: atribuições cujo usuário ou
  aplicação já não existe no diretório. Hoje não dão acesso a ninguém, mas se o Azure reutilizar aquele
  identificador a permissão revive sobre outro principal.
- Exportação para **PDF executivo** e para **CSV** com o conjunto de dados completo.

### 7.3. Controle de Máquinas Virtuais — Horários de Desligamento (`/governance/power`, Business+)

Rotinas automáticas de ligar e desligar VMs fora do horário produtivo, mais controle manual ao vivo.

**Dois modos de agendamento:**
- **Hora única:** executa a ação (ligar / desligar / reiniciar) uma só vez, em data e hora exatas.
- **Recorrente:** você escolhe a hora e os dias da semana. O padrão "de–até" é montado com duas regras: uma de
  ligar e outra de desligar, sobre os mesmos dias.

**Smart Shutdown.** Antes de cada desligamento agendado, o sistema consulta a CPU real da VM nos últimos 30
minutos. Se estiver acima do limiar (5% por padrão, ajustável), **adia o desligamento** e o registra como
omitido, em vez de derrubar uma máquina que está trabalhando. Ajuste o limiar em "Calibrar Limiar": muito alto
desliga máquinas com trabalho em curso; muito baixo faz o ruído do sistema operacional cancelar todos os
desligamentos e a economia nunca se materializa.

**Economia fora de horário.** O primeiro KPI mostra o gasto mensal que você já recupera com os horários
ativos, e quanto mais há disponível nas VMs ligadas sem agendamento. O cálculo usa a janela real de cada VM
—do desligamento até o próximo acionamento—, não uma constante: um fim de semana sem acionamento agendado
estende o desligamento de sexta até segunda.

**Controle ao vivo.** A tabela inferior lista todas as VMs com estado, tamanho, CPU atual e gasto. Selecione
várias e aplique Desligar / Ligar / Reiniciar em lote. O badge de estado muda imediatamente enquanto o Azure
processa a operação, e se corrige sozinho se algo falhar ou se o Smart Shutdown omitir o desligamento.

**Detalhes operacionais:**
- O fuso horário é salvo como nome IANA, então o horário continua disparando na hora local correta quando muda
  o horário de verão.
- O sistema revisa horários pendentes a cada poucos minutos, mais uma verificação imediata ao salvar.
- Se o Azure Monitor não devolver métricas de uma VM, a coluna de CPU mostra **"s/d"** em vez de 0%: um zero
  seria lido como "ociosa" e poderia levar você a desligar uma máquina sem telemetria.

### 7.4. Recomendações de Alta Disponibilidade (`/governance/ha`, Business+)

Detecta máquinas virtuais, bancos de dados e recursos cloud sem redundância zonal, geográfica ou sem backup.

**Cada lacuna informa qual SLA você tem hoje e qual alcançaria**, traduzido em minutos de indisponibilidade
mensal — porque "99,9%" não significa nada até virar 43,2 minutos por mês, e 99,99% virar 4,3. O drawer "Ver
Arquitetura" mostra a topologia, a comparação de SLA e o custo adicional estimado antes da decisão.

**O que é detectado:** VMs sem zona nem Availability Set, recursos sem backup, bancos sem failover group nem
geo-redundância, App Service Plans com uma única instância e IPs públicos em SKU Basic.

**Sobre os IPs Basic:** aparecem com SLA 0, não 99,9. A Microsoft não publica SLA para essa SKU — não é que
seja baixo, é que não existe.

**Sobre os backups:** um backup não melhora a disponibilidade, melhora o RPO (quantos dados você perde se algo
falhar). Por isso, nessas linhas, o SLA atual e o projetado coincidem: não prometemos uma melhoria que não
acontece.

**O que dá para remediar daqui:** apenas a migração de SKU de IP público e a associação de uma política de
backup, ambas operações idempotentes no Azure. Distribuir em zonas ou habilitar geo-redundância exige recriar
o recurso ou escolher uma região secundária — nesses casos, "Remediar" entrega o blueprint da mudança com o
comando exato, para que a equipe de infraestrutura planeje.

**Isenções.** Se uma carga não produtiva não justifica redundância, você a isenta com uma justificativa. Deixa
de contar nos KPIs mas segue visível no botão de histórico, e a justificativa fica registrada com o seu
usuário — alguém terá que defendê-la na próxima auditoria.

### 7.5. Credenciais por Expirar — Entra ID (`/governance/credentials`, Business+)

Inventário de segredos e certificados de App Registrations e Service Principals, em duas abas.

**Aba Credenciais.** Cada linha mostra o estado —**Vigente** (mais de 30 dias), **Próximo a Vencer** (30 dias
ou menos) ou **Expirado**—, a data de vencimento, os dias restantes exatos e o App ID com botão de cópia. Os
dias são recalculados a cada consulta: uma credencial passa de vigente a por vencer sem que ninguém a toque.

**Rotação de segredos.** O botão "Rotacionar" gera um segredo novo via Microsoft Graph com a vigência que você
escolher (6, 12 ou 24 meses).

> **Importante:** a rotação **não revoga o segredo anterior**, e isso é proposital. Revogar no mesmo passo
> deixaria fora do ar tudo que ainda o usa — exatamente o incidente que este módulo previne. A ordem correta
> é: rotacionar, migrar os consumidores para o segredo novo e só então excluir o antigo pelo portal do Entra
> ID.
>
> O valor do segredo **é exibido uma única vez**. O Microsoft Graph não o devolve novamente e a plataforma não
> o guarda em lugar nenhum. Copie na hora e armazene no Azure Key Vault.

Certificados não são rotacionados aqui: são renovados enviando a chave pública, um procedimento diferente.

**Aba Alertas Configurados.** Regras de aviso prévio ao vencimento. Cada regra aceita **vários limiares** (por
exemplo 60, 30 e 7 dias), e cada um dispara um aviso independente — um único lembrete a 7 dias raramente basta
para coordenar uma rotação com todas as equipes consumidoras. Escolha os canais (Email, Teams, Slack, Webhook)
e os destinatários, e habilite ou desabilite cada regra com um interruptor.

### 7.6. Políticas Auto-Block (`/governance/policies`, Enterprise+)

Prevenção de custos já no provisionamento, com Azure Policy: restrições que impedem que o gasto indesejado
chegue a existir.

**O que você vê:** a conformidade global do ambiente, o detalhamento por categoria de recurso, o estado de cada
iniciativa de governança e a tabela de políticas ativas com seu efeito (`Deny`, `Modify`, `Audit`,
`DeployIfNotExists`), seu escopo e quantos recursos cada uma descumpre.

Tudo vem do Azure Policy ao vivo. **Se o seu ambiente não tem políticas atribuídas, você verá 0 avaliações** e
uma mensagem explicando o motivo — não uma porcentagem estimada.

**Implantar uma política.** O assistente permite escolher o escopo (management group ou assinatura) e um dos
modelos predefinidos: restringir tamanhos de VM, bloquear IPs públicos em sandbox, herdar etiquetas, exigir
CostCenter, restringir regiões ou auditar storage sem HTTPS. Cada modelo explica que custo evita.

> Uma política `Deny` **bloqueia novas criações mas não reverte o que já existe**. Os recursos anteriores à
> atribuição vão aparecer como não conformes até serem corrigidos manualmente ou com uma política `Modify`. O
> Azure leva até 30 minutos para concluir a primeira avaliação.

**Remediar.** O botão de remediação cria uma tarefa do Azure Policy que corrige os recursos existentes. Só
aparece em políticas `Modify` e `DeployIfNotExists`: são os únicos efeitos que o Azure consegue aplicar
retroativamente. Não é oferecido em `Deny` nem em `Audit`, onde a tarefa terminaria com zero recursos
corrigidos.

**Ver recursos não conformes** abre um painel lateral com cada infração e seu motivo.

### 7.7. Aprovações de Remediação (`/governance/approvals`, Business+)

Fluxo de controle sobre as mudanças de infraestrutura propostas pelos motores de otimização. Funciona sob o
**princípio dos quatro olhos**: quem solicita a mudança não pode aprová-la.

**Solicitações pendentes.** Cada cartão mostra o recurso, a ação proposta, quem solicitou, a economia mensal
que libera e os avisos pertinentes — se a VM será reiniciada, se a ação é irreversível.

**Aprovar executa a mudança no Azure imediatamente.** Não é uma mudança de estado em uma lista: a plataforma
chama o Azure Resource Manager e o resultado real fica no histórico. Se o Azure rejeitar a operação, a
solicitação aparece como **Falha** com a resposta literal do erro, não como aprovada.

**Controles de segurança:**
- **Snapshot prévio.** Ao excluir um disco você pode pedir um snapshot de backup. Se o snapshot falhar, a
  exclusão **não é executada**: você pediu uma rede de proteção e, sem ela, a ação não avança.
- **"Aprovar tudo o que é seguro"** cobre apenas ações não destrutivas e que não reiniciam serviço. Excluir um
  disco ou redimensionar uma VM produtiva exige decisão consciente, não um clique em massa.
- **Rejeitar exige um motivo**, que é notificado ao solicitante. Sem ele, a mesma solicitação volta na semana
  seguinte.

**Histórico de decisões.** Trilha de auditoria completa: quem resolveu, quando, o que o Azure respondeu e —se
foi criado— o identificador do snapshot de backup. O KPI de "Economia Liberada" soma **apenas o que o Azure
confirmou**: uma aprovação que falhou não liberou nada e não é contada.

### 7.8. Alertas Self-Service (`/governance/alerts`, Professional+)

Regras de alerta financeiro que você mesmo cria, sem pedir nada ao suporte, com entrega para Microsoft Teams, Slack, webhooks, e-mail e ServiceNow. São criadas com um assistente de **3 passos** (*Configuração de disparo e destino*).

**Quatro tipos de alerta:**

| Tipo | Dispara quando… |
|---|---|
| **Orçamento (% de consumo)** | o gasto supera uma porcentagem do orçamento |
| **Limite fixo ($ USD)** | o gasto supera um valor em dólares |
| **Anomalia estatística (+% desvio)** | o gasto se desvia do habitual mais do que a porcentagem escolhida |
| **Forecast de fechamento do mês (> % EOM)** | a projeção para o fim do mês supera a porcentagem escolhida |

**Alcance.** Cada regra pode olhar o **tenant inteiro**, uma **assinatura**, um **grupo de recursos** ou um **centro de custo** (por tag). A **prévia da condição** mostra em uma frase quando o alerta será emitido (*«quando o gasto em X superar Y sob o critério de Z»*) antes de salvar.

**Tabela de regras.** Você busca por nome, assinatura ou canal; filtra por tipo, canal e estado (ativas ou pausadas); ordena por mais disparadas, última ativação, nome ou limite. Cada regra é **pausada com um interruptor**, **editada** sem se duplicar, e tem **«Testar envio»**, que despacha uma notificação de teste ao canal para verificar a entrega antes de depender dele. As colunas *Última ativação* e *Disparos* dizem se a regra está viva.

Os canais de entrega são configurados em **Configuração → Notificações** (8.5).

### 7.9. Fim de suporte (`/governance/lifecycle`, Business+)

**O que roda sobre uma versão que o Azure aposenta, quando, e quanto custa hoje.** Ficar em uma versão aposentada tem dois finais e os dois se pagam: uma migração de urgência sem orçamento, ou suporte estendido pago. Vê-lo com meses de antecedência permite planejá-lo.

Cruza o inventário do seu tenant contra o calendário de aposentadorias do Azure. Hoje cobre **AKS** (versão do Kubernetes), **PostgreSQL Flexible Server** e **MySQL Flexible Server**.

**No topo**, um resumo: *«N recursos em risco — $X por mês rodando sobre algo que o Azure aposenta dentro do ano, ou que já aposentou»*.

**A tabela** mostra por recurso o produto, a versão, o **estado**, a data de **fim de suporte** (*faltam N dias* ou *venceu há N dias*), a data de suporte estendido pago quando existe, e o **custo mensal**. O estado é um semáforo por janela:

| Estado | Significa |
|---|---|
| **Aposentado** | O Azure já aposentou essa versão |
| **Menos de 90 dias** | Crítico: a aposentadoria é iminente |
| **Menos de um ano** | Próximo: há tempo para planejar |
| **Suportado** | Com suporte além de um ano |
| **Sem dados** | Não se pode afirmar nada |

**A regra que dá nome à tela: ausência de dado nunca é «suportado».** Um recurso cuja versão não pôde ser lida, uma versão posterior à última que o catálogo conhece, ou um tipo de recurso que o catálogo não cobre, são marcados **Sem dados**. O mesmo com o custo: um recurso sem custo atribuível aparece como *sem dado* e é informado à parte —não se soma como zero—, porque somá-lo baixaria o total e faria o risco parecer menor.

**De onde saem as datas.** Da documentação da Microsoft, mantidas em um catálogo próprio —não de uma API do Azure—. Por isso a tela mostra a **data da última revisão do catálogo**: se ficou velho, ela diz. Quando o Azure publica o fim de uma versão como um mês (por exemplo «Mar 2026») significa o **último dia** desse mês, e assim é carregado.

**O que ainda não cobre:** os servidores lógicos do Azure SQL (a versão deles é a do servidor, que não se aposenta; o fim de suporte do SQL vive no nível de compatibilidade de cada banco), os runtimes do App Service, as séries de VM e as licenças na nuvem.

Esta tela não é mostrada a usuários com alcance atribuído: é o inventário de toda a plataforma, não a parcela de um time.

### 7.10. Shift-Left FinOps (`/governance/shift-left`, Business+)

**O custo se decide quando alguém escreve o `.tf`, não quando chega a fatura.** O Shift-Left leva o impacto econômico de uma mudança de infraestrutura para a revisão do **Pull Request**, que é onde ainda é barato corrigi-lo. Funciona sobre Terraform. No menu, fica em **Governança → Shift-Left (PRs)**.

**Como funciona.** No pipeline do PR gera-se o plano (`terraform plan`), uma action do GitHub o envia à plataforma, e a plataforma estima o **delta de custo mensal** com os **preços de tabela do Azure**. O resultado volta como comentário no Pull Request (que é editado a cada push, não se acumula) e pode **fazer o check falhar** se o aumento superar um limite. A action e o seu exemplo de workflow são descritos em 11.10, e ela precisa de uma API Key com a permissão `write:shift-left`.

**Como ler o número.** O delta é um **piso, não um total**: precifica-se o que a plataforma sabe mapear a um medidor da Azure Retail Prices API —hoje **máquinas virtuais Linux e Windows, discos gerenciados e IPs públicos**—; o resto é contado à parte como *sem precificar* e aparece no comentário, e se esse número não é zero o custo real é maior. São **preços de tabela**: não incluem as suas reservas, Savings Plans, descontos EA/CSP nem markup. Serve para comparar o antes contra o depois de um PR, não substitui o custo real que a plataforma mostra.

**O que você vê na tela.**
- Quatro KPIs: **Planos analisados**, **Aumento detectado**, **Economia detectada** e **Bloqueados por limite**.
- O **histórico**: uma linha para cada `terraform plan` analisado, com repositório, autor, custo *antes* e *depois*, **delta mensal**, estado do limite (*Dentro do limite*, *Limite superado* ou *Sem limite*) e data. Se há recursos que não puderam ser precificados, a tela avisa que **o delta é um piso, não o total**.

**Budget Gates.** Você define, por repositório, quantos USD por mês um Pull Request pode adicionar. Se superar, o check do GitHub falha. Como os limites se combinam:

- O `threshold-usd` do workflow, se existir, **vence** sobre o da plataforma: um time pode ser mais estrito no seu próprio pipeline, não mais frouxo.
- Sem nenhum limite o gate fica *não avaliado*: informa e não bloqueia.
- Se a plataforma não responde, **também não bloqueia**: é um controle de custo, e parar o trabalho de um time por uma queda nossa é pior do que deixar passar uma mudança cara.
- Só um **Admin ou Owner** pode alterar os limites.

**Limites atuais.** Apenas Terraform (não Bicep) e apenas GitHub (não Azure DevOps). O limite é em USD absolutos —não percentual—, e o desbloqueio de um PR bloqueado se resolve com os mecanismos do próprio repositório (outro commit, ou as regras de proteção de branches): a plataforma não tem um fluxo de aprovação próprio.


---

## 8. Seção Administração

### 8.1. Suporte (`/support`, todos os planos a partir do Professional)

Qualquer usuário do tenant pode abrir tickets para a CSCloudSolutions e acompanhar a conversa dentro da plataforma.

**Como criar um ticket:**
1. Preencha assunto, categoria (Técnico / Faturamento / Dúvida / Pedido de feature), prioridade e mensagem inicial.
2. Você pode anexar capturas de tela ou arquivos (`jpg`, `jpeg`, `png`, `txt`, `json`; máx. 5 MB por arquivo, 10 por ticket) — mantidos por 60 dias e depois excluídos automaticamente.
3. As respostas da equipe de suporte aparecem marcadas com 🛟 no tópico. Você pode responder enquanto estiver aberto, e fechar/reabrir você mesmo.
4. **Acesso rápido:** o ícone de boia junto ao seu usuário no cabeçalho abre o Suporte de qualquer página. Quando seu ticket é respondido, você vê uma notificação no sino 🔔.

**Cotas por plano:**

| Plano | Tickets/mês | SLA de primeira resposta |
|---|---|---|
| Professional | 20 | 24 h |
| Business | Ilimitados | 8 h |
| Enterprise | Ilimitados | 4 h |

**O que você vê na tela:**

- **Quatro indicadores no topo:** tickets abertos (incluindo os que aguardam sua resposta), em
  andamento, resolvidos, e o SLA de primeira resposta do seu plano.
- **Solução de problemas:** uma seção retrátil com as perguntas frequentes e um campo de busca. Muitas
  dúvidas se resolvem aqui sem abrir um ticket.
- **Tabela dos seus tickets** com número, assunto, categoria, prioridade, status, última atualização e
  **SLA restante** em contagem regressiva. Arraste a borda direita de qualquer cabeçalho para
  redimensionar a coluna, escolha quais colunas ver em *Personalizar colunas*, e pagine de 15 em 15 (ou
  30/45/60). Essas preferências ficam salvas no seu navegador.
- **Conversa em painel lateral:** o botão *Ver conversa* abre o histórico à direita sem perder a tabela.
  Você pode anexar vários arquivos de uma vez, arrastando-os; as imagens aparecem com pré-visualização
  ampliável e os logs são baixados.

**Sobre o SLA restante:** o contador mede o tempo até a **primeira resposta** da equipe. Depois que
respondemos ele para, mesmo que o ticket siga aberto. Se o ticket estiver aguardando sua resposta, ele
também não corre — a bola está do seu lado.

**Módulo afetado (opcional):** ao criar o ticket você pode indicar de qual módulo se trata (Defender,
Recursos zumbis, Rateio de custos, Alertas, Agendamentos de desligamento, Governança de tags). Não é
obrigatório, mas acelera o encaminhamento para a equipe correta.

**IA no atendimento:** se a sua organização tem a IA habilitada, a equipe pode usá-la para classificar o
ticket e preparar um rascunho de resposta a partir deste manual. Uma pessoa sempre o revisa antes de
enviá-lo. Se você desativar a IA da sua organização, ou não compartilhar nomes de recursos nem tags com
a IA (*Configuração → IA*), os seus tickets não passam pela IA.

### 8.2. Usuários e Acessos (`/admin/access`)

O hub tem cinco abas: **Usuários e Permissões** (o que descreve esta seção), **Segurança (2FA)** (seção 10), **SSO SAML** (11.1), **Onboarding de Clientes** (1.2 e 1.3) e **Onboarding Lighthouse** (Enterprise, para delegar o acesso de um cliente sem pedir credenciais).

Veja a seção 2 para o detalhe de papel vs. permissões. Pela aba **Usuários e Permissões** você adiciona usuários, edita seu papel, ajusta o alcance de módulos ou remove o acesso. Somente Admin e Owner do tenant entram nesta tela.

**Quatro indicadores no topo:** usuários registrados (e quantos seu plano permite), administradores e
owners, leitores, e a **conformidade de 2FA** da sua equipe.

**Adicionar um usuário — sem copiar GUIDs.** Digite o nome ou o e-mail da pessoa: a plataforma busca no
seu diretório do Entra ID e mostra as correspondências. Ao escolher uma, o campo *Entra ID (OID)* é
preenchido sozinho e fica marcado com um check verde. Depois escolha o papel base e o alcance de páginas
(*Acesso total aos módulos*, *Somente Visibilidade e FinOps*, ou *Somente Limpeza e Governança*).

As sugestões avisam quando alguém **já está adicionado** ao tenant ou quando a **conta está
desabilitada** no Entra ID.

**Sincronizar do Entra ID** abre um painel com duas formas de cadastro em lote:

1. **Por usuários:** a lista do diretório, com seleção múltipla e papel por pessoa.
2. **Por grupo de segurança:** escolha um grupo (por exemplo `FinOps-Engineers`) e um papel padrão, e
   todos os membros são provisionados de uma vez. O papel **Owner não pode ser atribuído por grupo**: a
   transferência de propriedade é feita usuário por usuário, de propósito. Se o grupo tiver mais membros
   do que seu plano permite, o excedente é ignorado e informado.

**A tabela de usuários** mostra nome com iniciais, e-mail, o OID abreviado com botão de cópia, o papel
(editável em um clique na própria célula), o alcance de páginas, o status de 2FA e o último acesso. Como
todas as outras tabelas: colunas redimensionáveis, seletor de colunas visíveis, paginação 15/30/45/60 e
preferências salvas no seu navegador.

**Status de 2FA — três valores, não dois:**

| Badge | O que significa |
|---|---|
| **2FA ativo** | A pessoa tem um segundo fator registrado no Entra ID. |
| **Pendente** | O Entra ID confirmou que **não** há segundo fator registrado. |
| **Sem dado** | O Entra ID ainda não respondeu por esse usuário. **Não** significa que falte 2FA. |

O indicador de conformidade é calculado apenas sobre os usuários com dado conhecido, e informa quantos
ficaram sem dado. Se a plataforma não tiver a permissão do Graph para ler o relatório de métodos de
autenticação, a coluna fica em "Sem dado" para todos — e não em 0% de conformidade. O botão *Atualizar
2FA* consulta o Entra ID novamente quando você precisar.

**Permissões granulares** (botão *Permissões* em cada linha) abre um painel lateral com um interruptor
por módulo: Visibilidade, Inteligência financeira, Limpeza de nuvem, Governança, Segurança, e
Administração e suporte. Desligar um módulo o remove do menu daquele usuário **e** bloqueia o acesso se
ele tentar entrar digitando a URL. Abaixo você pode limitar quais assinaturas do Azure ele vê: sem
nenhuma marcada, ele vê todas as do tenant.

#### Alcance por equipe: restringir uma pessoa à sua parcela do gasto (Enterprise)

As **permissões de domínio** (seção 2) decidem quais *páginas* uma pessoa vê; o **alcance por equipe** decide qual *parcela dos dados* ela vê. Serve para que o responsável por um time entre na plataforma e veja só o gasto do seu grupo de uma Perspective (5.3), sem ver o do resto da organização.

**Não é um filtro de tela: o servidor o aplica.** Com um alcance atribuído a API devolve só a sua parcela —mudar um parâmetro na URL não mostra mais— e os totais e porcentagens dos painéis são calculados sobre essa parcela. As telas que ainda não sabem se restringir **negam o acesso** em vez de mostrar o tenant inteiro: na dúvida, o sistema falha fechado.

**Como se atribui.** Um Admin ou Owner o faz, só em um tenant Enterprise, em **Usuários e Acessos → Usuários e Permissões**: a coluna **Equipe (dados)** mostra o alcance de cada pessoa (*Todo o tenant* se não tiver) e o botão **Restringir** abre a escolha de **Perspective** e **Grupo** (*todos os grupos* é a Perspective inteira, sem o não atribuído). Antes de salvar, o diálogo diz quais telas vão sobrar. **Alterar** substitui o alcance e o **✕** o remove. Não é oferecido para um Admin ou Owner.

Pela API: `POST /api/admin/user-scopes` (`tenantId`, `email`, `perspectiveId` e `group` opcional), `GET /api/admin/user-scopes?tenantId=…` e `DELETE /api/admin/user-scopes?tenantId=…&email=…`. A resposta do POST inclui **quantas telas sobram** (`screensWhenScoped`): atribuir às cegas seria atribuir sem saber o que se está tirando.

**Regras.**

- **Um alcance por usuário.** Atribuir outro substitui o anterior.
- **Somente Reader e Colaborador.** Um usuário **Admin ou Owner não pode ter alcance**: poderia emitir para si uma chave de API —que é do tenant, não dele— e contornar o recorte.
- Se a Perspective é excluída, o alcance de quem a tinha atribuída é eliminado junto.

**O que a pessoa restrita vê.** Somente as telas que hoje sabem se restringir a um grupo, todas recortadas à sua parcela: o **Whiteboard**; em **Consumo e Orçamento**, as abas Grupos de Custos, Orçamento por Grupos de Custos e Gastos e Projeção; em **Analítica Avançada**, o Scorecard (Fama); e em **Armazenamento**, a aba *Storage Accounts*. O resto responde com acesso negado. O menu lateral mostra só esses lugares: cada hub a leva direto à sua primeira aba permitida e, dentro, as abas que não sabem se restringir não aparecem. O seletor de Perspective fica fixo com cadeado e as Visões não são mostradas. É um produto pequeno de propósito: cresce à medida que mais painéis aprendem a se restringir.

### 8.3. Configuração (`/admin/config`)

Hub com cinco abas:

| Aba | O que você faz ali |
|---|---|
| **Geral** | Aparência (tema claro, escuro ou do sistema), **Ano fiscal** (o mês em que começa o exercício, 5.1.5), marca (o logo do tenant) e integrações: webhook de alertas, ITSM e o feed para Power BI |
| **IA** | Habilitar ou desabilitar funções de IA, escolher o modelo, ajustar a sensibilidade das detecções e quais dados são compartilhados (Professional+) |
| **Notificações** | Canais de entrega: Slack, Teams, e-mail e webhook (8.5) |
| **Status da Conta** | Suas assinaturas do Azure, o estado da ingestão e o vencimento de credenciais; daqui você desvincula e revincula assinaturas para escolher quais são monitoradas (15) |
| **Partner Markup (CSP)** | Margens configuráveis por serviço para parceiros CSP, aplicadas automaticamente no faturamento (Enterprise) |

### 8.4. Faturamento — Mudança de Plano (`/admin/billing`, Professional+, papel Owner)

**Limites por Plano:**
| Plano | Assinaturas do Azure Permitidas | Usuários por Tenant | Suporte / SLA |
|---|---|---|---|
| **Professional** | Até 2 assinaturas | Até 3 usuários | 20 tickets/mês (24 h) |
| **Business** | Até 3 assinaturas | Até 5 usuários | Tickets ilimitados (resposta em 8 h) |
| **Enterprise** | Ilimitadas | Ilimitados | Suporte dedicado, tickets ilimitados (SLA máximo 4 h) |

**Procedimento de mudança:**
1. Escolha o novo plano (Professional / Business / Enterprise).
2. Escolha frequência (mensal/anual) e modo de rateio.
3. O sistema mostra um **resumo prévio** com o valor real calculado pelo gateway de pagamento antes de confirmar: *"Você será cobrado $X agora"* (upgrade) ou *"Você receberá um crédito de $X"* (downgrade), o novo total recorrente e a data da próxima cobrança.
4. A mudança **só se aplica** ao clicar em **Confirmar mudança** — até esse momento você pode cancelar sem custo.

#### 8.4.1. Controle de Cotas de Assinaturas Azure e Modal de Upgrade
A plataforma valida de maneira automática o total de assinaturas Azure conectadas:
- **Professional:** Até 2 assinaturas Azure vinculadas.
- **Business:** Até 3 assinaturas Azure vinculadas.
- **Enterprise:** Assinaturas ilimitadas com gestão multi-conta.

Se você tentar conectar uma assinatura excedendo a cota do seu plano, o **Modal Dinâmico de Upgrade** será exibido automaticamente para atualização via Paddle.


#### 8.4.2. Ampliar capacidade sem mudar de plano (add-ons)

Se você precisa de mais assinaturas do Azure ou mais tenants mas não quer subir de plano, em **Administração → Faturamento** você encontra o cartão **Ampliar capacidade**.

No topo você vê quanto está usando: *"Você está usando 3 de 3 assinaturas do Azure"*.

**Como contratar:**
1. Digite a quantidade **total** que deseja ter (não quantas adicionar). Se já tem 2 e quer 5, digite `5`.
2. Pressione **Contratar**. Se digitar um número menor, o botão muda para **Reduzir**.
3. A mudança é rateada automaticamente na próxima fatura.

**A capacidade não é liberada na hora:** ativa alguns segundos depois, quando o gateway de pagamento confirma. Se não aparecer de imediato, aguarde e recarregue.

**Preço de tabela por unidade** (o cartão mostra o preço vigente, o que o gateway de pagamento cobra):

| Add-on | Professional | Business |
|---|---|---|
| Assinatura do Azure adicional | $40/mês | $40/mês |
| Tenant adicional | $90/mês | $240/mês |

**Enterprise não usa este cartão:** sua capacidade é ajustada por contrato. Fale com seu executivo de conta.

Se o cartão mostrar *"A contratação on-line não está disponível"*, é porque sua conta não tem assinatura paga ativa (por exemplo, em trial ou com plano gerenciado comercialmente). Entre em contato que resolvemos.


### 8.5. Configuração de Notificações (`/admin/notifications`, Professional+)

Três canais suportados: **Slack**, **Microsoft Teams**, **Email (SMTP)**. Além dos alertas que você configura, por esses canais chegam avisos automáticos da plataforma, como o **vencimento de reservas** a 90, 60 e 30 dias (5.4.4).

#### 8.5.1. Central Global de Notificações (Sino na Barra Superior)
- **Sino Interativo:** Ícone `IconBell` com badge em azul corporativo (`#0078D4`) indicando alertas não lidos.
- **Filtros Dinâmicos:** Classificação entre *Todas*, *Não Lidas*, *Info*, *Avisos* e *Críticas*.
- **Ações Rápidas:** *"Marcar todas como lidas"* e links diretos para as anomalias, relatórios ou tickets de suporte envolvidos.

**Configurar Slack:**
1. Acesse `https://api.slack.com/apps` → crie ou selecione um app → **Incoming Webhooks**.
2. **"Add New Webhook to Workspace"** → escolha o canal de destino.
3. Copie a URL do webhook (começa com `https://hooks.slack.com/services/...`).
4. Na plataforma: **Notificações** → **Adicionar canal** → **Slack** → cole a URL → salvar.

**Configurar Microsoft Teams:**
1. No canal do Teams → **⋯** → **Connectors** → procure "Incoming Webhook".
2. Configure o webhook e dê um nome.
3. Copie a URL gerada.
4. Na plataforma: **Notificações** → **Adicionar canal** → **Microsoft Teams** → cole a URL → salvar.

**Configurar Email:**
- Usa SMTP. Se sua organização não especificar um servidor próprio, é usada a configuração SMTP padrão da plataforma.
- Você pode definir múltiplos destinatários e, opcionalmente, sobrescrever host/porta/usuário/senha SMTP por canal.

**Filtro de severidade:** cada canal pode filtrar o que recebe — `info`, `warning`, `error`, ou combinações (ex.: `warning,error` para não receber informativos).

**Testar o canal:** botão de teste em cada canal configurado — envia uma notificação de teste antes de você depender dele em produção.

**Disponibilidade por tier:** Professional permite 2+ canais; Enterprise permite canais ilimitados + overrides de SMTP por canal.

**Se as notificações não chegam**, verifique nesta ordem: canal habilitado (`enabled = true`) → filtro de severidade corresponde ao nível do alerta → você testou o canal pela interface → há pelo menos um canal configurado para o tenant. O log de envios (com erros) está disponível para diagnóstico.

### 8.6. Relatórios e Exportação (`/admin/reports`, Professional+)

Hub com sete abas:

| Aba | Plano | O que faz |
|---|---|---|
| **Relatório Executivo** | Business+ | Geração automatizada de relatórios de alto nível, pensados para apresentar à diretoria: resumo executivo baixável em PDF e com envio por e-mail |
| **Histórico de Relatórios** | Business+ | Os relatórios executivos já gerados, para reabrir ou baixar |
| **Relatório de Faturamento** | Business+ | Faturas showback/chargeback por cliente ou centro de custo (11.4) |
| **Workbooks** | Enterprise | Relatórios personalizados: layout próprio, gráficos, tabelas de dados, exportáveis para PDF e compartilháveis por link |
| **Modelos Power BI** | Enterprise | Modelos `.pbit` baixáveis, pré-conectados aos seus dados do SaaS |
| **Exportação FOCUS 1.1** | Professional+ | Seus dados no formato padrão FOCUS, programáveis para geração diária automática (11.5) |
| **Assinaturas** | Professional+ | Relatórios por e-mail na cadência que você escolher (abaixo) |

#### Assinaturas de relatórios

*Em uma ferramenta de FinOps, o relatório que é preciso ir buscar não é olhado.* Uma assinatura faz o relatório **chegar sozinho**, na cadência que cada um escolher, com **link para o relatório, gráfico e CSV anexo** dos dados brutos (o CSV é o que permite ao financeiro cruzá-lo com o seu próprio modelo).

**Criar uma assinatura** (Admin ou Owner, porque envia e-mail a terceiros): **Nova assinatura** e preencha:

| Campo | O que é |
|---|---|
| **Relatório** | Hoje há um tipo: **Gasto por time** (o desvio do gasto de um grupo) |
| **Frequência** | *Todos os dias*, *Semanal* (com o dia da semana) ou *Mensal* (com o dia do mês) |
| **Destinatários** | E-mails separados por vírgula; é preciso pelo menos um |
| **Perspective e Grupo** (opcional) | Para enviar só o gasto de um time: quem se assina ao seu grupo não recebe o dos demais. Escolhem-se na lista de Perspectives do tenant (Enterprise); sem Perspective, o relatório é do tenant inteiro |

**O que convém saber:**

- **A cadência é avaliada no fuso horário do seu tenant**: «as segundas» são as segundas da sua organização, não as do servidor.
- **Um dia 31 não pula os meses curtos**: envia-se no último dia do mês.
- **Envia-se uma única vez por período**, embora o sistema verifique a cada hora.
- **Um relatório sem dados não é enviado.** Um e-mail com a tabela vazia seria lido como «seu time não gastou nada», e quase sempre significa que a ingestão ainda não rodou.
- **Um e-mail por destinatário**: ninguém vê quem mais o recebe, e um retorno não afeta os demais.
- **Se quem criou a assinatura deixa de estar ativo** no tenant, a assinatura fica **desativada** e deixa de enviar.
- **Enviar um de teste agora** usa o mesmo caminho do envio programado e **não conta** como o envio do período.
- O gráfico vai **dentro do corpo do e-mail** (não como imagem anexa) para que se veja igual no Gmail e no Outlook.

### 8.7. Integrações e API (`/admin/integrations`, Enterprise)

Hub com três abas: **Copilot M365** (configuração do tenant e chat assistido sobre os seus próprios dados FinOps), **MCP API Keys** (chaves para integrações com assistentes de IA do tipo MCP: gerar, rotacionar e revogar) e **API Pública** (REST documentada com OpenAPI/Swagger, com limites de uso e monitoramento; veja 11.3).

### 8.8. Faturamento e Auditoria (`/admin/account`, Professional+)

Duas abas: **Faturamento** (plano, cotas, método de pagamento e mudança de plano; veja 8.4) e **Audit Trail** (o log de quem mudou o quê e quando; veja 11.2).

### 8.9. Outros módulos de Administração

| Módulo | Onde está | Plano | Uso |
|---|---|---|---|
| **Azure Lighthouse Onboarding** | Usuários e Acessos → Onboarding Lighthouse | Enterprise | Template ARM para delegação cross-tenant, em `/admin/onboarding/lighthouse` |
| **Configuração de IA** | Configuração → IA | Professional | Habilitar ou desabilitar funções de IA, escolher o modelo, ajustar a sensibilidade e quais dados são compartilhados |
| **Relatório de Faturamento (Invoicing)** | Relatórios e Exportação | Business | Export em JSON/CSV/PBIT stub com detalhe por billing profile, invoice section e customer |
| **Workbooks** | Relatórios e Exportação | Enterprise | Relatórios personalizados exportáveis para PDF e compartilháveis por link |
| **Auditoria** | Faturamento e Auditoria → Audit Trail | Professional | Log completo de quem mudou o quê e quando, filtrável por usuário, ação e data, exportável para compliance |
| **MCP API Keys** | Integrações e API | Enterprise | Chaves de API para integrações do tipo MCP — gerar, rotacionar e revogar |
| **API Pública** | Integrações e API | Enterprise | REST API documentada (OpenAPI/Swagger), com rate limits e monitoramento de uso |
| **Modelos Power BI** | Relatórios e Exportação | Enterprise | Modelos `.pbit` baixáveis, pré-conectados aos seus dados do SaaS |
| **FOCUS 1.1 Export** | Relatórios e Exportação | Professional | Exportação dos seus dados no formato padrão FOCUS, programável para geração diária automática |
| **SSO SAML** | Usuários e Acessos | Enterprise | Você configura o seu Identity Provider, mapeia atributos (papéis, e-mails), testa e ativa para toda a organização |
| **Partner Markup (CSP)** | Configuração | Enterprise | Margens configuráveis por serviço para parceiros CSP, aplicadas automaticamente no faturamento |
| **M365 Copilot** | Integrações e API | Enterprise | Configuração do tenant + chat assistido sobre os seus próprios dados FinOps |

### 8.10. Marketplace de Add-ons: módulos e capacidades à la carte (`/marketplace`)

Se você precisa de uma função ou de uma cota que o seu plano não inclui, **não é preciso mudar de plano**: o Marketplace vende complementos avulsos. Contratam-se com **assinatura mensal rateada** ou com um **passe temporário** de 1, 3, 6, 9 ou 12 meses, e pagam-se pelo mesmo gateway (Paddle) do seu plano.

**O que se vende:**

| Tipo | O que inclui |
|---|---|
| **Funcionalidades** | *Simulador de Compromissos RIs & Savings Plans*, *Auditoria Avançada de Zumbis e Redes*, *Relatórios Executivos em PDF* e os **módulos de navegação**: Inventário de Recursos, Bancos de Dados, Computação, Redes, TTL, Power Schedules, Alta Disponibilidade, Credenciais a Expirar, Aprovações, Otimização e Economia, Armazenamento, Usuários e Licenças, Azure AI, Azure Integration Services, Monitoramento, Segurança, Analítica Avançada, Políticas e Auto-Block e Relatórios de Governança |
| **Cotas e capacidade** | Assinatura do Azure adicional, assentos de usuário extras (+5) e tenant adicional |

**Como se usa:**

1. Filtre por *Funcionalidades* ou *Cotas e capacidade*. Cada cartão explica o que desbloqueia e mostra o preço vigente.
2. **Passe temporário:** escolha a duração e pressione **Ativar Passe**. Paga-se uma vez e, ao vencer, o módulo se desabilita sozinho sem tocar no seu plano base. Se você já tem um ativo, aparece **Estender Passe**.
3. **Assinatura mensal:** **Adicionar à assinatura mensal** soma o complemento à sua assinatura atual com rateio.
4. No topo, **Suas Capacidades e Passes Ativos** mostra o que você tem e os dias que restam a cada passe.

Um módulo comprado abre **tanto a tela quanto as suas APIs**, e você recebe um aviso antes de vencer. A ativação ocorre quando o gateway confirma a cobrança, alguns segundos depois.

O **tenant adicional** —soma outro tenant do Azure ao seu contrato, com a mesma conta e os mesmos acessos, herdando os limites do seu plano— contrata-se em **Faturamento → Ampliar capacidade** (8.4.2): modifica a sua assinatura existente em vez de abrir uma compra à parte, e o Marketplace o mostra para que você o encontre.

Os clientes **Enterprise** têm tudo incluído (verão o selo *Plano Enterprise Ativo*). Se a sua assinatura é faturada pelo **Marketplace da Microsoft Azure**, os módulos adicionais não podem ser contratados daqui: escreva para nós e resolvemos pelo seu canal de compra.

---

## 9. FinOps Copilot (assistente de IA)

Ícone flutuante no canto inferior da tela, disponível em Professional+.

- **Consciência de contexto automática:** o Copilot lê o conteúdo da página em que você está — não é preciso dizer em qual módulo você está. Ao abri-lo, sem digitar nada, ele gera um **relatório executivo** do que está sendo exibido: contexto do módulo, principais achados, oportunidades de economia priorizadas por impacto, riscos e um plano de ação de 7 dias.
- **Perguntas direcionadas:** além do relatório automático, você pode perguntar diretamente. Ex.: em Orçamentos: *"Resuma o estado atual dos nossos orçamentos"*.
- **Sugestões e informações estratégicas:** o Copilot fornece exclusivamente recomendações analíticas, sugestões de otimização de custos e respostas informativas para apoiar a tomada de decisão da equipe — não executa ações corretivas nem modificações diretas na sua infraestrutura.

- **Conversa contínua:** o Copilot lembra a conversa mesmo que você mude de página, então você pode perguntar *«compare este rightsizing com as anomalias que vimos agora há pouco»* e ele resolve a referência ao que foi falado na tela anterior. Lembra as últimas perguntas da conversa (até 8 turnos) e, se um turno antigo contradiz o que a tela mostra hoje, **valem as cifras atuais**.
- **Cota mensal de consultas:** Professional **50**, Business **150** e Enterprise **sem teto**. Se o tenant configura **a sua própria chave de IA** (*Configuração → IA*), o Copilot não tem teto de consultas.
- **Nova conversa:** o botão do cabeçalho do painel apaga o fio para começar do zero (fica desativado enquanto o Copilot está respondendo).
- **Leitura confortável:** a resposta chega palavra por palavra e o painel a acompanha; se você sobe para reler um relatório, ele não te arrasta de volta ao final até que você faça uma nova pergunta.

> O Copilot vive dentro da plataforma: não aparece nas páginas públicas (legais, status, painel do parceiro, demo, login e cadastro) nem antes de iniciar a sessão.

---

## 10. Segurança da Conta (MFA)

Autenticação de dois fatores baseada em TOTP (Google Authenticator, Microsoft Authenticator, Authy, etc.), opcional por usuário, exigida apenas para **operações sensíveis** (excluir um tenant, cancelar assinatura, mudar configuração de faturamento).

**Como ativar:**
1. Vá ao seu perfil → **Configurações de Segurança** → **"Habilitar 2FA"**.
2. O sistema mostra um código QR — escaneie com seu app de autenticação.
3. Digite o código de 6 dígitos exibido pelo app para confirmar.
4. Você recebe **10 códigos de recuperação** — baixe e guarde em um lugar seguro. São exibidos apenas uma vez.

**Quando é solicitado:** ao tentar uma operação marcada como sensível, aparece um modal pedindo seu código de 6 dígitos (ou um código de recuperação se você perdeu o acesso ao autenticador). Cada código de recuperação é de uso único; se você usar os 10, precisa desabilitar e reabilitar o 2FA para gerar um novo conjunto.

**Se você perder o acesso ao autenticador:** use qualquer um dos seus 10 códigos de recuperação para entrar e reconfigurar o 2FA do zero. Se também perdeu os códigos de recuperação, um Admin pode forçar a desativação do seu MFA (fica registrado no log de auditoria).

---

## 11. Funcionalidades Avançadas e Integrações

Esta seção é para usuários técnicos (Cloud Admin, DevOps) que precisam integrar a plataforma com outras ferramentas ou configurar acessos avançados.

### 11.1. SSO SAML (`/admin/sso`, Enterprise, via WorkOS)

Permite que usuários de um cliente Enterprise façam login com seu próprio Identity Provider (Okta, Auth0, AD FS) em vez de — ou além de — Microsoft Entra ID.

**Configuração por cliente:**
1. Vá em **Admin → SSO SAML** (visível apenas no tier Enterprise).
2. Obtenha o `workos_org_id` e `workos_connection_id` no painel da WorkOS (a CSCloudSolutions cria a Organization/Connection lá se não existirem).
3. Preencha o formulário: **Domain** (ex.: `acme.com`), **WorkOS Organization ID**, **WorkOS Connection ID** → ative o toggle **Enable SSO** → salve.
4. Botão **"Gerar Admin Portal"** → abre um link da WorkOS em nova aba; o admin de TI do cliente recebe um email para configurar seu próprio IdP.
5. (Opcional) Botão **"Testar SSO"** → redireciona ao IdP para validar que o login funciona antes de anunciá-lo aos usuários finais.

**Como o usuário final faz login:** na tela de login, escolhe "Login com SSO" em vez de "Entrar com Microsoft" → o sistema o redireciona ao seu próprio IdP → após autenticar, retorna automaticamente ao dashboard.

> ⚠️ Apenas **uma conexão de IdP por tenant** é suportada pelo design atual. O SSO convive com o login da Microsoft Entra ID (MSAL) sem substituí-lo — os dois métodos funcionam simultaneamente, então você não perde o acesso existente ao ativar o SSO. A sessão SSO dura 12 horas.

**Erros comuns:** "SSO not configured" (faltam credenciais da plataforma), "SSO not enabled for this tenant" (o toggle está desligado), "Missing workos_connection_id" (o portal ainda não foi gerado, ou o cliente ainda não configurou seu IdP).

### 11.2. Auditoria — uso avançado (`/admin/audit`, Professional+)

Além do log filtrável (por email, tipo de ação, status e intervalo de datas, 10 linhas por página), você tem 4 formatos de exportação: **CSV (página atual)**, **CSV completo filtrado (streaming)**, **JSON**, **NDJSON**.

**Casos de uso típicos:**
- **Auditoria de conformidade (SOC2):** exporte o intervalo trimestral completo com o botão de exportação filtrada.
- **Investigar um incidente:** filtre pelo email do usuário suspeito + status `FAILURE`.
- **Monitoramento operacional:** filtre por tipo de ação `DELETE` + intervalo de datas recente para ver o que foi excluído.

> ⚠️ A exportação completa tem um limite de **100.000 linhas** — para conjuntos de dados maiores, reduza o intervalo de datas e exporte em partes. A retenção de logs é indefinida por enquanto (ainda não há purga automática).

### 11.3. API REST Pública v1 (`/admin/api-keys`, Enterprise)

Acesso programático somente leitura aos seus dados (custos, orçamentos, recomendações, anomalias) para conectar ferramentas de BI ou scripts próprios.

**Como gerar e usar:**
1. **Admin → API Pública** → gere uma nova chave, escolhendo apenas os **escopos** que precisa (`read:cost`, `read:resources`, `read:budgets`, `read:recommendations`, `read:anomalies`, mais os de escrita, `write:metrics` e `write:shift-left`, que precisam ser concedidos de propósito: 11.10 e 11.11) — peça o mínimo necessário, por exemplo `read:cost` se for apenas para alimentar um painel de BI.
2. Autentique cada requisição com o header `X-API-Key: pak_live_xxx` (ou `Authorization: Bearer pak_live_xxx`).
3. Exemplos de endpoints: `GET /cost/summary?from=...&to=...&groupBy=service`, `GET /cost/timeseries?granularity=daily|monthly`, `GET /resources?type=...&limit=100`, `GET /budgets`, `GET /recommendations`, `GET /anomalies?severity=low|medium|high`.
4. Documentação interativa (Swagger) disponível em `/api/v1/docs`.

> ⚠️ Limite padrão: **60 requisições/minuto** por chave (headers `X-RateLimit-*` mostram quanto resta; ao esgotar, erro 429). Se precisar de mais para um job em lote, solicite em Admin → API Pública ou pelo suporte (até 1000 req/min). Valores monetários sempre trafegam como **strings** (ex.: `"1234.56"`), não como números — trate como texto para não perder precisão.

### 11.4. Exportação de Faturas Showback/Chargeback em PDF (`/admin/report`, Business+)

Gere e envie por email faturas de showback/chargeback para cada cliente ou centro de custo interno.

- **Baixar uma fatura individual:** no relatório de faturamento, escolha o cliente/centro e o período → o PDF é baixado diretamente.
- **Baixar todas de uma vez:** mesmo fluxo sem escolher um cliente específico → baixa um ZIP com todas as faturas do período.
- **Enviar por email:** preencha o email e nome do destinatário → é enviado automaticamente com o PDF anexado via Microsoft 365 (requer que a CSCloudSolutions tenha configurado o envio de email para seu tenant — se não estiver disponível, você verá um erro claro pedindo para contatar o suporte).

Todo envio e download fica registrado no log de auditoria.

### 11.5. FOCUS 1.1 Export — uso avançado

Além do download manual em `/admin/focus-export` (veja seção 8.7), você pode automatizar a extração com uma MCP API Key própria (gerada em `/admin/mcp-keys`):

```
curl -H "Authorization: Bearer mcp_xxx" \
  ".../api/exports/focus?tenantId=...&format=ndjson"
```

Formatos disponíveis: CSV, JSON, NDJSON. Limite de **500.000 linhas** por exportação (padrão 100.000). Útil para alimentar automaticamente ferramentas FinOps externas (Power BI, CloudHealth, etc.) sem intervenção manual.

### 11.6. Página de Status

Página pública (sem login) onde você e seus usuários podem consultar a qualquer momento se a plataforma está operacional: `/es/status` (ou `/en/status`, `/status`). Mostra o status de API, banco de dados, sincronização com o Azure, provedor de IA e faturamento, além de um histórico de incidentes. Útil para compartilhar com sua equipe se algo parecer não estar funcionando — antes de abrir um ticket, verifique se já há um incidente reportado ali.

### 11.7. Faturamento com Paddle — detalhe técnico

A mudança de plano (veja seção 8.4) tem 3 modos possíveis de rateio ao fazer upgrade/downgrade:

- **Rateio imediato:** a diferença é cobrada ou creditada agora mesmo.
- **Rateio no próximo ciclo:** a mudança de preço completa é cobrada apenas na próxima renovação.
- **Sem cobrança imediata:** a mudança de plano se aplica sem gerar nenhuma cobrança até o próximo ciclo.

Em `/admin/billing` você também acessa o **portal de gestão de pagamento** (atualizar cartão) e o **histórico de faturas** para download.

### 11.8. Teste gratuito de 7 dias (autoatendimento)

Se você se cadastrou sozinho pela página de preços (sem passar por um onboarding assistido pela equipe da CSCloudSolutions), sua conta começa com um **teste de 7 dias** no plano que você escolheu. Você verá um banner de status do teste no topo da plataforma:

- 🔵 Azul: 5 dias ou mais restantes.
- 🟡 Amarelo: entre 3 e 4 dias restantes.
- 🔴 Vermelho: 2 dias ou menos — este não pode ser dispensado.

Você pode fazer upgrade para um plano pago a qualquer momento em **Faturamento** — o teste se converte imediatamente em assinatura ativa. Se o teste expirar sem upgrade, a conta passa para modo de acesso limitado até você ativar um plano pago.

### 11.9. Infraestrutura e residência de dados

- **Região física ativa:** Azure West US 2.
- **Redis de produção:** Azure Managed Redis com HA habilitada.
- **Edge/CDN:** usamos Cloudflare na frente da origem no Azure.

### 11.10. Shift-Left FinOps: API e GitHub Action (Business+)

O que faz e como ler o resultado: veja 7.10. Aqui, a parte técnica.

**A permissão.** O escopo **`write:shift-left`** não vem nas chaves existentes: é preciso concedê-lo explicitamente ao gerar a key em **Integrações e API → API Pública** (11.3). É de propósito: uma chave de leitura de custos não deveria poder escrever estimativas.

**A API.** `POST /api/v1/shift-left/estimate`, com a API Key no header `X-API-Key`. Recebe o plano do Terraform em JSON (a saída de `terraform show -json`, até 6 MB) e devolve o delta de custo mensal, o custo projetado, a quantidade de recursos sem precificar e o estado do Budget Gate do repositório (`OK`, `EXCEEDED` ou `NOT_EVALUATED`).

**A GitHub Action** *FinOps PR Cost Estimator* envolve essa chamada em um passo do workflow do Pull Request:

```yaml
permissions:
  contents: read
  pull-requests: write   # sem isto não consegue comentar

steps:
  - uses: actions/checkout@v4
  - uses: hashicorp/setup-terraform@v3
  - run: terraform init
  - run: terraform plan -out=tfplan.bin
  - uses: ./integrations/github-action      # a action, como você a tiver no seu repositório
    with:
      api-key: ${{ secrets.FINOPS_API_KEY }} # sempre por secrets, nunca literal
      plan-file: tfplan.bin
      threshold-usd: '200'                   # opcional: Budget Gate local
```

Entradas: `api-key` (obrigatória), `plan-file` (padrão `tfplan.bin`), `plan-json` (um plano já convertido, para não precisar do Terraform no runner), `threshold-usd`, `comment` e `api-url`. Saídas, para encadear com outros passos: `delta-usd`, `projected-usd`, `unpriced` e `gate-status`. Precisa de `jq`, `curl` e `bc`, que já vêm nos runners do GitHub.

### 11.11. Ingestão de métricas de negócio por API (receita e volume)

Para calcular o **custo unitário** (Unit Economics, 5.14) e a **margem bruta** (Leaderboard, 5.2), a plataforma precisa saber quanto você vendeu ou processou. Você envia isso do seu pipeline ou de um cron com uma API Key pública que tenha o escopo **`write:metrics`**:

```
curl -X POST https://<host>/api/unit-metrics/ingest \
  -H "x-api-key: pak_..." -H "Content-Type: application/json" \
  -d '[{"metricDate":"2026-08-21","metricType":"TRANSACTIONS","unitCount":14320}]'
```

Até **400 linhas por chamada**; o tenant sai da própria key, nunca do corpo da requisição. `metricType` = `REVENUE` carrega **receita** (em dinheiro, não uma contagem de unidades: não é oferecida como denominador do custo unitário) e habilita a margem bruta.

### 11.12. App móvel (PWA)

A plataforma pode ser instalada no celular como um **aplicativo web progressivo** (adicionar à tela inicial) e, em telas estreitas, oferece uma experiência móvel dedicada em `/mobile` com cinco abas:

| Aba | O que você vê |
|---|---|
| **Resumo** | Custo do mês, projeção, economia potencial e recursos zumbi |
| **Alertas** | O estado das suas regras de alerta (disparadas, pausadas) e credenciais vencidas ou a vencer em 30 dias ou menos |
| **Aprovar** | As aprovações de remediação pendentes, com o botão **Aprovar** para resolvê-las pelo celular |
| **Suporte** | Abrir um ticket com a equipe |
| **Perfil** | Sua conta, o idioma e o acesso à versão desktop |

O resumo traz atalhos para **Alertas** (orçamentos, anomalias e credenciais), **Recomendações** (as economias sugeridas pelo Azure Advisor) e **Suporte**. Se preferir a versão desktop, escolha-a com **Usar versão desktop**.

---

## 12. Melhores Práticas

- **Revisão semanal:** acesse o **Dashboard** e **Recursos Zumbis** pelo menos uma vez por semana para capturar vazamentos financeiros antes que se acumulem.
- **Automatize cedo:** ative **Horários de Desligamento** nos seus ambientes de Desenvolvimento/Teste como primeira medida — é comum ver economias de 60% em horas de computação ociosas sem nenhuma outra mudança.
- **Exija conformidade de tags:** sem tags consistentes, o módulo de chargeback/showback não consegue distribuir a fatura mensal de forma justa entre equipes — é a base de tudo o resto.
- **Use o Simulador What-If antes de se comprometer:** antes de comprar uma Reserva ou Savings Plan, simule o cenário e salve-o — isso dá um número concreto para justificar a decisão perante o financeiro.
- **Configure pelo menos um canal de notificação desde o primeiro dia** (Slack/Teams se sua equipe já vive lá, ou email se preferir simplicidade) — alertas de orçamento não servem de nada se ninguém os vê a tempo.



## 13. Avisos da plataforma

De vez em quando você verá comunicados nossos dentro da plataforma. São de dois tipos:

**Banner superior.** Uma faixa colorida no topo da tela. A cor indica a gravidade:

| Cor | Significa |
|---|---|
| Azul | Informativo |
| Âmbar | Manutenção programada ou advertência |
| Vermelho | Incidente crítico |

Você pode fechá-lo no **✕**, mas ele **reaparece na próxima sessão** enquanto o aviso seguir vigente. É proposital: durante uma manutenção real convém que não se perca de vista.

**Janela pop-up.** Para avisos que exigem sua atenção. Ao pressionar **Entendi**, não aparece de novo: essa dispensa fica registrada para o seu usuário, então não retorna nem em outro dispositivo.

Os avisos **somem sozinhos** quando termina a janela de vigência; você não precisa fazer nada.

Se um aviso incluir o link **Mais informações**, ele leva à página de status ou ao detalhe correspondente.

Os avisos aparecem no idioma que você tiver ativo. Se um aviso pontual não foi traduzido para o seu idioma, você o verá em espanhol, que é o idioma base — preferimos mostrá-lo a escondê-lo.


## 14. Anomalias de gasto: quem as atende

Quando a plataforma detecta um gasto fora do normal, ela não para no aviso.

### 14.1 O responsável

Cada anomalia mostra **quem é o responsável** e de onde veio essa atribuição. A plataforma a deduz do seu próprio modelo de governança, nesta ordem:

1. Se o Resource Group está atribuído manualmente a um Cost Group, ganha o dono desse grupo.
2. Se corresponde à regra de padrão de nome de um Cost Group.
3. Se leva a etiqueta que define esse grupo.
4. Se o recurso tem a etiqueta `Owner` com um e-mail.

**Se nada disso resolver, você verá "Sem responsável"** — de propósito. Preferimos dizer que falta um dono a atribuí-lo a quem não corresponde: essa pessoa aprenderia a ignorar os alertas. Esse "sem responsável" é, na prática, a lista do que falta etiquetar.

> É recalculado a cada análise. Se você atribuir o Resource Group a um Cost Group **depois** de a anomalia disparar, ela encontra o dono sozinha.

### 14.2 O acompanhamento

Cada anomalia tem um estado que **fica salvo**, com quem o alterou e quando:

| Estado | Quando usar |
|---|---|
| **Nova** | Ninguém olhou ainda |
| **Em investigação** | Alguém assumiu |
| **Resolvida** | Houve ação e o gasto foi corrigido |
| **Falso positivo** | A detecção errou |

Esse último não é o mesmo que "descartada": serve de retorno para afinar a detecção.

As mudanças são vistas por toda a equipe, então duas pessoas não trabalham no mesmo item sem saber.

O estado é alterado em **Analítica Avançada → Detecção de Anomalias** (Enterprise, 5.14), com os botões de cada cartão: **Investigar** numa Nova, **Marcar como Resolvida** ou **Falso positivo** enquanto está aberta, e **Reabrir** quando já foi fechada. Owner, Admin e Colaborador os usam; o Reader vê o estado e o responsável, sem os botões. Se a mudança não puder ser salva, o cartão volta ao estado anterior e a tela avisa.

Os indicadores do painel saem desses estados:

- **Anomalias Abertas:** as Novas e as que estão Em investigação.
- **Impacto Não Resolvido:** quanto as abertas gastaram acima do esperado.
- **Resolvidas** e **Tempo Médio de Ação:** só as Resolvidas. O tempo vai da detecção ao fechamento; os falsos positivos não contam, porque fechá-los não corrigiu nenhum gasto.

### 14.3 O aviso

Se a anomalia tem responsável, a notificação **chega a essa pessoa**. Se não tem, chega a toda a equipe — um desvio sem dono ainda precisa ser visto por alguém.

### 14.4 O que mudou, e a explicação com IA

Em **Analítica Avançada → Detecção de Anomalias** (Enterprise, 5.14), o botão **Ver Causa Raiz** de cada anomalia abre o painel lateral. Abaixo do detalhamento por serviço, o bloco **O que mudou** mostra o que se moveu dentro do serviço que a puxou. Ele compara o dia com a média dos 30 dias anteriores:

| Fato | O que significa |
|---|---|
| **Medidor novo** | Algo que nos últimos 30 dias não custava nada |
| **Maior consumo** | O aumento vem sobretudo de se usar mais |
| **Custo unitário maior** | O aumento vem sobretudo de cada unidade sair mais cara, por exemplo porque uma reserva deixou de cobri-la |
| **Custo maior** | O custo subiu, mas não há quantidades para saber se foi por consumo ou por preço |
| **Sem detalhe por medidor** | Não há detalhe desse serviço: a plataforma diz isso em vez de adivinhar |

O detalhe é no nível do serviço: soma todas as regiões e grupos de recursos. Ele chega com a sincronização por API e com os exports de custos que trazem a coluna do medidor (`MeterName`, ou `SkuMeter` / `x_SkuMeterName` no FOCUS). Se a sua organização carrega os custos com um export sem essa coluna, você vai ver **Sem detalhe por medidor**.

Abaixo, **O que verificar** lista os próximos passos. Eles saem dos fatos, não da IA:

- Confirmar que um medidor novo é um uso esperado.
- Ver se dá para desligar fora do horário.
- Revisar a cobertura de reservas e savings plans.
- Atribuir um responsável, se a anomalia não tiver.

Os fatos e os passos não usam IA: aparecem mesmo com a IA desligada.

**Explicar com IA.** O botão **Explicar com IA** pede à IA que conte o mesmo em palavras. A IA só pode usar os fatos acima:

- Ela não vê valores e não pode citar uma causa que não esteja na lista.
- Se escrever um número que não está nos fatos, a explicação é descartada e ficam os fatos.
- Por isso ela leva a etiqueta **Gerado com IA · verifique os dados**.

Com **Ajudou** ou **Não ajudou** você nos ajuda a medir se a explicação é útil.

No Enterprise as explicações não têm cota mensal. Se não estiver disponível (IA desativada ou na demo), a tela diz por quê.

---

## 15. Assinaturas fora do limite do seu plano

Em **Configuração → Status da Conta** (antes «Contas Cloud») são listadas **todas** as assinaturas do
Azure que a plataforma descobre. Se você tiver mais do que o seu plano permite
(Professional 2, Business 3, Enterprise sem limite), as que ficam de fora
aparecem **esmaecidas** e com o badge âmbar **"Fora do plano"**.

Essa marca significa algo bem concreto: **essa assinatura aparece nesta tabela e
não alimenta nenhum painel**. O gasto dela não entra nos totais, seus recursos
não aparecem no inventário e suas anomalias não são detectadas.

### 15.1 Como escolher quais são monitoradas

A plataforma não tem como saber quais importam para você, então pega as
primeiras por ordem de identificador — um critério estável, mas arbitrário. Você
tem duas formas de decidir isso:

- **Desvincular as que não interessam.** O botão *Desvincular* de cada linha tira
  uma assinatura da contagem e **libera a vaga** para outra. Ele pede que você
  digite o identificador para confirmar, porque a ação afeta todos os painéis do
  tenant.
- **Ampliar a cota.** O botão *Aumentar cota* do banner soma assinaturas sem
  trocar de plano. O que você comprar se mantém mesmo que depois mude de tier.

### 15.2 Voltar a vincular

Uma assinatura desvinculada não desaparece: ela fica no fim da lista, esmaecida,
com o badge **"Desvinculada"** e um botão **Revincular**.

Diferente de desvincular, revincular **não pede confirmação**: não destrói nada
— só remove a exclusão — e desvincular de novo está a um clique.

> Revincular não exige repetir o onboarding nem rodar nenhum script de novo. O
> gasto histórico de uma assinatura desvinculada **é preservado**: o de meses
> fechados é informação contábil e nunca é apagado.

> Se você estiver no limite do plano, revincular devolve a assinatura a esta
> tabela, mas os painéis continuam deixando-a de fora, igual a qualquer outra
> acima do limite. Abra espaço primeiro.

### 15.3 Adicionar uma assinatura nova no Azure

**Não é preciso refazer o onboarding.** O script atribui os papéis de leitura no
management group raiz do seu diretório, e o Azure os herda para baixo: uma
assinatura criada depois já nasce com permissão. Ela aparece sozinha com
**Sincronizar agora**.

O único passo manual é se você quiser **acionar** essa assinatura — desligar VMs,
horários de ligar/desligar, right-sizing: o papel de remediação é atribuído por
assinatura e não é herdado. Portal do Azure → a assinatura → Controle de acesso
(IAM) → Adicionar atribuição de função, sobre o mesmo Service Principal.

> Se depois de sincronizar a assinatura nova **não** aparecer, é porque a
> atribuição no management group raiz não chegou a ser feita quando o onboarding
> foi executado. Nesse caso é preciso atribuir os papéis de leitura nessa
> assinatura.

---

## Suporte e Contato

Para qualquer assistência adicional, abra um ticket em **Suporte** (`/support`) dentro da plataforma, ou escreva para **soporte@cscloudsolutions.com.ar**.

---

**Manual do Usuário — FinOps SaaS**
**Versão 2.1 | Português Brasileiro | Outubro 2026**
