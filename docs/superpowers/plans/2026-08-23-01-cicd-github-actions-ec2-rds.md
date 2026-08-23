# CI/CD com GitHub Actions, EC2 e RDS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo `push` na `main` builda a imagem, publica no ECR e sobe na EC2 com migrations aplicadas, health check e rollback automático, com o Postgres num RDS gerenciado.

**Architecture:** Dois jobs no GitHub Actions. O primeiro assume uma role por OIDC, builda o `Dockerfile` que já existe e empurra para o ECR. O segundo manda o `infra/deploy/deploy.sh` **inline** por SSM Send-Command; na instância o script monta o `.env` a partir do Parameter Store, roda `prisma migrate deploy` num container one-shot, troca o container e valida `/api/health` — voltando à imagem anterior se falhar. Toda a infra (ECR, RDS, IAM, SGs, parâmetros) é Terraform em `infra/`.

**Tech Stack:** GitHub Actions, Terraform >= 1.10 com AWS provider ~> 5.60, AWS (ECR, RDS PostgreSQL 16, SSM Parameter Store + Send-Command, IAM OIDC), Docker Buildx, Caddy 2.

**Spec:** `docs/superpowers/specs/2026-08-23-cicd-github-actions-ec2-rds-design.md`

## Global Constraints

- **Conta AWS de destino é OUTRA**, não a `196044402972` que a CLI usa hoje. Nenhum `terraform apply` ou `aws` de escrita roda antes da Task 1 confirmar a conta. Aplicar na conta errada cria um segundo caminho de produção ao lado do EKS ativo da EMR.
- **Não tocar em `.k8s/`** (pipeline do Azure DevOps, outra conta, ativo), nem em `appspec.yml`, `start.sh`, `clean.sh`.
- **Nenhum workflow de pull request.** Só `push` na `main` e `workflow_dispatch`.
- **Nenhum segredo em arquivo commitado.** O repo `social463/monorepo` é **público**.
- Terraform: `required_version >= 1.10.0`, provider `hashicorp/aws ~> 5.60`, `hashicorp/random ~> 3.6`.
- Postgres do RDS na **major 16**, a mesma do `docker-compose.yml`.
- O container publica **`8080:80`**, nunca `80:80` — a porta 80 do host é do Caddy.
- Toda mensagem de log/erro voltada a pessoa em **português** (convenção do repo, `AGENTS.md`).
- Nomes de recurso prefixados com `legends-`; tag `Project = legends` via `default_tags`.
- Path dos parâmetros: `/legends/prod/<NOME_DA_VARIAVEL>`, batendo com `apps/api/.env.example`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `infra/README.md` | Passos manuais: bootstrap do state, associação do instance profile, seed inicial, túnel para o RDS |
| `infra/bootstrap-state.sh` | Cria o bucket S3 do state (o único recurso fora do Terraform) |
| `infra/backend.hcl` | Parâmetros do backend S3, passados no `terraform init` |
| `infra/providers.tf` | `terraform {}`, backend, provider AWS com `default_tags` |
| `infra/variables.tf` | Entradas: região, VPC, subnets, instance-id, domínio, repo |
| `infra/terraform.tfvars` | Valores concretos da conta (sem segredo) |
| `infra/ecr.tf` | Repositório `legends` + lifecycle policy |
| `infra/network.tf` | SG da app, SG do banco, attachment do SG na ENI existente |
| `infra/rds.tf` | Subnet group, senha aleatória, instância Postgres 16 |
| `infra/ssm-parameters.tf` | `/legends/prod/*` — 3 gerados pelo Terraform, o resto placeholder |
| `infra/iam-ec2.tf` | Role + instance profile da instância (SSM, pull do ECR, ler parâmetros) |
| `infra/iam-github.tf` | Provider OIDC + role assumida pelo Actions + policy mínima |
| `infra/outputs.tf` | `github_actions_role_arn`, `ecr_repository_url`, `rds_endpoint` |
| `infra/deploy/deploy.sh` | Deploy na instância: .env, migrations, swap, health check, rollback |
| `infra/ec2-bootstrap.sh` | Instala Docker, AWS CLI, agente SSM e Caddy na instância (uma vez) |
| `infra/Caddyfile` | Termina TLS e faz proxy para `localhost:8080` |
| `.github/workflows/deploy.yml` | Os dois jobs |
| `.github/scripts/send-deploy.sh` | Envia o Send-Command e acompanha até o fim |
| `.gitignore` | Ignora state, `.terraform/`, plano binário |

**Sobre "teste" em infraestrutura:** não há ciclo TDD clássico aqui. O equivalente honesto — e é assim que cada task abaixo está montada — é escrever primeiro o **comando de verificação** que prova o resultado, rodá-lo e vê-lo **falhar** (recurso não existe), depois aplicar, depois rodá-lo de novo e vê-lo **passar**. Onde há código de verdade (`deploy.sh`, `send-deploy.sh`), há lint e execução real.

---

### Task 1: Descobrir a conta de destino e travar os parâmetros

Task bloqueante: nada depois dela funciona sem esses valores. Ela não cria nada.

**Files:**
- Create: `infra/terraform.tfvars`
- Create: `infra/README.md` (seção "Dados da conta")

**Interfaces:**
- Produces: `infra/terraform.tfvars` com `aws_region`, `vpc_id`, `private_subnet_ids`, `ec2_instance_id`, `app_domain`; e o fato **arquitetura da instância** (`arm64` ou `x86_64`), que a Task 10 usa para escolher o runner.

- [ ] **Step 1: Obter credenciais da conta de destino**

Peça ao usuário. Uma das duas formas:

```bash
# forma A — perfil dedicado
aws configure --profile legends
# forma B — o usuário roda e cola o resultado
aws sts get-caller-identity
```

A partir daqui **todo** comando `aws` deste plano leva `--profile legends`. Confirme que não é a conta `196044402972`:

```bash
aws sts get-caller-identity --profile legends --query Account --output text
```

Expected: um número **diferente** de `196044402972`. Se for igual, **pare** e volte ao usuário.

- [ ] **Step 2: Escrever a verificação da instância e rodá-la**

```bash
aws ec2 describe-instances --profile legends \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[].Instances[].{arch:Architecture,type:InstanceType,state:State.Name,vpc:VpcId,subnet:SubnetId,ip:PublicIpAddress,profile:IamInstanceProfile.Arn,ami:ImageId}' \
  --output json
```

Expected: `state = running`. Anote `arch` — é o que decide o runner na Task 10. `profile` provavelmente vem `null`; a Task 7 resolve.

- [ ] **Step 3: Descobrir as subnets para o subnet group do RDS**

O RDS exige **duas subnets em AZs diferentes**, mesmo sem Multi-AZ.

```bash
VPC_ID=$(aws ec2 describe-instances --profile legends --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].VpcId' --output text)
aws ec2 describe-subnets --profile legends \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]' --output table
```

Expected: pelo menos duas AZs distintas. Prefira as subnets **sem** `MapPublicIpOnLaunch`; se a VPC for a default e todas forem públicas, use duas delas — o `publicly_accessible = false` do RDS é o que mantém o banco inalcançável de fora, não a subnet.

- [ ] **Step 4: Confirmar que o OIDC do GitHub ainda não existe na conta**

```bash
aws iam list-open-id-connect-providers --profile legends \
  --query "OpenIDConnectProviderList[?contains(Arn, 'token.actions.githubusercontent.com')]" --output text
```

Se **já existir**, a Task 8 importa em vez de criar (o comando de import está lá). Anote o resultado.

- [ ] **Step 5: Perguntar o domínio ao usuário**

Precisa de um domínio apontando (registro A) para o IP público da instância — o Caddy só emite certificado se o desafio HTTP-01 chegar. Sem domínio definido, `app_domain` fica pendente e a Task 10 não roda; as demais seguem.

- [ ] **Step 6: Escrever `infra/terraform.tfvars`**

