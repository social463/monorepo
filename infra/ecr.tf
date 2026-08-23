resource "aws_ecr_repository" "legends" {
  name                 = "legends"
  image_tag_mutability = "MUTABLE" # a tag :latest e reescrita a cada deploy

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "legends" {
  repository = aws_ecr_repository.legends.name

  # A imagem passa de 280 MB. Sem expiracao, o custo do registro so cresce.
  # 20 e o suficiente para rollback: o alvo e sempre a imagem anterior.
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Mantem as 20 imagens mais recentes"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
