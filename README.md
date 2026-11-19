# 💰 錢錢簿

自用嘅資產記錄 app：定期、活期、股票、強積金、儲蓄保險、信用卡欠款。

- 靜態 HTML/CSS/JS，冇 build step，放 GitHub Pages
- 雲端：同 PM tracker、旅行筆記共用「PM Management」Supabase project（table 用 `invest_` 前綴）
- 登入：PM tracker 同一個 email + 密碼
- 示範模式：網址加 `?demo=1`，用假資料，唔會寫入雲端

## 第一次設定

1. Supabase → SQL Editor → 貼 `supabase/schema.sql` 成段執行
2. 開 GitHub repo，push 呢個資料夾，Settings → Pages 揀 `main` branch

## 影相匯入（Gemini）

截圖喺瀏覽器縮細 → Supabase Edge Function `invest-extract` → Gemini → 確認畫面 → 儲存。
張圖唔會儲落任何地方；Gemini key 只放喺 Supabase secret。

部署（Supabase dashboard，唔使 CLI）：
1. Google AI Studio（https://aistudio.google.com/apikey）攞 API key
2. Supabase → PM Management → Edge Functions → Deploy a new function → Via Editor
   - 名：`invest-extract`
   - 貼 `supabase/functions/invest-extract/index.ts` 全部內容 → Deploy
   - Function 設定入面熄咗「Verify JWT」（code 自己用 `auth.getUser` 檢查登入）
3. Edge Functions → Secrets → 新增 `GEMINI_API_KEY`
   （可選 `GEMINI_MODEL`，預設 `gemini-2.5-flash`）

注意：Gemini 免費版可能會用上傳內容改善 Google 產品，上傳前最好裁走戶口號碼。

## 每日更新同提醒（第 2 期）

`.github/workflows/daily.yml` 每朝香港時間 07:00 同 09:00 行 `scripts/daily.js`：
1. USD/HKD 匯率（open.er-api.com，唔使 key）
2. 股價（Finnhub `/quote`）
3. 定期到期（前 N 日 + 前 1 日）同自訂規則（唔符合時提，之後每 7 日再提）→ Gmail
   已寄記錄喺 `invest_notifications`，所以行兩次都唔會重複寄。

設定：
1. Supabase SQL Editor 行 `supabase/migration_002_phase2.sql`（要喺推網頁之前行）
2. GitHub repo secrets：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`FINNHUB_API_KEY`、
   `GMAIL_USER`、`GMAIL_APP_PASSWORD`、`RECIPIENT_EMAIL`
3. Actions → 每日更新同提醒 → Run workflow（剔「只試行」先試）

規則檢查邏輯喺 `js/calc.js` 嘅 `checkRules`，網頁同排程共用。

## 本機測試

```
python -m http.server 8095
```
開 http://localhost:8095/?demo=1

## 計數方法

- 美元資產用「設定」入面嘅匯率換算做港幣
- 定期利息 = 本金 × 年息 × 日數 ÷ 365
- 股票市值 = 股數 × 現價（未有現價就用買入價）
- 淨資產 = 總資產 − 信用卡欠款

## 之後

- 第 2 期：每日自動更新股價、定期到期 email 提醒、自訂規則
- 第 3 期：Gemini 每月分析報告
