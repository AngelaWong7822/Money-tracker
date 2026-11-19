-- 錢錢簿第 3 期：每日快照 + Gemini 分析報告
-- 喺 Supabase（PM Management）→ SQL Editor 貼晒成段執行一次就得（重複執行都唔會出錯）

-- ── 每日快照：每人每日一行，用嚟同上個禮拜比較 ──
create table if not exists public.invest_snapshots (
    user_id uuid not null references auth.users (id) on delete cascade,
    snap_date date not null,
    net numeric not null,
    assets_total numeric not null,
    liabilities numeric not null,
    by_type jsonb not null default '{}'::jsonb,       -- { "fd": 169000, "cash": 30000, ... }（港幣）
    by_currency jsonb not null default '{}'::jsonb,   -- { "HKD": ..., "USD": ... }（港幣）
    created_at timestamptz not null default now(),
    primary key (user_id, snap_date)
);

alter table public.invest_snapshots enable row level security;

drop policy if exists "invest_snapshots: own rows read" on public.invest_snapshots;
create policy "invest_snapshots: own rows read" on public.invest_snapshots
    for select
    using (auth.uid() = user_id);

-- ── 分析報告 ──
create table if not exists public.invest_reports (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    source text not null check (source in ('manual', 'weekly')),
    content jsonb not null,     -- { headline, sections: [{ title, body }], watch_points: [] }
    facts jsonb not null,       -- 傳咗俾 Gemini 嘅數字（方便日後核對）
    model text,
    created_at timestamptz not null default now()
);

create index if not exists invest_reports_user_created_idx on public.invest_reports (user_id, created_at desc);

alter table public.invest_reports enable row level security;

drop policy if exists "invest_reports: own rows read" on public.invest_reports;
create policy "invest_reports: own rows read" on public.invest_reports
    for select
    using (auth.uid() = user_id);

drop policy if exists "invest_reports: own rows insert" on public.invest_reports;
create policy "invest_reports: own rows insert" on public.invest_reports
    for insert
    with check (auth.uid() = user_id);

drop policy if exists "invest_reports: own rows delete" on public.invest_reports;
create policy "invest_reports: own rows delete" on public.invest_reports
    for delete
    using (auth.uid() = user_id);
