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
