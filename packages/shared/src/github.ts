// packages/shared/src/github.ts
/**
 * Nom exact du Check Run publié par la plateforme.
 *
 * Cette valeur est une référence de contrat : la protection de branche doit
 * exiger ce nom, et le worker doit publier ce même nom. Les deux côtés
 * importent donc la constante partagée pour éviter toute dérive silencieuse
 * entre le check publié et le check obligatoire.
 */
export const DEVSECOPS_CHECK_NAME = "DevSecOps Manager / Security Gate";
