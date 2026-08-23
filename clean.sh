#!/bin/bash
# Limpa o diretorio Legends para o novo build
sudo rm -r /home/ubuntu/Legends || exit 1

# Limpa o diretorio o Agent codedeploy para o proximo build
sudo rm -rf /opt/codedeploy-agent/deployment-root/*

# Limpa as imagem do docker antiga
docker system prune -af