```hcl
aws_region         = "us-east-1"
vpc_id             = "vpc-XXXXXXXX"
private_subnet_ids = ["subnet-AAAA", "subnet-BBBB"]
ec2_instance_id    = "i-XXXXXXXXXXXX"
app_domain         = "legends.exemplo.com.br"
github_repo        = "social463/monorepo"
deploy_branch      = "main"
```

- [ ] **Step 7: Exportar as variáveis de shell que o plano inteiro usa**

Praticamente todo comando das tasks seguintes depende destas. Deixe-as num arquivo e recarregue a cada sessão nova de terminal — **não commite** este arquivo se acrescentar algo sensível a ele.

```bash
cat > /tmp/legends-env.sh <<'EOF'
export AWS_PROFILE=legends
export AWS_REGION=us-east-1
export INSTANCE_ID=i-XXXXXXXXXXXX
export APP_DOMAIN=legends.exemplo.com.br
EOF

# Derivados — dependem dos de cima.
source /tmp/legends-env.sh
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
echo "conta=$ACCOUNT registry=$REGISTRY instancia=$INSTANCE_ID"
```

Expected: os três valores preenchidos, e `$ACCOUNT` **diferente** de `196044402972`.

- [ ] **Step 8: Instalar o Terraform**

```bash
brew tap hashicorp/tap && brew install hashicorp/tap/terraform
terraform version
```

Expected: `>= v1.10.0` — o backend S3 com `use_lockfile` (lock nativo, sem DynamoDB) só existe a partir da 1.10.

- [ ] **Step 9: Commit**

```bash
git add infra/terraform.tfvars infra/README.md
git commit -m "chore(infra): registra parametros da conta AWS de destino"
```

---

### Task 2: Fundação do Terraform (backend, providers, variáveis)

**Files:**
- Create: `infra/bootstrap-state.sh`, `infra/backend.hcl`, `infra/providers.tf`, `infra/variables.tf`, `infra/outputs.tf`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `infra/terraform.tfvars` (Task 1).
- Produces: um workspace Terraform inicializado, com state remoto. `var.aws_region`, `var.vpc_id`, `var.private_subnet_ids`, `var.ec2_instance_id`, `var.app_domain`, `var.github_repo`, `var.deploy_branch`, `var.db_instance_class`, `var.db_allocated_storage`, e o data source `data.aws_caller_identity.current`, usado por todas as tasks seguintes.

- [ ] **Step 1: Verificação primeiro — o bucket de state não existe**

```bash
ACCOUNT=$(aws sts get-caller-identity --profile legends --query Account --output text)
aws s3api head-bucket --profile legends --bucket "legends-tfstate-$ACCOUNT"
```

Expected: FALHA com `404` / `Not Found`.

- [ ] **Step 2: Escrever `infra/bootstrap-state.sh`**

```bash
#!/usr/bin/env bash
# Cria o bucket do state do Terraform. E o UNICO recurso criado fora do
# Terraform, pelo ovo-e-galinha de guardar o proprio state.
# Uso: AWS_PROFILE=legends ./infra/bootstrap-state.sh
set -Eeuo pipefail

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="legends-tfstate-${ACCOUNT}"

if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "bucket $BUCKET ja existe"
else
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION"
  fi
  echo "bucket $BUCKET criado"
fi

# O state guarda DATABASE_URL, JWT_SECRET e CALENDAR_ENCRYPTION_KEY em texto.
# Versionamento, criptografia e bloqueio de acesso publico nao sao opcionais.
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'

aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'

echo "pronto. bucket: $BUCKET"
```

- [ ] **Step 3: Rodar e verificar que agora existe**

```bash
chmod +x infra/bootstrap-state.sh
AWS_PROFILE=legends AWS_REGION=us-east-1 ./infra/bootstrap-state.sh
aws s3api head-bucket --profile legends --bucket "legends-tfstate-$ACCOUNT" && echo OK
```

Expected: `OK`, e o script imprime o nome do bucket.

- [ ] **Step 4: Escrever `infra/backend.hcl`** (troque `<ACCOUNT>` pelo número real)

```hcl
bucket       = "legends-tfstate-<ACCOUNT>"
key          = "prod/terraform.tfstate"
region       = "us-east-1"
encrypt      = true
use_lockfile = true
```

- [ ] **Step 5: Escrever `infra/providers.tf`**

```hcl
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # Valores em backend.hcl: terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "legends"
      ManagedBy = "terraform"
    }
  }
}

# Usado pelas policies das Tasks 7 e 8 para montar ARNs.
data "aws_caller_identity" "current" {}
```

- [ ] **Step 6: Escrever `infra/variables.tf`**

```hcl
variable "aws_region" {
  type        = string
  description = "Regiao onde tudo e criado. Precisa ser a mesma da EC2."
}

variable "vpc_id" {
  type        = string
  description = "VPC da EC2 existente."
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Ao menos duas subnets em AZs distintas — o RDS exige isso mesmo sem Multi-AZ."

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "O subnet group do RDS precisa de pelo menos duas subnets."
  }
}

variable "ec2_instance_id" {
  type        = string
  description = "Instancia que recebe o deploy. NAO e gerenciada por este Terraform."
}

variable "app_domain" {
  type        = string
  description = "Dominio publico do app. O branding resolve a empresa pelo Host."
}

variable "github_repo" {
  type        = string
  default     = "social463/monorepo"
  description = "owner/repo autorizado a assumir a role via OIDC."
}

variable "deploy_branch" {
  type        = string
  default     = "main"
  description = "Unica branch que consegue assumir a role. Repo publico: manter travado."
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}
```

- [ ] **Step 7: Escrever `infra/outputs.tf`**

```hcl
output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions.arn
  description = "Valor da repository variable AWS_ROLE_ARN."
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.legends.repository_url
  description = "Registro/repositorio das imagens."
}

output "rds_endpoint" {
  value       = aws_db_instance.legends.endpoint
  description = "host:porta do Postgres. Alcancavel so de dentro da VPC."
}
```

Esse arquivo referencia recursos das Tasks 3, 4 e 8; até lá o `validate` acusa. É esperado — o Step 9 abaixo só roda `init`.

- [ ] **Step 8: Ignorar artefatos do Terraform**

Acrescente ao final de `.gitignore`:

```
infra/.terraform/
infra/.terraform.lock.hcl
*.tfstate
*.tfstate.*
*.tfplan
```

- [ ] **Step 9: Inicializar e verificar**

```bash
cd infra && AWS_PROFILE=legends terraform init -backend-config=backend.hcl
```

Expected: `Terraform has been successfully initialized!` e o state indo para o S3.

- [ ] **Step 10: Commit**

```bash
git add infra/bootstrap-state.sh infra/backend.hcl infra/providers.tf \
        infra/variables.tf infra/outputs.tf .gitignore
git commit -m "feat(infra): fundacao do terraform com state remoto em S3"
```

---

### Task 3: Repositório ECR

**Files:**
- Create: `infra/ecr.tf`

**Interfaces:**
- Consumes: providers e variáveis (Task 2).
- Produces: `aws_ecr_repository.legends` — atributos `.arn` (usado nas policies das Tasks 7 e 8) e `.repository_url` (usado pelo workflow, Task 9).

- [ ] **Step 1: Verificação primeiro — o repositório não existe**

```bash
aws ecr describe-repositories --profile legends --repository-names legends
```

Expected: FALHA com `RepositoryNotFoundException`.

- [ ] **Step 2: Escrever `infra/ecr.tf`**

```hcl
resource "aws_ecr_repository" "legends" {
  name                 = "legends"
  image_tag_mutability = "MUTABLE" # a tag :latest e reescrita a cada deploy

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "legends" {
  repository = aws_ecr_repository.legends.name

  # A imagem passa de 280 MB. Sem expiracao, o custo do registro so cresce.
  # 20 e o suficiente para rollback: o alvo e sempre a imagem anterior.
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Mantem as 20 imagens mais recentes"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
```

