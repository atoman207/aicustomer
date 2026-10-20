// Supabase のテーブル定義（SQL Editor に貼り付けて 1 回実行）。supabase/schema.sql は npm run db:schema でここから作る
export const SCHEMA_SQL = `-- 一畳屋 AI相談窓口：Supabase のテーブル（SQL Editor に貼り付けて 1 回実行してください。何度実行しても安全です）
create extension if not exists pgcrypto;

-- 管理画面で追加した情報・アップロードしたファイル（追加の履歴）
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('text', 'file')),
  name text not null,
  mime text,
  size integer,
  category text not null default 'auto',
  status text not null default 'processing',
  entries_count integer not null default 0,
  error text,
  storage_path text,
  excerpt text,
  created_at timestamptz not null default now()
);

-- AI の回答情報源（顧客対応マニュアル・会社情報・ホームページ・管理画面で追加・アップロード）
create table if not exists public.knowledge (
  id text primary key,
  origin text not null check (origin in ('manual', 'company', 'website', 'admin', 'upload')),
  category text not null default '',
  title text not null,
  content text not null,
  keywords jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  anchors jsonb not null default '[]'::jsonb,
  note text,
  price_table jsonb,
  source_id uuid references public.knowledge_sources (id) on delete cascade,
  enabled boolean not null default true,
  edited boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists knowledge_origin_idx on public.knowledge (origin, position);
create index if not exists knowledge_source_idx on public.knowledge (source_id);

-- 会話履歴（文字・声・電話・LINE のすべての質問と回答）
create table if not exists public.conversations (
  id text primary key,
  channel text not null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  estimate_id text,
  messages jsonb not null default '[]'::jsonb,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists conversations_updated_idx on public.conversations (updated_at desc);

-- 見積の受付
create table if not exists public.estimates (
  id text primary key,
  received_at timestamptz not null default now(),
  channel text,
  status text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists estimates_received_idx on public.estimates (received_at desc);

-- 設定・電話の会話状態・学習済みの回答・利用状況など
create table if not exists public.app_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

-- 公開キー（publishable）では読み書きできないようにする（サーバーの secret キーだけが使えます）
alter table public.knowledge_sources enable row level security;
alter table public.knowledge enable row level security;
alter table public.conversations enable row level security;
alter table public.estimates enable row level security;
alter table public.app_kv enable row level security;

-- アップロードしたファイルの保存先（非公開）
insert into storage.buckets (id, name, public) values ('knowledge-files', 'knowledge-files', false) on conflict (id) do nothing;

notify pgrst, 'reload schema';
`;
