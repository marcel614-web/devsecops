# Hook Gitleaks local

Le hook `pre-commit` bloque un commit si un secret est présent dans les
fichiers **indexés**. Il complète le scan Gitleaks exécuté par la plateforme :
il donne un retour immédiat, mais ne remplace ni le scan complet du workspace
ni le Security Gate.

## Version et syntaxe utilisées

- Gitleaks testé : **8.30.0** (minimum 8.x).
- Commande du hook :

```sh
gitleaks git --pre-commit --staged --redact --no-banner \
  --exit-code 0 --report-format json --report-path <rapport-temporaire>
```

`--pre-commit --staged` limite le scan au diff indexé. `--redact` masque les
valeurs dans la sortie et le rapport. Le script `scripts/gitleaks-precommit.mjs`
lit le rapport JSON, affiche la règle, le fichier et la ligne, puis refuse le
commit. Le rapport est supprimé dans tous les cas.

La syntaxe `gitleaks git` / `gitleaks dir` est celle de Gitleaks 8.x. Les
anciennes commandes `detect` restent disponibles mais ne sont pas utilisées par
le hook.

## Installation

### 1. Installer Gitleaks

Télécharger le binaire depuis les releases officielles
<https://github.com/gitleaks/gitleaks/releases>, ou :

```sh
# macOS / Linux (Homebrew)
brew install gitleaks

# Go
go install github.com/gitleaks/gitleaks/v8@v8.30.0
```

Sous Windows, ajouter le dossier du binaire au `PATH`, ou définir explicitement :

```powershell
$env:GITLEAKS_BIN = "D:\ProjetL3\Outils\gitleaks\gitleaks.exe"
```

Vérifier :

```sh
gitleaks version
```

### 2. Activer le hook versionné

```sh
npm run hooks:install
```

La commande configure `core.hooksPath=.githooks` pour ce dépôt et rend
`.githooks/pre-commit` exécutable sur macOS/Linux. Elle vérifie aussi la
présence de Gitleaks et affiche sa version.

### 3. Vérifier le fonctionnement

```sh
# Créer un faux secret dans un fichier de test, puis :
git add fichier-de-test
git commit -m "test hook"
```

Résultat attendu : commit refusé, avec une sortie du type

```text
[gitleaks pre-commit] 1 secret(s) détecté(s) dans les fichiers indexés :
  - slack-bot-token — app.env:1 (valeur masquée)

Commit refusé : retirez le secret, utilisez une variable d'environnement...
```

Retirer ensuite le fichier de test de l'index (`git restore --staged ...`).

## Comportement en cas de problème

| Situation | Comportement |
|---|---|
| Secret détecté | Commit refusé, valeur masquée |
| Gitleaks absent | Commit refusé, message d'installation (fail-closed) |
| Gitleaks en erreur | Commit refusé, détail redacté |
| Rapport illisible | Commit refusé |
| `GITLEAKS_HOOK_ALLOW_MISSING=1` | Commit autorisé **sans** scan local, avec avertissement explicite |

Le contournement `git commit --no-verify` ne doit pas être utilisé. Si un
outil externe l'impose, le scan plateforme reste la barrière de secours, mais
le secret est déjà dans l'historique local.

## Faux positif confirmé

1. Vérifier que la valeur n'est pas un secret réel.
2. Préférer un commentaire inline `# gitleaks:allow` **sur la ligne concernée**,
   avec justification en revue.
3. Pour un fichier de test volumineux, utiliser une entrée précise dans
   `.gitleaksignore` (empreinte Gitleaks), jamais une exclusion de catégorie.

Une exception de Security Gate ne dispense pas de traiter le secret : le hook
et le scan Gitleaks restent exécutés.

## Scan plateforme complémentaire

Le worker exécute Gitleaks sur l'ensemble du workspace avec :

```sh
gitleaks dir <workspace> --report-format json --report-path <rapport> --redact --exit-code 0
```

Les findings sont normalisés (`SECRET`), persistés, puis évalués par le
Security Gate. Un scanner indisponible ou un rapport illisible produit un
`SCANNER_UNAVAILABLE` ou `PARSE_ERROR`, jamais un succès à zéro finding. Le
hook local ne voit que les fichiers indexés : un fichier non suivi, généré ou
présent uniquement dans l'historique n'est couvert que par le scan plateforme
et l'analyse d'historique ci-dessous.

## Analyse de l'historique Git

Cette analyse est **en lecture seule** : elle ne réécrit pas l'historique.

```sh
gitleaks git --log-opts="--all" --redact --no-banner \
  --exit-code 0 --report-format json --report-path gitleaks-history.json
```

Le rapport contient les commits, fichiers et règles concernés (valeurs
masquées). Il ne doit pas être commité : ajouter `gitleaks-history.json` au
`.gitignore` local ou le placer hors du dépôt.

Procédure recommandée :

1. **Révoquer et rotationner** chaque secret confirmé, même ancien. Un secret
   supprimé du code reste compromis s'il a été exposé.
2. Identifier les commits/branches concernés et vérifier si le dépôt a été
   partagé (remote, forks, CI, artefacts).
3. Corriger le secret dans le code courant et ajouter une règle de prévention.
4. Si la direction sécurité l'exige, planifier une réécriture d'historique :
   sauvegarde complète, coordination de tous les contributeurs, fenêtre
   annoncée, puis `git filter-repo`/BFG sur une copie. La réécriture est
   destructive (hashes, tags, PR) et ne doit jamais être lancée à l'aveugle.
5. Après réécriture, forcer la mise à jour des branches avec accord explicite,
   recréer les tags, et relancer l'analyse d'historique.

Ne pas utiliser `git filter-branch` de manière interactive sur un dépôt partagé
sans sauvegarde ni validation.

### Résultat de l'analyse sur ce dépôt (2026-10-28)

`npm run secrets:history` a scanné 28 commits et signalé **2 résultats**
(valeurs masquées, aucun secret affiché) :

| Règle | Fichier / commit | Interprétation | Action |
|---|---|---|---|
| `private-key` | `secrets/github-app.pem` @ `97518a7` | **Clé privée réelle présente dans l'historique.** Le fichier est ignoré aujourd'hui, mais reste accessible dans les anciens commits. | Révoquer/rotationner la clé GitHub App, puis décider avec la direction sécurité d'une éventuelle réécriture d'historique. |
| `generic-api-key` | `apps/api/.env.example` @ `264b9da` | Faux positif : `MASTER_ENCRYPTION_KEY=changeme-32-bytes-base64` est un placeholder. | Aucune rotation nécessaire ; ne pas ajouter d'exclusion large pour autant. |

Le fichier `secrets/github-app.pem` n'a pas été supprimé du disque par cette
analyse (il peut être nécessaire au fonctionnement local). Le scan plateforme
ignore `secrets/` car le dossier est dans `.gitignore`, mais l'analyse
d'historique doit rester dans la procédure de revue sécurité.
