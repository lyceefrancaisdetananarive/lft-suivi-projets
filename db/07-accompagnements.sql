-- =====================================================================
-- Accompagnements des élèves : PAP, PPRE, PAI, comme dans Pronote
-- (décision de l'administrateur de l'application, 18/11/2026).
-- À jouer une fois dans l'éditeur SQL du projet Suivi_Projets_LFT.
--
--   PAP   plan d'accompagnement personnalisé
--   PPRE  programme personnalisé de réussite éducative
--   PAI   projet d'accueil individualisé
--
-- Visibles des seuls enseignants, de la direction et de l'administrateur
-- (et, quand l'espace élève ouvrira, de l'élève concerné pour lui seul).
-- Jamais des visiteurs non connectés, jamais de la vie scolaire.
--
-- PREMIÈRE PARTIE : la nouvelle colonne, avec reprise des PAP déjà posés.
-- L'ancienne colonne « pap » reste en place le temps du déploiement ; la
-- seconde partie (db/08-retrait-pap.sql) la retire ensuite.
-- =====================================================================

alter table suivi.eleves
  add column if not exists accompagnements text[] not null default '{}'
  check (accompagnements <@ array['PAP','PPRE','PAI']::text[]);

update suivi.eleves
   set accompagnements = array_append(accompagnements, 'PAP')
 where pap and not ('PAP' = any(accompagnements));

-- Vérification : autant de PAP dans les deux colonnes.
select count(*) filter (where pap)                           as pap_ancien,
       count(*) filter (where 'PAP' = any(accompagnements))  as pap_nouveau,
       count(*)                                              as eleves
  from suivi.eleves;
