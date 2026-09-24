output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions.arn
  description = "Valor da repository variable AWS_ROLE_ARN."
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.legends.repository_url
  description = "Registro/repositorio das imagens."
}

output "rds_endpoint" {
  value       = aws_db_instance.legends.endpoint
  description = "host:porta do Postgres. Alcancavel so de dentro da VPC."
}

output "app_public_ip" {
  value       = aws_eip.app.public_ip
  description = "IP publico fixo da EC2. Valor do registro A de belegends.app."
}
