#!/usr/bin/env bash
# Executado NA EC2 via SSM Send-Command. O workflow prepende:
#   export IMAGE_URI=...
#   export AWS_REGION=...
set -Eeuo pipefail

APP_DIR=/home/ec2-user/legends
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
  # Esta saida (stdout) vira StandardOutputContent da invocacao SSM, e o
  # send-deploy.sh ecoa isso no log do GitHub Actions — que e PUBLICO neste
  # repositorio. Por isso a aplicacao NUNCA deve logar variavel de ambiente
  # nem string de conexao (ex.: DATABASE_URL) no startup. Quem precisar de
  # log mais completo do que estas 50 linhas deve buscar direto com
  # `aws ssm get-command-invocation`, e nao aumentar o --tail aqui.
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
