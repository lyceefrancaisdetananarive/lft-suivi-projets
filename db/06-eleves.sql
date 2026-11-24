-- =====================================================================
-- Élèves concernés par un projet (18/11/2026). À jouer une fois dans
-- l'éditeur SQL du projet Suivi_Projets_LFT.
--
-- Décision de la direction du 18/11/2026. (La mention « AIPD réalisée et
-- avis du DPD obtenu » a été retirée le 24/11/2026 : à vérifier et à mettre
-- à jour avant tout nouvel usage.) Les noms d'élèves :
--   - viennent de Pronote, une liste par année scolaire ;
--   - ne sont lus QUE par les personnels connectés (enseignant, vie
--     scolaire, direction, administrateur), jamais par la vitrine publique ;
--   - le repère PAP n'est jamais transmis à un autre rôle que ceux-là.
-- Aucune donnée n'est écrite par ce script : la liste est importée à part,
-- depuis un fichier tenu hors du dépôt public.
-- =====================================================================

create table if not exists suivi.eleves (
  id       uuid primary key default gen_random_uuid(),
  annee    text not null,                       -- « 2026-2027 »
  classe   text not null,                       -- « 3M2 »
  nom      text not null,
  prenom   text not null,
  -- Mandats de l'année : délégué titulaire ou suppléant, éco-délégué,
  -- élu au conseil de la vie collégienne ou lycéenne.
  mandats  text[] not null default '{}'
           check (mandats <@ array['delegue_titulaire','delegue_suppleant','eco_delegue','cvc','cvl']::text[]),
  pap      boolean not null default false,      -- plan d'accompagnement personnalisé
  maj_le   timestamptz not null default now(),
  unique (annee, classe, nom, prenom)
);
create index if not exists eleves_annee_classe_idx on suivi.eleves (annee, classe);

-- Les élèves retenus pour un projet (quand seuls certains élèves d'une
-- classe sont concernés). Sans ligne ici, toute la classe l'est.
create table if not exists suivi.projet_eleves (
  projet_id uuid not null references suivi.projets(id) on delete cascade,
  eleve_id  uuid not null references suivi.eleves(id)  on delete cascade,
  primary key (projet_id, eleve_id)
);
create index if not exists projet_eleves_eleve_idx on suivi.projet_eleves (eleve_id);

-- Mêmes verrous que le reste du schéma : aucun accès anon ni authenticated,
-- seul le serveur (service_role) lit et écrit.
alter table suivi.eleves        enable row level security;
alter table suivi.projet_eleves enable row level security;
revoke all on suivi.eleves, suivi.projet_eleves from public, anon, authenticated;
grant select, insert, update, delete on suivi.eleves, suivi.projet_eleves to service_role;

-- Vérification : deux lignes, RLS active, aucun droit pour anon.
select c.relname, c.relrowsecurity as rls,
       has_table_privilege('anon', c.oid, 'select') as anon_lit
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'suivi' and c.relname in ('eleves', 'projet_eleves')
 order by 1;
