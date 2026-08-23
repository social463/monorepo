resource "aws_security_group" "app" {
  name        = "legends-app"
  description = "HTTP/HTTPS publico para o Caddy da EC2 do Legends"
  vpc_id      = var.vpc_id

  # A 80 fica aberta nao para servir o app, e sim para o redirect e para o
  # desafio HTTP-01 do Let's Encrypt. Fechar a 80 quebra a renovacao do
  # certificado 60 dias depois, quando ninguem mais lembra deste arquivo.
  ingress {
    description = "HTTP (redirect e desafio ACME)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Saida liberada (pull do ECR, SSM, ACME, S3, LiveKit)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# A instancia ja existe e NAO e gerenciada aqui. O data source so le a ENI
# para pendurar o SG novo nela, sem mexer nos SGs que ela ja tiver.
data "aws_instance" "app" {
  instance_id = var.ec2_instance_id
}

resource "aws_network_interface_sg_attachment" "app" {
  security_group_id    = aws_security_group.app.id
  network_interface_id = data.aws_instance.app.network_interface_id
}

resource "aws_security_group" "db" {
  name        = "legends-db"
  description = "Postgres acessivel apenas pela EC2 do Legends"
  vpc_id      = var.vpc_id

  # Referencia o SG, nao um CIDR: se a instancia trocar de IP, a regra continua
  # valendo. E nada fora desse SG alcanca o banco.
  ingress {
    description     = "Postgres a partir da EC2 do Legends"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  # Sem egress de proposito: o RDS nao inicia conexao para lugar nenhum.
}
