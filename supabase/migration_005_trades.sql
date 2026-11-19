-- 錢錢簿：賣出記錄（已實現盈虧）
-- 喺 Supabase（PM Management）→ SQL Editor 貼晒成段執行一次就得（重複執行都唔會出錯）

create table if not exists public.invest_trades (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    symbol text,
    name text not null,
    institution text,
    currency text not null default 'USD',
    shares numeric not null check (shares > 0),
    cost_price numeric,          -- 每股平均買入價（賣出嗰陣）
    sell_price numeric not null, -- 每股賣出價
    fee numeric not null default 0,
    sold_on date not null,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists invest_trades_user_sold_idx on public.invest_trades (user_id, sold_on desc);

alter table public.invest_trades enable row level security;

drop policy if exists "invest_trades: own rows" on public.invest_trades;
create policy "invest_trades: own rows" on public.invest_trades
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
