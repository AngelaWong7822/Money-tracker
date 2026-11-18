-- 錢錢簿：資產記錄
-- 同 PM tracker、旅行筆記共用「PM Management」Supabase project，所以 table 全部加 invest_ 前綴，
-- 唔會郁到 projects / tasks / travel_trips。
-- 喺 Supabase → SQL Editor 貼晒成段執行一次就得（重複執行都唔會出錯）

-- ── 資產：一筆資產一行 ──
-- type:
--   cash      活期／儲蓄
--   fd        定期（amount = 本金）
--   stock     股票（用 shares × price 計市值；amount 唔用）
--   mpf       強積金
--   insurance 儲蓄保險（現金價值）
--   credit    信用卡欠款（amount = 欠款，總資產會減返）
--   other     其他
create table if not exists public.invest_assets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    type text not null check (type in ('cash', 'fd', 'stock', 'mpf', 'insurance', 'credit', 'other')),
    name text not null,
    institution text,
    currency text not null default 'HKD',
    amount numeric,
    -- 定期
    rate numeric,            -- 年息 %
    start_date date,
    maturity_date date,
    -- 股票
    symbol text,
    shares numeric,
    cost_price numeric,      -- 每股平均買入價
    last_price numeric,      -- 每股現價（第 1 期手動輸入，第 2 期自動更新）
    price_updated_at timestamptz,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted boolean not null default false
);

create index if not exists invest_assets_user_id_idx on public.invest_assets (user_id);

alter table public.invest_assets enable row level security;

drop policy if exists "invest_assets: own rows" on public.invest_assets;
create policy "invest_assets: own rows" on public.invest_assets
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ── 設定：每人一行（匯率等） ──
create table if not exists public.invest_settings (
    user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
    usd_hkd numeric not null default 7.8,
    updated_at timestamptz not null default now()
);

alter table public.invest_settings enable row level security;

drop policy if exists "invest_settings: own row" on public.invest_settings;
create policy "invest_settings: own row" on public.invest_settings
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
