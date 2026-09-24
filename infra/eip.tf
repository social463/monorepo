# O IP publico atual da instancia nao e Elastic: um stop/start troca o IP. E
# como belegends.app esta no HSTS preload dos navegadores, perder o IP sem
# atualizar o DNS derruba o certificado e o site inteiro, sem tela de escape
# (HSTS preload nao deixa cair para HTTP nem aceitar excecao manual).
resource "aws_eip" "app" {
  domain = "vpc"
}

resource "aws_eip_association" "app" {
  instance_id   = var.ec2_instance_id
  allocation_id = aws_eip.app.id
}
