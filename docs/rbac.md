# RBAC — rôles, permissions et migration

Cette page décrit le contrôle d'accès basé sur les rôles (RBAC) de
DevSecOps Manager. Le backend est la **source de vérité** : masquer un bouton
dans l'interface ne remplace jamais une vérification d'autorisation côté API.

## 1. Principes

- Aucune route sensible ne se contente de vérifier `req.user.role`.
- Les décisions passent par un registre central de permissions
  (`apps/api/src/modules/authorization/`).
- Le refus est la règle par défaut : sans rôle global, appartenance active ou
  permission spéciale, l'accès est refusé.
- Un `PLATFORM_ADMIN` peut tout faire, mais cette exception est centralisée.
- GitHub reste une source de vérité distincte : une permission GitHub ne donne
  aucun droit DevSecOps implicite, et inversement.

## 2. Rôles globaux

| Rôle | Usage |
| --- | --- |
| `PLATFORM_ADMIN` | Administration de la plateforme : utilisateurs, rôles, intégrations, serveurs, audit global, accès à tous les projets. |
| `PLATFORM_USER` | Compte standard. Aucun accès automatique à un projet : il faut une appartenance projet ou une permission spéciale. |

Les anciennes valeurs `ADMIN` et `DEVELOPER` restent temporairement dans
l'enum PostgreSQL pour ne pas casser les données ou les anciens JWT. Elles sont
normalisées en mémoire :

- `ADMIN` → `PLATFORM_ADMIN`
- `DEVELOPER` → `PLATFORM_USER`

Elles ne doivent plus être attribuées à de nouveaux comptes.

## 3. Rôles projet

| Rôle | Portée principale |
| --- | --- |
| `OWNER` | Contrôle total du projet, membres, secrets, configuration, déploiements et équipes GitHub. Seul rôle pouvant nommer ou retirer un autre `OWNER`. |
| `MAINTAINER` | Gestion opérationnelle : pipelines, dépôts, configuration, déploiements et approbations, sans gestion des membres ni suppression du projet. |
| `DEVELOPER` | Lecture du projet, exécution/annulation de ses propres pipelines, lecture des vulnérabilités et des rapports. |
| `SECURITY_ANALYST` | Lecture sécurité, mise à jour des vulnérabilités, lecture des gates, rapports, SBOM et images. |
| `REPORTER` | Lecture et export de rapports, lecture des pipelines, vulnérabilités et déploiements. |
| `GUEST` | Lecture minimale du projet, des pipelines et des rapports. |

Un `PLATFORM_ADMIN` obtient un rôle synthétique `OWNER` sur chaque projet sans
créer de `ProjectMember`. Les autres utilisateurs doivent avoir une ligne
`ProjectMember` avec le statut `ACTIVE`.

### Compatibilité des projets historiques

Si un projet n'a pas encore de ligne `ProjectMember` pour son `ownerId`
historique, cet utilisateur est traité comme `OWNER`. La migration crée
normalement cette ligne pour tous les projets existants ; le fallback couvre les
données importées ou restaurées après migration.

## 4. Permissions spéciales

Une permission spéciale est un droit supplémentaire, indépendant du rôle
projet. Elle peut être :

- **globale** : valable sur toute la plateforme (attribution réservée à
  `PLATFORM_ADMIN`) ;
- **projet** : valable uniquement sur le projet concerné.

| Permission | Portée | Capacités ajoutées |
| --- | --- | --- |
| `APPROVE_PRODUCTION` | Globale ou projet | `deployment:approve`, y compris l'auto-approbation d'une livraison dont on est le demandeur. |
| `MANAGE_SECURITY_POLICY` | Globale ou projet | `security_gate:configure`. Permet uniquement de modifier les champs de politique de sécurité, pas le reste de la configuration projet. |
| `MANAGE_SERVERS` | Globale uniquement | Gestion de tous les serveurs de déploiement. |
| `MANAGE_INTEGRATIONS` | Globale uniquement | Configuration des intégrations GitHub, DefectDojo et Dependency-Track. |
| `MANAGE_PROJECT_MEMBERS` | Globale ou projet | `project:manage_members` et `project_member:read`. Ne permet pas de nommer ou retirer un `OWNER`. |
| `MANAGE_GITHUB_TEAMS` | Globale ou projet | `github_team:read` et `github_team:configure`. |
| `ACCEPT_SECURITY_RISK` | Globale ou projet | `vulnerability:accept_risk` et `security_gate:approve`. |
| `MANAGE_DEPLOYMENTS` | Globale ou projet | `deployment:create`, `deployment:update`, `deployment:cancel`. |
| `MANAGE_PROJECT_SECRETS` | Globale ou projet | `project_secret:configure`. |
| `VIEW_SECURITY_AUDIT` | Globale uniquement | `audit_log:read` au-delà de ses propres actions. |

