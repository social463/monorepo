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
