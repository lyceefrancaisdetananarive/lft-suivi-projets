-- =====================================================================
-- Suivi des projets · vérification du schéma « suivi »
--
-- À EXÉCUTER APRÈS 01-schema-suivi.sql, ET DE NOUVEAU APRÈS CHAQUE
-- MIGRATION DU SUIVI. Lecture seule : les essais d'écriture de la fin sont
-- annulés avant de rendre la main, rien ne reste en base.
--
-- Sortie attendue : une seule ligne « OK ». Toute anomalie arrête le
-- script avec un message qui dit quoi corriger.
--
-- Le suivi a son propre projet Supabase, séparé de celui du classeur de
-- technologie. Ce script ne regarde que le schéma suivi, plus les liens
-- éventuels avec le schéma public, qui doit rester vide de toute dépendance.
-- =====================================================================

do $$
declare
  t      record;
  n      int;
  c1     text;
  c2     text;
  c3     text;
  avant  timestamptz;
  apres1 timestamptz;
  apres2 timestamptz;
begin
  -- 1. Le schéma existe.
  if not exists (select 1 from pg_namespace where nspname = 'suivi') then
    raise exception 'Schema suivi absent : executer 01-schema-suivi.sql.';
  end if;

  -- 2. Le navigateur n'a aucun accès au schéma.
  if has_schema_privilege('anon', 'suivi', 'USAGE')
     or has_schema_privilege('authenticated', 'suivi', 'USAGE') then
    raise exception 'anon ou authenticated a USAGE sur le schema suivi : revoke all on schema suivi from anon, authenticated.';
  end if;
  if not has_schema_privilege('service_role', 'suivi', 'USAGE') then
    raise exception 'service_role n''a pas USAGE sur suivi : les fonctions serveur recevront permission denied.';
  end if;

  -- 3. Chaque table : RLS actif, aucun droit pour le navigateur, tous les
  --    droits pour service_role.
  for t in
    select c.oid, c.relname, c.relkind, c.relrowsecurity
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'suivi' and c.relkind in ('r', 'v')
  loop
    if t.relkind = 'r' and not t.relrowsecurity then
      raise exception 'RLS DESACTIVE sur suivi.% : son contenu serait lisible par quiconque obtiendrait un droit dessus.', t.relname;
    end if;
    if has_table_privilege('anon', t.oid, 'SELECT')
       or has_table_privilege('anon', t.oid, 'INSERT')
       or has_table_privilege('anon', t.oid, 'UPDATE')
       or has_table_privilege('anon', t.oid, 'DELETE')
       or has_table_privilege('authenticated', t.oid, 'SELECT')
       or has_table_privilege('authenticated', t.oid, 'INSERT')
       or has_table_privilege('authenticated', t.oid, 'UPDATE')
       or has_table_privilege('authenticated', t.oid, 'DELETE') then
      raise exception 'anon ou authenticated a un droit sur suivi.% : le navigateur ne doit rien lire ni ecrire directement.', t.relname;
    end if;
    if not has_table_privilege('service_role', t.oid, 'SELECT') then
      raise exception 'service_role ne peut pas lire suivi.%.', t.relname;
    end if;
    if t.relkind = 'r' and not (
         has_table_privilege('service_role', t.oid, 'INSERT')
     and has_table_privilege('service_role', t.oid, 'UPDATE')
     and has_table_privilege('service_role', t.oid, 'DELETE')) then
      raise exception 'service_role ne peut pas ecrire dans suivi.%.', t.relname;
    end if;
  end loop;

  -- 4. Aucune politique RLS : le modèle n'en prévoit pas. Une politique
  --    apparue ici a été ajoutée à la main, et elle ouvre peut-être quelque
  --    chose. On préfère l'examiner que la découvrir.
  select count(*) into n from pg_policies where schemaname = 'suivi';
  if n > 0 then
    raise exception '% politique(s) RLS sur le schema suivi : le modele n''en prevoit aucune, examiner pg_policies.', n;
  end if;

  -- 5. Les fonctions du schéma ne sont pas exécutables par le navigateur.
  for t in
    select p.oid, p.proname
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'suivi'
  loop
    if has_function_privilege('anon', t.oid, 'EXECUTE')
       or has_function_privilege('authenticated', t.oid, 'EXECUTE') then
      raise exception 'La fonction suivi.% est executable par anon ou authenticated.', t.proname;
    end if;
  end loop;

  -- 6. Supprimer un compte ne doit jamais échouer à cause du suivi.
  --    Aucune clé étrangère partant du suivi vers auth ou public ne doit être
  --    en « restrict » ou « no action ».
  select count(*) into n
    from pg_constraint k
    join pg_class src  on src.oid = k.conrelid
    join pg_namespace ns on ns.oid = src.relnamespace
    join pg_class dst  on dst.oid = k.confrelid
    join pg_namespace nd on nd.oid = dst.relnamespace
   where k.contype = 'f'
     and ns.nspname = 'suivi'
     and nd.nspname in ('auth', 'public')
     and k.confdeltype in ('a', 'r');
  if n > 0 then
    raise exception '% cle(s) du suivi vers auth ou public en restrict / no action : la purge des comptes du classeur echouerait.', n;
  end if;

  -- 7. Et dans l'autre sens : rien dans public ne dépend du suivi.
  select count(*) into n
    from pg_constraint k
    join pg_class src  on src.oid = k.conrelid
    join pg_namespace ns on ns.oid = src.relnamespace
    join pg_class dst  on dst.oid = k.confrelid
    join pg_namespace nd on nd.oid = dst.relnamespace
   where k.contype = 'f' and ns.nspname = 'public' and nd.nspname = 'suivi';
  if n > 0 then
    raise exception 'Une table du schema public pointe vers le suivi : a examiner.';
  end if;

  -- 8. Bascule de l'année au 4 juillet.
  if suivi.annee_scolaire(date '2026-07-03') <> '2025-2026'
     or suivi.annee_scolaire(date '2026-07-04') <> '2026-2027'
     or suivi.annee_scolaire(date '2027-01-15') <> '2026-2027' then
    raise exception 'suivi.annee_scolaire ne bascule pas au 4 juillet.';
  end if;

  -- 9. Statut : mêmes réponses que computeStatus() d'index.html.
  if suivi.statut_calcule(null, null, date '2026-11-17') <> 'planifie'
     or suivi.statut_calcule(date '2026-12-01', null, date '2026-11-17') <> 'planifie'
     or suivi.statut_calcule(date '2026-09-01', date '2026-10-01', date '2026-11-17') <> 'termine'
     or suivi.statut_calcule(date '2026-09-01', date '2027-06-30', date '2026-11-17') <> 'en_cours'
     or suivi.statut_calcule(date '2026-09-01', null, date '2026-11-17') <> 'en_cours'
     or suivi.statut_calcule(null, date '2027-06-30', date '2026-11-17') <> 'planifie'
     or suivi.statut_calcule(null, date '2026-10-01', date '2026-11-17') <> 'termine' then
    raise exception 'suivi.statut_calcule diverge de computeStatus() d''index.html.';
  end if;

  -- 10. Attribution des codes et date de modification, sur une année fictive
  --     (1900-1901), dans un sous-bloc annulé avant la fin.
  begin
    insert into suivi.projets (annee, categorie, nom)
      values ('1900-1901', 'LFT', 'essai verification') returning code into c1;
    insert into suivi.projets (annee, categorie, nom)
      values ('1900-1901', 'LFT', 'essai verification') returning code into c2;
    insert into suivi.projets (annee, categorie, nom)
      values ('1900-1901', 'ZOI', 'essai verification') returning code into c3;

    select modifie_le into avant from suivi.projets
     where annee = '1900-1901' and code = c1;
    update suivi.projets set supprime_le = now()
     where annee = '1900-1901' and code = c1;
    select modifie_le into apres1 from suivi.projets
     where annee = '1900-1901' and code = c1;
    update suivi.projets set nom = 'essai verification modifie'
     where annee = '1900-1901' and code = c1;
    select modifie_le into apres2 from suivi.projets
     where annee = '1900-1901' and code = c1;

    raise exception using errcode = 'P0001', message = 'essai_annule';
  exception when raise_exception then
    if sqlerrm <> 'essai_annule' then
      raise;
    end if;
  end;

  if c1 is distinct from 'LFT-001' or c2 is distinct from 'LFT-002'
     or c3 is distinct from 'ZOI-001' then
    raise exception 'Attribution des codes inattendue : %, %, % (attendu LFT-001, LFT-002, ZOI-001).', c1, c2, c3;
  end if;
  if avant is not null or apres1 is not null then
    raise exception 'modifie_le a bouge sur une mise a la corbeille : il ne doit suivre que le contenu de la fiche.';
  end if;
  if apres2 is null then
    raise exception 'modifie_le ne bouge pas quand le nom change.';
  end if;
  if exists (select 1 from suivi.projets where annee = '1900-1901') then
    raise exception 'Les fiches d''essai n''ont pas ete annulees : supprimer les lignes de l''annee 1900-1901.';
  end if;
end;
$$;

select 'OK' as verification_suivi;
