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
