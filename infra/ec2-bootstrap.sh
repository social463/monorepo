#!/usr/bin/env bash
# Rodar UMA VEZ na EC2, como root (via SSM Send-Command ou console).
# Amazon Linux 2023 (x86_64). Idempotente: pode rodar de novo sem quebrar.
set -Eeuo pipefail

CADDY_VERSION=2.10.2

dnf -y makecache

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
# --home-dir aponta pro mesmo diretorio onde o Caddy guarda os certificados
# (senao o useradd cai em /home/caddy, que nao existe e nao pode ser criado).
if ! id caddy >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
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
# HOME explicito: cobre tambem a maquina onde o usuario caddy ja existia com
# outro home (script idempotente). E onde o Caddy persiste os certificados.
Environment=HOME=/var/lib/caddy
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

# ---------- LiveKit self-hosted ----------
# Mesma EC2 do app (decisao ja tomada). O servidor le a chave e o segredo do
# SSM na hora de escrever o config, em vez de receber via variavel de
# ambiente do bootstrap — assim a instancia nunca precisa deles em texto
# aberto em outro lugar alem do arquivo final, que ja nasce 600.
REGION=us-east-2

mkdir -p /etc/livekit

LK_KEY=$(aws ssm get-parameter --name /legends/prod/LIVEKIT_API_KEY --with-decryption --region "$REGION" --query Parameter.Value --output text)
LK_SECRET=$(aws ssm get-parameter --name /legends/prod/LIVEKIT_API_SECRET --with-decryption --region "$REGION" --query Parameter.Value --output text)

cat > /etc/livekit/livekit.yaml <<EOF
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  ${LK_KEY}: ${LK_SECRET}
EOF
# Contem o segredo do LiveKit em texto puro: leitura restrita ao dono (root).
chmod 600 /etc/livekit/livekit.yaml

# use_external_ip: true e necessario porque a instancia esta atras do NAT da
# VPC (so tem IP publico via Elastic IP associado, nao interface publica de
# verdade) e o LiveKit precisa anunciar esse IP nos candidatos ICE, senao o
# participante remoto recebe um IP privado que nao alcanca.

# Idempotente: se o container ja existe (reexecucao do bootstrap com config
# nova), remove antes de subir de novo.
docker rm -f livekit >/dev/null 2>&1 || true

# --network host NAO E OPCIONAL. A faixa de midia tem 10.001 portas UDP
# (50000-60000); publicar isso com `-p` faria o Docker criar uma regra de
# iptables POR PORTA e a maquina nao sobe (ou trava por minutos). Com
# --network host o container usa a pilha de rede do host direto, sem NAT do
# Docker, e as portas abertas no security group (network.tf) bastam.
docker run -d --name livekit --restart unless-stopped \
  --network host \
  -v /etc/livekit/livekit.yaml:/etc/livekit.yaml \
  livekit/livekit-server:latest \
  --config /etc/livekit.yaml

echo "bootstrap concluido"
docker --version
aws --version
caddy version