Les permissions projet ne s'appliquent jamais à un autre projet. Les
attributions globales ne peuvent pas être créées depuis un formulaire projet :
elles passent par `/api/authorization/global-permissions`, réservé aux
`PLATFORM_ADMIN`.

## 5. Résolution d'une décision

Fichiers principaux :

| Fichier | Rôle |
| --- | --- |
| `authorization/permissions.constants.ts` | Ressources, actions, catalogue exhaustif et capacités des permissions spéciales. |
| `authorization/role-permissions.ts` | Matrice rôles globaux / rôles projet, normalisation des anciens rôles. |
| `authorization/project-membership.service.ts` | Résolution de l'appartenance, fallback propriétaire historique, filtres de listes, protection du dernier `OWNER`. |
| `authorization/permission.service.ts` | Calcul des permissions effectives, `can`, `requirePermission`, `requireSpecialPermission`, `requirePlatformAdmin`. |
| `authorization/authorization.middleware.ts` | Gardes Express réutilisables. |
| `authorization/authorization.audit.ts` | Journalisation des accès refusés et des actions sensibles. |

Ordre simplifié :

1. `requireAuth` vérifie le JWT, recharge le compte en base, refuse un compte
   suspendu/inactif et compare `tokenVersion` (`tv` dans le JWT).
2. La route ou le service appelle `requirePermission` avec la permission
   attendue et, si nécessaire, le `projectId`.
3. `getEffectivePermissions` part des permissions globales, ajoute celles du
   rôle projet si l'appartenance est active, puis les capacités des permissions
   spéciales actives (non expirées, non révoquées, de la bonne portée).
4. `PLATFORM_ADMIN` court-circuite les vérifications projet, mais pas les
   vérifications d'existence des ressources.
5. Un refus est journalisé dans `AuditLog` avec le résultat `DENIED`.

## 6. Invitations et membres

Routes projet (authentification obligatoire) :

| Méthode | Route | Permission |
| --- | --- | --- |
| `GET` | `/api/projects/:id/members` | `project_member:read` |
| `GET` | `/api/projects/:id/invitations` | `project_member:read` |
| `POST` | `/api/projects/:id/invitations` | `project:manage_members` |
| `POST` | `/api/projects/:id/invitations/:invitationId/resend` | `project:manage_members` |
| `DELETE` | `/api/projects/:id/invitations/:invitationId` | `project:manage_members` |
| `PATCH` | `/api/projects/:id/members/:memberId` | `project:manage_members` |
| `DELETE` | `/api/projects/:id/members/:memberId` | `project:manage_members` |
| `GET` | `/api/projects/:id/permission-grants` | `project_member:read` |
| `POST` | `/api/projects/:id/permission-grants` | `project:manage_members` |
| `DELETE` | `/api/projects/:id/permission-grants/:grantId` | `project:manage_members` |
| `POST` | `/api/projects/invitations/accept` | compte authentifié dont l'email correspond |

Règles de sécurité :

- le jeton brut est généré avec `crypto.randomBytes(32)` et n'est stocké que
  sous forme de hash SHA-256 ;
- il n'est retourné qu'une seule fois, jamais journalisé ;
- expiration configurable de 1 à 30 jours (7 jours par défaut) ;
- renvoi = rotation du jeton et de l'expiration ;
- révocation immédiate possible ;
- l'acceptation vérifie l'email du compte, le statut actif, l'expiration et la
  révocation ;
- le dernier `OWNER` actif ne peut être ni rétrogradé ni retiré ;
- seul un `OWNER` ou un `PLATFORM_ADMIN` peut nommer, rétrograder ou retirer un
  `OWNER`.

## 7. Administration des utilisateurs

Routes principales :

| Méthode | Route | Accès |
| --- | --- | --- |
| `GET` | `/api/users` | `PLATFORM_ADMIN` |
| `POST` | `/api/users` | `PLATFORM_ADMIN` |
| `GET` | `/api/users/:id` | `PLATFORM_ADMIN` ou soi-même |
| `PATCH` | `/api/users/:id` | `PLATFORM_ADMIN` |
| `POST` | `/api/users/:id/suspend` | `PLATFORM_ADMIN` |
| `POST` | `/api/users/:id/reactivate` | `PLATFORM_ADMIN` |
| `POST` | `/api/users/:id/revoke-sessions` | `PLATFORM_ADMIN` |
| `GET` | `/api/users/:id/permissions` | `PLATFORM_ADMIN` ou soi-même |
| `GET` | `/api/users/:id/activity` | `PLATFORM_ADMIN` |

La suppression d'un utilisateur est **logique** (`status = DISABLED`) afin de
préserver les projets, pipelines, audits et relations historiques. Toute
modification de rôle, de statut, de mot de passe ou toute révocation de session
incrémente `tokenVersion`, ce qui invalide immédiatement les anciens JWT.

## 8. Frontend

