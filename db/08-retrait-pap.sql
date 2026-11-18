-- =====================================================================
-- Seconde partie de db/07 : retrait de l'ancienne colonne « pap », une fois
-- en ligne le code qui lit « accompagnements ».
-- =====================================================================

alter table suivi.eleves drop column if exists pap;

-- Vérification : la colonne « accompagnements » seule reste.
select column_name from information_schema.columns
 where table_schema = 'suivi' and table_name = 'eleves'
   and column_name in ('pap', 'accompagnements');
