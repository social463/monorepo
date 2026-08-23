#!/bin/bash
set -eu

cd /home/ubuntu/Legends || exit 1

IMAGE_NAME="legends:latest"
CONTAINER_NAME="legends"

ENV_FILE=""

if [ -f /home/ubuntu/Legends/.env ]; then
  ENV_FILE="/home/ubuntu/Legends/.env"
elif [ -f /home/ubuntu/Legends/apps/api/.env ]; then
  ENV_FILE="/home/ubuntu/Legends/apps/api/.env"
else
  echo "Arquivo de ambiente nao encontrado. Esperado em .env na raiz ou apps/api/.env."
  exit 1
fi

echo "Usando env file: $ENV_FILE"

# Builda a imagem localmente a partir do Dockerfile do monorepo
docker build --pull -t "$IMAGE_NAME" .

# Para se ja existir um container com o mesmo nome
docker stop "$CONTAINER_NAME" || true
docker rm "$CONTAINER_NAME" || true

# Sobe o container com a imagem :latest
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -e RUN_MIGRATIONS=true \
  -p 80:80 \
  -p 3333:3333 \
  "$IMAGE_NAME"
