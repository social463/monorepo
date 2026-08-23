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
