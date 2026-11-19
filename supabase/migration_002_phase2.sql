-- 錢錢簿第 2 期：自訂規則 + email 提醒記錄
-- 喺 Supabase（PM Management）→ SQL Editor 貼晒成段執行一次就得（重複執行都唔會出錯）

-- ── 規則同提醒設定（留空 = 唔用嗰條規則） ──
alter table public.invest_settings add column if not exists min_cash numeric;            -- 活期最少要有（港幣）
alter table public.invest_settings add column if not exists max_stock_pct numeric;       -- 單一股票最多佔總資產 %
alter table public.invest_settings add column if not exists max_usd_pct numeric;         -- 美元最多佔總資產 %
alter table public.invest_settings add column if not exists fd_remind_days integer not null default 7;  -- 定期到期前幾多日提
alter table public.invest_settings add column if not exists email_enabled boolean not null default true;
alter table public.invest_settings add column if not exists usd_hkd_updated_at timestamptz;

-- ── 已寄出嘅提醒（避免同一件事日日寄） ──
create table if not exists public.invest_notifications (
    id bigint generated always as identity primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    kind text not null,          -- 'fd' 或者 'rule'
    ref text not null,           -- 例如 'fd:<asset id>:7'、'rule:max_usd_pct'
    sent_at timestamptz not null default now()
);

create index if not exists invest_notifications_lookup_idx on public.invest_notifications (user_id, ref, sent_at desc);

alter table public.invest_notifications enable row level security;

-- 網頁只需要睇；寫入由每日排程用 service role 做
drop policy if exists "invest_notifications: own rows read" on public.invest_notifications;
create policy "invest_notifications: own rows read" on public.invest_notifications
    for select
    using (auth.uid() = user_id);
