-- =====================================================================
-- Suivi des projets d'établissement · Lycée Français de Tananarive
-- Schéma « suivi » dans un projet Supabase DÉDIÉ (région Francfort)
-- Migration 01 : création du compartiment, sans aucune donnée
--
-- UN PROJET À PART, PAS UN COIN DU CLASSEUR DE TECHNOLOGIE.
-- Décision du 17 novembre 2026. Le classeur de technologie a son propre
-- projet Supabase (Technologie_LFT), avec les données d'élèves mineurs. Le
-- suivi n'y est pas logé, pour une raison de sécurité précise : un serveur
-- qui gère des comptes détient la clé de service de son projet, et cette clé
-- ouvre TOUT le projet. Logé à côté du classeur, le moindre défaut du suivi
-- (140 utilisateurs, du code neuf) aurait donné sur les copies des élèves.
-- Deux projets, deux clés : aucune des deux applications ne peut atteindre
-- l'autre. Les comptes sont donc distincts : un professeur de technologie a
-- un compte sur chaque site, et un « mot de passe oublié » sur l'un ne
-- touche pas l'autre. Les sauvegardes et restaurations sont indépendantes.
--
-- POURQUOI UN SCHÉMA « suivi » PLUTÔT QUE public : le schéma public d'un
-- projet Supabase reçoit des droits par défaut pour anon et authenticated.
-- Un schéma à nous part fermé, et le futur suivi de parcours pourra avoir
-- le sien à côté.
--
-- Les clés qui partent du suivi vers un compte (auth.users) sont toutes en
-- « on delete cascade » ou « on delete set null » : supprimer un compte ne
-- doit jamais échouer à cause d'une fiche ou d'un commentaire.
--
-- MODÈLE DE SÉCURITÉ : le même que celui du classeur.
-- Le navigateur ne parle jamais directement à Supabase. Toutes les lectures
-- et écritures passent par des fonctions serveur (/api/) qui utilisent la clé
-- de service et vérifient les droits en JavaScript relu. On n'accorde donc
-- RIEN aux rôles anon et authenticated. Le Row Level Security est activé sur
-- chaque table, sans aucune politique : c'est une seconde barrière, qui
-- répond « zéro ligne » si un jour quelque chose s'authentifiait directement.
--
-- RÈGLE D'ÉCRITURE : SQL INTÉGRALEMENT ASCII HORS COMMENTAIRES.
-- Coller du texte accentué dans l'éditeur SQL de Supabase depuis le
-- navigateur abîme l'UTF-8 (« élève » devient « √©l√®ve »). Les valeurs
-- stockées par contrainte sont donc des codes sans accent (« LFT »,
-- « en_cours », « vie_scolaire ») ; les libellés accentués sont l'affaire de
-- l'interface. Les commentaires gardent leurs accents : Postgres ne les
-- stocke pas.
--
-- REJOUABLE : « if not exists », « create or replace », « drop ... if
-- exists ». Rejouer ce fichier ne crée pas de doublon et n'efface rien.
--
-- APRÈS L'EXÉCUTION, DEUX GESTES :
--   a. Tableau de bord > Project Settings > Data API > Exposed schemas :
--      ajouter « suivi ». Sans cela, les fonctions serveur reçoivent
--      « The schema must be one of the following: public, ... ». L'exposition
--      ne donne rien au navigateur : anon et authenticated n'ont aucun droit
--      sur ce schéma.
--   b. Exécuter db/02-verification-suivi.sql, qui doit finir sur « OK ».
-- =====================================================================

create schema if not exists suivi;

-- Par défaut, Postgres laisse tout le monde (PUBLIC) utiliser un schéma
-- nouveau et exécuter ses fonctions. On ferme tout, puis on ouvre au seul
-- rôle des fonctions serveur, en fin de fichier.
revoke all on schema suivi from public, anon, authenticated;

-- =====================================================================
-- ANNÉE SCOLAIRE
--
-- Même règle que Code.gs et index.html depuis la v7 : l'année bascule le
-- 4 juillet, à l'heure d'Antananarivo.
--   avant le 4 juillet  -> (y-1)-y
--   à partir du 4 juillet -> y-(y+1)
-- Une seule source de vérité côté serveur : les fonctions /api/ appellent
-- suivi.annee_courante() au lieu de refaire le calcul.
-- =====================================================================

