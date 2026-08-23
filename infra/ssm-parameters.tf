resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

# LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_URL deixaram de ser PREENCHER:
# sao exigencia de BOOT da API (lib/config.ts lanca erro em producao se
# faltarem, e o listen() nao sobe), nao um recurso opcional que degrada
# sozinho. Um placeholder aqui deixaria a API fora do ar ate alguem lembrar
# de preencher a mao.
resource "random_password" "livekit_api_key" {
  length  = 24
  special = false
}

resource "random_password" "livekit_api_secret" {
  length  = 48
  special = false
}

# 32 bytes em base64, exatamente o que lib/crypto.ts espera.
resource "random_bytes" "calendar_encryption_key" {
  length = 32
}

locals {
  # aws_db_instance.endpoint ja vem como "host:5432".
  database_url = format(
    "postgresql://%s:%s@%s/%s?schema=public",
    aws_db_instance.legends.username,
    random_password.db.result,
    aws_db_instance.legends.endpoint,
    aws_db_instance.legends.db_name,
  )

  # Valor vem de fora: nasce placeholder e o Terraform nunca mais olha.
  # PREENCHER e um sentinela — o deploy.sh OMITE do .env todo parametro com
  # esse valor, para que a variavel chegue ausente na aplicacao e o recurso
  # degrade como foi projetado (503 tratado), em vez de tentar usar lixo.
  placeholder_parameters = {
    GEMINI_API_KEY     = "PREENCHER"
    GIPHY_API_KEY      = "PREENCHER"
    S3_BUCKET          = "PREENCHER"
    S3_PUBLIC_BASE_URL = "PREENCHER"
  }

  # Valor conhecido agora e derivado da propria infra.
  derived_parameters = {
    APP_BASE_URL                = "https://${var.app_domain}"
    GEMINI_MODEL                = "gemini-2.5-flash"
    S3_REGION                   = var.aws_region
    TEAMS_NOTIFICATIONS_ENABLED = "true"
    # Subdominio do LiveKit self-hosted (mesma EC2, atras do Caddy). E o
    # mesmo host que o bloco em infra/Caddyfile expoe.
    LIVEKIT_URL = "wss://livekit.${var.app_domain}"
  }
}

# HR_DASHBOARD_ALLOWED_HOSTS, GA4_MEASUREMENT_ID e GA4_API_SECRET NAO sao
# criados: o SSM nao aceita valor vazio, e a aplicacao trata ausencia como
# estado valido (config.ts cai no default; o sink do GA4 some sem derrubar o
# boot). Criar com placeholder seria pior que nao criar.

resource "aws_ssm_parameter" "database_url" {
  name        = "/legends/prod/DATABASE_URL"
  type        = "SecureString"
  value       = local.database_url
  description = "Montada pelo Terraform a partir do RDS."
}

resource "aws_ssm_parameter" "jwt_secret" {
  name        = "/legends/prod/JWT_SECRET"
  type        = "SecureString"
  value       = random_password.jwt_secret.result
  description = "Obrigatorio em producao (lib/config.ts). Trocar desloga todo mundo."
}

resource "aws_ssm_parameter" "livekit_api_key" {
  name        = "/legends/prod/LIVEKIT_API_KEY"
  type        = "SecureString"
  value       = random_password.livekit_api_key.result
  description = "Obrigatorio em producao (lib/config.ts). Lido pelo bootstrap para gerar /etc/livekit/livekit.yaml."
}

resource "aws_ssm_parameter" "livekit_api_secret" {
  name        = "/legends/prod/LIVEKIT_API_SECRET"
  type        = "SecureString"
  value       = random_password.livekit_api_secret.result
  description = "Obrigatorio em producao (lib/config.ts). Lido pelo bootstrap para gerar /etc/livekit/livekit.yaml."
}

resource "aws_ssm_parameter" "calendar_encryption_key" {
  name  = "/legends/prod/CALENDAR_ENCRYPTION_KEY"
  type  = "SecureString"
  value = random_bytes.calendar_encryption_key.base64
  # PERDER OU REGERAR ESTA CHAVE TORNA ILEGIVEL toda credencial ja cifrada:
  # chaves de IA por empresa e tokens de calendario. E perda irreversivel.
  description = "Cifra segredos em repouso. NAO regenerar."

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ssm_parameter" "derived" {
  for_each    = local.derived_parameters
  name        = "/legends/prod/${each.key}"
  type        = "SecureString"
  value       = each.value
  description = "Derivado da infra pelo Terraform."
}

resource "aws_ssm_parameter" "placeholder" {
  for_each    = local.placeholder_parameters
  name        = "/legends/prod/${each.key}"
  type        = "SecureString"
  value       = each.value
  description = "Preencher fora do Terraform. Segredo em codigo vira segredo no state."

  lifecycle {
    ignore_changes = [value]
  }
}

# Os tres parametros do LiveKit saem do map de placeholder e viram recurso
# proprio (blocos acima). Sem isto o Terraform veria endereco de estado
# diferente e destruiria o parametro antigo antes de criar o novo — o `moved`
# preserva a identidade, e o resultado vira apenas uma atualizacao de valor.
moved {
  from = aws_ssm_parameter.placeholder["LIVEKIT_API_KEY"]
  to   = aws_ssm_parameter.livekit_api_key
}

moved {
  from = aws_ssm_parameter.placeholder["LIVEKIT_API_SECRET"]
  to   = aws_ssm_parameter.livekit_api_secret
}

moved {
  from = aws_ssm_parameter.placeholder["LIVEKIT_URL"]
  to   = aws_ssm_parameter.derived["LIVEKIT_URL"]
}
