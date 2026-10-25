-- Bot de veille Doléances : tables de travail.
-- À exécuter une fois dans Supabase > SQL Editor.
-- Les tables sont réservées au bot (clé service_role) : RLS activé sans aucune policy = aucun accès public.

create table if not exists veille_articles (
  id bigserial primary key,
  sujet_id text not null,
  guid text not null,
  titre text not null,
  source_nom text,
  source_domaine text,
  lien text,
  publie_le timestamptz not null,
  collecte_le timestamptz not null default now(),
  unique (sujet_id, guid)
);
create index if not exists veille_articles_sujet_date on veille_articles (sujet_id, publie_le desc);

create table if not exists veille_wiki (
  article text not null,
  jour date not null,
  vues integer not null,
  primary key (article, jour)
);

create table if not exists veille_scores (
  id bigserial primary key,
  calcule_le timestamptz not null default now(),
  sujet_id text not null,
  articles_fenetre integer not null,
  histoires integer not null,
  medias numeric not null,
  reference numeric not null,
  ratio numeric not null,
  bonus_wiki boolean not null default false,
  historique_jours integer not null default 0,
  niveau text
);
create index if not exists veille_scores_sujet_date on veille_scores (sujet_id, calcule_le desc);

create table if not exists veille_alertes (
  id bigserial primary key,
  cree_le timestamptz not null default now(),
  cle text not null unique,
  sujet_id text,
  type text not null,          -- presse | wiki | agenda | rappel | vote | agenda_modif | budget
  niveau text not null,        -- haute | moyenne | basse | info
  mention boolean not null default false,
  statut text not null,        -- envoyee | en_attente | ecartee
  envoyee_le timestamptz,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists veille_alertes_statut on veille_alertes (statut, cree_le desc);
create index if not exists veille_alertes_sujet on veille_alertes (sujet_id, type, cree_le desc);

create table if not exists veille_agenda (
  uid text primary key,
  debut timestamptz not null,
  lieu text,
  type text,                   -- seance | commission | autre
  objet text,
  sujets text[] not null default '{}',
  etat text,
  vu_le timestamptz not null default now(),
  maj_le timestamptz not null default now()
);

create table if not exists veille_etat (
  cle text primary key,
  valeur jsonb not null,
  maj_le timestamptz not null default now()
);

alter table veille_articles enable row level security;
alter table veille_wiki enable row level security;
alter table veille_scores enable row level security;
alter table veille_alertes enable row level security;
alter table veille_agenda enable row level security;
alter table veille_etat enable row level security;

-- Purge : garder 30 jours d'articles et 90 jours de scores (lancée par le bot une fois par jour).
create or replace function veille_purge() returns void language sql as $$
  delete from veille_articles where publie_le < now() - interval '30 days';
  delete from veille_scores where calcule_le < now() - interval '90 days';
  delete from veille_wiki where jour < current_date - 60;
$$;
