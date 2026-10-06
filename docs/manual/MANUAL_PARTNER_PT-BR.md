<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">Manual do Parceiro e da Equipe Comercial</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Versão 1.0 · Outubro 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. Todos os direitos reservados.</p>
</div>

# 📘 Manual do Parceiro e da Equipe Comercial — FinOps SaaS (CSCloudSolutions)

**Versão:** 1.0
**Idioma:** Português Brasileiro
**Última atualização:** Outubro 2026
**Público:** parceiros e afiliados, comerciais e equipe de pré-venda. Não é preciso saber Azure nem FinOps para usá-lo: explica o que é a plataforma, como funciona por dentro, o que o cliente vê e como vendê-la.

---

## Como usar este manual

Este manual faz duas coisas ao mesmo tempo: **explica como funciona o SaaS** —do ponto de vista dos usuários que vão usá-lo todos os dias— e **dá a você as ajudas para vendê-lo**: perguntas de descoberta, roteiro de demo, respostas a objeções, planos e preços, e como você recebe.

**Se tiver pouco tempo, vá direto ao que precisa:**

| Situação | Leia |
|---|---|
| Tenho uma reunião amanhã | 1, 6 e 7.3 (roteiro de demo) |
| Me perguntaram sobre segurança ou sobre as permissões no Azure | 3.2, 3.4 e 8 |
| Quero saber quanto custa e o que inclui cada plano | 6 |
| O cliente diz «já temos o Azure Cost Management» | 7.4 e 7.5 |
| Quero saber quanto ganho e quando recebo | 9 |
| Não entendo um termo | 10 (glossário) |

> **Uma regra para todo o manual:** venda o que a plataforma faz hoje. Nas seções de funções marcamos com clareza os **limites** (o que ainda não faz e o que depende do plano), porque um cliente a quem se prometeu demais é um cliente que se perde no mês dois.

---

## 📑 Índice

