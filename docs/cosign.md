# Cosign et sécurité de la supply chain

## Mode de signature

La politique projet utilise `cosignMode` :

- `DISABLED` : aucune signature.
- `WARNING` : signature tentée, échec non bloquant.
- `REQUIRED` : signature obligatoire ; un échec interrompt le pipeline avant le déploiement.

La vérification est liée à l'image par son digest (`sha256:...`), jamais par un tag mutable.

## Stockage de la clé

- La clé privée Cosign reste sur la VM de build/déploiement, jamais dans le dépôt.
- Les variables `COSIGN_PASSWORD` et `COSIGN_REGISTRY_PASSWORD` sont masquées dans les logs.
- Accès limité au compte de déploiement (lecture seule pour les autres utilisateurs).
- Rotation : générer une nouvelle paire, mettre à jour la clé publique dans la configuration, resigner les images requises, puis révoquer l'ancienne clé.

## Vérification avant promotion

Lorsque `cosignMode = REQUIRED`, l'étape `SIGN` est critique. Le pipeline ne peut pas promouvoir une image dont la signature est absente ou invalide.