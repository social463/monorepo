# CI/CD com GitHub Actions, EC2 e RDS — design

Data: 2026-08-23
Branch: `ci-cd-github-actions`

## Problema

O repo não tem `.github/` — nenhum pipeline no GitHub. O que existe hoje são dois
caminhos de deploy herdados, e nenhum deles serve para este trabalho:

- **`.k8s/production/` e `.k8s/hml/`** — pipeline do **Azure DevOps** que builda o
  Dockerfile, empurra para o ECR e atualiza o `kustomization.yaml` (GitOps) num EKS.
  Aponta para a conta da EMR (`196044402972`), onde o repositório ECR `legends` recebeu
  ~100 imagens, a última em 21/08. **Está vivo e não é tocado por este trabalho.**
- **`appspec.yml` + `start.sh` + `clean.sh`** — AWS CodeDeploy numa EC2. O `start.sh`
  roda `docker build` **dentro da instância** a cada deploy e o `clean.sh` faz
  `docker system prune -af`, jogando fora todo o cache de camadas. Uma EC2 pequena
  gasta minutos nisso, e o build compete com a aplicação que está servindo.

O destino aqui é **outra conta AWS**, com uma EC2 ainda vazia e sem banco. O objetivo é
um caminho novo: `push` na `main` builda, publica e sobe, com o Postgres num RDS
gerenciado em vez de container.

## Escopo

Entra:

- Workflow único em `.github/workflows/deploy.yml`, disparado **só** em `push` na `main`.
- Build da imagem no runner do GitHub (sai da EC2) e push para ECR.
- Deploy na EC2 via **SSM Send-Command**, sem abrir SSH.
- `prisma migrate deploy` como passo próprio, antes da troca do container.
- Health check em `/api/health` com rollback automático para a tag anterior.
- Terraform em `infra/` criando ECR, RDS, IAM (OIDC + role da EC2), security groups e a
  árvore de parâmetros no SSM.