1. [A plataforma em dois minutos](#1-a-plataforma-em-dois-minutos)
2. [Para quem você vende](#2-para-quem-você-vende)
3. [Como funciona por dentro, em linguagem de venda](#3-como-funciona-por-dentro-em-linguagem-de-venda)
4. [A jornada do cliente: da demo ao valor](#4-a-jornada-do-cliente-da-demo-ao-valor)
5. [O que o usuário vê: o tour pela plataforma](#5-o-que-o-usuário-vê-o-tour-pela-plataforma)
6. [Planos, preços e limites](#6-planos-preços-e-limites)
7. [Como vender](#7-como-vender)
8. [Perguntas frequentes dos clientes](#8-perguntas-frequentes-dos-clientes)
9. [O programa de parceiros: como você ganha](#9-o-programa-de-parceiros-como-você-ganha)
10. [Glossário](#10-glossário)
11. [Anexos](#11-anexos)

---

## 1. A plataforma em dois minutos

### 1.1. O que é

Uma plataforma **SaaS de FinOps para Microsoft Azure**. Mostra a uma empresa **para onde vai o gasto na nuvem**, **onde está sendo desperdiçado**, e dá a ela **os botões para corrigir**, com aprovações e registro de auditoria de cada mudança.

**A dor que resolve é concreta e silenciosa:** discos e IPs órfãos que continuam faturando, máquinas superdimensionadas ou ligadas à noite sem que ninguém as use, gateways sem tráfego, recursos sem tag dos quais ninguém sabe de quem são, compromissos de reservas que vencem todos no mesmo mês. Ninguém olha… até chegar a fatura.

### 1.2. Por que compensa frente a fazer na mão

- **Não substitui o Azure Cost Management: usa-o como fonte** e acrescenta o que esse painel não faz sozinho —dizer **o que fazer**, **quem faz** e **quanto se economizou de verdade**—. (Detalhe em 7.5.)
- **Do dado à ação no mesmo lugar.** Cada achado traz a sua remediação (scripts de CLI, PowerShell ou Terraform e, conforme o plano, execução direta pela plataforma com aprovação).
- **Preço fixo e público.** Ao contrário das plataformas que cobram uma porcentagem do consumo na nuvem, aqui a mensalidade **não sobe porque a infraestrutura do cliente cresce**. Ele sabe o que paga antes de assinar.
- **Copilot com IA em espanhol, inglês e português.** Um assistente que lê a tela em que o usuário está, detecta economias e responde perguntas. Está nos três planos.
- **Padrão internacional.** Exportação **FOCUS 1.1**, o formato da FinOps Foundation: serve ao cliente que já tem ferramentas próprias ou que presta contas a uma matriz.
- **Toda a equipe, não só a de TI.** Há uma visão executiva para a Diretoria, painéis de custo por time para o Financeiro e cockpits técnicos para quem opera a nuvem.

### 1.3. O discurso, em três tamanhos

> **Em 30 segundos.** «A sua fatura do Azure tem dinheiro que vai embora em coisas que ninguém usa. Esta plataforma se conecta ao seu Azure em modo leitura, mostra onde está esse dinheiro e dá os botões para recuperá-lo, com aprovação e auditoria. Plano fixo, sem porcentagem sobre o seu consumo, e você testa 7 dias grátis.»

> **Em 2 minutos.** Some ao anterior: *como se conecta* (um script que cria uma identidade somente leitura; o cliente o executa e pode revogá-la quando quiser), *o que cada pessoa vê* (a Diretoria uma visão executiva; o Financeiro orçamentos e rateio de custos por time; as Operações recursos zumbi, agendas de desligamento e rightsizing) e *como se paga sozinha* (a Economia Potencial que mostra a primeira tela, contra o preço do plano).

> **Para um CFO.** «Previsibilidade e rateio: você vê quanto gasta cada time, quanto vai gastar no fim do mês, e recebe o relatório por e-mail toda segunda sem precisar procurá-lo. O gasto deixa de ser uma surpresa.»

### 1.4. O que a plataforma NÃO é (diga você antes que o cliente descubra)

- **É só Azure.** Não cobre AWS nem Google Cloud. (Com a *Ingestão CSV* em formato FOCUS é possível somar faturamento de terceiros para analisá-lo junto com o Azure, mas não é um painel multi-nuvem.)
- **Não pede nem usa o papel Contributor.** O teto do que pode executar é um **papel personalizado** restrito (ligar e desligar VMs, taguear e, no Enterprise, excluir certos recursos órfãos). O que precisar de mais permissões **é mostrado e recomendado, mas não é executado**.
- **A IA aconselha, não executa.** O Copilot analisa e recomenda; não modifica a infraestrutura do cliente.
- **Não é consultoria.** É um produto. O onboarding e a demo técnica são acompanhados pelos nossos engenheiros, mas a plataforma se usa de forma autônoma.
- **Uma única região de implantação** hoje (Azure West US 2). Não se oferece escolha de região de dados.

---

## 2. Para quem você vende

### 2.1. O cliente ideal

Uma organização que **já usa Azure** e cuja fatura mensal justifica olhá-la de perto: a plataforma se paga com o que encontra (veja 7.6). Quanto mais assinaturas, mais times implantando por conta própria e menos tagueamento, mais valor se vê desde a primeira semana.

| Tamanho e perfil | Plano que costuma encaixar |
|---|---|
| Empresa média que quer **entender tendências e reportar** | **Professional** |
| Empresa em crescimento, **vários ambientes** (desenvolvimento, testes, produção) e necessidade de **automatizar** | **Business** |
| Corporação com **topologias complexas** (Hub & Spoke), muitos times, necessidade de rateio de custos e governança forte | **Enterprise** |
| **MSP ou parceiro da Microsoft** que administra a nuvem dos seus clientes | **Enterprise** (Lighthouse, markup CSP, Power BI para clientes finais) |

### 2.2. As pessoas que compram (e o que importa a cada uma)

| Persona | O que a preocupa | O que mostrar | Uma frase que funciona |
|---|---|---|---|
| **CFO / Financeiro** | Previsibilidade, orçamento, rateio do gasto entre áreas, surpresas na fatura | White Board, Orçamentos, Gastos e Projeção, relatórios por e-mail, showback/chargeback | «O gasto de nuvem deixa de ser uma surpresa no fim do mês.» |
| **CTO / Diretoria de TI** | Controle, risco, governança, que a nuvem não vire bagunça | White Board, Governança (tags, políticas, fim de suporte), Maturidade FinOps, Copilot | «Uma visão executiva e regras que impedem o desperdício antes que exista.» |
| **Cloud Admin / DevOps / SRE** | Tirar de cima o trabalho manual, não quebrar nada | Recursos Zumbi, Agendas de Desligamento, Rightsizing, TTL, Shift-Left | «Cada achado traz o script e, se quiser, executa-se com aprovação.» |
| **Analista FinOps** | Dados confiáveis, rateio, compromissos | Perspectives, Unit Economics, Compromissos (ESR), FOCUS, Rateio | «Tudo no padrão FOCUS e com rateio auditável: a soma sempre fecha.» |
| **Líder de time / Product Owner** | «Quanto custa o meu e estou gastando bem?» | Alcance por equipe, Leaderboard, Cost Groups | «Entra e vê só a sua parcela, não o gasto de toda a empresa.» |
| **MSP / parceiro CSP** | Operar muitos clientes, faturá-los com margem | Lighthouse, Partner Markup, Power BI de faturamento, multi-tenant | «Você conecta o tenant do seu cliente sem pedir credenciais.» |

### 2.3. O que dispara uma compra

- A **fatura do Azure cresceu** e ninguém sabe por quê.
- Chega o **fechamento do ano fiscal** ou o **planejamento de orçamento** e o Financeiro pede projeções e rateio por área.
- Houve uma **migração recente para o Azure** e ninguém governa o que foi implantado.
- Aproxima-se a **renovação de um EA/MCA** ou de um compromisso (MACC) e é preciso chegar ao número.
- A Diretoria pede **showback/chargeback** e não há tags confiáveis.
- Uma **auditoria** ou um incidente de segurança exige saber quem mudou o quê.
- Um **estouro pontual** (um ambiente de testes que ficou ligado o mês todo) colocou o assunto na pauta.

### 2.4. Quando NÃO é para eles (e convém dizer)

- **Não usam Azure** (só AWS ou Google Cloud, ou só on-premises): a plataforma é Azure.
- **Gasto em nuvem muito baixo**: o preço de tabela do Professional é US$ 299,99 por mês; se o gasto do Azure é muito pequeno, não há de onde recuperá-lo (7.6 ensina a fazer a conta com os números do cliente).
- Precisam que uma ferramenta **execute mudanças com permissões amplas** na sua nuvem: aqui o teto é um papel restrito, de propósito.

---

## 3. Como funciona por dentro, em linguagem de venda

### 3.1. O modelo, em quatro passos

| Passo | O que acontece | Quem faz |
|---|---|---|
| **1. Conectar** | O cliente executa um **script** (que a própria plataforma gera) e cria uma **identidade de leitura** (um *Service Principal*) com os papéis que correspondem ao seu plano. Alternativa Enterprise: **Azure Lighthouse**, sem credenciais. | O cliente, com a nossa ajuda |
| **2. Ler** | A plataforma traz **custos**, **inventário de recursos**, **métricas**, **recomendações do Azure Advisor** e dados de identidade (credenciais a vencer, licenças), de forma programada. | A plataforma, sozinha |
| **3. Analisar** | Motores próprios detectam desperdício, anomalias, falta de tags, compromissos mal usados, versões prestes a se aposentar etc., e a IA os explica. | A plataforma, sozinha |
| **4. Agir** | Cada achado traz a sua **remediação**: scripts para copiar e colar e, conforme o plano, **execução direta com aprovação** e auditoria. | O cliente decide; a plataforma executa |

### 3.2. Que permissões pede e o que pode (e não pode) fazer no Azure

É a pergunta de segurança número um. Responda com a tabela:

| Plano | Papéis do Azure | O que pode fazer com eles |
|---|---|---|
| **Professional** | Reader, Cost Management Reader, Monitoring Reader, Billing Reader, Security Reader e, no nível do tenant, Reservations Reader (para ver as reservas) | **Somente ler.** Não pode modificar nem apagar nada. |
| **Business** | Os do Professional + Tag Contributor + um **papel personalizado** (*CSCloudSolutions Remediation Role*) | Taguear; **ligar, desligar, reiniciar e desalocar VMs**; gerenciar orçamentos do Azure; e **excluir recursos órfãos** (VMs, discos, snapshots, planos do App Service, NICs, IPs públicos, NSGs e os demais tipos de rede que a Limpeza de Nuvem detecta). |
| **Enterprise** | Os do Business + Monitoring Contributor | O do Business mais criar grupos de recursos. |

Quatro pontos para tranquilizar o cliente:

1. **Nunca se pede o papel Contributor nem Owner** sobre a assinatura. O que precisar de mais permissões do que o papel personalizado **é mostrado mas não é executado**.
2. **As mudanças de infraestrutura que os motores de otimização propõem passam por um fluxo de aprovação** (princípio dos quatro olhos: quem pede não aprova) e **toda ação fica no log de auditoria**. Antes de excluir um disco pode-se exigir um **snapshot de respaldo**, e se o snapshot falha, a exclusão não é feita.
3. **Os papéis são de plano de gerenciamento** (custos, inventário, métricas, faturamento): não dão acesso ao conteúdo dos bancos de dados nem dos arquivos do cliente.
4. **O cliente mantém o controle:** pode remover os papéis ou revogar a identidade quando quiser, e com o Lighthouse delega e revoga a partir do seu próprio diretório.

Além disso, o script concede **permissões de leitura do Microsoft Graph** (diretório, relatórios, usuários e organização) e, conforme o plano, algumas pontuais: rotacionar segredos de App Registrations (Business+, só sobre os apps dos quais a identidade é *owner*), atividade de login para o módulo de licenças e o conector do Copilot M365 (Enterprise).

> **Contas EA ou MCA** (Enterprise Agreement / Microsoft Customer Agreement): além disso, é preciso que o administrador de faturamento do cliente atribua um papel de leitura em nível de *billing account* (`Enrollment Reader` ou `Billing Account Reader`). O script não consegue fazer isso sozinho; é preciso coordenar com o cliente. É o motivo mais comum de uma tela de Consumo vazia no primeiro dia.

### 3.3. De onde saem os dados e a cada quanto se atualizam

- **Custos:** do Azure Cost Management, sincronizados **toda noite**. A plataforma guarda o histórico de até **13 meses** para trás, de modo que os intervalos de 30 e 90 dias respondem na hora e não gastam cota de consultas do Azure.
- **O mês atual** é consultado ao vivo, com a base da plataforma como respaldo se o Azure não responder, e há um botão **Atualizar** que ignora o cache.
- **Inventário e recomendações:** Azure Resource Graph e Azure Advisor.
- **Métricas de uso** (CPU, memória, RU, largura de banda…): Azure Monitor. Se o Azure não devolve uma métrica, a tela diz **«sem dado»** e não um zero: um zero seria lido como «ocioso» e levaria a desligar algo que talvez esteja trabalhando.
- **A primeira sincronização** traz o primeiro conjunto de custos em até um minuto a partir do assistente de onboarding.

### 3.4. Segurança e confiança

O que você pode afirmar, com as palavras do **Centro de Confiança** público da plataforma:

| Tema | O que dizer |
|---|---|
| **Criptografia** | TLS 1.2 ou superior em trânsito; AES-256 em repouso para o banco de dados e os backups. As chaves são administradas à parte no **Azure Key Vault**. |
| **Acesso** | Login com **Microsoft Entra ID**; **2FA próprio com TOTP** (Google Authenticator, Microsoft Authenticator…), exigido para as operações sensíveis —excluir um tenant, cancelar a assinatura, alterar o faturamento—; **SSO SAML** para Enterprise (via WorkOS); controle por **papéis** e por **permissões de domínio**. |
| **Auditoria** | Todas as ações de usuário ficam registradas e são mantidas por **7 anos**; o log pode ser exportado. |
| **Infraestrutura** | Microsoft Azure, **região West US 2**; banco de dados MySQL gerenciado com backups automáticos; Redis com alta disponibilidade; Cloudflare na frente como CDN/WAF. |
| **Continuidade** | Backups georredundantes; objetivo de recuperação **RTO menor que 4 horas** e **RPO menor que 1 hora**; **SLA de 99,9%** de disponibilidade para planos pagos (exclui manutenção programada). |
| **Incidentes** | Os incidentes de segurança são investigados dentro de **2 horas** da detecção e, diante de um vazamento de dados confirmado, os clientes afetados são notificados dentro de **72 horas**. |
| **Subprocessadores** | Microsoft Azure (computação, armazenamento, redes), Paddle (pagamentos), WorkOS (SSO) e Google Gemini (modelos de linguagem opcionais). A lista completa está no Centro de Confiança. |
| **Privacidade** | Conformidade declarada com o **GDPR**; **DPA** disponível; o Centro de Confiança reúne a política de privacidade, os termos, o DPA, a ficha de segurança e a lista de subprocessadores. |

> ⚠️ **O que você NÃO pode dizer.** A plataforma **não tem hoje certificação SOC 2**: está **em preparação para SOC 2 Tipo II, com meta no terceiro trimestre de 2027**, e **ISO 27001 está planejado para 2028**. O relatório que se publica é um *resumo do estado de preparação*, não um relatório de auditoria de um terceiro. Se o cliente o exige como requisito, diga isso como é e nos avise: não o prometa.
>
> Também não ofereça **residência de dados por região**: há uma única região de implantação.

### 3.5. A IA: o que faz, o que vê e quem a paga

- **FinOps Copilot.** Um assistente flutuante, disponível nos três planos, que **lê o conteúdo da tela onde o usuário está** e gera um relatório executivo (achados, economias priorizadas, riscos e plano de ação de 7 dias), além de responder perguntas. Responde no idioma da plataforma (espanhol, inglês ou português) e **lembra a conversa** mesmo que o usuário mude de página.
- **Aconselha, não executa:** não modifica a infraestrutura do cliente.
- **Cota mensal de consultas:** Professional **50**, Business **150** e Enterprise **sem teto**. Com **chave de IA própria** do cliente (BYOK) não há teto.
- **Quem paga a IA:** o consumo de IA com a chave da plataforma **é absorvido pela CSCloudSolutions; não é cobrado do cliente** hoje.
- **Controle do cliente:** um Admin do tenant pode **desligar as funções de IA**, escolher se se compartilham com o provedor os **nomes de recursos** e as **tags**, e ajustar a sensibilidade da detecção de anomalias. A CSCloudSolutions tem ainda um interruptor mestre que desliga a IA para todos diante de um incidente com o provedor.

---

## 4. A jornada do cliente: da demo ao valor

### 4.1. A demo interativa (sem conectar nada)

É o melhor primeiro passo: o prospect **vê a plataforma funcionando com dados sintéticos** e sem conectar o seu Azure.

1. Pela página de preços, o botão **Demo Interativa** (ou diretamente `https://finops.cscloudsolutions.com.ar/demo`). O parâmetro `?tier=` escolhe qual plano mostrar: `professional`, `business` ou `enterprise`.
2. A demo pede primeiro **dados de contato** (nome, e-mail, telefone e empresa) com verificação reCAPTCHA: é também uma forma de a CSCloudSolutions registrar o interesse.
3. Depois entra-se com o usuário `demo` e a senha `demo`.
4. Aparece um banner de **modo demo** em toda a plataforma. As ações que modificam algo **não são salvas** (por exemplo, as Perspectives são de exemplo).

> 💡 Faça sempre a demo do **plano que convém ao cliente**, não do mais alto: mostrar Enterprise a um cliente de Professional gera desejo do que ele não vai poder usar.

### 4.2. Contratar e testar 7 dias grátis

1. O cliente escolhe um plano na **página de preços** (mensal ou anual; o anual tem 12% de desconto) e a plataforma pede um **e-mail corporativo**: não se aceitam provedores gratuitos (Gmail, Outlook…). Esse e-mail fica como a **conta administradora** do tenant.
2. Se entrou pelo **seu link de indicação** (`/signup?ref=SEUCODIGO`), a atribuição fica registrada (veja 9.2).
3. O **checkout** é processado pela **Paddle**. É ao passar pelo checkout que se ativa o **teste gratuito de 7 dias**; sem passar por ali, o tenant não tem acesso.
4. Enquanto dura o teste, um banner mostra os dias restantes (azul, amarelo aos 4 dias e vermelho aos 2). Se o teste vence sem plano pago, a conta fica em acesso limitado até que se ative um plano.

### 4.3. O onboarding: o que o cliente faz e o que fazemos nós

Ao entrar pela primeira vez, o administrador vê um **assistente de 5 passos** (pode ser pulado e retomado):

| Passo | O que o cliente faz | Resultado |
|---|---|---|
| **1. Boas-vindas** | Confirma o nome da empresa, a moeda de exibição e o fuso horário | Preferências iniciais |
| **2. Conectar o Azure** | Cola o **Client ID**, o **Client Secret** e o **Tenant ID** do Service Principal que criou com o script, e valida | A conexão fica pronta |
| **3. Primeira sincronização** | Pressiona *Executar sincronização* | Traz o seu primeiro conjunto de custos (até um minuto) |
| **4. Primeiro orçamento** | Define nome, limite mensal e limite de alerta | Primeiro orçamento ativo |
| **5. Notificações** | Adiciona um canal (e-mail, Slack ou Teams) | Recebe alertas |

**O que o cliente precisa preparar do lado do Azure** (a checklist do anexo B):
- Um usuário com permissões para **executar o script** e atribuir papéis nas suas assinaturas.
- Saber **quais assinaturas** quer monitorar (o plano define o teto: 2, 3 ou ilimitadas).
- Se tem **EA/MCA**, que o administrador de faturamento atribua o papel de leitura em nível de *billing account*.
- Se vai usar **Lighthouse** (Enterprise), um administrador do diretório que aceite a delegação.

**O que fazemos nós:** acompanhamos a demo técnica, a arquitetura e o onboarding. A plataforma inclui ainda uma **Academia FinOps** (cursos, vídeos, glossário) que cada usuário novo percorre ao começar.

### 4.4. Os primeiros 30 dias: como se vê o valor

| Quando | O que o cliente vê | O que convém pedir que faça |
|---|---|---|
| **Dia 1** | O White Board com o custo do mês, o forecast, os recursos zumbi e a **Economia Potencial** | Revisar o número de Economia Potencial: é o argumento do retorno |
| **Semana 1** | Recursos zumbi e órfãos concretos, com o seu custo mensal; recomendações do Advisor; conformidade de tags | Remediar os primeiros achados e **configurar um canal de notificação** |
| **Semana 2-3** | Agendas de desligamento de ambientes de desenvolvimento e testes, Cost Groups por time, orçamentos | Programar desligamentos fora do horário; atribuir orçamentos |
| **Mês 1** | Primeiro relatório executivo, anomalias com responsável, **Economia Capturada** | Assinar a Diretoria e o Financeiro a um relatório periódico |

> Uma boa prática do próprio manual do usuário: *«é comum ver economias de 60% em horas de computação ociosas»* ao programar desligamentos em ambientes de desenvolvimento e testes. Use como orientação, não como promessa: a economia real depende de cada cliente.

---

## 5. O que o usuário vê: o tour pela plataforma

Este é o mapa do que o cliente vai usar todos os dias. Para cada tela: **o problema que resolve**, **o que o usuário vê** e **como contar**. O menu lateral agrupa tudo em cinco pilares; quase toda entrada é um *hub* com abas. O plano mínimo aparece em cada linha (**P** = Professional, **B** = Business, **E** = Enterprise; «+» significa «a partir desse plano»).

> O detalhe de cada tela, passo a passo, está no **Manual do Usuário** (baixa-se pelo ícone de ajuda da plataforma). Este manual é a versão para vender.

### 5.1. Visibilidade — «como estamos?»

| Tela | Problema que resolve | O que o usuário vê | Como contar | Plano |
|---|---|---|---|---|
| **White Board** | «Como vai o gasto neste mês e onde há dinheiro para recuperar?» | Custo do período (mês atual, 30 ou 90 dias), forecast, recursos zumbi, **Economia Potencial**, impacto ambiental, orçamentos, serviços que mais pesam e **Quick Wins** com botão *Otimizar* | A tela para a Diretoria: em dez segundos sabe se há um problema | P+ |
| **Azure Advisor** | As recomendações da Microsoft estão dispersas e ninguém as acompanha | As recomendações nativas do Azure no seu idioma, com economia estimada, e a possibilidade de **adiar** ou **descartar** com registro | «O que o Azure já recomenda, organizado e com acompanhamento» | P+ |
| **Maturidade FinOps** | «Quão bem gerenciamos a nuvem?» | Avaliação Crawl / Walk / Run em 6 dimensões, com pontuação e roteiro; o cliente escolhe se vale a autoavaliação da equipe, a telemetria do Azure ou uma média | Uma conversa de Diretoria: onde estamos e o que vem a seguir | P+ |
| **Progresso Histórico** | «Estamos melhorando?» | Tendência mensal, marcos de economia, comparativos mês a mês e ano a ano, anotações | Prova de resultados para o comitê | P+ |
| **TOP Despesas** | «O que mais pesa?» | Ranking por serviço, assinatura ou grupo de recursos, com detalhe por recurso | Onde focar o esforço | P+ |
| **Recursos** | «O que tenho implantado e a que custo?» | Inventário completo com filtros, tagueamento em massa e exportação | O inventário que o Azure não dá com o custo ao lado | B+ |
| **Green FinOps** | «Qual é a pegada da minha nuvem?» | Estimativa de carbono por serviço e comparação de regiões | Um argumento de sustentabilidade | P+ |
| **Economia Capturada** | «Quanto economizamos de verdade?» | As economias já obtidas, inclusive as feitas **diretamente no Azure**, com cálculo de ROI | **A prova do retorno** | P+ |
| **Vazamentos Financeiros** | «Onde o dinheiro escapa?» | Recursos abandonados, superdimensionamento e redundância, com calendário de remediação | Uma lista de ações, não um relatório | P+ |
| **Academia FinOps** | «Minha equipe não sabe de FinOps» | Cursos, vídeos e glossário; os usuários novos a percorrem ao começar | Capacitação incluída | P+ |

### 5.2. Inteligência Financeira — «onde está o dinheiro e o que faço?»

| Hub | Problema que resolve | O que o usuário vê | Como contar | Plano |
|---|---|---|---|---|
| **Consumo e Orçamento** | Entender o gasto real, orçá-lo e projetá-lo | Consumo real por serviço e recurso, por categoria, **orçamentos com alertas**, **Cost Groups** por projeto ou linha de negócio, orçamento por centro de custo com **transferência do saldo não gasto**, **projeção** de 3 a 24 meses, ingestão de CSV FOCUS | «Da fatura ao orçamento, em um só lugar» | P+ (abas avançadas B/E) |
| **Otimização e Economia** | Pagar menos pelo mesmo | **Rightsizing** (o SKU ideal com 30 dias de uso real), **Reservas** e Savings Plans com simulador de ponto de equilíbrio, **taxa efetiva de economia (ESR)**, aviso de reservas que vencem juntas, **avisos automáticos 90, 60 e 30 dias antes do vencimento de cada reserva**, Hybrid Benefit, custo zero, Índice de Otimização | «Cada decisão de compra com o seu número» | E |
| **Bancos de Dados** | Os bancos de dados estão entre as linhas mais voláteis | Cosmos DB (com **otimizador de RU/s**), SQL, PostgreSQL, MySQL, MongoDB, Redis e Fabric, com métricas reais | «Onde sobra capacidade e onde falta» | B+ |
| **Computação** | VMs, contêineres e serverless superdimensionados ou ociosos | VMs, App Services, Functions, **Azure Virtual Desktop** (custo por usuário), contêineres, VMSS, **Kubernetes** (com chargeback por namespace) e OpenShift | O cockpit da equipe de operações | B+ |
| **Armazenamento** | Contas, discos e backups que crescem sem dono | Storage Accounts, discos, backups e Data Lake, com economia potencial e eficiência | «Que storage não precisa estar onde está» | E |
| **Redes** | Custos de rede que não aparecem no custo dos recursos | Análise de rede, conectividade híbrida, balanceamento, **egress** (para onde vai o dinheiro de mover dados) e **capacidade de enlaces** (ExpressRoute/VPN superdimensionados) | «Os custos ocultos da rede, à vista» | B+ |
| **Usuários e Licenças** | Licenças M365 sem uso | KPIs de M365 e Entra ID, atividade de usuários e otimização de licenças | Economia em licenças, não só no Azure | E |
| **Azure AI** | O gasto em IA cresce rápido e sem controle | Custo por modelo e consumo de tokens (Foundry/OpenAI), AI Search, Document Intelligence, Speech, Vision, ML, Databricks | «O gasto de IA, sob controle» | E |
| **Azure Integration Services** | Integrações (Logic Apps, APIM, Service Bus…) que custam mais do que o esperado | Operação e custo de Logic Apps, APIM, Service Bus, Event Grid, Event Hubs e Data Factory | Para clientes com muitas integrações | E |
| **Monitoramento** e **Segurança** | Os serviços de observabilidade e segurança também faturam | Log Analytics, Application Insights, Sentinel, Defender, Key Vault, WAF, DDoS… com oportunidades de economia | «Até o que custa vigiar, sob controle» | E |
| **Analítica Avançada** | Decisões financeiras de nível especialista | **Unit Economics** (custo por transação ou cliente), **rateio** de custos compartilhados, Scorecard, **detecção de anomalias**, saúde do tenant, simulador **What-If** e acompanhamento do compromisso **MACC** | O que pede um analista FinOps | E |
| **Perspectives** | Dividir o gasto por time, produto ou ambiente **sem depender de que tudo esteja taguado** | Regras ordenadas que dividem o custo; **a soma dos grupos mais o «não atribuído» dá exatamente o total** | «Um rateio que fecha e pode ser auditado» | E |
| **Leaderboard de times** | Premiar quem otimiza, não quem gasta menos | Ranking por **melhoria**, divisão custo dos produtos vendidos / despesa operacional (cada time é classificado na tabela) e **margem bruta** | «Gamificação com critério» | E |

### 5.3. Limpeza de Nuvem — «pare de pagar o que ninguém usa»

| Tela | Problema que resolve | O que o usuário vê | Plano |
|---|---|---|---|
| **Recursos Zumbi** | Discos, IPs, NICs, planos e VMs órfãos que continuam faturando | Varredura de 25 tipos de recursos, desperdício **duro** (dinheiro direto) vs **mole** (governança), remediação com snapshot prévio | P+ (remediação B+) |
| **Zumbis de Rede** | Gateways, IPs e endpoints de rede sem uso | Gateways VPN/ExpressRoute ociosos, IPs órfãos, Private Endpoints desconectados, NAT e firewalls sem uso | P+ (remediação B+) |
| **Expirações TTL** | Ambientes de teste que ficam vivos para sempre | Políticas de vida útil, tag de expiração, semáforo de vencimento e prorrogações | B+ |
| **Backups Órfãos** | Backups de recursos que já não existem | Detecção, custo exato, purga segura e isenções por conformidade legal | P+ (remediação B+) |

### 5.4. Governança — «para que não volte a acontecer»

| Tela | Problema que resolve | O que o usuário vê | Plano |
|---|---|---|---|
| **Conformidade de Tags** | Sem tags não há rateio de custos | Auditoria das 4 tags estruturais, **sugestão com IA** das que faltam e herança do grupo de recursos | P+ (autocorreção B+) |
| **Alertas Self-Service** | Saber de um desvio quando já aconteceu | Regras por orçamento, limite fixo, anomalia ou forecast, com entrega para Teams, Slack, e-mail, webhook ou ServiceNow | P+ |
| **Agendas de Desligamento** | Máquinas ligadas à noite e nos fins de semana | Programação de ligar e desligar com **Smart Shutdown** (não desliga uma VM que está trabalhando) e economia calculada | B+ |
| **Alta Disponibilidade** | Não saber quão exposto está o crítico | Lacunas de redundância, SLA atual vs alcançável em minutos de queda por mês | B+ |
| **Fim de suporte** | Versões que o Azure aposenta, sem orçamento para migrar | O que roda sobre uma versão que se aposenta, quando, e **quanto custa hoje** | B+ |
| **Credenciais a Expirar** | A queda por um segredo vencido | Inventário de segredos e certificados do Entra ID, alertas prévios e rotação | B+ |
| **Aprovações** | Mudanças sem controle | Fluxo de **quatro olhos** sobre as mudanças que os motores propõem, com histórico auditável | B+ |
| **Políticas Auto-Block** | Prevenir o custo antes que exista | Azure Policy com modelos (restringir tamanhos, regiões, exigir tags) | E |
| **Relatórios de Governança** | «Quão seguros e ordenados estamos?» | **Score de Segurança Financeira** 0-100, conformidade de políticas, RBAC e recursos zumbi | E |
| **Shift-Left FinOps** | O custo se decide quando alguém escreve o código | O custo de um `terraform plan` **dentro do Pull Request**, com limites por repositório | B+ |

### 5.5. Administração e transversais

| Tela ou função | O que o usuário vê | Plano |
|---|---|---|
| **Usuários e Acessos** | Cadastro de usuários (com busca no Entra ID), papéis, permissões por módulo, 2FA, SSO SAML (E), onboarding e Lighthouse (E) | P+ |
| **Relatórios e Exportação** | **Relatório executivo** em PDF, histórico, relatório de faturamento, Workbooks, modelos Power BI, exportação **FOCUS 1.1** e **assinaturas por e-mail** na cadência escolhida | P+ (alguns B/E) |
| **Integrações e API** | API REST pública, chaves MCP para assistentes de IA, Copilot M365 | E |
| **Faturamento e Auditoria** | Plano, cotas, mudança de plano com rateio, **audit trail** exportável | P+ |
| **Marketplace** | Módulos e cotas à la carte com passes temporários | Todos |
| **Suporte** | Tickets com a equipe dentro da plataforma, com SLA | P+ |
| **App móvel (PWA)** | Resumo, alertas, aprovações, suporte e perfil pelo celular | Todos |
| **Multi-idioma e multi-moeda** | Espanhol, inglês e português; o usuário vê os valores na sua moeda | Todos |
| **Alcance por equipe** | Que cada responsável veja **só a sua parcela** do gasto, aplicado no servidor; atribui-se na tela de usuários | E |

---

## 6. Planos, preços e limites

Os preços são os de tabela, em **dólares americanos**, vigentes em outubro de 2026. **Todos os planos começam com teste gratuito de 7 dias.**

### 6.1. Os três planos

| | Professional | Business | Enterprise |
|---|---|---|---|
| **Preço mensal** | US$ 299,99 | US$ 999,99 | A combinar |
| **Preço anual** | US$ 3.167,88 | US$ 10.559,88 | A combinar |
| **Economia pagando anual** | 12% | 12% | — |
| **Assinaturas do Azure** | Até 2 | Até 3 | Ilimitadas |
| **Usuários** | Até 3 | Até 5 | Ilimitados |
| **Para quem é** | Empresas médias que precisam entender tendências e reportar | Empresas em crescimento com vários ambientes | Corporações com topologias complexas, e MSPs |

> **O Business não se compra pelo volume de assinaturas** (inclui 3 e custa quase 3,3 vezes o Professional): paga-se por **capacidades** —remediação, automação, FOCUS, markup, API—. Se o cliente só precisa de mais assinaturas ou usuários, há add-ons mais baratos (6.3).

### 6.2. O que inclui cada plano

✓ = incluído · — = não incluído

**Capacidade e contas**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Assinaturas do Azure | Até 2 | Até 3 | Ilimitadas |
| Usuários | Até 3 | Até 5 | Ilimitados |
| Multi-moeda | ✓ | ✓ | ✓ |
| Delegações multi-tenant | — | ✓ | ✓ |

**Visibilidade e controle de custos**

| | Professional | Business | Enterprise |
|---|---|---|---|
| White Board (visão executiva) | ✓ | ✓ | ✓ |
| Histórico, faturamento e orçamentos | ✓ | ✓ | ✓ |
| Consumo real (painel detalhado) | ✓ | ✓ | ✓ |
| Alertas multicanal (orçamento, anomalias, limites) | ✓ | ✓ | ✓ |
| Maturidade FinOps | ✓ | ✓ | ✓ |
| Exportação FOCUS 1.1 | ✓ | ✓ | ✓ |
| Progresso histórico, TOP despesas, Green FinOps, economia capturada, vazamentos financeiros | ✓ | ✓ | ✓ |
| Recursos (inventário) e custos por categoria | — | ✓ | ✓ |
| Cost Groups (orçamento e forecast por unidade de negócio) | — | ✓ | ✓ |
| Ingestão CSV | — | ✓ | ✓ |
| Relatório executivo | — | ✓ | ✓ |
| Gastos e projeção de 12 meses, orçamento por centro de custos | — | — | ✓ |
| Perspectives, Leaderboard e alcance por equipe | — | — | ✓ |
| Rateio de custos compartilhados (Allocation) | — | — | ✓ |

**Economia e remediação**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Recursos zumbi e Zumbis de rede | Detecta | Detecta e remedia | Detecta e remedia |
| Conformidade e auditoria de tags | Audita | Audita e corrige | Audita e corrige |
| Backups órfãos | Detecta | Detecta e remedia | Detecta e remedia |
| Ligar e desligar VMs automaticamente | — | ✓ | ✓ |
| Expirações TTL | — | ✓ | ✓ |
| Credenciais a expirar (Entra ID) | — | ✓ | ✓ |
| Alta disponibilidade, Fim de suporte, Shift-Left | — | ✓ | ✓ |
| Action Center (Quick Fixes com scripts) e supressão de recomendações | ✓ | ✓ | ✓ |
| Aprovações de remediação (fluxo de quatro olhos) | — | ✓ | ✓ |
| Rightsizing de computação e banco de dados | — | — | ✓ |
| Reservas, Savings Plans e simulador de ponto de equilíbrio | — | — | ✓ |
| Benefícios Híbridos (AHB) | — | — | ✓ |
| Inventário de custo zero | — | — | ✓ |
| Simulador What-If | — | — | ✓ |
| Eficiência de storage e de computação | — | — | ✓ |
| MACC tracking e burn-rate | — | — | ✓ |

**Bancos de dados, computação, redes e serviços (hubs)**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Bancos de Dados, Computação e Redes | — | ✓ | ✓ |
| Kubernetes (AKS), chargeback por namespace e Unit Economics | — | — | ✓ |
| Armazenamento, Usuários e Licenças, Azure AI, Integration Services, Monitoramento, Segurança, Analítica Avançada | — | — | ✓ |

**Inteligência artificial**

| | Professional | Business | Enterprise |
|---|---|---|---|
| FinOps Copilot (consultas por mês) | 50 | 150 | Sem teto |
| Detecção de anomalias (Z-Score) | — | — | ✓ |
| AI Cost Analytics (Azure OpenAI e Cognitive Services) | — | — | ✓ |
| Custos do Microsoft 365 Copilot e chaves MCP | — | — | ✓ |

**Automação, governança e integrações**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Registro de auditoria completo | ✓ | ✓ | ✓ |
| Notificações (Slack, Teams, e-mail, webhook) | ✓ | ✓ | ✓ |
| 2FA para operações sensíveis | ✓ | ✓ | ✓ |
| Azure Key Vault (criptografia gerenciada) | ✓ | ✓ | ✓ |
| Políticas preventivas (Auto-Block) e Relatórios de Governança | — | — | ✓ |
| Azure Lighthouse (multi-tenant MSP) | — | — | ✓ |
| Motor de billing para parceiros CSP e markup de revenda | — | — | ✓ |
| Modelos Power BI e Power BI de faturamento | — | — | ✓ |
| SSO federado (SAML 2.0) | — | — | ✓ |
| API REST pública | — | — | ✓ |

**Suporte**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Tickets incluídos | 20 por mês | Ilimitados | Ilimitados |
| Primeira resposta (SLA) | 24 h | 8 h | 4 h |
| Suporte dedicado | — | — | ✓ |

> **O Azure Lighthouse é o argumento de peso com MSPs.** Permite conectar o tenant de um cliente sem pedir credenciais nem executar scripts no seu ambiente: o cliente delega o acesso a partir do seu próprio diretório e o revoga quando quiser.

> **Azure Marketplace.** A compra pelo Marketplace do Azure (útil para clientes Enterprise que querem consumir o seu compromisso com a Microsoft) está construída tecnicamente, mas **a oferta é publicada por um circuito administrativo à parte**. Antes de oferecê-la a um cliente, confirme conosco o seu estado. Um cliente faturado pelo Marketplace do Azure também não pode contratar módulos adicionais pela plataforma.

### 6.3. Add-ons e Marketplace da plataforma

Se o cliente precisa de **uma função ou de uma cota** que o seu plano não inclui, não é preciso saltar de plano. Em **Administração → Marketplace** contratam-se complementos avulsos, com **assinatura mensal rateada** ou com um **passe temporário** de 1, 3, 6, 9 ou 12 meses (paga-se uma vez e, ao vencer, desativa-se sozinho, sem tocar no plano). Preços de tabela de referência, por mês; o Marketplace mostra o vigente.

| Complemento | US$ / mês |
|---|---|
| **Assinatura do Azure adicional** | 40 |
| **Assentos de usuário extras (+5)** | 35 |
| **Tenant adicional** (outro tenant do Azure com a mesma conta) | 90 (Professional) · 240 (Business) |
| Simulador de Compromissos RIs & Savings Plans | 49 |
| Auditoria Avançada de Zumbis e Redes | 59 |
| Relatórios Executivos em PDF | 39 |
| Módulo **Aprovações** | 39 |
| Módulos **TTL**, **Agendas de Desligamento** e **Alta Disponibilidade** | 59 cada |
| Módulos **Inventário de Recursos**, **Credenciais a Expirar** e **Redes** | 79 cada |
| Módulos **Bancos de Dados** e **Computação** | 129 cada |
| Módulos Enterprise (**Otimização e Economia**, **Armazenamento**, **Usuários e Licenças**, **Azure AI**, **Integration Services**, **Monitoramento**, **Segurança**, **Analítica Avançada**, **Políticas e Auto-Block**, **Relatórios de Governança**) | 129 cada |

O **tenant adicional** custa aproximadamente **30% do plano base** (não um valor fixo): um valor fixo seria 50% do plano para o Professional e 19% para o Business. O **Enterprise** não usa add-ons por unidade: a sua capacidade se negocia por contrato, porque uma fatura por unidade torna imprevisível justamente o que esse comprador rejeita.

### 6.4. Faturamento

- As cobranças são processadas pela **Paddle**; os preços se confirmam ali. Mensal ou anual (o anual tem **12%** de desconto).
- Mudar de plano mostra **antes de confirmar** o valor real calculado pelo gateway («Será cobrado agora $X» ou «Você receberá um crédito de $X»), com rateio imediato, no próximo ciclo ou sem cobrança imediata. Até confirmar, cancela-se sem custo.
- O cliente baixa as suas faturas e atualiza o cartão em **Faturamento**.
- Os valores que a plataforma vê podem ser exibidos na **moeda do usuário** (com taxa de câmbio), mas **os preços de tabela são em dólares**.

### 6.5. Quando recomendar cada plano

| Se o cliente… | Recomende |
|---|---|
| Quer **entender e reportar** o gasto de 1 ou 2 assinaturas, com poucos usuários | **Professional** |
| Quer **agir** (desligar, remediar, taguear), tem vários ambientes ou precisa ratear custos por unidade de negócio | **Business** |
| Precisa **ratear por time com regras próprias**, otimizar compromissos, anomalias, SSO, API, ou é um **MSP** | **Enterprise** |
| Está em um plano e lhe falta **uma única coisa** | Um **add-on** do Marketplace, antes que um salto de plano |

Um cliente pode **começar pequeno e subir**: a plataforma avisa quando algo está fora do seu plano (com um cadeado e um modal que explica o que desbloqueia), e a mudança com rateio se faz em um par de cliques.

---

## 7. Como vender

### 7.1. Perguntas de descoberta

Não venda funções: **escute a dor** e mostre a tela que a resolve. Estas perguntas abrem a conversa; anote as respostas, você vai usá-las na demo.

| Tema | Perguntas |
|---|---|
| **Contexto** | Quantas assinaturas e tenants do Azure vocês têm? Como contratam: EA, MCA ou CSP? Mais ou menos quanto gastam por mês e como está a tendência? |
| **Visibilidade** | Quem olha a fatura do Azure e com que frequência? Quando o gasto se desvia, como vocês ficam sabendo e quantos dias levam? |
| **Rateio** | Como dividem o gasto entre áreas ou clientes hoje: planilha, tags, nada? Que porcentagem dos recursos está tagueada? |
| **Desperdício** | O que fazem com os recursos que ninguém usa? Os ambientes de desenvolvimento e testes são desligados fora do horário? Quando foi a última limpeza? |
| **Compromissos** | Têm Reservas ou Savings Plans? Quando vencem? Quem decide a renovação? |
| **Controle** | Quem aprova uma mudança em produção? Pedem evidências em uma auditoria? |
| **Equipe** | Há alguém dedicado a FinOps ou a TI faz «nas horas vagas»? |
| **Decisão** | Quem decide uma compra deste tipo? Há orçamento? Há uma data (fechamento do ano, renovação do EA, planejamento) que marque o momento? |

**Perguntas extras por persona:** ao **CFO**, «Com que frequência a fatura de nuvem te surpreende?». Ao **CTO**, «Como você sabe que o que se implanta cumpre as suas regras?». Ao **responsável por operações**, «Quantas horas por mês vocês dedicam a procurar recursos sem dono?».

### 7.2. Qualificação: vale a pena avançar?

| Sinais verdes | Sinais de alerta |
|---|---|
| Usam Azure com várias assinaturas ou times | Só AWS, Google Cloud ou on-premises |
| A fatura cresceu ou os surpreende | Gasto muito baixo, sem perspectiva de crescer |
| Pouco tagueamento e ninguém dono dos recursos | Querem que uma ferramenta execute mudanças com permissões amplas |
| Há uma data (fechamento, renovação) que apressa | Exigem hoje uma certificação SOC 2 ou residência de dados por região |
| Quem decide está na conversa | Nenhuma pessoa com decisão nem orçamento à vista |

### 7.3. Roteiro de demo em 20 minutos

**Antes:** escolha a demo do **plano que convém ao cliente** (`?tier=`), percorra o roteiro uma vez (usa dados sintéticos e algumas ações de escrita não são salvas) e tenha à mão as respostas de descoberta.

| Min | Tela | O que mostrar | O que dizer |
|---|---|---|---|
| 0-2 | — | Retome a dor dele com as próprias palavras | «Você me disse que a fatura te surpreende. Vamos ver como isso fica resolvido.» |
| 2-5 | **White Board** | Custo do período (alterne entre mês, 30 e 90 dias), forecast, **Economia Potencial**, zumbis, Quick Wins | «Esta é a visão da Diretoria. E este número é dinheiro que se pode recuperar.» |
| 5-9 | **Limpeza → Recursos Zumbi** | Os 25 tipos, desperdício duro vs mole, o botão de remediação com snapshot prévio, e **Aprovações** | «Cada recurso sem uso, com o seu custo mensal. E nada é excluído sem que outra pessoa aprove.» |
| 9-11 | **Governança → Agendas de Desligamento** | Uma regra de desligamento e o **Smart Shutdown** (não desliga uma VM que está trabalhando) | «Desligar os ambientes de testes à noite e nos fins de semana é das coisas mais rentáveis que há.» |
| 11-13 | **Governança → Tags** e **Cost Groups** | A sugestão de tags com IA e o rateio por unidade de negócio | «Sem tags não há rateio justo. Isto organiza quase sozinho.» |
| 13-15 | **Consumo e Orçamento** e **Alertas Self-Service** | Um orçamento com limite, um alerta que chega ao Teams ou Slack | «Você fica sabendo do desvio quando acontece, não quando chega a fatura.» |
| 15-17 | **Copilot** | Uma pergunta ao vivo sobre a tela atual | «Você pergunta no seu idioma e ele analisa o que você está vendo.» |
| 17-19 | **Relatórios** | O relatório executivo e as **assinaturas por e-mail** | «A Diretoria e o Financeiro recebem sozinhos, toda segunda.» |
| 19-20 | **Planos** | O plano que corresponde e o teste de 7 dias | «Testa-se 7 dias grátis. Montamos o onboarding esta semana?» |

**Variantes.** *Enterprise:* some **Perspectives e Leaderboard** (o rateio que fecha, o ranking por melhoria), **Reservas** com ESR e reservas que vencem juntas, **Shift-Left** (o custo no Pull Request) e, se for um MSP, **Lighthouse**. *Para o Financeiro:* menos recursos, mais Orçamentos, Gastos e Projeção e Relatórios. *Para Operações:* mais Zumbis, Computação e Agendas.

### 7.4. Como lidar com objeções

| Objeção | O que há por trás | Como responder |
|---|---|---|
| «Já temos Azure Cost Management / Advisor» | Acha que já está coberto | «São o ponto de partida, e os usamos como fonte. O que acrescentamos é dizer o que fazer, quem faz e quanto se economizou: zumbis com remediação e aprovação, tags com IA, desligamentos, rateio por time, orçamentos com alertas e relatórios que chegam sozinhos.» |
| «É caro» | Não vê o retorno | «Façamos a conta com o seu gasto» (7.6). «E o preço é fixo: não sobe quando cresce o seu consumo.» |
| «Não queremos dar permissões a um terceiro» | Risco de segurança | 3.2: papéis **somente leitura** no Professional, sem Contributor nem Owner em nenhum plano, revogáveis, e com o Lighthouse sem credenciais. «Você pode começar só com leitura.» |
| «E se executar algo e quebrar a produção?» | Medo da automação | As mudanças passam por **aprovação de quatro olhos**, com snapshot prévio e auditoria; o papel é restrito de propósito; **o Copilot não executa**. |
| «Não temos tempo para implementar outra ferramenta» | Custo de adoção | «Conecta-se com um script e a primeira sincronização traz dados em um minuto. Você testa 7 dias sem compromisso, e os nossos engenheiros acompanham o onboarding.» |
| «Montamos nós mesmos com Power BI ou planilhas» | Prefere construir | «Dá, mas alguém precisa mantê-lo. Aqui você já tem os motores, o padrão FOCUS e os modelos de Power BI. E a sua equipe se dedica a decidir, não a manter consultas.» |
| «Já usamos outra plataforma FinOps» | Custo de troca | Pergunte o que lhe falta. Diferenciais: **preço fixo** (não uma porcentagem do consumo), remediação com aprovação, Copilot em três idiomas, FOCUS 1.1. «Você não precisa decidir hoje: teste em paralelo 7 dias.» |
| «O nosso gasto não é tão grande» | Não vê o retorno | Faça a conta (7.6). Se de fato é muito pequeno, diga a ele: é melhor um «ainda não» honesto do que um cliente que vai embora. |
| «Onde estão os nossos dados?» | Compliance | 3.4: região **West US 2**, TLS 1.2+ e AES-256, Key Vault, auditoria por 7 anos, DPA e lista de subprocessadores públicos. |
| «Precisamos de SOC 2» | Requisito formal | Com honestidade: **está em preparação (meta Q3 2027)**. Ofereça o Centro de Confiança, o DPA e uma reunião com os nossos engenheiros; e nos avise. |
| «Usamos mais de uma nuvem» | Alcance | «Hoje é Azure. Com a ingestão de CSV em formato FOCUS você pode somar faturamento de outros provedores para analisá-lo ao lado.» |
| «A IA vê os nossos dados?» | Privacidade | 3.5: lê o que está na tela, o cliente escolhe se compartilha nomes de recursos e tags, pode **desligar a IA**, e não executa mudanças. |
| «Esperemos o fim do ano» | Falta de urgência | «O teste é de 7 dias e sem compromisso. O que se desperdiça a cada mês não se recupera.» |

### 7.5. Posicionamento frente às alternativas

| Alternativa | O que faz bem | Onde fica curta | Como posicionar |
|---|---|---|---|
| **Azure Cost Management e Advisor** (nativos) | Mostram o gasto e recomendações da Microsoft, sem custo extra | Dizem *o que* acontece, mas não organizam *quem* corrige, nem executam com aprovação, nem rateiam por time com regras próprias, nem enviam o relatório sozinhos | «Complemento: usamos os dados deles e fechamos o ciclo até a economia capturada» |
| **Planilhas e Power BI próprios** | Flexibilidade total | Alguém precisa mantê-los; cada mudança do Azure os quebra; não acionam | «A sua equipe decide em vez de manter» |
| **Outras plataformas FinOps de terceiros** | Cobertura ampla, muitas multi-nuvem | Muitas cobram uma **porcentagem do consumo**, então a mensalidade sobe com o cliente | «Preço fixo e público; foco profundo em Azure; remediação com aprovação» |
| **Consultoria ou auditoria pontual** | Uma foto especialista | Desatualiza-se assim que termina | «A plataforma faz todos os dias; pode complementar a consultoria» |

> Seja justo com a concorrência: não a desacredite nem afirme o que não puder demonstrar. O cliente compara.

### 7.6. Como quantificar o valor

A plataforma se paga com o que encontra. A conta, com os números do próprio cliente:

1. **Olhe a Economia Potencial** do White Board (na demo, com os dados sintéticos; no teste de 7 dias, com os dele). Some o que vê em **Recursos Zumbi** (o custo mensal do que está órfão), o **desligamento de ambientes** de desenvolvimento e testes (horas fora do horário vezes o custo dessas máquinas) e, se for Enterprise, o que mostram **Reservas** e o simulador de ponto de equilíbrio.
2. **Aplique uma estimativa prudente** de quanto se concretiza (por exemplo, a metade).
3. **Compare com o preço anual do plano** (Professional: US$ 3.167,88; Business: US$ 10.559,88).
4. **Depois do teste, use a Economia Capturada**: a economia real, com a data e quem a fez.

> **Exemplo ilustrativo, com números inventados para mostrar a conta (não é uma promessa nem um dado de nenhum cliente).** Se o White Board mostrasse uma Economia Potencial de US$ 2.000 por mês e só a metade se concretizasse, seriam US$ 1.000 por mês, US$ 12.000 por ano, contra US$ 3.167,88 do plano Professional anual: umas 3,8 vezes o que custa.

**O que NÃO fazer:** prometer uma porcentagem de economia. A economia depende do cliente. Mostre o dado dele.

### 7.7. Mensagens prontas para usar

**Primeiro contato (e-mail curto)**

> **Assunto:** A fatura do Azure da [Empresa]
>
> Olá [Nome]: trabalho com uma plataforma de FinOps para Azure que mostra a empresas como a sua para onde vai o gasto de nuvem e onde há dinheiro para recuperar —recursos que ninguém usa, máquinas ligadas além da conta, compromissos mal usados—, com aprovações e auditoria. Tem preço fixo e testa-se 7 dias grátis. Você topa que eu te mostre em 20 minutos como fica com dados de exemplo? — [Seu nome]

**Depois da demo**

> Olá [Nome]: obrigado pelo tempo. Resumo o que vimos: [dor 1 → tela], [dor 2 → tela]. Para testar com os seus dados, este é o link de cadastro: [seu link de indicação]. São 7 dias grátis e acompanhamos você com o onboarding. Montamos esta semana?

**Mensagem curta (LinkedIn ou chat)**

> Olá [Nome], como vai a fatura do Azure? Se você quer ver onde escapa dinheiro sem que ninguém perceba, tenho uma demo de 20 minutos de uma plataforma FinOps. Sem compromisso.

> Lembre: use sempre o **seu link de indicação** (`…/signup?ref=SEUCODIGO`) ao compartilhar o cadastro, para que o cliente fique atribuído ao seu nome (9.2).

---

## 8. Perguntas frequentes dos clientes

### Produto

**O que é e o que não é?** Uma plataforma de FinOps **para Azure**: visibilidade, otimização, governança e relatórios. Não é multi-nuvem e não é consultoria.

**Substitui o Azure Cost Management?** Não: usa-o como fonte de dados e acrescenta análise, remediação com aprovações, rateio por time, relatórios e a IA.

**Funciona com EA, MCA e CSP?** Sim. Em EA e MCA é preciso também um papel de leitura em nível de *billing account*, que atribui o administrador de faturamento do cliente. Com CSP, o plano Enterprise soma o motor de faturamento para parceiros, o *markup* de revenda e o Power BI de faturamento.

**Quantos dados históricos traz?** Até **13 meses** de custos.

**A cada quanto se atualizam os dados?** Os custos, **toda noite**; o mês atual é consultado ao vivo e o usuário pode forçar uma atualização com o botão *Atualizar*.

**Em que idiomas está?** Espanhol, inglês e português (Brasil), incluídos os manuais e o Copilot.

**Dá para usar pelo celular?** Sim: há um app web instalável (PWA) com resumo, alertas, aprovações, suporte e perfil.

**Pode exportar os dados?** Sim: exportação **FOCUS 1.1** (CSV, JSON, NDJSON), relatórios em PDF, modelos de Power BI e, no Enterprise, uma **API REST pública** e chaves MCP para assistentes de IA.

### Conexão e permissões

**Quanto demora para estar funcionando?** O cliente executa um script, carrega as credenciais no assistente e pressiona *Executar sincronização*: a primeira sincronização traz os primeiros custos em até um minuto.

**Que permissões precisa?** Veja 3.2. No Professional, somente leitura. Business e Enterprise somam um papel personalizado restrito para agir. Nunca Contributor nem Owner.

**E se o cliente tem muitas assinaturas?** O plano define o teto (2, 3 ou ilimitadas). Se há mais do que permite, as que ficam de fora aparecem esmaecidas com a marca «Fora do plano» e **não alimentam nenhum painel**; o cliente escolhe quais monitorar ou amplia a cota com um add-on.

**Dá para conectar sem nos dar credenciais?** Com o **Azure Lighthouse** (Enterprise): o cliente delega o acesso a partir do seu próprio diretório e o revoga quando quiser.

**Uma assinatura nova no Azure exige refazer o onboarding?** Não: os papéis de leitura são atribuídos no grupo de gerenciamento raiz e herdados; aparece sozinha ao sincronizar. Só é preciso atribuir à mão o papel de remediação se quiser *agir* sobre ela.

### Segurança e dados

**Onde ficam guardados os dados?** No Azure, região **West US 2**. Há uma única região de implantação.

**Como se protege a informação?** Criptografia TLS 1.2+ e AES-256, chaves no Azure Key Vault, 2FA para operações sensíveis, SSO SAML no Enterprise, papéis e permissões por módulo, e log de auditoria com retenção de 7 anos.

**Têm SOC 2?** Ainda não: **em preparação, meta terceiro trimestre de 2027**. ISO 27001, planejado para 2028. Há Centro de Confiança, DPA e lista de subprocessadores públicos.

**Que provedores externos intervêm?** Microsoft Azure, Paddle (pagamentos), WorkOS (SSO) e Google Gemini (modelos opcionais).

**Quem pode ver os dados da minha organização?** Somente os usuários do tenant que o próprio cliente cadastra, com o papel e as permissões que definir. Um administrador pode também **restringir** uma pessoa à sua parcela de gasto, e a restrição é aplicada pelo servidor.

### Faturamento e suporte

**Quanto custa?** Veja 6. Professional US$ 299,99 por mês, Business US$ 999,99, Enterprise a combinar; o anual tem 12% de desconto.

**Há teste gratuito?** Sim, **7 dias**, que se ativa ao passar pelo checkout.

**Posso mudar de plano?** Sim, com rateio calculado pelo gateway e visível antes de confirmar. Também pode somar módulos ou cotas avulsos pelo Marketplace.

**Que suporte inclui?** Tickets dentro da plataforma: 20 por mês com resposta em 24 horas (Professional), ilimitados com 8 horas (Business) ou 4 horas (Enterprise, com suporte dedicado).

**Onde vejo se a plataforma está funcionando?** Na **página de status** pública (`/status`), com o estado de cada componente e o histórico de incidentes.

### Inteligência artificial

**A IA modifica a minha infraestrutura?** Não. Analisa e recomenda.

**A IA vê os meus dados?** Trabalha com o que está na tela. O cliente pode escolher se se compartilham os nomes de recursos e as tags, usar **a sua própria** chave de IA ou **desligar** as funções de IA.

**Quanto me custa usar a IA?** Hoje o consumo de IA com a chave da plataforma é absorvido pela CSCloudSolutions: não se fatura à parte. Há uma cota mensal de consultas ao Copilot por plano (50, 150 ou sem teto).

---

## 9. O programa de parceiros: como você ganha

Sem exclusividade, sem cota mínima e sem que você precise fazer uma demo técnica: isso fazemos nós. Você escolhe o quanto quer se envolver em cada conta e pode usar as duas modalidades com clientes diferentes.

### 9.1. As duas modalidades

| | **Indicação** | **Co-venda** |
|---|---|---|
| **Comissão** | **15%** | **20%** |
| **Sobre o quê** | Cada cobrança do cliente | O valor anual da venda |
| **Durante** | Os primeiros **12 meses** do cliente | Veja abaixo |
| **O que você faz** | Compartilha o seu link | Apresenta a conta e co-lidera a oportunidade |
| **O que fazemos nós** | Todo o resto | Demo técnica, arquitetura e onboarding |

**A janela de 12 meses é contada por cliente, não a partir de quando você assina.** Se você trouxer uma conta em março e outra em novembro, cada uma comissiona os seus doze meses desde a sua própria primeira cobrança. Mede-se em meses e não em quantidade de cobranças: «até 12 cobranças» daria doze anos a um cliente que paga anual.

**Como se acumula a co-venda**, conforme o cliente paga:

- **Contrato mensal:** uma parcela por mês, equivalente a 20% de cada cobrança mensal, até 12 parcelas. O primeiro mês não é liquidado (período de onboarding) e vence junto com o segundo: após a segunda cobrança liquidam-se as duas primeiras parcelas, e do terceiro mês em diante cada cobrança acumula a sua parcela.
- **Contrato anual:** uma única parcela, 20% da cobrança anual, exigível a partir do **segundo mês** da venda. A renovação do ano seguinte não a paga de novo.
- Se o cliente é desligado, cancelam-se as parcelas que ainda não eram exigíveis; o que já era exigível ou estava pago não se toca.

**O que significa em dinheiro** (sobre preços de tabela, supondo que o cliente pague os doze meses):

| Plano que o seu cliente contrata | Indicação (15%) | Co-venda (20%) |
|---|---|---|
| Professional — US$ 299,99/mês | US$ 540 | US$ 720 |
| Business — US$ 999,99/mês | US$ 1.800 | US$ 2.400 |
| Enterprise — a combinar | Conforme contrato | Conforme contrato |

Os valores são calculados sobre o **subtotal antes de impostos** de cada cobrança. Não se comissionam impostos, retenções nem taxas do gateway de pagamento.

### 9.2. O seu link de indicação e como um cliente fica no seu nome

Damos a você um link próprio com o seu código:

```
https://finops.cscloudsolutions.com.ar/signup?ref=SEUCODIGO
```

1. Você compartilha o link por onde quiser: e-mail, LinkedIn, o seu próprio site.
2. Alguém entra por ali e o seu navegador guarda o seu código por **60 dias corridos**.
3. Se se cadastra dentro dessa janela, o cliente fica **atribuído a você**.
4. Desde a primeira cobrança, cada pagamento dele gera comissão para você durante 12 meses.

**As quatro regras:**

- **O primeiro toque vence.** Um cliente pertence a um único parceiro e a atribuição não é reatribuída. Se entrou pelo seu link e depois pelo de outro, é seu.
- **A atribuição ocorre no cadastro.** Uma empresa que já era cliente antes não é atribuída por entrar mais tarde em um link de indicação.
- **A sua porcentagem se congela em cada cobrança.** Se mais adiante renegociarmos o %, o que já foi acumulado não se toca: o novo vale a partir da cobrança seguinte.
- **Sem autoindicações.** Não se atribui um cliente quando o seu e-mail coincide com o de alguém dessa empresa. O sistema rejeita sozinho.

> **O limite que convém que você saiba.** A atribuição depende de o visitante conservar os cookies do navegador. A navegação privada, a limpeza de dados do site, a troca de dispositivo ou os bloqueadores podem impedi-la. Se você estiver trabalhando uma conta importante, **avise-nos antes de ela se cadastrar** e a atribuímos à mão: é a forma segura de não depender de um cookie.

### 9.3. O seu painel

Quando cadastramos você, recebe por e-mail um **link pessoal somente leitura** para o seu painel. Não precisa de usuário nem senha: **o link é a credencial**.

```
https://finops.cscloudsolutions.com.ar/partner#k=…
```

Abre no idioma do seu navegador, e você o troca com o **seletor de idioma** no canto superior direito (espanhol, inglês ou português) sem perder o acesso.

**O que você vê:**

- Quanto você tem **a receber** e quanto **já lhe pagamos**.
- Os seus **clientes indicados**, com a data até a qual cada um comissiona.
- O detalhe de cada comissão: empresa, data, base, porcentagem, valor e estado.
- **Este manual**, em espanhol, inglês e português, para baixar em PDF ou em Markdown, pelo botão *Manual do parceiro* do painel.

**O que você NÃO vê** (de propósito): o gasto em nuvem dos clientes que trouxe, os seus identificadores do Azure nem nada de outros parceiros. Só o nome da empresa, as datas e os seus próprios valores.

**Cuide do link:** quem o tiver vê os seus números. Não o cole em um grupo. Se o perder, peça-nos um novo: o anterior deixa de funcionar. Se deixarmos de trabalhar juntos, o revogamos e o painel se fecha.

### 9.4. Como e quando você recebe

Cada comissão passa por estes estados, e você os vê todos no seu painel:

| Estado | O que significa |
|---|---|
| **Pendente** | Acumulada. O cliente pagou e a sua comissão ficou registrada; espera-se a janela de reembolsos antes de aprová-la. |
| **Exigível** | Pronta para liquidar. |
| **Aprovada** | Revisada do nosso lado. |
| **Paga** | Já a transferimos a você, com o seu comprovante. |
| **Revertida** | O cliente pediu reembolso e a comissão foi anulada. |
| **Cancelada** | Anulada à mão. |

- As transferências são montadas **por lote**: agrupamos tudo o que lhe corresponde em um pagamento, não uma transferência por comissão. Se há um **mínimo**, o saldo que não o alcança é arrastado ao pagamento seguinte.
- **Se um cliente pede reembolso**, a comissão é anulada se ainda não a liquidamos. Se já pagamos, é descontada da liquidação seguinte.
- Uma comissão **Paga** não se desfaz pelo sistema: uma correção é uma operação contábil.

**O que combinamos ao assinar.** Preferimos dizer agora e não que você descubra depois. Estas quatro coisas **não** estão fixadas de antemão e se definem com você no acordo:

1. **Com que frequência liquidamos.** Hoje não há um calendário automático.
2. **A forma de pagamento.** Transferência, ou o que combinarmos; registramos na sua ficha.
3. **Se há um mínimo** abaixo do qual o saldo é arrastado ao pagamento seguinte.
4. **A documentação fiscal.** Quem emite comprovante e sob que condição. Não retemos nem tramitamos impostos por sua conta.

> As porcentagens deste manual são as do **programa padrão** e se confirmam no acordo assinado.

### 9.5. Como começar

1. **Uma ligação de 15 minutos:** vemos se a sua rede encaixa e respondemos o que faltar.
2. **Assinamos o acordo**, com a sua porcentagem e as condições de liquidação.
3. **Cadastramos você:** recebe por e-mail o seu link de indicação e o link do seu painel.
4. **Passamos o material comercial** e coordenamos a primeira demo quando você precisar.

Não é preciso que você saiba Azure nem FinOps. É preciso que tenha acesso a CTOs, CFOs, diretores de tecnologia ou responsáveis por infraestrutura.

### 9.6. Boas práticas para vender sem exagerar

- **Prometa o que a plataforma faz hoje.** Os limites estão marcados em 1.4, 3.4 e 6.2.
- **Não prometa uma certificação** (SOC 2, ISO 27001) nem a residência de dados por região.
- **Não garanta uma porcentagem de economia:** mostre o dado do próprio cliente (7.6).
- **Confirme preços e condições antes de cotar.** Os deste manual são os de tabela de outubro de 2026; qualquer condição especial (desconto, prazo, piloto) é coordenada com a CSCloudSolutions antes de oferecê-la.
- **Compartilhe sempre o seu link de indicação** e avise-nos das contas importantes antes de elas se cadastrarem.
- **Diante de uma dúvida técnica ou de segurança, escale:** os nossos engenheiros estão para isso.

---

## 10. Glossário

| Termo | O que significa |
|---|---|
| **FinOps** | A prática de gerenciar o gasto na nuvem com dados compartilhados entre Financeiro, Tecnologia e Negócio. |
| **FOCUS** | *FinOps Open Cost and Usage Specification*: formato padrão da FinOps Foundation para os dados de custo. A plataforma exporta em FOCUS 1.1. |
| **Service Principal** | A identidade de aplicação que o cliente cria no Entra ID para que a plataforma leia o seu Azure com os papéis certos. |
| **Azure Lighthouse** | Mecanismo do Azure para **delegar** o acesso a um tenant sem compartilhar credenciais; o cliente o revoga quando quiser. |
| **RBAC** | Controle de acesso baseado em papéis. No Azure, que papéis tem uma identidade; na plataforma, o que pode fazer cada usuário. |
| **EA / MCA / CSP** | Modalidades de contrato com a Microsoft: *Enterprise Agreement*, *Microsoft Customer Agreement* e *Cloud Solution Provider* (por meio de um parceiro). |
| **MACC** | *Microsoft Azure Consumption Commitment*: compromisso de consumo mínimo anual com a Microsoft. |
| **Reserva (RI)** | Compromisso de 1 ou 3 anos sobre um recurso específico em troca de um desconto frente ao pagamento sob demanda. |
| **Savings Plan** | Compromisso de gasto por hora, mais flexível que uma reserva. |
| **Pagamento sob demanda (PAYG)** | Pagar por uso sem compromisso: a tarifa mais alta. |
| **ESR** | *Effective Savings Rate*: quanto se economiza realmente contra pagar tudo a preço de tabela, descontando o compromisso que não foi usado. |
| **Azure Hybrid Benefit (AHB)** | Desconto por usar licenças de Windows Server ou SQL Server que o cliente já tem. |
| **Rightsizing** | Ajustar o tamanho de um recurso ao seu uso real. |
| **Recurso zumbi** | Recurso que continua faturando sem cumprir nenhuma função (disco não anexado, IP órfão, VM sem uso…). |
| **Hard waste / Soft waste** | Desperdício monetário direto / desalinhamento de governança (por exemplo, falta de tags). |
| **TTL** | *Time-To-Live*: vida útil de um recurso efêmero antes da sua expiração. |
| **Tag** | Metadado chave-valor em um recurso (Ambiente, Centro de custos…), base do rateio de custos. |
| **Showback / Chargeback** | Mostrar a cada área quanto gasta / cobrar isso internamente. |
| **Cost Group / Centro de custo** | Agrupamento de custos por projeto, linha de negócio ou área. |
| **Perspective** | Divisão do gasto por regras ordenadas (time, produto, ambiente) em que cada recurso cai em um único grupo. |
| **Unit Economics** | Custo por unidade de negócio (por transação, por usuário, por cliente). |
| **Anomalia** | Desvio de gasto fora do normal, detectado por estatística (Z-Score). |
| **Forecast / projeção** | Estimativa do gasto futuro. |
| **MTD** | *Month-To-Date*: o acumulado no mês atual. |
| **Shift-Left** | Levar o controle de custos a uma etapa mais cedo: o Pull Request, antes da implantação. |
| **Budget Gate** | Limite que faz falhar um Pull Request se a mudança acrescenta mais custo do que o permitido. |
| **BYOK** | *Bring Your Own Key*: o cliente usa a sua própria chave de IA. |
| **PAL / CPOR** | Mecanismos da Microsoft para associar um parceiro a um cliente (*Partner Admin Link*, *Claiming Partner of Record*). |
| **PWA** | Aplicativo web instalável no celular. |
| **Tenant** | A organização do cliente dentro da plataforma (e, no Azure, o seu diretório do Entra ID). |

---

## 11. Anexos

### Anexo A. Checklist da reunião

**Antes**
- [ ] Sei a que plano apontar e tenho a demo desse plano pronta (`?tier=`).
- [ ] Percorri o roteiro de demo (7.3) uma vez.
- [ ] Tenho o meu link de indicação à mão.

**Durante**
- [ ] Fiz as perguntas de descoberta (7.1) e anotei as respostas.
- [ ] Mostrei a dor do cliente, não uma lista de funções.
- [ ] Respondi às objeções com honestidade (7.4), inclusive os limites.
- [ ] Combinei o próximo passo com data.

**Depois**
- [ ] Enviei o resumo com o link de cadastro.
- [ ] Se é uma conta importante, avisei a CSCloudSolutions **antes** de ela se cadastrar.

### Anexo B. O que o cliente precisa preparar para o onboarding

- [ ] Uma pessoa com permissões para **executar o script** e **atribuir papéis** nas assinaturas a monitorar.
- [ ] A lista de **assinaturas** a conectar (dentro do teto do seu plano).
- [ ] Se tem **EA ou MCA**: o administrador de faturamento atribui o papel de leitura em nível de *billing account*.
- [ ] Um **e-mail corporativo** para o administrador do tenant (não se aceitam provedores gratuitos).
- [ ] Pelo menos um **canal de notificação** (e-mail, Slack ou Teams).
- [ ] Se usa **Lighthouse**: um administrador do diretório que aceite a delegação.
- [ ] Se usa **SSO** (Enterprise): os dados do seu provedor de identidade.

### Anexo C. Contatos e links

| Para… | Onde |
|---|---|
| Falar com a equipe comercial, o seu cadastro como parceiro, contas importantes | **sales@cscloudsolutions.com.ar** |
| Suporte técnico da plataforma | **soporte@cscloudsolutions.com.ar** (ou um ticket em *Suporte*) |
| Privacidade, DPA e estado da certificação | **privacy@cscloudsolutions.com.ar** |
| A plataforma | https://finops.cscloudsolutions.com.ar |
| Demo interativa | https://finops.cscloudsolutions.com.ar/demo |
| Centro de Confiança | `/legal/security` · `/legal/privacy` · `/legal/terms` · `/legal/dpa` · `/legal/subprocessors` |
| Estado da plataforma | `/status` |

---

**Manual do Parceiro e da Equipe Comercial — FinOps SaaS**
**Versão 1.0 | Português Brasileiro | Outubro 2026**

Os preços e as capacidades deste documento são os vigentes em outubro de 2026. As porcentagens de comissão são as do programa padrão e se confirmam no acordo assinado.
