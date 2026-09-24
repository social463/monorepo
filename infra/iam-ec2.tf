resource "aws_iam_role" "ec2" {
  name = "legends-ec2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Da a instancia o canal do SSM: e como o Actions manda o deploy sem SSH.
resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2" {
  name = "legends-ec2"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Chamada de conta, nao de repositorio: a API so aceita Resource "*".
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = aws_ecr_repository.legends.arn
      },
      {
        Sid    = "ReadAppParameters"
        Effect = "Allow"
        Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        # SAO DOIS ARNs, e nao um. GetParameter/GetParameters autorizam contra
        # cada parametro (o `/*`), mas GetParametersByPath autoriza contra o
        # PATH em si — `parameter/legends/prod`, sem barra nem asterisco. Com so
        # o `/*`, o deploy.sh morre em
        # "not authorized to perform: ssm:GetParametersByPath".
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/legends/prod",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/legends/prod/*",
        ]
      },
      {
        # Sem isto o SecureString volta cifrado e o .env sai com lixo.
        # A condicao limita a chave ao uso via SSM, e nao a conta inteira.
        Sid      = "DecryptParameters"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      },
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "legends-ec2"
  role = aws_iam_role.ec2.name
}
