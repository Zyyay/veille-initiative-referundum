-- Correctifs de la première semaine. À exécuter une fois dans Supabase > SQL Editor, AVANT de déployer le code.

-- P3.2 : empreintes des histoires déjà signalées (déduplication entre alertes sur 24 h).
create table if not exists veille_histoires (
  id bigserial primary key,
  cree_le timestamptz not null default now(),
  sujet_id text not null,
  niveau text not null,                -- niveau de l'alerte qui a signalé l'histoire
  medias numeric not null,             -- médias pondérés de l'histoire à ce moment-là
  mots text[] not null default '{}',   -- mots distinctifs des titres
  guids text[] not null default '{}',  -- articles de l'histoire
  alerte_cle text
);
create index if not exists veille_histoires_sujet_date on veille_histoires (sujet_id, cree_le desc);
alter table veille_histoires enable row level security;

-- P1 : la normale peut être absente (aucun jour d'historique) ; on garde le nombre de jours utilisés.
alter table veille_scores alter column reference drop not null;
alter table veille_scores alter column ratio drop not null;
alter table veille_scores add column if not exists jours_reference integer;
alter table veille_scores add column if not exists medias_nationaux integer;

-- Purge : on ajoute les empreintes d'histoires (7 jours suffisent, la déduplication porte sur 24 h).
create or replace function veille_purge() returns void language sql as $$
  delete from veille_articles where publie_le < now() - interval '30 days';
  delete from veille_scores where calcule_le < now() - interval '90 days';
  delete from veille_wiki where jour < current_date - 60;
  delete from veille_histoires where cree_le < now() - interval '7 days';
$$;
