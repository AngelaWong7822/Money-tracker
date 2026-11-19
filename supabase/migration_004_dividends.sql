-- 錢錢簿：股息估算
-- 喺 Supabase（PM Management）→ SQL Editor 貼晒成段執行一次就得（重複執行都唔會出錯）
-- 由每日排程用 Finnhub 填，App 唔會改呢幾欄

alter table public.invest_assets add column if not exists dividend_per_share numeric;     -- 每股每年股息（原幣，0 = 冇派息）
alter table public.invest_assets add column if not exists company_country text;          -- 公司所在地（例如 US、CH），用嚟決定點計稅
alter table public.invest_assets add column if not exists dividend_updated_at timestamptz;
