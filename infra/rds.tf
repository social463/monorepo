resource "aws_db_subnet_group" "legends" {
  name       = "legends"
  subnet_ids = var.private_subnet_ids
}

resource "random_password" "db" {
  length = 32
  # special = false de proposito: a senha entra numa URL
  # (postgresql://user:senha@host/db) e um '/' ou '@' quebraria o parse do
  # Prisma sem percent-encoding. 32 chars alfanumericos ja dao entropia de
  # sobra, e o RDS proibe varios especiais de qualquer forma.
  special = false
}

resource "aws_db_instance" "legends" {
  identifier     = "legends-prod"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = 100 # autoscaling do disco; evita ficar sem espaco de madrugada
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "legends"
  username = "legends"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.legends.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period    = 7
  auto_minor_version_upgrade = true

  # Producao: nem um `terraform destroy` distraido leva o banco embora.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "legends-prod-final"
}
