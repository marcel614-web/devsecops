# Sandbox d'exécution des dépôts

Les étapes `Install Dependencies` et `Tests` exécutent le code des dépôts
analysés dans un conteneur jetable, jamais directement sur l'hôte du worker.

## Moteurs

- `ssh-docker` : Docker est piloté sur une VM distante via SSH. C'est le mode
  utilisé par le laboratoire.
- `local-docker` : Docker local, prévu pour une CI Linux.
- `auto` : choisit `ssh-docker` si la configuration SSH est complète, sinon
  `local-docker`.

Si le moteur est injoignable, l'étape échoue explicitement. Il n'existe aucun
repli silencieux vers l'hôte.

## Mesures appliquées

- Conteneur non privilégié, utilisateur non-root (`uid:gid` du moteur).
- `--cap-drop ALL`, `no-new-privileges`, rootfs en lecture seule.
- Un seul bind mount : `/workspace`, avec un répertoire propre au pipeline.
- `tmpfs` pour `/tmp`, sans socket Docker ni secret de la plateforme.
- Limites CPU, RAM, PIDs, taille du workspace, durée des commandes.
- Réseau coupé par défaut ; l'accès sortant n'est ouvert que pendant les
  installations, puis refermé avant les tests.
- Aucun montage du socket Docker, des clés SSH de la plateforme, de l'hôte
  Windows ou du dépôt Git privé.
- Nettoyage après succès, échec, timeout ou annulation, avec balayage des
  conteneurs orphelins au démarrage du worker.

## Risques résiduels

Un conteneur Docker n'est pas une frontière d'isolation absolue.

- Une évasion du noyau Linux ou de Docker reste possible. Le moteur doit donc
  être patché et dédié à la plateforme.
- Le code analysé partage le noyau de la VM. Une faille kernel peut affecter
  les autres conteneurs de la VM.
- Le build d'image Docker (`Docker Build`) est exécuté par le daemon de la VM
  et non dans cette sandbox applicative. Il reste un risque distinct, à
  traiter par une VM de build isolée et un daemon dédié.
- Les images de base peuvent contenir des vulnérabilités ; elles sont
  scannées par Trivy, mais leur correction dépend des mainteneurs.
- Le réseau sortant pendant les installations permet au code du dépôt de
  contacter des services externes. Les tests sont hors-ligne par défaut.
- Les artefacts rapatriés sont filtrés et extraits de façon contrôlée, mais
  ils proviennent du code analysé et doivent être considérés comme non fiables.
- La clé SSH du moteur doit être limitée au compte de déploiement et à ses
  droits Docker ; sa compromission équivaut à un accès au daemon Docker.
- Un conteneur n'empêche pas une attaque par déni de service dans les limites
  configurées. Le moteur doit être dimensionné et surveillé.
