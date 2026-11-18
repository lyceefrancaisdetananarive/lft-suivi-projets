-- =====================================================================
-- Refonte graphique (18/11/2026) : classes d'un projet, fonction des
-- personnels. À jouer une fois dans l'éditeur SQL du projet
-- Suivi_Projets_LFT. Sans effet sur les fiches existantes.
-- =====================================================================

-- Les classes concernées par un projet, en texte : « 3M2, 3M6 ». Des noms de
-- classes, jamais de noms d'élèves (la liste nominative attend l'AIPD, l'avis
-- du DPD et la décision de la direction).
alter table suivi.projets
  add column if not exists classes text;

-- La fonction d'un personnel, affichée dans le choix des co-animateurs :
-- « Anglais », « CPE », « Professeure documentaliste ». Renseignée par
-- l'administrateur à partir du trombinoscope interne.
alter table suivi.membres
  add column if not exists fonction text;

-- Vérification
select column_name, data_type
  from information_schema.columns
 where table_schema = 'suivi'
   and ((table_name = 'projets' and column_name = 'classes')
     or (table_name = 'membres' and column_name = 'fonction'));
