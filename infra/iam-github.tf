resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

locals {
  # O CloudTrail da conta mostrou que o GitHub passou a emitir o `sub` com os
  # IDs numericos de dono e repositorio embutidos (ex.:
  # repo:social463@319249438/monorepo@1341254093:ref:...), em vez da forma
  # so-com-nome que a role aceitava ate entao. Por isso duas strings, as duas
  # exatas:
  #   - com IDs: e o que o GitHub emite hoje, e a mais segura (ID nao
  #     acompanha rename nem transferencia de repo/dono);
  #   - so com nome: volta a valer se o GitHub reverter o formato; manter so
  #     uma das duas quebraria a autenticacao em silencio na proxima virada.
  # As duas entram como lista em StringEquals (OR, casamento exato) — nunca
  # StringLike com curinga: um curinga na posicao do dono ou do repositorio
  # abriria a role para qualquer repositorio, e este repositorio e publico.
  github_repo_owner_name = split("/", var.github_repo)[0]
  github_repo_name       = split("/", var.github_repo)[1]

  github_actions_sub_by_name = "repo:${var.github_repo}:ref:refs/heads/${var.deploy_branch}"
  github_actions_sub_by_id   = "repo:${local.github_repo_owner_name}@${var.github_owner_id}/${local.github_repo_name}@${var.github_repo_id}:ref:refs/heads/${var.deploy_branch}"
}

resource "aws_iam_role" "github_actions" {
  name = "legends-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          # O `sub` travado em ref:refs/heads/<branch> e o que impede que um
          # workflow de outra branch — ou de um fork, num repo PUBLICO —
          # assuma esta role. Nao trocar por StringLike com curinga.
          "token.actions.githubusercontent.com:sub" = [
            local.github_actions_sub_by_name,
            local.github_actions_sub_by_id,
          ]
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "legends-deploy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = aws_ecr_repository.legends.arn
      },
      {
        # Restrito AO documento e A instancia. Sem o segundo ARN, esta role
        # mandaria comando shell em qualquer maquina da conta.
        Sid    = "SendDeployCommand"
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
          "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${var.ec2_instance_id}",
        ]
      },
      {
        # A API nao aceita restricao por command-id (o id so existe depois).
        Sid      = "ReadCommandResult"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
        Resource = "*"
      },
    ]
  })
}