- [ ] **Step 3: Planejar só este recurso**

```bash
cd infra && AWS_PROFILE=legends terraform plan \
  -target=aws_ecr_repository.legends \
  -target=aws_ecr_lifecycle_policy.legends
```

Expected: `2 to add, 0 to change, 0 to destroy`.

- [ ] **Step 4: Aplicar**

```bash
cd infra && AWS_PROFILE=legends terraform apply \
  -target=aws_ecr_repository.legends \
  -target=aws_ecr_lifecycle_policy.legends
```

- [ ] **Step 5: Rodar a verificação do Step 1 de novo**

```bash
aws ecr describe-repositories --profile legends --repository-names legends \
  --query 'repositories[0].repositoryUri' --output text
```

Expected: PASSA, imprimindo `<account>.dkr.ecr.<region>.amazonaws.com/legends`.

- [ ] **Step 6: Commit**

```bash
git add infra/ecr.tf
git commit -m "feat(infra): repositorio ECR do legends com lifecycle de 20 imagens"
```

---

### Task 4: Security groups e RDS

Uma task só: um banco sem a regra de entrada certa não é revisável em separado — a pergunta "isto está seguro?" se responde olhando os dois juntos.

**Files:**
- Create: `infra/network.tf`, `infra/rds.tf`

**Interfaces:**
- Consumes: providers e variáveis (Task 2).
- Produces: `aws_security_group.app` (referenciado pela regra de entrada do banco), `aws_db_instance.legends` com `.endpoint`, `.username`, `.db_name`, e `random_password.db.result` — os quatro montam a `DATABASE_URL` na Task 5.

- [ ] **Step 1: Verificação primeiro — o banco não existe**

```bash
aws rds describe-db-instances --profile legends --db-instance-identifier legends-prod
```

Expected: FALHA com `DBInstanceNotFound`.

- [ ] **Step 2: Escrever `infra/network.tf`**

```hcl
resource "aws_security_group" "app" {
  name        = "legends-app"
  description = "HTTP/HTTPS publico para o Caddy da EC2 do Legends"
  vpc_id      = var.vpc_id

  # A 80 fica aberta nao para servir o app, e sim para o redirect e para o
  # desafio HTTP-01 do Let's Encrypt. Fechar a 80 quebra a renovacao do
  # certificado 60 dias depois, quando ninguem mais lembra deste arquivo.
  ingress {
    description = "HTTP (redirect e desafio ACME)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Saida liberada (pull do ECR, SSM, ACME, S3, LiveKit)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# A instancia ja existe e NAO e gerenciada aqui. O data source so le a ENI
# para pendurar o SG novo nela, sem mexer nos SGs que ela ja tiver.
data "aws_instance" "app" {
  instance_id = var.ec2_instance_id
}

resource "aws_network_interface_sg_attachment" "app" {
  security_group_id    = aws_security_group.app.id
  network_interface_id = data.aws_instance.app.network_interface_id
}

resource "aws_security_group" "db" {
  name        = "legends-db"
  description = "Postgres acessivel apenas pela EC2 do Legends"
  vpc_id      = var.vpc_id

  # Referencia o SG, nao um CIDR: se a instancia trocar de IP, a regra continua
  # valendo. E nada fora desse SG alcanca o banco.
  ingress {
    description     = "Postgres a partir da EC2 do Legends"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  # Sem egress de proposito: o RDS nao inicia conexao para lugar nenhum.
}
```

- [ ] **Step 3: Escrever `infra/rds.tf`**

```hcl
resource "aws_db_subnet_group" "legends" {
  name       = "legends"
  subnet_ids = var.private_subnet_ids
}

resource "random_password" "db" {
  length = 32
  # special = false de proposito: a senha entra numa URL
  # (postgresql://user:senha@host/db) e um '/' ou '@' quebraria o parse do
  # Prisma sem percent-encoding. 32 chars alfanumericos ja dao entropia de
  # sobra, e o RDS proibe varios especiais de qualquer forma.
  special = false
}

resource "aws_db_instance" "legends" {
  identifier     = "legends-prod"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = 100 # autoscaling do disco; evita ficar sem espaco de madrugada
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "legends"
  username = "legends"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.legends.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period    = 7
  auto_minor_version_upgrade = true

  # Producao: nem um `terraform destroy` distraido leva o banco embora.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "legends-prod-final"
}
```

- [ ] **Step 4: Planejar e conferir o que vai nascer**

```bash
cd infra && AWS_PROFILE=legends terraform plan \
  -target=aws_security_group.app -target=aws_security_group.db \
  -target=aws_network_interface_sg_attachment.app \
  -target=aws_db_subnet_group.legends -target=aws_db_instance.legends
```

Expected: `6 to add` — os 5 recursos mais `random_password.db`, que entra como dependência do banco. Confira no plano que `publicly_accessible = false` e que o SG do banco não tem `cidr_blocks`.

- [ ] **Step 5: Aplicar** (o RDS leva ~10 minutos)

```bash
cd infra && AWS_PROFILE=legends terraform apply \
  -target=aws_security_group.app -target=aws_security_group.db \
  -target=aws_network_interface_sg_attachment.app \
  -target=aws_db_subnet_group.legends -target=aws_db_instance.legends
```

- [ ] **Step 6: Rodar a verificação do Step 1 de novo**

```bash
aws rds describe-db-instances --profile legends --db-instance-identifier legends-prod \
  --query 'DBInstances[0].[DBInstanceStatus,Endpoint.Address,PubliclyAccessible,StorageEncrypted]' --output text
```

Expected: `available <host>.rds.amazonaws.com False True`. Um `True` na terceira coluna é falha da task.

- [ ] **Step 7: Confirmar que o SG novo entrou na instância sem derrubar os antigos**

```bash
aws ec2 describe-instances --profile legends --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[].Instances[].SecurityGroups[].GroupName' --output text
```

Expected: `legends-app` na lista, junto do que já estava lá.

- [ ] **Step 8: Commit**

```bash
git add infra/network.tf infra/rds.tf
git commit -m "feat(infra): security groups e RDS postgres 16 privado"
```

---

### Task 5: Parâmetros no SSM Parameter Store

**Files:**
- Create: `infra/ssm-parameters.tf`

**Interfaces:**
- Consumes: `aws_db_instance.legends`, `random_password.db` (Task 4); `var.app_domain`, `var.aws_region` (Task 2).
- Produces: a árvore `/legends/prod/*`, lida pelo `deploy.sh` (Task 8) e autorizada pela role da Task 7.

- [ ] **Step 1: Verificação primeiro — a árvore está vazia**

```bash
aws ssm get-parameters-by-path --profile legends --path /legends/prod \
  --query 'length(Parameters)' --output text
```

Expected: `0`.

- [ ] **Step 2: Escrever `infra/ssm-parameters.tf`**

