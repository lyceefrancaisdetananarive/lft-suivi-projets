-- =====================================================================
-- Phase 2 (18/11/2026) : parcours éducatifs et projet phare.
-- À jouer une fois dans l'éditeur SQL du projet Suivi_Projets_LFT.
-- Sans effet sur les fiches existantes (valeurs par défaut).
-- =====================================================================

-- Les parcours éducatifs auxquels contribue un projet, avec leurs axes :
--   { "S": [0, 1], "C": [2] }
--   S santé (circulaire 2016-008), C citoyen (circulaire 2016-092),
--   A Avenir (arrêté du 1er juillet 2015), E éducation artistique et
--   culturelle (arrêté du 1er juillet 2015). Indices d'axes 0 à 2.
-- Le contrôle fin de la forme est fait par l'API ; la base garantit un objet.
alter table suivi.projets
  add column if not exists parcours jsonb not null default '{}'::jsonb;
alter table suivi.projets drop constraint if exists projets_parcours_objet;
alter table suivi.projets
  add constraint projets_parcours_objet check (jsonb_typeof(parcours) = 'object');

-- Projet phare : choisi par la direction (trois au plus par année, contrôlé
-- par l'API). L'auteur peut seulement le proposer.
alter table suivi.projets
  add column if not exists phare boolean not null default false;
alter table suivi.projets
  add column if not exists phare_propose boolean not null default false;

select 'OK' as resultat;
