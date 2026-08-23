# <ACCOUNT> e o account id da conta AWS de destino, descoberto na Task 1
# (ainda nao disponivel neste ambiente). Substitua antes de rodar
# `terraform init -backend-config=backend.hcl` de verdade.
bucket       = "legends-tfstate-<ACCOUNT>"
key          = "prod/terraform.tfstate"
region       = "us-east-1"
encrypt      = true
use_lockfile = true