create or replace function suivi.annee_scolaire(jour date) returns text
  language sql immutable set search_path = pg_catalog, pg_temp
as $$
  select case
    when (extract(month from jour)::int, extract(day from jour)::int) >= (7, 4)
      then format('%s-%s', extract(year from jour)::int, extract(year from jour)::int + 1)
    else format('%s-%s', extract(year from jour)::int - 1, extract(year from jour)::int)
  end;
$$;

create or replace function suivi.annee_courante() returns text
  language sql stable set search_path = pg_catalog, pg_temp
as $$
  select suivi.annee_scolaire((now() at time zone 'Indian/Antananarivo')::date);
$$;

-- =====================================================================
-- MEMBRES
--
-- Une ligne par personne autorisée sur le suivi, liée au compte commun
-- (auth.users). C'est l'équivalent de l'onglet « Utilisateurs », sans les
-- colonnes qui posaient problème :
--   - plus de Mot_de_Passe ni de Mdp_Initial : le mot de passe vit dans
--     auth.users, haché par Supabase. Aucun mot de passe en clair n'existe
--     plus nulle part, ni dans la base, ni dans les sauvegardes ;
--   - plus de Session_Token ni de Reset_Token : la session est un cookie
--     signé par /api/, la réinitialisation passe par Supabase Auth, comme
--     sur le classeur.
--
-- Plus d'onglet « Emails_Autorises » non plus. Autoriser quelqu'un, c'est
-- créer sa ligne ici, avec un mot de passe aléatoire que personne ne connaît.
-- La personne active son compte par « Première connexion » : un lien reçu
-- dans sa boîte, ce qui prouve qu'elle possède l'adresse. C'était la faille
-- de l'ancienne inscription : elle remettait un mot de passe à quiconque
-- tapait une adresse autorisée, sans rien vérifier.
--
-- RÔLE « eleve » : prévu pour le futur suivi de parcours. Aucun élève n'est
-- inscrit par cette migration. L'ouvrir ne donne rien en soi : ce que chaque
-- rôle peut faire est décidé dans /api/.
--
-- CONTRAT mdp_provisoire POUR LES COMPTES COMMUNS AU CLASSEUR.
-- L'état « mot de passe provisoire » appartient au compte, pas au site. Le
-- suivi n'écrit jamais dans public.profils. En conséquence :
--   - quand on inscrit au suivi une personne qui a déjà un compte sur le
--     classeur (Franck, par exemple), on recopie l'état de son profil :
--     mdp_provisoire = false si elle a déjà choisi son mot de passe. Elle se
--     connecte alors au suivi avec le mot de passe qu'elle connaît déjà ;
--   - le script d'import est chargé de ce point, pas une contrainte, puisque
--     cette table ne doit pas dépendre de public.profils.
--
-- mdp_pose_le : même contrat que dans le classeur. NULL veut dire « aucun
-- mot de passe provisoire n'a été remis à quelqu'un », donc pas de
-- péremption. Tout chemin qui remet un mot de passe CONNU à un humain doit
-- écrire cette date à l'instant de la remise.
-- =====================================================================

create table if not exists suivi.membres (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text not null unique,
  role               text not null,
  nom                text,
  prenom             text,
  actif              boolean not null default true,
  mdp_provisoire     boolean not null default true,
  mdp_pose_le        timestamptz,
  cree_le            timestamptz not null default now(),
  derniere_connexion timestamptz,

  constraint membres_role_connu check (
    role in ('admin', 'direction', 'vie_scolaire', 'enseignant', 'eleve')
  ),
  -- Une adresse en minuscules : l'ancienne base comparait sans casse, la
  -- nouvelle compare à l'identique. On normalise à l'entrée, une fois.
  constraint membres_email_minuscules check (email = lower(email)),
  -- Même garde-fou que le classeur : une adresse d'élève ne peut jamais
  -- porter un rôle de personnel. Piège de LIKE : « %@egd.mg » n'attrape pas
  -- « prenom.nom@eleve.egd.mg », d'où les deux domaines écrits.
  constraint membres_domaine_coherent check (
    (email like '%@egd.mg' or email like '%@eleve.egd.mg')
    and (role = 'eleve' or email not like '%@eleve.egd.mg')
  )
);