- `Administration → Utilisateurs` : rôles globaux, statuts, suspension,
  réactivation, révocation de sessions, activité et permissions effectives.
- `Administration → Rôles et permissions` : catalogue, matrice et attributions
  globales.
- `Projet → Membres et permissions` : membres, invitations, rôles projet et
  permissions spéciales projet.
- `Projet → Équipes GitHub` : associations d'équipes, sans confusion avec le
  RBAC interne.
- `AcceptInvitationPage` : acceptation explicite d'une invitation via
  `/invitations/accept?token=...`.
- Le login et `/api/auth/me` renvoient `globalPermissions`. La navigation et le
  garde de la page d'audit s'en servent pour afficher le journal à un porteur
  global de `VIEW_SECURITY_AUDIT`, sans donner accès aux pages strictement
  administrateur.
- La navigation et les gardes frontend normalisent encore `ADMIN` et
  `DEVELOPER` pour les anciens comptes. Les contrôles backend restent
  obligatoires.

## 9. Migration

Les migrations doivent être appliquées dans cet ordre :

1. `prisma/migrations/20261104115900_rbac_enum/migration.sql` : ajout des
   valeurs `PLATFORM_ADMIN` et `PLATFORM_USER` à l'enum `Role`.
2. `prisma/migrations/20261104120000_rbac/migration.sql` : tables RBAC,
   colonnes de compatibilité, index, clés étrangères et migration des données.

Ne jamais fusionner l'ajout des valeurs d'enum et leur utilisation dans une
seule migration PostgreSQL : les nouvelles valeurs doivent être validées avant
d'être utilisées (`55P04`).

Commandes :

```bash
npx prisma migrate deploy
npx prisma generate
```

Après déploiement :

- redémarrer l'API et le worker pour charger le client Prisma et les nouvelles
  règles ;
- vérifier que les comptes historiques ont bien été convertis ;
- accorder manuellement les permissions GitHub App si nécessaire
  (`Members: read/write`, `Administration: write`, `Metadata: read`) ;
- ne pas réattribuer `ADMIN` ou `DEVELOPER`.

## 10. Défense en profondeur

- Toutes les listes transverses sont filtrées par `projectAccessWhere` ou
  `listAccessibleProjectIds` : un utilisateur ne voit que ses projets.
- Les routes qui prennent un `projectId` et un identifiant de ressource
  revérifient l'appartenance de la ressource au projet (anti-IDOR/BOLA).
- Les téléchargements de logs et de rapports utilisent les permissions
  `pipeline_log:export` et `security_report:export`.
- Les tâches BullMQ revérifient l'autorisation au moment de l'exécution :
  `apps/worker/src/orchestrator/pipeline.authorization.ts`. Si le déclencheur a
  été suspendu, retiré du projet ou supprimé, le pipeline est marqué `FAILED` et
  un audit `PIPELINE_JOB_DENIED` est écrit.
- Les pipelines déclenchés par webhook ont `triggeredById = null` ; leur
  authenticité repose sur la signature GitHub vérifiée à la réception.
- Les secrets, jetons, clés privées et hashes de mot de passe ne sont jamais
  renvoyés au frontend ni écrits dans les logs d'audit.

## 11. Tests

La suite API couvre notamment :

- rôles globaux et administration réservée ;
- isolation entre projets A et B et refus d'accès API direct ;
- invitations expirées et révoquées ;
- permissions spéciales expirées ou limitées à un autre projet ;
- protection du dernier `OWNER` ;
- auto-approbation de production interdite sans `APPROVE_PRODUCTION` ;
- compte suspendu bloqué malgré un JWT encore valide ;
- politique de sécurité protégée et `MANAGE_SECURITY_POLICY` limité aux champs
  de politique.

Fichiers utiles :

- `apps/api/src/modules/authorization/rbac.test.ts`
- `apps/api/src/modules/projects/projects.security-policy.test.ts`
- `apps/api/src/modules/deployments/approvals.service.test.ts`

Commandes :

```bash
npm run typecheck -w apps/api
npm run typecheck -w apps/web
npx tsc -p apps/worker/tsconfig.json --noEmit
npm test -w apps/api
```

## 12. Limites connues

- L'envoi d'email d'invitation n'est pas implémenté : le jeton est affiché une
  seule fois à l'administrateur, qui doit le transmettre par un canal sûr.
- Les anciennes valeurs `ADMIN` et `DEVELOPER` restent dans l'enum pour la
  compatibilité ; elles devront être supprimées dans une migration ultérieure
  après vérification qu'aucune donnée ne les utilise.
- `requireAuth` effectue une lecture utilisateur par requête afin de révoquer
  immédiatement les sessions ; c'est un choix de sécurité assumé.
- Les permissions GitHub et les rôles DevSecOps sont volontairement séparés :
  une équipe GitHub associée à un projet ne crée pas de `ProjectMember`.
