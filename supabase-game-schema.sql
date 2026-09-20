-- ============================================
-- H&A Game - جداول الحسابات والإحصائيات
-- طريقة التنفيذ: لوحة Supabase > SQL Editor > الصق > Run
-- ============================================

-- ===== جدول الحسابات (كل حساب = دعم) =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text default '',
  wins int not null default 0,
  losses int not null default 0,
  games_played int not null default 0,
  total_points int not null default 0,
  best_points int not null default 0,
  current_streak int not null default 0,
  best_streak int not null default 0,
  drawn_words int not null default 0,
  created_at timestamptz not null default now()
);

-- ===== جدول سجل المباريات =====
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null default '',
  player1 uuid references auth.users(id),
  player2 uuid references auth.users(id),
  winner uuid references auth.users(id),
  points_1 int not null default 0,
  points_2 int not null default 0,
  rounds int not null default 0,
  played_at timestamptz not null default now()
);

-- ===== إتاحة الوصول الآمن (Row Level Security) =====
alter table public.profiles enable row level security;
alter table public.games enable row level security;

-- أي مستخدم مسجل يستطيع قراءة الملفات الشخصية (لعرض أسماء اللاعبين)
drop policy if exists "profiles_read_all" on public.profiles;
create policy "profiles_read_all" on public.profiles
  for select using (true);

-- المستخدم يستطيع تحديث ملفه الشخصي فقط
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- تسجيل مباراة جديدة (من خادم اللعبة)
drop policy if exists "games_select_own" on public.games;
create policy "games_select_own" on public.games
  for select using (auth.uid() in (player1, player2));

drop policy if exists "games_insert_any" on public.games;
create policy "games_insert_any" on public.games
  for insert with check (true);

-- ===== أعمدة جديدة للداشبورد (سلسلة الفوز والكلمات المرسومة) =====
-- تُنفَّذ مرة واحدة فقط؛ لو كانت موجودة لن تتأثر (IF NOT EXISTS)
alter table public.profiles add column if not exists current_streak int not null default 0;
alter table public.profiles add column if not exists best_streak int not null default 0;
alter table public.profiles add column if not exists drawn_words int not null default 0;