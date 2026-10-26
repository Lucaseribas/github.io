-- Libreta de gastos: tabla única de datos, con seguridad por usuario (RLS).
-- Pegá este archivo completo en Supabase > SQL Editor > New query > Run.

create table if not exists public.items (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('tx', 'card')),
  data       jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists items_user_id_idx on public.items using btree (user_id);

-- Seguridad: cada persona solo accede a sus propias filas.
alter table public.items enable row level security;

revoke all on table public.items from anon, authenticated;
grant select, insert, update, delete on table public.items to authenticated;

drop policy if exists "items_select_own" on public.items;
drop policy if exists "items_insert_own" on public.items;
drop policy if exists "items_update_own" on public.items;
drop policy if exists "items_delete_own" on public.items;

create policy "items_select_own" on public.items
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "items_insert_own" on public.items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "items_update_own" on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "items_delete_own" on public.items
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Cambios en vivo entre dispositivos (si ya estaba agregada, este paso da un aviso y se puede ignorar).
alter publication supabase_realtime add table public.items;