```hcl
resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

# 32 bytes em base64, exatamente o que lib/crypto.ts espera.
resource "random_bytes" "calendar_encryption_key" {
  length = 32
}

locals {
  # aws_db_instance.endpoint ja vem como "host:5432".
  database_url = format(
    "postgresql://%s:%s@%s/%s?schema=public",
    aws_db_instance.legends.username,
    random_password.db.result,
    aws_db_instance.legends.endpoint,
    aws_db_instance.legends.db_name,
  )

  # Valor vem de fora: nasce placeholder e o Terraform nunca mais olha.
  # PREENCHER e um sentinela — o deploy.sh OMITE do .env todo parametro com
  # esse valor, para que a variavel chegue ausente na aplicacao e o recurso
  # degrade como foi projetado (503 tratado), em vez de tentar usar lixo.
  placeholder_parameters = {
    GEMINI_API_KEY     = "PREENCHER"
    GIPHY_API_KEY      = "PREENCHER"
    S3_BUCKET          = "PREENCHER"
    S3_PUBLIC_BASE_URL = "PREENCHER"
    LIVEKIT_API_KEY    = "PREENCHER"
    LIVEKIT_API_SECRET = "PREENCHER"
    LIVEKIT_URL        = "PREENCHER"
  }

  # Valor conhecido agora e derivado da propria infra.
  derived_parameters = {
    APP_BASE_URL                = "https://${var.app_domain}"
    GEMINI_MODEL                = "gemini-2.5-flash"
    S3_REGION                   = var.aws_region
    TEAMS_NOTIFICATIONS_ENABLED = "true"
  }
}

# HR_DASHBOARD_ALLOWED_HOSTS, GA4_MEASUREMENT_ID e GA4_API_SECRET NAO sao
# criados: o SSM nao aceita valor vazio, e a aplicacao trata ausencia como
# estado valido (config.ts cai no default; o sink do GA4 some sem derrubar o
# boot). Criar com placeholder seria pior que nao criar.

resource "aws_ssm_parameter" "database_url" {
  name        = "/legends/prod/DATABASE_URL"
  type        = "SecureString"
  value       = local.database_url
  description = "Montada pelo Terraform a partir do RDS."
}

resource "aws_ssm_parameter" "jwt_secret" {
  name        = "/legends/prod/JWT_SECRET"
  type        = "SecureString"
  value       = random_password.jwt_secret.result
  description = "Obrigatorio em producao (lib/config.ts). Trocar desloga todo mundo."
}

resource "aws_ssm_parameter" "calendar_encryption_key" {
  name  = "/legends/prod/CALENDAR_ENCRYPTION_KEY"
  type  = "SecureString"
  value = random_bytes.calendar_encryption_key.base64
  # PERDER OU REGERAR ESTA CHAVE TORNA ILEGIVEL toda credencial ja cifrada:
  # chaves de IA por empresa e tokens de calendario. E perda irreversivel.
  description = "Cifra segredos em repouso. NAO regenerar."

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ssm_parameter" "derived" {
  for_each    = local.derived_parameters
  name        = "/legends/prod/${each.key}"
  type        = "SecureString"
  value       = each.value
  description = "Derivado da infra pelo Terraform."
}

resource "aws_ssm_parameter" "placeholder" {
  for_each    = local.placeholder_parameters
  name        = "/legends/prod/${each.key}"
  type        = "SecureString"
  value       = each.value
  description = "Preencher fora do Terraform. Segredo em codigo vira segredo no state."

  lifecycle {
    ignore_changes = [value]
  }
}
```

- [ ] **Step 3: Aplicar**

```bash
cd infra && AWS_PROFILE=legends terraform apply \
  -target=aws_ssm_parameter.database_url \
  -target=aws_ssm_parameter.jwt_secret \
  -target=aws_ssm_parameter.calendar_encryption_key \
  -target=aws_ssm_parameter.derived \
  -target=aws_ssm_parameter.placeholder
```

Expected: `16 to add` — os 14 parâmetros mais `random_password.jwt_secret` e `random_bytes.calendar_encryption_key`, que entram como dependência.

- [ ] **Step 4: Rodar a verificação do Step 1 de novo**

```bash
aws ssm get-parameters-by-path --profile legends --path /legends/prod \
  --query 'Parameters[].Name' --output text | tr '\t' '\n' | sort
```

Expected: 14 nomes. Nenhum deles `GA4_*` nem `HR_DASHBOARD_ALLOWED_HOSTS`.

- [ ] **Step 5: Conferir que a `DATABASE_URL` saiu bem formada**

```bash
aws ssm get-parameter --profile legends --name /legends/prod/DATABASE_URL \
  --with-decryption --query 'Parameter.Value' --output text | sed -E 's#//([^:]+):[^@]+@#//\1:***@#'
```

Expected: `postgresql://legends:***@legends-prod.xxxx.us-east-1.rds.amazonaws.com:5432/legends?schema=public`. A senha é mascarada pelo `sed` para não vazar no terminal nem no log da sessão.

- [ ] **Step 6: Commit**

```bash
git add infra/ssm-parameters.tf
git commit -m "feat(infra): arvore de parametros /legends/prod no SSM"
```

---

### Task 6: Preparar a EC2 (Docker, AWS CLI, agente SSM, Caddy)

**Files:**
- Create: `infra/ec2-bootstrap.sh`

**Interfaces:**
- Consumes: nada do Terraform — roda na instância.
- Produces: instância com `docker`, `aws` e `caddy` instalados e o agente SSM ativo. A Task 7 depende disso para provar que o pull do ECR funciona; a Task 8 depende do Docker.

- [ ] **Step 1: Verificação primeiro — a instância responde ao SSM?**

```bash
aws ssm describe-instance-information --profile legends \
  --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
  --query 'InstanceInformationList[0].[PingStatus,PlatformName,PlatformVersion,AgentVersion]' --output text
```

Expected agora: vazio ou `None` — sem instance profile a instância não aparece no SSM. É o que a Task 7 conserta. **Se já aparecer `Online`, ótimo**, siga; significa que a instância já tem um perfil com o `AmazonSSMManagedInstanceCore`.

- [ ] **Step 2: Escrever `infra/ec2-bootstrap.sh`**

```bash
#!/usr/bin/env bash
# Rodar UMA VEZ na EC2, como root (via SSM Send-Command ou console).
# Ubuntu 22.04 / 24.04. Idempotente: pode rodar de novo sem quebrar.
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg unzip apt-transport-https \
                   debian-keyring debian-archive-keyring

# ---------- Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io
fi
usermod -aG docker ubuntu
systemctl enable --now docker

# ---------- AWS CLI v2 ----------
# O deploy.sh usa `aws ssm get-parameters-by-path` e `aws ecr get-login-password`.
if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip
  unzip -q -o /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install --update
  rm -rf /tmp/awscliv2.zip /tmp/aws
fi

# ---------- Agente SSM ----------
# Ja vem nas AMIs Ubuntu da Canonical; o `|| true` cobre a AMI que nao tem.
snap install amazon-ssm-agent --classic 2>/dev/null || true
systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service 2>/dev/null \
  || systemctl enable --now amazon-ssm-agent 2>/dev/null || true

# ---------- Caddy ----------
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

mkdir -p /home/ubuntu/legends
chown ubuntu:ubuntu /home/ubuntu/legends

echo "bootstrap concluido"
docker --version
aws --version
caddy version
```

- [ ] **Step 3: Enviar e rodar na instância**

Depois que a Task 7 associar o instance profile (se a instância ainda não aparecia no SSM, faça a Task 7 antes deste step):

```bash
CMD_ID=$(aws ssm send-command --profile legends \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "bootstrap da instancia" \
  --parameters commands="$(jq -Rs . < infra/ec2-bootstrap.sh)" \
  --query 'Command.CommandId' --output text)
sleep 90
aws ssm get-command-invocation --profile legends \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent]' --output text
```

Expected: `Success` e a saída terminando com as três versões (`Docker version…`, `aws-cli/2…`, `v2.…`).

- [ ] **Step 4: Commit**

```bash
git add infra/ec2-bootstrap.sh
git commit -m "feat(infra): script de bootstrap da EC2 (docker, aws cli, ssm, caddy)"
```

---

### Task 7: IAM da EC2 — instance profile

**Files:**
- Create: `infra/iam-ec2.tf`
- Modify: `infra/README.md` (seção "Associar o instance profile")

**Interfaces:**
- Consumes: `aws_ecr_repository.legends.arn` (Task 3), `data.aws_caller_identity.current` (Task 2).
- Produces: `aws_iam_instance_profile.ec2`, associado à instância. É o que dá à máquina: SSM, pull do ECR e leitura de `/legends/prod/*`.

- [ ] **Step 1: Verificação primeiro — a instância não lê os parâmetros**

```bash
aws ec2 describe-instances --profile legends --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].IamInstanceProfile' --output text
```

Expected: `None`.

