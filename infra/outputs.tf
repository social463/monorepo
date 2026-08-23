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
