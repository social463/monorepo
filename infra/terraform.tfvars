# Valores reais da conta AWS de destino, descobertos na Task 1
# (verificacao/discovery na conta). NAO commitar em outro lugar/contexto —
# este arquivo e local por natureza, mas neste repo esta versionado de
# proposito porque a conta e unica e o valor nao e segredo.

aws_region = "us-east-2"

vpc_id = "vpc-05b769c8975bf355c" # VPC default da conta

# A VPC default nao tem subnet privada — so publicas. As duas subnets abaixo
# (2a e 2b) sao publicas mesmo, apesar do nome da variavel. Isso e aceitavel
# porque quem mantem o RDS inalcancavel de fora e `publicly_accessible = false`
# em rds.tf, e nao o tipo da subnet. Nao troque por subnet privada "de
# verdade" sem criar uma antes — hoje ela nao existe nesta conta.
private_subnet_ids = ["subnet-033ea1ef33d8ee2c3", "subnet-0375299bf87cb28b3"]

ec2_instance_id = "i-08ec3f198b9aa0aac" # t3.small, x86_64, Amazon Linux 2023, subnet-0375299bf87cb28b3 (us-east-2b)
app_domain      = "belegends.app"

github_repo   = "social463/monorepo"
deploy_branch = "main"

db_instance_class    = "db.t4g.micro"
db_allocated_storage = 20