- [ ] **Step 2: Escrever `infra/iam-ec2.tf`**

```hcl
resource "aws_iam_role" "ec2" {
  name = "legends-ec2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Da a instancia o canal do SSM: e como o Actions manda o deploy sem SSH.
resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2" {
  name = "legends-ec2"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Chamada de conta, nao de repositorio: a API so aceita Resource "*".
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = aws_ecr_repository.legends.arn
      },
      {
        Sid      = "ReadAppParameters"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/legends/prod/*"
      },
      {
        # Sem isto o SecureString volta cifrado e o .env sai com lixo.
        # A condicao limita a chave ao uso via SSM, e nao a conta inteira.
        Sid      = "DecryptParameters"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      },
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "legends-ec2"
  role = aws_iam_role.ec2.name
}
```

- [ ] **Step 3: Aplicar**

```bash
cd infra && AWS_PROFILE=legends terraform apply \
  -target=aws_iam_role.ec2 -target=aws_iam_role_policy_attachment.ec2_ssm \
  -target=aws_iam_role_policy.ec2 -target=aws_iam_instance_profile.ec2
```

- [ ] **Step 4: Associar o perfil à instância**

**Não existe recurso Terraform para isto** numa instância que o Terraform não gerencia. É passo único, por CLI. Documente-o em `infra/README.md`.

```bash
aws ec2 associate-iam-instance-profile --profile legends \
  --instance-id "$INSTANCE_ID" \
  --iam-instance-profile Name=legends-ec2
```

Se a instância já tiver um perfil, troque com `replace-iam-instance-profile-association` em vez de `associate`.

- [ ] **Step 5: Rodar a verificação do Step 1 de novo**

```bash
aws ec2 describe-instances --profile legends --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text
```

Expected: `arn:aws:iam::<account>:instance-profile/legends-ec2`.

- [ ] **Step 6: Provar que a instância lê um parâmetro decifrado**

O SSM leva 1-2 minutos para reconhecer a instância. Depois:

```bash
CMD_ID=$(aws ssm send-command --profile legends \
  --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --parameters 'commands=["aws ssm get-parameter --name /legends/prod/APP_BASE_URL --with-decryption --region '"$AWS_REGION"' --query Parameter.Value --output text"]' \
  --query 'Command.CommandId' --output text)
sleep 15
aws ssm get-command-invocation --profile legends \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent]' --output text
```

Expected: `Success` e o domínio (`https://…`) em texto claro. Se vier base64 ou erro de KMS, a policy `DecryptParameters` está errada.

- [ ] **Step 7: Commit**

```bash
git add infra/iam-ec2.tf infra/README.md
git commit -m "feat(infra): role e instance profile da EC2 (ssm, ecr pull, parametros)"
```

---

### Task 8: IAM do GitHub — provider OIDC e role de deploy

**Files:**
- Create: `infra/iam-github.tf`

**Interfaces:**
- Consumes: `aws_ecr_repository.legends.arn` (Task 3), `var.ec2_instance_id`, `var.github_repo`, `var.deploy_branch` (Task 2).
- Produces: `aws_iam_role.github_actions.arn` — vira a repository variable `AWS_ROLE_ARN` na Task 10.

- [ ] **Step 1: Verificação primeiro — a role não existe**

```bash
aws iam get-role --profile legends --role-name legends-github-actions
```

Expected: FALHA com `NoSuchEntity`.

- [ ] **Step 2: Escrever `infra/iam-github.tf`**

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "legends-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          # O `sub` travado em ref:refs/heads/<branch> e o que impede que um
          # workflow de outra branch — ou de um fork, num repo PUBLICO —
          # assuma esta role. Nao trocar por StringLike com curinga.
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/${var.deploy_branch}"
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "legends-deploy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.legends.arn
      },
      {
        # Restrito AO documento e A instancia. Sem o segundo ARN, esta role
        # mandaria comando shell em qualquer maquina da conta.
        Sid      = "SendDeployCommand"
        Effect   = "Allow"
        Action   = "ssm:SendCommand"
        Resource = [
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
          "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${var.ec2_instance_id}",
        ]
      },
      {
        # A API nao aceita restricao por command-id (o id so existe depois).
        Sid      = "ReadCommandResult"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
        Resource = "*"
      },
    ]
  })
}
```

- [ ] **Step 3: Se o provider OIDC já existir na conta, importar**

A Task 1 Step 4 registrou isso. Uma conta só pode ter **um** provider por URL; criar o segundo falha com `EntityAlreadyExists`.

```bash
cd infra && AWS_PROFILE=legends terraform import aws_iam_openid_connect_provider.github \
  "arn:aws:iam::<ACCOUNT>:oidc-provider/token.actions.githubusercontent.com"
```

- [ ] **Step 4: Aplicar**

```bash
cd infra && AWS_PROFILE=legends terraform apply \
  -target=aws_iam_openid_connect_provider.github \
  -target=aws_iam_role.github_actions \
  -target=aws_iam_role_policy.github_actions
