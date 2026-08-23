#!/usr/bin/env bash
# Rodar UMA VEZ na EC2, como root (via SSM Send-Command ou console).
# Amazon Linux 2023 (x86_64). Idempotente: pode rodar de novo sem quebrar.
set -Eeuo pipefail

CADDY_VERSION=2.10.2

dnf -y update

# ---------- Docker ----------
# Pacote oficial do AL2023, sem repositorio externo.
if ! command -v docker >/dev/null 2>&1; then
  dnf install -y docker
fi
systemctl enable --now docker
usermod -aG docker ec2-user

# ---------- AWS CLI v2 ----------
# O deploy.sh usa `aws ssm get-parameters-by-path` e `aws ecr get-login-password`.
# Ja vem pre-instalado no AL2023; so instala se faltar.
if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip
  unzip -q -o /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install --update
  rm -rf /tmp/awscliv2.zip /tmp/aws
fi

# ---------- Agente SSM ----------
# Ja vem pre-instalado e ativo no AL2023; so garante que continue assim.
systemctl enable --now amazon-ssm-agent

# ---------- Caddy ----------
# AL2023 nao tem pacote nem repositorio de Caddy. Instala o binario estatico
# oficial direto do release do GitHub.
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
    -o /tmp/caddy.tar.gz
  tar -xzf /tmp/caddy.tar.gz -C /tmp caddy
  install -m 0755 /tmp/caddy /usr/local/bin/caddy
  rm -f /tmp/caddy.tar.gz /tmp/caddy
fi

# Usuario de sistema sem shell de login, dono do processo do Caddy.
if ! id caddy >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin caddy
fi
mkdir -p /etc/caddy /var/lib/caddy
chown -R caddy:caddy /var/lib/caddy

# Unit do systemd. Nao da `systemctl start` aqui: o /etc/caddy/Caddyfile so e
# escrito depois (Task 11), e subir sem config falharia.
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable caddy

mkdir -p /home/ec2-user/legends
chown ec2-user:ec2-user /home/ec2-user/legends

echo "bootstrap concluido"
docker --version
aws --version
caddy version