- TLS com Caddy na própria EC2 (Let's Encrypt).

Não entra:

- **Workflow de PR** (teste/lint/build em pull request). Foi decisão explícita: o pedido
  é só `main` → AWS. Fica como trabalho separado.
- Qualquer alteração em `.k8s/`. Aquele pipeline é de outra conta e continua ativo.
- Remoção de `appspec.yml`, `start.sh`, `clean.sh`. Ficam onde estão; não colidem,
  porque o CodeDeploy não está ligado à EC2 nova.
- Staging/homologação. Um ambiente só, produção.
- Seed de produção no pipeline (ver "Seed inicial").

## Decisões

Cada uma foi escolhida no brainstorming; o registro aqui é do **porquê**, que é o que se
perde depois.

| Decisão | Escolha | Por quê |
|---|---|---|
| Auth do Actions na AWS | OIDC + IAM Role | Sem credencial de longa duração no GitHub e nada para rotacionar. O trust fica travado no repo **e** na branch. |
| Entrega na EC2 | ECR + SSM Send-Command | Não abre a porta 22 nem guarda chave privada em secret. A instância só precisa do agente do SSM, que já vem na AMI da Canonical. |
| Segredos da app | SSM Parameter Store (SecureString) | Versionado, auditável, e trocar um segredo não passa pelo GitHub nem por deploy. Separa quem opera de quem programa. |
| Infra | Terraform em `infra/` | Você revisa o `plan` antes de aplicar, e daqui a seis meses dá para saber por que um SG tem aquela regra. |
| Migrations | Passo próprio antes do swap | No boot (`RUN_MIGRATIONS=true`, hoje), uma migration quebrada mata o container novo **depois** de o antigo já ter morrido: fora do ar, sem rollback. Como passo próprio, a falha aborta o deploy com o container antigo ainda servindo. |
| TLS | Caddy na EC2 | Let's Encrypt automático sem os ~US$ 16/mês de um ALB. O branding resolve a empresa pelo `Host`, então domínio de verdade não é opcional. |
| Acesso ao RDS | Privado, só a EC2 | SG do banco aceita apenas o SG da instância. Acesso humano por túnel SSM quando precisar. |

## Fluxo do deploy

```
push na main
  │
  ├─ job build
  │    OIDC → assume role
  │    docker buildx build (arch da EC2) --cache-from/to gha
  │    push ECR :<sha> e :latest
  │
  └─ job deploy  (needs: build)
       SSM Send-Command com o conteúdo de infra/deploy/deploy.sh
         1. login no ECR, docker pull :<sha>
         2. monta /home/ubuntu/legends/.env a partir de /legends/prod/* (chmod 600)
         3. migrate one-shot:
              docker run --rm --env-file .env <img> \
                sh -lc 'cd /app && pnpm --filter @legends/api exec prisma migrate deploy'
            falhou? aborta — container antigo continua de pé
         4. guarda a tag em execução como PREV
         5. stop/rm do antigo, docker run do novo em -p 8080:80
         6. curl http://localhost:8080/api/health, com retry
         7. falhou? volta o PREV e sai != 0
```

O script vai **inline** no Send-Command, lido do repo pelo workflow. Assim a lógica de
deploy é sempre a versão commitada, e não uma cópia envelhecida no disco da instância.

`concurrency: { group: deploy-prod, cancel-in-progress: false }` — dois deploys
simultâneos na mesma instância se atropelariam no `docker stop`. Não cancelar o que está
em curso é deliberado: um deploy interrompido no meio do swap deixa a máquina sem
container nenhum.

`/api/health` funciona porque o nginx do container mapeia `/api/` → `127.0.0.1:3333/`, e
`GET /health` existe em `apps/api/src/app.ts:186`.

## Terraform (`infra/`)

```
infra/
  README.md            bootstrap manual: bucket de state, instance profile, Caddy
  providers.tf         backend S3 + provider aws
  variables.tf         region, account_id, vpc_id, subnet_ids, instance_id, domain
  ecr.tf               repositório + lifecycle policy
  rds.tf               subnet group, parameter group, instância, senha
  iam-github.tf        OIDC provider + role assumida pelo Actions
  iam-ec2.tf           role e instance profile da instância
  security-groups.tf   SG da EC2 e do RDS + attachment na ENI existente
  ssm-parameters.tf    árvore /legends/prod/*
  outputs.tf           role_arn, ecr_url, rds_endpoint
  deploy/deploy.sh     script executado via SSM
```

**RDS.** Postgres 16 (mesma major do `docker-compose.yml`), `db.t4g.micro`, gp3 20 GB,
`publicly_accessible = false`, `backup_retention_period = 7`,
`deletion_protection = true`, `skip_final_snapshot = false`. Senha gerada por
`random_password` e gravada como SecureString em `/legends/prod/DATABASE_URL` já no
formato de URL que o Prisma espera — o app nunca monta a string.

**A EC2 não é criada pelo Terraform.** Ela já existe. Consequências:

- O security group novo entra pela ENI existente, com
  `aws_network_interface_sg_attachment` — recurso feito para isso.
- **Não há recurso Terraform para associar um instance profile a uma instância que o
  Terraform não gerencia.** Fica como passo único documentado no `infra/README.md`
  (`aws ec2 associate-iam-instance-profile`). Importar a instância para o state é
  possível depois, mas é mudança de escopo: importar sem conhecer a configuração atual
  arrisca um `plan` que quer recriar a máquina.

**State.** Bucket S3 com versionamento e lock. O bucket é o **único** recurso criado à
mão, pelo ovo-e-galinha de guardar o próprio state.

## IAM

**Role do Actions** — trust condicionado a:

```
token.actions.githubusercontent.com:aud = sts.amazonaws.com
token.actions.githubusercontent.com:sub = repo:social463/monorepo:ref:refs/heads/main
```

O `sub` travado na branch é o que impede um PR de qualquer fork assumir a role. Permissões:

- `ecr:GetAuthorizationToken` (exige `Resource: *`, é uma chamada de conta).
- Push/pull de camadas **só** no ARN do repositório `legends`.
- `ssm:SendCommand` restrito a dois recursos: o documento `AWS-RunShellScript` e o ARN
  **daquele instance-id**. Sem isso a role manda comando em qualquer máquina da conta.
- `ssm:GetCommandInvocation` para acompanhar o resultado.

**Role da EC2** — `AmazonSSMManagedInstanceCore`, pull do ECR, `ssm:GetParametersByPath`
em `/legends/prod/*` e `kms:Decrypt` na chave `alias/aws/ssm` (sem ela o SecureString
volta cifrado e o `.env` sai com lixo).

## Segredos

`/legends/prod/<NOME>`, um parâmetro por variável de `apps/api/.env.example`:

`DATABASE_URL`, `JWT_SECRET`, `CALENDAR_ENCRYPTION_KEY`, `APP_BASE_URL`,
`GEMINI_API_KEY`, `GEMINI_MODEL`, `GIPHY_API_KEY`, `S3_BUCKET`, `S3_REGION`,
`S3_PUBLIC_BASE_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`,
`HR_DASHBOARD_ALLOWED_HOSTS`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`,
`TEAMS_NOTIFICATIONS_ENABLED`.

O Terraform cria a **estrutura** com valor placeholder e
`lifecycle { ignore_changes = [value] }`; o valor real é preenchido uma vez por fora.
Segredo em código Terraform vira segredo no state em texto claro.

Três exceções, que o Terraform **gera e gerencia de ponta a ponta**, porque não têm
origem externa — não existe valor "certo" para alguém colar:

- `DATABASE_URL` — montada do endpoint do RDS com a senha do `random_password`.
- `JWT_SECRET` e `CALENDAR_ENCRYPTION_KEY` — aleatórios (32 bytes em base64).

As três ficam no state, o que torna o bucket de state um alvo tão sensível quanto o
próprio Parameter Store: daí ele exigir versionamento, criptografia e acesso restrito.

`JWT_SECRET` e `CALENDAR_ENCRYPTION_KEY` são obrigatórios em produção (`lib/config.ts`),
e **perder o `CALENDAR_ENCRYPTION_KEY` torna ilegível toda credencial já cifrada** —
chaves de IA por empresa, tokens de calendário. O SSM passa a ser a cópia autoritativa;
`terraform destroy` no parâmetro, ou regenerar a chave, é perda de dado irreversível.

No GitHub ficam só valores não sensíveis, como *repository variables*: `AWS_REGION`,
`AWS_ROLE_ARN`, `EC2_INSTANCE_ID`, `ECR_REPOSITORY`.

## TLS e portas

Caddy no host termina 443 e faz `reverse_proxy` para `localhost:8080`. O container passa
a publicar **`8080:80`** em vez de `80:80`, liberando a 80 para o desafio HTTP-01.

O `nginx/default.conf` do container não muda: ele já tem `client_max_body_size 11m` e
`proxy_read_timeout 3600s` para o WebSocket do escritório virtual. O Caddy passa
WebSocket nativamente, sem configuração extra.

SG da EC2: 80 e 443 abertos; 22 opcional, já que o acesso operacional é por SSM.

## Seed inicial

O RDS nasce vazio, e o app precisa de categorias, selos, período e da conta SUPER_ADMIN
(`pnpm --filter @legends/api run db:seed`). É passo **manual, uma vez**, documentado no
`infra/README.md` e executado via SSM.

Fora do pipeline de propósito: o seed cria uma conta administrativa com senha conhecida
(`super-admin@legends.internal`) e mexe em catálogo. Rodar isso a cada deploy em
produção é desastre — e a senha padrão precisa ser trocada logo após o primeiro login.

## Variável em aberto

**Arquitetura da imagem.** A EC2 de destino está na outra conta e ainda não foi
inspecionada. Se for `arm64` (Graviton — é o padrão das instâncias do usuário na conta
atual: `t4g`, `c7g`), o build precisa de runner ARM nativo; emular com QEMU é ordens de
grandeza mais lento num build que compila TypeScript e roda `prisma generate`. Se for
`x86_64`, `ubuntu-latest` resolve. Resolvido na primeira tarefa do plano, com
`describe-instances` na conta certa.

## Riscos

- **Sem acesso à conta de destino, nada é criado.** O plano começa por obter credenciais
  e confirmar instance-id, VPC, subnets e arquitetura. Aplicar Terraform na conta errada
  criaria um segundo caminho de produção ao lado do EKS ativo da EMR.
- **Downtime de alguns segundos** entre `docker stop` e o health check passar. Aceito:
  uma instância, um container. Zero-downtime exigiria segunda instância e load balancer.
- **`main` sem proteção = deploy direto em produção.** O workflow não pode compensar
  isso; recomenda-se exigir PR para a `main` no GitHub.