```

- [ ] **Step 5: Rodar a verificação do Step 1 de novo e conferir o trust**

```bash
aws iam get-role --profile legends --role-name legends-github-actions \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition' --output json
```

Expected: PASSA, e o `sub` é exatamente `repo:social463/monorepo:ref:refs/heads/main` — sem `*`.

- [ ] **Step 6: Aplicar o resto do state e conferir que não sobrou nada**

Todos os `-target` acabaram; a partir daqui o Terraform roda inteiro.

```bash
cd infra && AWS_PROFILE=legends terraform apply
```

Expected: `No changes. Your infrastructure matches the configuration.` — e os três outputs impressos.

- [ ] **Step 7: Commit**

```bash
git add infra/iam-github.tf
git commit -m "feat(infra): provider OIDC e role de deploy do github actions"
```

---

### Task 9: Script de deploy executado na instância

O único código de verdade do plano. Ele é enviado **inline** pelo workflow, então a versão que roda é sempre a commitada — nunca uma cópia envelhecida no disco da máquina.

**Files:**
- Create: `infra/deploy/deploy.sh`

**Interfaces:**
- Consumes: `IMAGE_URI` e `AWS_REGION` exportados pelo cabeçalho que o `send-deploy.sh` (Task 10) prepende; a árvore `/legends/prod/*` (Task 5); Docker e AWS CLI na máquina (Task 6).
- Produces: container `legends` publicando `8080:80`, e `/home/ubuntu/legends/.env` com modo `600`.

- [ ] **Step 1: Escrever `infra/deploy/deploy.sh`**

```bash
#!/usr/bin/env bash
# Executado NA EC2 via SSM Send-Command. O workflow prepende:
#   export IMAGE_URI=...
#   export AWS_REGION=...
set -Eeuo pipefail

APP_DIR=/home/ubuntu/legends
CONTAINER=legends
HOST_PORT=8080          # a 80 do host e do Caddy
PARAM_PATH=/legends/prod
ENV_FILE="$APP_DIR/.env"
HEALTH_URL="http://localhost:${HOST_PORT}/api/health"

log() { echo "[deploy] $*"; }

: "${IMAGE_URI:?IMAGE_URI nao definida}"
: "${AWS_REGION:?AWS_REGION nao definida}"

# 1. Qual imagem esta rodando agora? E o alvo do rollback.
PREVIOUS_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
log "imagem atual: ${PREVIOUS_IMAGE:-<nenhuma>}"

# 2. Login no ECR e pull.
REGISTRY="${IMAGE_URI%%/*}"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"
log "baixando $IMAGE_URI"
docker pull "$IMAGE_URI"

# 3. Monta o .env a partir do Parameter Store.
#    Parametro com valor PREENCHER e OMITIDO: a aplicacao trata variavel
#    ausente como recurso desligado (503 tratado), enquanto um valor falso
#    faria o codigo tentar usar credencial invalida em runtime.
mkdir -p "$APP_DIR"
umask 077
aws ssm get-parameters-by-path \
      --path "$PARAM_PATH" \
      --with-decryption \
      --region "$AWS_REGION" \
      --query 'Parameters[].[Name,Value]' \
      --output text \
  | awk -F'\t' '$2 != "PREENCHER" { n = $1; sub(/.*\//, "", n); print n "=" $2 }' \
  > "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Um .env vazio derruba a API por falta de JWT_SECRET. Falhe aqui, e nao la.
grep -q '^DATABASE_URL=' "$ENV_FILE" || { log "ERRO: DATABASE_URL ausente no .env"; exit 1; }
grep -q '^JWT_SECRET='   "$ENV_FILE" || { log "ERRO: JWT_SECRET ausente no .env";   exit 1; }
log "$(wc -l < "$ENV_FILE") variaveis escritas"

# 4. Migrations com a imagem NOVA, antes de derrubar a antiga.
#    Se falhar, o `set -e` aborta aqui e o container atual segue servindo.
log "aplicando migrations"
docker run --rm --env-file "$ENV_FILE" "$IMAGE_URI" \
  sh -lc 'cd /app && pnpm --filter @legends/api exec prisma migrate deploy'

# 5. Troca o container.
log "subindo container novo"
docker stop "$CONTAINER" >/dev/null 2>&1 || true
docker rm   "$CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -p "${HOST_PORT}:80" \
  "$IMAGE_URI"

# 6. Health check: ate 60s.
healthy=false
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    healthy=true
    log "health OK na tentativa $attempt"
    break
  fi
  sleep 2
done

# 7. Rollback.
if [ "$healthy" != true ]; then
  log "ERRO: health check falhou apos 60s. Ultimas linhas do container:"
  docker logs --tail 50 "$CONTAINER" 2>&1 || true

  if [ -n "$PREVIOUS_IMAGE" ]; then
    log "rollback para $PREVIOUS_IMAGE"
    docker stop "$CONTAINER" >/dev/null 2>&1 || true
    docker rm   "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d --name "$CONTAINER" --restart unless-stopped \
      --env-file "$ENV_FILE" -p "${HOST_PORT}:80" "$PREVIOUS_IMAGE"
    log "rollback concluido"
  else
    log "sem imagem anterior — nada para restaurar (primeiro deploy)"
  fi
  exit 1
fi

# Remove so camadas orfas. A imagem anterior tem tag e sobrevive, que e o
# que mantem o rollback possivel no proximo deploy.
docker image prune -f >/dev/null 2>&1 || true
log "deploy concluido: $IMAGE_URI"
```

- [ ] **Step 2: Instalar o shellcheck e lintar**

```bash
brew install shellcheck
shellcheck infra/deploy/deploy.sh infra/ec2-bootstrap.sh infra/bootstrap-state.sh
```

Expected: sem erro. Corrija o que aparecer antes de seguir.

- [ ] **Step 3: Verificação primeiro — não há container rodando**

```bash
aws ssm send-command --profile legends --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker ps --filter name=legends --format {{.Names}}"]' \
  --query 'Command.CommandId' --output text
```

Consulte a saída com `get-command-invocation`. Expected: vazio.

- [ ] **Step 4: Publicar uma imagem à mão, só para exercitar o script**

O workflow ainda não existe. Builde e empurre da sua máquina, com a plataforma que a Task 1 descobriu:

```bash
ACCOUNT=$(aws sts get-caller-identity --profile legends --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"
aws ecr get-login-password --profile legends --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"
docker buildx build --platform linux/arm64 \
  -t "$REGISTRY/legends:smoke" --push .
```

Troque `linux/arm64` por `linux/amd64` se a instância for `x86_64`.

- [ ] **Step 5: Rodar o deploy.sh de verdade, pela mesma via que o workflow usará**

```bash
PAYLOAD="$(printf 'export IMAGE_URI=%q\nexport AWS_REGION=%q\n' \
  "$REGISTRY/legends:smoke" "$AWS_REGION"; cat infra/deploy/deploy.sh)"

CMD_ID=$(aws ssm send-command --profile legends \
  --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --comment "smoke do deploy.sh" \
  --parameters "$(jq -n --arg s "$PAYLOAD" '{commands: [$s], executionTimeout: ["1800"]}')" \
  --query 'Command.CommandId' --output text)

sleep 120
aws ssm get-command-invocation --profile legends \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
```

Expected: `Success`, com `[deploy] health OK na tentativa N` e `[deploy] deploy concluido` na saída. Esta é a prova de que migrations, `.env` e health check funcionam de ponta a ponta — o RDS foi migrado agora.

- [ ] **Step 6: Confirmar que as tabelas nasceram no RDS**

Monte o payload com `jq --arg` em vez de escapar aspas à mão — é o padrão usado em todo este plano, e o único que não quebra com aspas aninhadas:

```bash
REMOTE='docker exec legends sh -lc "cd /app && pnpm --filter @legends/api exec prisma migrate status"'
CMD_ID=$(aws ssm send-command --profile legends --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "$(jq -n --arg c "$REMOTE" '{commands: [$c]}')" \
  --query 'Command.CommandId' --output text)
sleep 20
aws ssm get-command-invocation --profile legends --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" --query '[Status,StandardOutputContent]' --output text
```

Expected: `Success` e `Database schema is up to date!`.

- [ ] **Step 7: Commit**

```bash
git add infra/deploy/deploy.sh
git commit -m "feat(infra): script de deploy com migrations, health check e rollback"
```

---

### Task 10: Workflow do GitHub Actions

**Files:**
- Create: `.github/workflows/deploy.yml`, `.github/scripts/send-deploy.sh`

**Interfaces:**
- Consumes: `aws_iam_role.github_actions.arn` (Task 8), `aws_ecr_repository.legends` (Task 3), `infra/deploy/deploy.sh` (Task 9), e a arquitetura da instância (Task 1).
- Produces: deploy automático a cada `push` na `main`.

- [ ] **Step 1: Cadastrar as repository variables**

Nenhuma é segredo — por isso são *variables*, não *secrets*.

```bash
gh variable set AWS_REGION      --repo social463/monorepo --body "us-east-1"
gh variable set AWS_ROLE_ARN    --repo social463/monorepo --body "$(cd infra && AWS_PROFILE=legends terraform output -raw github_actions_role_arn)"
gh variable set EC2_INSTANCE_ID --repo social463/monorepo --body "$INSTANCE_ID"
gh variable set ECR_REPOSITORY  --repo social463/monorepo --body "legends"
```

O `gh` desta máquina falha por causa do plugin do 1Password. Se não autenticar, cadastre pela UI em *Settings › Secrets and variables › Actions › Variables*.

- [ ] **Step 2: Escrever `.github/scripts/send-deploy.sh`**

```bash
#!/usr/bin/env bash
# Manda o infra/deploy/deploy.sh para a instancia via SSM e acompanha ate o
# fim, espelhando a saida no log do Actions. Sai != 0 se o deploy falhar.
set -Eeuo pipefail

: "${IMAGE_URI:?}" ; : "${AWS_REGION:?}" ; : "${INSTANCE_ID:?}"

# %q escapa os valores, entao uma URI com caractere estranho nao vira injecao
# de shell no comando remoto.
payload="$(printf 'export IMAGE_URI=%q\nexport AWS_REGION=%q\n' "$IMAGE_URI" "$AWS_REGION"; cat infra/deploy/deploy.sh)"

command_id="$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "deploy ${GITHUB_SHA:0:7}" \
  --parameters "$(jq -n --arg s "$payload" '{commands: [$s], executionTimeout: ["1800"]}')" \
  --query 'Command.CommandId' --output text)"

echo "SSM command: $command_id"

# A invocacao leva alguns segundos para existir; ate la a API responde
# InvocationDoesNotExist, que nao e falha.
status=Pending
for _ in $(seq 1 360); do
  sleep 5
  status="$(aws ssm get-command-invocation \
    --command-id "$command_id" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)"
  echo "status: $status"
  case "$status" in
    Pending|InProgress|Delayed) ;;
    *) break ;;
  esac
done

echo "--- saida do deploy ---"
aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent --output text || true

err="$(aws ssm get-command-invocation --command-id "$command_id" --instance-id "$INSTANCE_ID" \
  --query StandardErrorContent --output text 2>/dev/null || true)"
if [ -n "$err" ] && [ "$err" != "None" ]; then
  echo "--- stderr ---"
  echo "$err"
fi

if [ "$status" != "Success" ]; then
  echo "deploy falhou com status: $status"
  exit 1
fi
echo "deploy concluido"
```

- [ ] **Step 3: Escrever `.github/workflows/deploy.yml`**

Use `runs-on: ubuntu-24.04-arm` se a Task 1 disse `arm64`; `ubuntu-latest` se `x86_64`. Runner ARM é gratuito aqui porque o repositório é público.

```yaml
name: Deploy para produção

on:
  push:
    branches: [main]
  workflow_dispatch:

# Dois deploys simultaneos se atropelariam no docker stop. Nao cancelar o que
# esta em curso e deliberado: interromper no meio do swap deixa a maquina sem
# container nenhum.
concurrency:
  group: deploy-prod
  cancel-in-progress: false

permissions:
  id-token: write   # exigido pelo OIDC
  contents: read

env:
  AWS_REGION: ${{ vars.AWS_REGION }}
  ECR_REPOSITORY: ${{ vars.ECR_REPOSITORY }}

jobs:
  build:
    name: Build e push da imagem
    runs-on: ubuntu-24.04-arm
    outputs:
      image: ${{ steps.meta.outputs.image }}
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - id: meta
        run: echo "image=${{ steps.login-ecr.outputs.registry }}/${ECR_REPOSITORY}:${GITHUB_SHA}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v3

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ steps.meta.outputs.image }}
            ${{ steps.login-ecr.outputs.registry }}/${{ env.ECR_REPOSITORY }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    name: Deploy na EC2
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_ROLE_ARN }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Enviar deploy via SSM
        env:
          IMAGE_URI: ${{ needs.build.outputs.image }}
          INSTANCE_ID: ${{ vars.EC2_INSTANCE_ID }}
        run: |
          chmod +x .github/scripts/send-deploy.sh
          .github/scripts/send-deploy.sh
```

- [ ] **Step 4: Lintar o workflow**

```bash
brew install actionlint
actionlint .github/workflows/deploy.yml
shellcheck .github/scripts/send-deploy.sh
```

Expected: silêncio nos dois.

- [ ] **Step 5: Commit e abrir PR para a `main`**

O deploy só dispara no merge — é por isso que o teste real deste plano é o merge.

```bash
git add .github/workflows/deploy.yml .github/scripts/send-deploy.sh
git commit -m "feat(ci): workflow de deploy na main via OIDC, ECR e SSM"
git push -u origin ci-cd-github-actions
gh pr create --fill --base main
```

- [ ] **Step 6: Fazer o merge e acompanhar a primeira execução**

```bash
gh run watch --repo social463/monorepo
```

Expected: os dois jobs verdes, e no log do `deploy` as linhas `[deploy] health OK…` e `[deploy] deploy concluido`.

Se o job `build` falhar em `configure-aws-credentials` com `Not authorized to perform sts:AssumeRoleWithWebIdentity`, o `sub` da trust policy não bate — confira `repo:<owner>/<repo>:ref:refs/heads/main` contra o repositório real.

- [ ] **Step 7: Proteger a `main`**

A partir do merge anterior, **todo commit na `main` vai para produção**. O workflow não tem como compensar isso — quem decide o que entra é a regra de branch. O spec registra isso como risco; este step o fecha.

```bash
gh api -X PUT repos/social463/monorepo/branches/main/protection \
  --input - <<'EOF'
{
  "required_pull_request_reviews": {"required_approving_review_count": 1},
  "required_status_checks": null,
  "enforce_admins": false,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

Expected: resposta 200. Se você trabalha sozinho e uma aprovação obrigatória atrapalha, mantenha ao menos `allow_force_pushes: false` e `allow_deletions: false` — reescrever a `main` com o deploy automático ligado é como se perde produção sem perceber. Confirme com o usuário antes de aplicar.

- [ ] **Step 8: Provar que a aplicação responde**

A 8080 **não** está aberta no security group — de propósito, ela é interna e quem a publica é o Caddy na Task 11. Então a verificação roda de dentro da instância:

```bash
REMOTE='curl -fsS http://localhost:8080/api/health'
CMD_ID=$(aws ssm send-command --profile legends --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "$(jq -n --arg c "$REMOTE" '{commands: [$c]}')" \
  --query 'Command.CommandId' --output text)
sleep 15
aws ssm get-command-invocation --profile legends --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" --query StandardOutputContent --output text
```

Expected: `{"status":"ok"}`.

---

### Task 11: TLS com Caddy

**Files:**
- Create: `infra/Caddyfile`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: container publicando `8080` (Task 9), SG com 80/443 abertos (Task 4), `var.app_domain` (Task 1).
- Produces: o app servido em `https://<app_domain>`.

- [ ] **Step 1: Verificação primeiro — não há HTTPS**

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' "https://$APP_DOMAIN/api/health"
```

Expected: FALHA (conexão recusada ou certificado inválido).

- [ ] **Step 2: Apontar o DNS**

Registro `A` de `$APP_DOMAIN` para o IP público da instância. Confirme antes de seguir — o Caddy só emite certificado se o desafio HTTP-01 chegar:

```bash
dig +short "$APP_DOMAIN"
```

Expected: o IP público da instância. Se o IP não for Elastic, um `stop`/`start` da instância o troca e o certificado quebra — alocar um Elastic IP é recomendado.

- [ ] **Step 3: Escrever `infra/Caddyfile`**

```
# Trocar pelo dominio real. O Caddy resolve o certificado sozinho por ACME,
# desde que a 80 e a 443 estejam abertas e o DNS aponte para esta maquina.
legends.exemplo.com.br {
    encode zstd gzip

    # O container publica 8080; dentro dele o nginx serve o front e faz proxy
    # de /api/ para a API na 3333. O WebSocket do escritorio virtual passa sem
    # configuracao extra: o Caddy faz upgrade de protocolo por padrao.
    reverse_proxy localhost:8080

    # O salvamento do mapa do escritorio manda o documento inteiro; o nginx de
    # dentro ja aceita 11m (nginx/default.conf) e o Caddy nao pode ser o gargalo.
    request_body {
        max_size 11MB
    }
}
```

- [ ] **Step 4: Instalar na instância e recarregar**

Gere o script localmente num arquivo e mande o arquivo inteiro como um único argumento — heredoc aninhado dentro de `$( )` dentro de `jq` é exatamente o tipo de construção que quebra em silêncio.

```bash
# 1. Monta o script remoto num arquivo temporario, com o dominio ja substituido.
{
  echo 'set -Eeuo pipefail'
  echo "cat > /etc/caddy/Caddyfile <<'CADDY'"
  sed "s/legends\.exemplo\.com\.br/$APP_DOMAIN/" infra/Caddyfile
  echo 'CADDY'
  echo 'caddy validate --config /etc/caddy/Caddyfile'
  echo 'systemctl reload caddy || systemctl restart caddy'
  echo 'systemctl is-active caddy'
} > /tmp/setup-caddy.sh

# 2. Confere o que vai ser enviado ANTES de enviar.
cat /tmp/setup-caddy.sh

# 3. Envia.
CMD_ID=$(aws ssm send-command --profile legends --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "configura o caddy" \
  --parameters "$(jq -n --rawfile c /tmp/setup-caddy.sh '{commands: [$c]}')" \
  --query 'Command.CommandId' --output text)
sleep 30
aws ssm get-command-invocation --profile legends --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
```

Expected: `Success` e `active`. Se o Caddy não conseguir o certificado, o `StandardErrorContent` diz por quê — quase sempre DNS ainda propagando ou a porta 80 bloqueada.

- [ ] **Step 5: Rodar a verificação do Step 1 de novo**

```bash
curl -fsS "https://$APP_DOMAIN/api/health"
curl -fsS -o /dev/null -w 'redirect http->https: %{http_code}\n' "http://$APP_DOMAIN/api/health"
```

Expected: `{"status":"ok"}` com certificado válido, e `308` no segundo (o Caddy redireciona sozinho).

- [ ] **Step 6: Commit**

```bash
git add infra/Caddyfile infra/README.md
git commit -m "feat(infra): TLS com caddy na frente do container"
```

---

### Task 12: Seed inicial, documentação e verificação fim-a-fim

**Files:**
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: tudo.
- Produces: aplicação utilizável e o runbook.

- [ ] **Step 1: Verificação primeiro — o banco está sem dados**

Abra `https://$APP_DOMAIN` no navegador. Expected: a tela de login carrega (o schema existe, senão a API responderia 500), e **nenhuma credencial funciona** — não há usuário.

Se preferir confirmar pelo banco:

```bash
REMOTE='docker exec legends sh -lc "cd /app/apps/api && echo \"select count(*) from \\\"User\\\";\" | pnpm exec prisma db execute --stdin"'
CMD_ID=$(aws ssm send-command --profile legends --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "$(jq -n --arg c "$REMOTE" '{commands: [$c]}')" \
  --query 'Command.CommandId' --output text)
sleep 20
aws ssm get-command-invocation --profile legends --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" --query '[Status,StandardOutputContent]' --output text
```

Expected: `Success` — a tabela `User` existe e está vazia.

- [ ] **Step 2: Rodar o seed, uma única vez**

Fora do pipeline de propósito: o seed cria a conta `super-admin@legends.internal` com senha conhecida e popula catálogo. Rodar a cada deploy em produção é desastre.

```bash
CMD_ID=$(aws ssm send-command --profile legends --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "seed inicial — RODAR UMA VEZ" \
  --parameters 'commands=["docker exec legends sh -lc \"cd /app && pnpm --filter @legends/api run db:seed\""]' \
  --query 'Command.CommandId' --output text)
sleep 60
aws ssm get-command-invocation --profile legends --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" --query '[Status,StandardOutputContent]' --output text
```

Expected: `Success`.

- [ ] **Step 3: Entrar e trocar a senha do super-admin**

Abra `https://$APP_DOMAIN`, entre com `super-admin@legends.internal` / `emr2026@` e **troque a senha imediatamente**. A senha padrão está documentada no `AGENTS.md`, que é público.

- [ ] **Step 4: Verificação fim-a-fim do pipeline inteiro**

Faça uma alteração trivial e visível, empurre para a `main` e confirme que ela chega sozinha em produção:

```bash
git switch main && git pull
# altere algo visivel, por exemplo a tagline em packages/shared
git commit -am "chore: verifica pipeline fim-a-fim" && git push
gh run watch --repo social463/monorepo
curl -fsS "https://$APP_DOMAIN/api/health"
```

Expected: workflow verde, e a alteração no ar sem ninguém ter tocado na instância.

- [ ] **Step 5: Verificar que o rollback funciona**

É a única parte do desenho que ninguém testa até precisar — e aí é tarde.

O caminho de rollback só dispara quando o container **sobe e mesmo assim reprova no health check**. Uma imagem inexistente não serve: o `docker pull` falharia antes do swap, exercitando o caminho de abortar, que é outro.

A forma de provocar exatamente essa condição é rodar uma cópia do script com o health check apontado para uma rota que não existe. O container novo sobe normal, o `curl -fsS` recebe 404 e falha, e o rollback executa com a imagem real.

```bash
# Copia do script com o health check condenado a falhar.
sed 's#/api/health#/api/rota-que-nao-existe#' infra/deploy/deploy.sh > /tmp/deploy-rollback-test.sh

# Mesma imagem que ja esta no ar: se o rollback funcionar, nada muda para o usuario.
IMAGE_ATUAL="$REGISTRY/legends:smoke"
{
  printf 'export IMAGE_URI=%q\nexport AWS_REGION=%q\n' "$IMAGE_ATUAL" "$AWS_REGION"
  cat /tmp/deploy-rollback-test.sh
} > /tmp/payload-rollback.sh

CMD_ID=$(aws ssm send-command --profile legends --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "teste de rollback" \
  --parameters "$(jq -n --rawfile c /tmp/payload-rollback.sh '{commands: [$c], executionTimeout: ["900"]}')" \
  --query 'Command.CommandId' --output text)
sleep 150
aws ssm get-command-invocation --profile legends --command-id "$CMD_ID" \
  --instance-id "$INSTANCE_ID" --query '[Status,StandardOutputContent]' --output text

# E, o tempo todo, a aplicacao seguiu no ar:
curl -fsS "https://$APP_DOMAIN/api/health"
```

Expected: status `Failed`; a saída contém `[deploy] ERRO: health check falhou`, `[deploy] rollback para …` e `[deploy] rollback concluido`; **e o `curl` final devolve `{"status":"ok"}`**. Se o `curl` falhar, o rollback tem defeito — conserte antes de considerar o plano concluído.

- [ ] **Step 6: Escrever o `infra/README.md` completo**

Deve conter, com os valores reais preenchidos:

1. **Dados da conta** — account id, região, VPC, subnets, instance-id, domínio (Task 1).
2. **Ordem de bootstrap** — `bootstrap-state.sh` → `terraform init -backend-config=backend.hcl` → `terraform apply` → `associate-iam-instance-profile` → `ec2-bootstrap.sh` → Caddyfile → seed.
3. **Preencher os parâmetros `PREENCHER`** — o comando, e o aviso de que `PREENCHER` faz a variável ser omitida do `.env`:
   ```bash
   aws ssm put-parameter --profile legends --overwrite \
     --name /legends/prod/S3_BUCKET --type SecureString --value "meu-bucket"
   ```
   Vale para `GEMINI_API_KEY`, `GIPHY_API_KEY`, `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`. **Mudar parâmetro não redeploya** — o `.env` só é remontado no próximo deploy; force com `gh workflow run deploy.yml --repo social463/monorepo`.
4. **Acessar o RDS da sua máquina** — o banco é privado; use túnel:
   ```bash
   aws ssm start-session --profile legends --target "$INSTANCE_ID" \
     --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters '{"host":["<rds-endpoint>"],"portNumber":["5432"],"localPortNumber":["5433"]}'
   ```
5. **Avisos que custam caro** — `CALENDAR_ENCRYPTION_KEY` não pode ser regenerada; o RDS tem `deletion_protection`; o state do S3 contém segredos em texto.

- [ ] **Step 7: Commit**

```bash
git add infra/README.md
git commit -m "docs(infra): runbook de bootstrap, parametros e acesso ao RDS"
```

---

## Verificação final

Antes de considerar o trabalho pronto:

- [ ] `push` na `main` dispara o workflow e ele fica verde ponta a ponta.
- [ ] `https://$APP_DOMAIN/api/health` responde `{"status":"ok"}` com certificado válido.
- [ ] `terraform plan` em `infra/` diz `No changes`.
- [ ] O SG do RDS não tem nenhum `cidr_blocks`, e `PubliclyAccessible` é `False`.
- [ ] A trust policy da role tem `sub` exato, sem curinga.
- [ ] `shellcheck` e `actionlint` passam em todos os scripts e no workflow.
- [ ] Nenhum segredo em arquivo commitado (`git log -p | grep -iE 'secret|password|api[_-]key'` não acha valor real).
- [ ] O rollback foi exercitado ao menos uma vez.
- [ ] `.k8s/`, `appspec.yml`, `start.sh` e `clean.sh` continuam intocados (`git diff main --stat` não os lista).