-- =====================================================================
-- PROJETS
--
-- Une seule table pour toutes les années, avec une colonne « annee ».
-- Les onglets datés se justifiaient par les limites de Google Sheets
-- (lecture de la feuille entière à chaque appel) ; elles n'existent plus.
-- Pour l'utilisateur, rien ne change : année courante, années archivées en
-- lecture seule, bascule du 4 juillet, reconduction.
--
-- Correspondance avec les 28 colonnes de l'onglet Projets_<annee> :
--   ID_Projet               -> code (unique dans son année)
--   Nom_Projet              -> nom
--   Categorie               -> categorie (code sans accent, voir plus bas)
--   Echelle                 -> echelle (texte libre, comme aujourd'hui)
--   Axe_Projet_Etablissement-> axe (1, 2 ou 3)
--   Sous_Axe                -> sous_axe
--   Disciplines_Mobilisees  -> disciplines
--   Niveaux_Concernes       -> niveaux
--   Description             -> description
--   Objectifs_Pedagogiques  -> objectifs
--   Statut                  -> SUPPRIMÉ : il était déjà recalculé à
--                              l'affichage depuis les dates, et la colonne
--                              stockée était incohérente (27 vides,
--                              « Planifie » et « Planifié » mêlés). Voir la
--                              fonction suivi.statut_calcule().
--   Priorite                -> priorite (haute, moyenne, basse)
--   Date_Debut, Date_Fin    -> date_debut, date_fin
--   Partenariats            -> partenariats
--   Ressources_Necessaires  -> ressources
--   Modalite_Valorisation   -> valorisation
--   Enseignant_Referent     -> referents (texte affiché) ET table
--                              suivi.projet_referents (droits), voir plus bas
--   Created_By              -> cree_par (+ cree_par_nom, instantané)
--   Deleted, _By, _Date     -> supprime_le, supprime_par (corbeille)
--   Locked, _By, _Date      -> verrouille_le, verrouille_par
--   Last_Modified_By, _Date -> modifie_par, modifie_le
--   Reconduit_De            -> reconduit_de (lien vers le projet source)
--
-- CATÉGORIES : les codes reprennent les préfixes d'identifiant existants.
--   LFT  = Projet LFT             ZOI  = Projet Zone OI
--   AEFE = Projet AEFE            INST = Projet institutionnel
--   CLUB = Clubs et activités     INT  = Projets de l'Internat
--
-- LE CODE NE SUIT PAS LA CATÉGORIE, ET C'EST VOULU. Le code est attribué à
-- la création et ne change plus, même si la catégorie change ensuite. Deux
-- projets de 2025-2026 sont dans ce cas (code LFT-, catégorie AEFE). Une
-- contrainte « préfixe = catégorie » rejetterait ces deux fiches à l'import
-- et casserait les liens déjà partagés.
-- =====================================================================

create table if not exists suivi.projets (
  id             uuid primary key default gen_random_uuid(),
  annee          text not null,
  code           text not null,
  categorie      text not null,
  nom            text not null,
  echelle        text,
  axe            smallint,
  sous_axe       text,
  disciplines    text,
  niveaux        text,
  description    text,
  objectifs      text,
  priorite       text,
  date_debut     date,
  date_fin       date,
  partenariats   text,
  ressources     text,
  valorisation   text,
  referents      text,

  cree_par       uuid references suivi.membres(id) on delete set null,
  -- Instantané du nom au moment de la création : la fiche garde son auteur
  -- lisible même si le compte disparaît un jour.
  cree_par_nom   text,
  cree_le        timestamptz not null default now(),
  modifie_par    uuid references suivi.membres(id) on delete set null,
  modifie_le     timestamptz,
  supprime_le    timestamptz,
  supprime_par   uuid references suivi.membres(id) on delete set null,
  verrouille_le  timestamptz,
  verrouille_par uuid references suivi.membres(id) on delete set null,
  reconduit_de   uuid references suivi.projets(id) on delete set null,

  constraint projets_annee_format check (
    annee ~ '^[0-9]{4}-[0-9]{4}$'
    and right(annee, 4)::int = left(annee, 4)::int + 1
  ),
  constraint projets_code_format check (
    code ~ '^(LFT|ZOI|AEFE|INST|CLUB|INT)-[0-9]{3,}$'
  ),
  constraint projets_code_unique_par_annee unique (annee, code),
  constraint projets_categorie_connue check (
    categorie in ('LFT', 'ZOI', 'AEFE', 'INST', 'CLUB', 'INT')
  ),
  constraint projets_nom_present check (length(btrim(nom)) between 1 and 300),
  constraint projets_axe_connu check (axe between 1 and 3),
  constraint projets_priorite_connue check (
    priorite in ('haute', 'moyenne', 'basse')
  ),
  constraint projets_dates_ordonnees check (
    date_debut is null or date_fin is null or date_fin >= date_debut
  ),
  -- Un projet ne se reconduit pas vers lui-même.
  constraint projets_reconduction_distincte check (reconduit_de <> id)
);

-- Lecture de base : les projets vivants d'une année.
create index if not exists projets_annee_idx
  on suivi.projets (annee) where supprime_le is null;
create index if not exists projets_cree_par_idx on suivi.projets (cree_par);

-- Une source n'est reconduite qu'une fois par année cible. C'est ce que
-- faisait l'index « Reconduit_De » relu avant chaque écriture dans Code.gs,
-- mais garanti ici par la base, même en cas de double clic simultané.
create unique index if not exists projets_reconduction_unique
  on suivi.projets (reconduit_de, annee) where reconduit_de is not null;

-- ------------------------------------------------ attribution du code
-- Si /api/ insère un projet sans code, la base attribue le suivant dans
-- l'année, pour le préfixe de la catégorie : LFT-001, LFT-002...
-- Le verrou consultatif sérialise deux créations simultanées dans la même
-- année et la même catégorie : Google Sheets n'offrait pas cette garantie.
-- La contrainte d'unicité reste le filet en dernier ressort.
create or replace function suivi.attribuer_code() returns trigger
  language plpgsql set search_path = pg_catalog, pg_temp
as $$
declare
  suivant int;
begin
  if new.code is null or new.code = '' then
    perform pg_advisory_xact_lock(
      hashtext('suivi.projets/' || new.annee || '/' || new.categorie));
    select coalesce(max(split_part(code, '-', 2)::int), 0) + 1
      into suivant
      from suivi.projets
     where annee = new.annee
       and split_part(code, '-', 1) = new.categorie;
    new.code := new.categorie || '-' || lpad(suivant::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists projets_code on suivi.projets;
create trigger projets_code
  before insert on suivi.projets
  for each row execute function suivi.attribuer_code();

-- ------------------------------------------------ date de modification
-- modifie_le n'avance que si le CONTENU de la fiche change. Mettre à la
-- corbeille, restaurer ou verrouiller n'est pas « modifier la fiche » : ce
-- sont des actions tracées dans leurs propres colonnes et dans le journal.
-- modifie_par, lui, reste écrit par /api/, seule à connaître la personne
-- (la clé de service n'a pas d'auth.uid()).
create or replace function suivi.dater_modification() returns trigger
  language plpgsql set search_path = pg_catalog, pg_temp
as $$
declare
  hors_contenu text[] := array[
    'modifie_par', 'modifie_le', 'supprime_le', 'supprime_par',
    'verrouille_le', 'verrouille_par'];
begin
  if (to_jsonb(new) - hors_contenu) is distinct from (to_jsonb(old) - hors_contenu) then
    new.modifie_le := now();
  end if;
  return new;
end;
$$;

drop trigger if exists projets_modification on suivi.projets;
create trigger projets_modification
  before update on suivi.projets
  for each row execute function suivi.dater_modification();

-- ------------------------------------------------ statut calculé
-- Reprise EXACTE de computeStatus() d'index.html, pour que rien ne bouge à
-- l'écran au moment de la bascule :
--   ni début ni fin            -> planifie
--   jour < début               -> planifie
--   jour > fin                 -> termine
--   début renseigné, jour >= début -> en_cours
--   sinon (fin seule, pas dépassée) -> planifie
create or replace function suivi.statut_calcule(debut date, fin date, jour date)
  returns text
  language sql immutable set search_path = pg_catalog, pg_temp
as $$
  select case
    when debut is null and fin is null then 'planifie'
    when debut is not null and jour < debut then 'planifie'
    when fin is not null and jour > fin then 'termine'
    when debut is not null and jour >= debut then 'en_cours'
    else 'planifie'
  end;
$$;

-- =====================================================================
-- RÉFÉRENTS
--
-- Aujourd'hui, être « enseignant référent » donne le droit de modifier et
-- de mettre à la corbeille une fiche, et ce droit repose sur une
-- comparaison de noms dans du texte libre (isReferentOf). Fragile : une
-- faute de frappe retire le droit, un homonyme le donne.
--
-- Désormais, le droit passe par cette table, qui désigne des comptes.
-- La colonne projets.referents garde le texte affiché, parce qu'il cite
-- parfois des personnes sans compte (intervenants, collègues partis).
-- Le script d'import rapproche les noms existants des membres et produit
-- la liste des cas qu'il n'a pas su trancher, à valider à la main.
-- =====================================================================

create table if not exists suivi.projet_referents (
  projet_id uuid not null references suivi.projets(id) on delete cascade,
  membre_id uuid not null references suivi.membres(id) on delete cascade,
  primary key (projet_id, membre_id)
);
create index if not exists projet_referents_membre_idx
  on suivi.projet_referents (membre_id);

-- =====================================================================
-- COMMENTAIRES
--
-- Un fil par projet. L'année n'est plus une colonne : elle est celle du
-- projet, ce qui supprime le risque de commentaire rangé dans la mauvaise
-- année. auteur_nom est un instantané, comme Nom_Prenom aujourd'hui.
-- =====================================================================

create table if not exists suivi.commentaires (
  id         bigserial primary key,
  projet_id  uuid not null references suivi.projets(id) on delete cascade,
  auteur_id  uuid references suivi.membres(id) on delete set null,
  auteur_nom text not null,
  texte      text not null,
  cree_le    timestamptz not null default now(),

  constraint commentaires_longueur check (length(btrim(texte)) between 1 and 1000)
);
create index if not exists commentaires_projet_idx
  on suivi.commentaires (projet_id, cree_le);

-- =====================================================================
-- TENTATIVES
--
-- Verrou de compte, sur le modèle du classeur : une ligne par échec,
-- comptée par COMPTE et non par adresse IP (le lycée sort par une seule IP
-- publique ; un verrou par IP punirait tout le personnel).
--
--   'connexion' : mauvais mot de passe sur la page de connexion ;
--   'ressaisie' : mot de passe retapé pour confirmer une action lourde ;
--   'oubli'     : demande de lien « mot de passe oublié ». Elle n'était
--                 limitée par rien dans l'ancienne version : n'importe qui
--                 pouvait faire envoyer cent courriels à un collègue.
-- Les trois compteurs restent séparés pour qu'un inconnu ne puisse pas
-- verrouiller à distance une action d'un collègue déjà connecté.
-- =====================================================================

create table if not exists suivi.tentatives (
  id        bigserial primary key,
  membre_id uuid not null references suivi.membres(id) on delete cascade,
  origine   text not null default 'connexion',
  quand     timestamptz not null default now(),

  constraint tentatives_origine_connue check (
    origine in ('connexion', 'ressaisie', 'oubli')
  )
);
create index if not exists tentatives_idx
  on suivi.tentatives (membre_id, origine, quand desc);

-- =====================================================================
-- JOURNAL
--
-- L'équivalent de l'onglet « Logs ». membre_id peut être vide : un échec de
-- connexion sur une adresse inconnue se journalise sans compte.
-- email et role sont des instantanés, pour que l'historique reste lisible.
-- pays et ville viennent, comme aujourd'hui, du fuseau horaire du poste,
-- jamais d'une géolocalisation par IP.
--
-- Conservation : un an, comme le journal du classeur. La purge sera écrite
-- dans une migration à part, jouée à la main, pas ici.
-- =====================================================================

create table if not exists suivi.journal (
  id         bigserial primary key,
  quand      timestamptz not null default now(),
  membre_id  uuid references suivi.membres(id) on delete set null,
  email      text,
  role       text,
  action     text not null,
  detail     text,
  pays       text,
  ville      text,
  os         text,
  navigateur text,
  appareil   text
);
create index if not exists journal_quand_idx on suivi.journal (quand desc);
create index if not exists journal_membre_idx on suivi.journal (membre_id, quand desc);

-- =====================================================================
-- VUE PUBLIQUE
--
-- Ce qu'un visiteur sans compte a le droit de lire, défini UNE fois, en
-- base, au lieu d'être filtré dans chaque fonction serveur.
--
-- Elle corrige une fuite relevée à l'audit de septembre 2026 : la liste
-- publique renvoyait les adresses de l'auteur et du dernier modificateur
-- de chaque fiche, que n'importe qui pouvait moissonner. Ici, aucune
-- adresse, aucun identifiant de compte. Les fiches en corbeille sont
-- exclues.
--
-- Le statut est calculé au jour d'Antananarivo, pas à celui du serveur.
-- security_invoker : la vue s'exécute avec les droits de l'appelant, et
-- n'ouvre donc rien que l'appelant n'aurait pas déjà.
-- =====================================================================

create or replace view suivi.projets_publics
  with (security_invoker = true)
as
select
  p.id,
  p.annee,
  p.code,
  p.categorie,
  p.nom,
  p.echelle,
  p.axe,
  p.sous_axe,
  p.disciplines,
  p.niveaux,
  p.description,
  p.objectifs,
  p.priorite,
  p.date_debut,
  p.date_fin,
  p.partenariats,
  p.ressources,
  p.valorisation,
  p.referents,
  suivi.statut_calcule(p.date_debut, p.date_fin,
    (now() at time zone 'Indian/Antananarivo')::date) as statut,
  (p.verrouille_le is not null) as verrouille,
  p.reconduit_de,
  p.cree_le,
  p.modifie_le
from suivi.projets p
where p.supprime_le is null;

-- =====================================================================
-- ROW LEVEL SECURITY : activé partout, AUCUNE politique.
--
-- Avec le RLS actif et aucune politique, anon et authenticated ne voient
-- rien, même si un droit leur était accordé par erreur un jour. La clé de
-- service des fonctions /api/ contourne le RLS (rôle bypassrls) : c'est
-- elle, et elle seule, qui lit et écrit.
-- =====================================================================

alter table suivi.membres          enable row level security;
alter table suivi.projets          enable row level security;
alter table suivi.projet_referents enable row level security;
alter table suivi.commentaires     enable row level security;
alter table suivi.tentatives       enable row level security;
alter table suivi.journal          enable row level security;

-- =====================================================================
-- PRIVILÈGES
--
-- Le projet a « Automatically expose new tables » DÉCOCHÉ : aucune table
-- nouvelle n'est accordée à personne, pas même à service_role. Sans les
-- clauses ci-dessous, chaque appel des fonctions serveur répondrait
-- « permission denied for table membres » avec une clé pourtant valide.
-- C'est la panne déjà rencontrée sur le classeur (voir son db/01).
--
-- Les fonctions sont exécutables par PUBLIC à leur création : on retire ce
-- droit, puis on le rend au seul service_role.
-- =====================================================================

grant usage on schema suivi to service_role;
grant select, insert, update, delete on all tables in schema suivi to service_role;
grant usage, select on all sequences in schema suivi to service_role;

revoke all on all tables    in schema suivi from public, anon, authenticated;
revoke all on all sequences in schema suivi from public, anon, authenticated;
revoke all on all functions in schema suivi from public, anon, authenticated;
grant execute on all functions in schema suivi to service_role;

-- Pour les tables, séquences et fonctions créées PLUS TARD dans ce schéma,
-- sans quoi la prochaine migration reproduirait exactement la même panne.
alter default privileges in schema suivi
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema suivi
  grant usage, select on sequences to service_role;
alter default privileges in schema suivi
  revoke execute on functions from public;
alter default privileges in schema suivi
  grant execute on functions to service_role;
