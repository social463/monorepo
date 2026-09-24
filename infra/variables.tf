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

variable "github_owner_id" {
  type        = string
  description = "ID numerico do dono do repo no GitHub (campo owner.id do token OIDC, visivel no sub no CloudTrail, ou em https://api.github.com/repos/<owner>/<repo>). Usado para casar o sub sem depender do nome do dono, que pode mudar."
}

variable "github_repo_id" {
  type        = string
  description = "ID numerico do repositorio no GitHub (campo id do token OIDC, visivel no sub no CloudTrail, ou em https://api.github.com/repos/<owner>/<repo>). Usado para casar o sub sem depender do nome do repo, que pode mudar."
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
