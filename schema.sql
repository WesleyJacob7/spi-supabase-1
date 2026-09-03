-- Dashboard SPI — schema do Supabase
-- Cole este arquivo inteiro no SQL Editor do Supabase (app.supabase.com >
-- projeto "dashboard-spi" > SQL Editor > New query) e clique em "Run".
--
-- É seguro rodar de novo mesmo se as tabelas já existirem (o DROP TABLE no
-- início limpa a versão anterior antes de recriar).

drop table if exists spi_records;
drop table if exists app_state;

-- Lançamentos semanais de SPI por projeto (um registro por projeto/semana).
create table spi_records (
  row_key            text primary key,      -- chave única do lançamento (gerada pelo painel)
  id                 text not null,         -- código do projeto (ex.: "240201")
  company            text not null,         -- "JKA" ou "Prestige"
  project            text not null,         -- nome do projeto
  scope              text not null,         -- escopo/etapa (ex.: "Framing")
  cr                 integer not null default 0,
  baseline_duration  integer,
  finish_variance    integer,
  schedule_duration  integer,
  spi                numeric,
  week               text not null,         -- rótulo da semana (ex.: "2025-38")
  date               date,
  pct_complete       numeric,
  band               text
);

create index spi_records_week_idx on spi_records (week);
create index spi_records_company_idx on spi_records (company);

-- Estado auxiliar do painel: projetos excluídos e senha trocada. Uma linha só
-- (id = 'global'), lida/gravada inteira a cada alteração.
create table app_state (
  id                 text primary key default 'global',
  excluded_projects  jsonb not null default '[]'::jsonb,
  auth_overrides     jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now()
);
insert into app_state (id) values ('global');

-- RLS: o painel usa a chave "anon public" direto do navegador (sem login de
-- verdade no Supabase — a tela de senha do painel é só uma barreira simples,
-- igual já era no modelo anterior). Por isso as políticas abaixo liberam
-- leitura e escrita para a chave anônima nas duas tabelas.
alter table spi_records enable row level security;
alter table app_state enable row level security;

create policy "spi_records: leitura pública" on spi_records for select using (true);
create policy "spi_records: escrita pública" on spi_records for insert with check (true);
create policy "spi_records: atualização pública" on spi_records for update using (true) with check (true);
create policy "spi_records: exclusão pública" on spi_records for delete using (true);

create policy "app_state: leitura pública" on app_state for select using (true);
create policy "app_state: atualização pública" on app_state for update using (true) with check (true);
