# Équipes GitHub — configuration et limites

Cette page décrit l'intégration des **organisations et équipes GitHub** dans
DevSecOps Manager. Les équipes sont réellement créées et modifiées sur GitHub :
la base locale ne sert que de **cache de lecture** et d'association aux projets
internes.

## 1. Source de vérité

- GitHub reste la source de vérité pour : l'existence d'une équipe, ses
  membres, ses invitations en attente, ses dépôts et les permissions associées.
- La table `GitHubTeam` est un cache alimenté par les appels GitHub. Elle ne
  remplace jamais une réponse GitHub.
- La table `ProjectTeam` associe une équipe GitHub à un projet DevSecOps avec un
  rôle **interne**. Cette association n'est jamais poussée vers GitHub.
- Aucun jeton d'installation, jeton d'application ou clé privée n'est envoyé au
  frontend. Tous les appels GitHub passent par l'API backend.

## 2. Prérequis GitHub App

L'application GitHub existante doit être installée sur une **organisation
GitHub** (les comptes personnels ne proposent pas d'équipes). Les permissions
minimales suivantes sont nécessaires :

| Portée | Permission | Niveau | Usage |
| --- | --- | --- | --- |
| Organisation | **Members** | Read and write | Lister, créer, renommer, supprimer les équipes ; ajouter/retirer des membres |
| Organisation | **Members** | Read | Lister les membres et les invitations en attente |
| Dépôt | **Administration** | Read and write | Associer un dépôt à une équipe, modifier ou retirer sa permission |
| Dépôt | **Metadata** | Read-only | Lecture des métadonnées de dépôts (obligatoire) |

Remarques :

- `Members: write` couvre les opérations sur les équipes et les appartenances.
- `Administration: write` (permission de dépôt) est nécessaire pour gérer
  l'accès des équipes aux dépôts. Sans elle, la lecture reste possible mais
  toute écriture est refusée par GitHub.
- Le webhook existant n'est pas requis pour les opérations d'équipe, mais il
  reste utilisé par les autres fonctionnalités GitHub de la plateforme.
- Après modification des permissions, réinstallez ou mettez à jour
  l'installation GitHub App pour que les nouveaux droits soient accordés.

### Variables d'environnement

```dotenv
GITHUB_APP_ID=
GITHUB_APP_SLUG=
# Chemin vers la clé privée .pem (ou contenu via GITHUB_APP_PRIVATE_KEY)
GITHUB_APP_PRIVATE_KEY_PATH=
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
```

La clé privée ne doit jamais être committée. Le fichier `secrets/github-app.pem`
est ignoré par Git ; en cas de fuite, la clé doit être révoquée et remplacée.

## 3. Installation et synchronisation

1. Un utilisateur installe la GitHub App sur une organisation depuis le flux
   d'installation existant (`/api/github/install/start`).
2. L'installation est enregistrée avec `accountType = Organization`. Les
   installations de type `User` restent visibles dans la page GitHub mais sont
   exclues de la gestion des équipes.
3. Depuis **Organisations**, l'utilisateur peut lancer une synchronisation
   complète : `POST /api/github/organizations/:installationId/sync`.
4. La synchronisation importe les équipes dans le cache local, met à jour
   `lastOrgSyncedAt`, positionne `orgSyncState` à `SYNCED` ou `ERROR`, et marque
   en `DELETED` les équipes qui ne existent plus sur GitHub.
5. Marquer une équipe `DELETED` ne supprime pas les associations
   `ProjectTeam` : l'historique et le rôle interne sont conservés, mais
   l'équipe ne peut plus être associée à un nouveau projet.

La page **Équipes** permet de lister, rechercher, filtrer, créer, consulter les
membres, les dépôts et les projets associés. Un bouton de synchronisation est
disponible par organisation.

## 4. Rôles et séparation des responsabilités

### Rôles DevSecOps Manager

- `PLATFORM_ADMIN` : accès complet, y compris la gestion des équipes et des
  installations GitHub.
- `PLATFORM_USER` : aucun droit GitHub automatique. La lecture exige
  `github_team:read` ; les écritures exigent `github_team:configure`.
- Les routes globales d'organisation/équipe sont protégées par
  `GITHUB_TEAM_MANAGE` (ou `PLATFORM_ADMIN`). L'API vérifie aussi que
  l'installation appartient à l'utilisateur, sauf pour un administrateur.
- Pour les associations projet : `GITHUB_TEAM_MANAGE` sur le projet est requis.
  `OWNER` le possède par rôle ; les autres rôles doivent recevoir la permission
  spéciale `MANAGE_GITHUB_TEAMS` (portée projet ou globale).
- `GITHUB_TEAM_READ` suffit pour consulter les équipes et leurs associations.
  Une écriture GitHub est refusée avant tout appel réseau si la permission
  manque.

### Rôles internes de projet

Les rôles `OWNER`, `MAINTAINER`, `DEVELOPER`, `SECURITY_ANALYST`, `REPORTER` et
`GUEST` sont appliqués uniquement par l'API DevSecOps Manager. Ils ne modifient
jamais les permissions GitHub, et un rôle GitHub (`member` / `maintainer`) ne
modifie pas automatiquement les droits internes de déploiement ou de Security
Gates.

### Rôle GitHub de l'utilisateur

Un `PLATFORM_ADMIN` DevSecOps n'est pas automatiquement propriétaire ou
mainteneur de l'organisation GitHub. GitHub applique ses propres règles : si le
compte de l'installation n'a pas les droits nécessaires, GitHub renvoie `403` et
l'API DevSecOps relaie l'erreur sans la transformer en succès.

## 5. API exposée

Toutes les routes sont authentifiées par JWT. Les écritures GitHub globales
exigent `GITHUB_TEAM_MANAGE` (ou `PLATFORM_ADMIN`) ; les écritures liées à un
projet exigent `GITHUB_TEAM_MANAGE` sur ce projet. Voir `docs/rbac.md` pour la
matrice complète.

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/github/organizations` | Organisations installées et capacités détectées |
| `POST` | `/api/github/organizations/:installationId/sync` | Synchronisation complète (GITHUB_TEAM_MANAGE) |
| `GET` | `/api/github/organizations/:installationId/teams` | Liste paginée et filtrée des équipes |
| `POST` | `/api/github/organizations/:installationId/teams` | Création réelle sur GitHub (GITHUB_TEAM_MANAGE) |
| `GET` | `/api/github/organizations/:installationId/teams/:slug` | Détail d'une équipe |
| `POST` | `/api/github/organizations/:installationId/teams/:slug/sync` | Resynchronisation d'une équipe (GITHUB_TEAM_MANAGE) |
| `GET` | `/api/github/organizations/:installationId/teams/:slug/members` | Membres actifs + invitations en attente |
| `PUT` | `/api/github/organizations/:installationId/teams/:slug/members/:username` | Ajout ou mise à jour d'un membre (GITHUB_TEAM_MANAGE) |
| `DELETE` | `/api/github/organizations/:installationId/teams/:slug/members/:username` | Retrait d'un membre (GITHUB_TEAM_MANAGE) |
| `GET` | `/api/github/organizations/:installationId/teams/:slug/repos` | Dépôts associés et permissions |
| `PUT` | `/api/github/organizations/:installationId/teams/:slug/repos/:owner/:repo` | Association/permission de dépôt (GITHUB_TEAM_MANAGE) |
| `DELETE` | `/api/github/organizations/:installationId/teams/:slug/repos/:owner/:repo` | Retrait d'un dépôt (GITHUB_TEAM_MANAGE) |
| `GET` | `/api/projects/:id/teams` | Équipes associées au projet |
| `GET` | `/api/projects/:id/teams/available` | Équipes disponibles pour l'association |
| `POST` | `/api/projects/:id/teams` | Association équipe ↔ projet |
| `PATCH` | `/api/projects/:id/teams/:linkId` | Mise à jour du rôle interne |
| `DELETE` | `/api/projects/:id/teams/:linkId` | Suppression de l'association interne |

Les réponses d'erreur GitHub sont traduites en codes stables :

| Code | Signification |
| --- | --- |
| `GITHUB_UNAUTHORIZED` | Jeton ou installation invalide |
| `GITHUB_FORBIDDEN` | Permission GitHub insuffisante ou règle d'organisation |
| `GITHUB_NOT_FOUND` | Équipe, dépôt ou ressource introuvable |
| `GITHUB_UNPROCESSABLE` | Données refusées par GitHub (nom déjà pris, etc.) |
| `GITHUB_RATE_LIMITED` | Limite de débit GitHub ; `retryAfterSeconds` peut être fourni |
| `GITHUB_TIMEOUT` | GitHub n'a pas répondu dans le délai imparti (15 s) |
| `GITHUB_PERMISSION_MISSING` | Permission requise absente de l'installation |

## 6. Limites connues

- **Pas de cache des membres** : les membres et invitations sont relus depuis
  GitHub à chaque affichage. Cela évite les données périmées mais consomme du
  quota API.
- **Pagination de synchronisation** : la synchronisation complète lit au plus
  10 pages de 100 équipes (1 000 équipes). Au-delà, le résultat est marqué
  incomplet et les équipes non lues ne sont pas marquées `DELETED`.
- **Membres** : la liste des membres actifs lit au plus 10 pages de 100 membres
  (1 000 membres). Les invitations en attente sont limitées à la première page
  (100 invitations).
- **Rate limiting GitHub** : les installations disposent d'un quota horaire.
  Les erreurs `429` sont relayées avec `Retry-After` lorsqu'il est fourni.
- **Timeouts** : chaque requête GitHub est abandonnée après 15 secondes et
  renvoyée en `504 GITHUB_TIMEOUT`. Aucune erreur réseau n'est convertie en
  succès.
- **Rôle GitHub humain** : sans jeton OAuth user-to-server, l'API ne peut pas
  vérifier le rôle d'un utilisateur humain dans l'organisation. Elle s'appuie
  sur les droits de l'installation et laisse GitHub appliquer ses règles.
- **Suppression d'équipe** : l'interface permet de retirer un membre, un dépôt
  ou une association projet. La suppression définitive d'une équipe GitHub
  n'est pas exposée dans cette version ; elle doit être faite sur GitHub puis
  suivie d'une synchronisation.
- **Comptes personnels** : les équipes ne sont jamais proposées pour une
  installation de type `User`.

## 7. Tests

Les tests API couvrent notamment :

- organisations et détection des permissions ;
- pagination, recherche et synchronisation du cache ;
- création réelle (mockée) et refus GitHub sans faux succès ;
- membres actifs, maintainers, invitations en attente, ajout/retrait ;
- dépôts, permissions et refus sans `Administration: write` ;
- RBAC HTTP (401/403) et validation Zod ;
- associations projet, rôles internes et refus d'accès ;
- rate limiting GitHub.

Commandes :

```bash
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npm run test -w apps/api
npm run build -w apps/api
npm run build -w apps/web
```
