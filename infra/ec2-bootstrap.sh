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
  # shellcheck disable=SC1091 # /etc/os-release so existe na EC2 alvo, nao no linter
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
