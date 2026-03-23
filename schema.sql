-- ════════════════════════════════════════════════════════════════════════════
--  ZALAVRAI SYSTÈME — Schema Supabase v3 FINAL
--  
--  ▶ INSTRUCTIONS :
--  1. Supabase → SQL Editor → New Query
--  2. Sélectionner TOUT (Ctrl+A) → Coller ce fichier
--  3. Cliquer Run ▶ en bas à droite
--  4. Résultat attendu : 6 lignes dans le tableau final
-- ════════════════════════════════════════════════════════════════════════════

-- ── ÉTAPE 1 : Créer les tables ───────────────────────────────────────────────

create table if not exists utilisateurs (
  id               text primary key,
  username         text not null default '',
  password         text not null default '',
  role             text not null default 'Agent',
  manager_username text default '',
  actif            boolean default true,
  photo            text default '',
  date_creation    text default ''
);

create table if not exists clients (
  id              text primary key,
  nom_complet     text default '',
  agent_username  text default '',
  photo           text default '',
  lieu_activite   text default '',
  activite        text default '',
  telephone       text default '',
  cin             text default '',
  genre           text default '',
  actif           boolean default true,
  actif_depuis    text default '',
  date_creation   text default '',
  carte_creee     text default 'Non',
  flag_manuel     text default null,
  note_interne    text default '',
  vente_bloquee   boolean default false
);

create table if not exists ventes (
  id                  text primary key,
  agent_username      text default '',
  vendu_par           text default '',
  client_id           text default '',
  produit             text default '',
  montant_total       numeric default 0,
  acompte30           numeric default 0,
  solde70             numeric default 0,
  montant_journalier  numeric default 0,
  duree_jours         integer default 30,
  date_debut          text default '',
  date_fin            text default '',
  date_creation       text default '',
  note                text default ''
);

create table if not exists paiements (
  id              text primary key,
  vente_id        text default '',
  agent_username  text default '',
  montant_paye    numeric default 0,
  date_paiement   text default '',
  date_creation   text default '',
  note            text default ''
);

create table if not exists stock (
  id               text primary key,
  source_username  text default '',
  dest_username    text default '',
  produit          text default '',
  quantite         integer default 0,
  prix_unitaire    numeric default 0,
  date_mouvement   text default ''
);

create table if not exists signalements (
  id               text primary key,
  type             text default '',
  ref_id           text default '',
  reporter         text default '',
  description      text default '',
  statut           text default 'attente',
  date_creation    text default '',
  date_resolution  text default ''
);

-- ── ÉTAPE 2 : Activer la sécurité (RLS) ─────────────────────────────────────

alter table utilisateurs  enable row level security;
alter table clients        enable row level security;
alter table ventes         enable row level security;
alter table paiements      enable row level security;
alter table stock          enable row level security;
alter table signalements   enable row level security;

-- ── ÉTAPE 3 : Créer les règles d'accès ──────────────────────────────────────
-- NOTE: using (true) = accès ouvert à tous (auth gérée dans l'app ZALAVRAI)

drop policy if exists "anon_all_utilisateurs"  on utilisateurs;
drop policy if exists "anon_all_clients"        on clients;
drop policy if exists "anon_all_ventes"         on ventes;
drop policy if exists "anon_all_paiements"      on paiements;
drop policy if exists "anon_all_stock"          on stock;
drop policy if exists "anon_all_signalements"   on signalements;
drop policy if exists "allow_all_utilisateurs"  on utilisateurs;
drop policy if exists "allow_all_clients"        on clients;
drop policy if exists "allow_all_ventes"         on ventes;
drop policy if exists "allow_all_paiements"      on paiements;
drop policy if exists "allow_all_stock"          on stock;
drop policy if exists "allow_all_signalements"   on signalements;

create policy "allow_all_utilisateurs"  on utilisateurs  for all using (true) with check (true);
create policy "allow_all_clients"       on clients        for all using (true) with check (true);
create policy "allow_all_ventes"        on ventes         for all using (true) with check (true);
create policy "allow_all_paiements"     on paiements      for all using (true) with check (true);
create policy "allow_all_stock"         on stock          for all using (true) with check (true);
create policy "allow_all_signalements"  on signalements   for all using (true) with check (true);

-- ── ÉTAPE 4 : Index pour les performances ───────────────────────────────────

create index if not exists idx_clients_agent   on clients(agent_username);
create index if not exists idx_ventes_client   on ventes(client_id);
create index if not exists idx_ventes_agent    on ventes(agent_username);
create index if not exists idx_paiements_vente on paiements(vente_id);
create index if not exists idx_paiements_agent on paiements(agent_username);
create index if not exists idx_stock_source    on stock(source_username);
create index if not exists idx_stock_dest      on stock(dest_username);

-- ── VÉRIFICATION FINALE ──────────────────────────────────────────────────────
-- Doit afficher 6 lignes si tout est correct

select 
  table_name as "Table",
  (select count(*) from information_schema.columns c 
   where c.table_name = t.table_name 
   and c.table_schema = 'public') as "Colonnes"
from information_schema.tables t
where table_schema = 'public' 
  and table_name in ('utilisateurs','clients','ventes','paiements','stock','signalements')
order by table_name;
