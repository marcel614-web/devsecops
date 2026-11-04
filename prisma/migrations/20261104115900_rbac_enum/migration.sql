-- Ajout des nouvelles valeurs d'enum dans une migration dédiée.
-- PostgreSQL exige que les nouvelles valeurs soient validées (COMMIT)
-- avant d'être utilisées dans une autre instruction.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PLATFORM_USER';
