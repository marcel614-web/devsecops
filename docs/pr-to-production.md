# Parcours Pull Request → production

Ce document décrit les contrôles réellement exécutés par la plateforme, les
permissions GitHub nécessaires et les limites connues.

## 1. Déclencheurs

| Événement | Pipeline | Déploiement |
| --- | --- | --- |
| `push` sur une branche surveillée | Oui, SHA complet obligatoire | Oui, selon la configuration du projet |
| `push` de tag / suppression de branche | Ignoré | Non |
| `pull_request` même dépôt | Oui, sans étapes `DEPLOYMENT`, `DAST`, `APPROVAL`, `PROMOTE` | Non |
| `pull_request` depuis un fork | Refusé | Non |
| Lancement manuel / relance | Oui, SHA complet obligatoire | Oui, selon la configuration |

La livraison webhook est identifiée par `X-GitHub-Delivery` et réclamée
atomiquement en base : une redelivraison ne crée pas un second pipeline.

Le worker clone la branche puis extrait **exactement** le SHA du pipeline et
vérifie `git rev-parse HEAD`. Si la branche a avancé entre le webhook et le
clone, le commit est récupéré par SHA ; le build ne peut jamais porter sur une
autre révision que celle affichée.

## 2. Séquence staging → production

1. Checkout du SHA exact.
2. Build Docker avec un tag unique par pipeline.
3. Scans (secrets, SAST, SCA, IaC, image), SBOM, signature éventuelle.
4. Security Gate initial.
5. Déploiement staging + healthcheck.
6. OWASP ZAP si activé.
7. Security Gate post-DAST.
8. Approbation humaine si `requireProductionApproval` est activé.
9. Promotion en production **du même artefact**, vérifié par digest, sans
   reconstruction.
10. Healthcheck production.
11. Rollback vers le déploiement de production précédent si le healthcheck
    échoue et si `autoRollback` est activé.

Un scanner indisponible est marqué `SKIPPED` avec l'échec technique conservé ;
il n'est jamais transformé en `SUCCESS`.

L'étape d'approbation place le pipeline en `WAITING_APPROVAL`. Le Check Run
GitHub correspondant utilise `action_required`, jamais `success`.

## 3. Artefact et digest

- L'image est référencée par un tag unique au pipeline et par son digest local
  `docker inspect --format '{{.Id}}'` (`sha256:...`).
- Le digest est persisté au build, vérifié sur la VM avant chaque déploiement,
  promotion et rollback, puis attaché au déploiement.
- La promotion ne pull pas et ne reconstruit pas : `pull_policy: never`.
- Une promotion ou un rollback sans digest connu est refusé.
- Ce digest est un identifiant local d'image, pas le digest d'un registre
  distant. Une promotion vers une autre machine nécessiterait une étape de
  transfert/registry explicite (non implémentée ici).

## 4. Approbation de production

- Configurable par un administrateur via « Approbation avant production ».
- Décision réservée au propriétaire du projet ou à un administrateur.
- La décision lie explicitement le pipeline, le SHA complet, le tag et le
  digest ; elle est horodatée et conserve l'auteur.
- Une approbation ne peut pas être réutilisée pour un autre commit ou un autre
  digest.
- Un refus exige un motif et termine le pipeline en échec.
- Une demande expirée ou révoquée peut être reformulée ; un nouveau commit sur
  la même branche révoque les demandes encore pendantes.
- La promotion revérifie elle-même l'approbation (défense en profondeur).

## 5. Concurrence et fraîcheur

- Un verrou `DeploymentLock` par projet empêche deux déploiements simultanés.
- Le verrou expire après `DEPLOYMENT_LOCK_TTL_MS` si un worker meurt.
- Un pipeline plus ancien est refusé si un commit plus récent de la même
  branche est actif ou déjà déployé avec succès.
- Une relance du même commit n'est pas considérée comme obsolète.

## 6. SSH

- Chaque serveur doit avoir une empreinte d'hôte de confiance au format
  OpenSSH `SHA256:<43 caractères base64>`.
- Aucun déploiement, rollback ou commande distante n'est exécuté sans
  référence de confiance.
- Une clé observée différente de l'empreinte enregistrée provoque un échec
  explicite ; aucun contournement n'est proposé.
- Le test SSH peut se connecter sans empreinte uniquement pour afficher
  l'empreinte observée (amorçage) ; il n'exécute alors aucune commande.
- Un changement d'hôte ou de port invalide l'empreinte enregistrée.
- La cible SSH provient toujours du serveur enregistré et du projet autorisé,
  jamais d'une destination fournie directement par la requête.

## 7. Permissions GitHub App

Permissions de dépôt requises :

| Permission | Niveau | Usage |
| --- | --- | --- |
| Administration | Read | Lire les protections de branche et les rulesets |
| Checks | Write | Publier le Check Run `DevSecOps Manager / Security Gate` |
| Contents | Read | Lire le dépôt et les commits |
| Metadata | Read | Implicite, accordée à toute GitHub App |

Si `Administration: read` ou `Checks: write` manque, l'écran « Protections »
affiche **non vérifiable**, jamais « absent ». Les étapes correctives sont
listées dans l'interface.

Le nom du check est partagé entre l'API et le worker via
`DEVSECOPS_CHECK_NAME` : le check publié et le check obligatoire ne peuvent
pas diverger silencieusement.

## 8. Protection de branche

Pour qu'un Check Run en échec bloque réellement une fusion, il faut :

1. une protection de branche classique ou un ruleset actif sur la branche ;
2. `DevSecOps Manager / Security Gate` déclaré comme status check obligatoire ;
3. idéalement « Do not allow bypassing the above settings » pour les
   administrateurs.

Un Check Run en échec ne bloque **pas** la fusion par lui-même : seul le
caractère obligatoire du check dans la protection/ruleset produit ce blocage.
L'interface distingue donc l'exécution du pipeline, la publication du Check Run
et le contrôle obligatoire de fusion.

## 9. Migration

La migration `20261028113842_pr_to_production_hardening` ajoute :

- `DeploymentApproval` et son statut ;
- `DeploymentLock` ;
- le digest d'image et les références de rollback ;
- l'empreinte de clé d'hôte des serveurs ;
- `requireProductionApproval` ;
- le statut `WAITING_APPROVAL`.

Elle a été appliquée à `devsecops` et `devsecops_test`.

## 10. Limites connues

- Les permissions réelles de la GitHub App doivent être confirmées sur
  l'installation GitHub : le code ne peut pas prouver leur présence sans
  interroger l'API.
- Une clé privée GitHub App a existé dans l'historique Git
  (`secrets/github-app.pem`, commit `97518a7`). Elle doit être révoquée et
  rotationnée ; ce document ne recommande pas de réécrire l'historique sans
  validation.
- Les anciens déploiements sans digest ne peuvent pas servir de cible de
  rollback vérifiée.
- Le digest étant local à la VM, aucun transfert d'image entre serveurs n'est
  couvert.
- En stratégie `direct` avec ZAP, le déploiement précède nécessairement le
  DAST : un gate post-DAST bloquant ne peut pas « dé-déployer » la version déjà
  installée. Le rollback automatique est tenté en cas d'échec de déploiement ou
  de healthcheck, mais la stratégie staging reste requise pour un contrôle DAST
  réellement préalable à la production.
- Le test SSH d'amorçage n'exécute aucune commande, mais l'empreinte observée
  doit toujours être vérifiée hors bande avant d'être enregistrée.
