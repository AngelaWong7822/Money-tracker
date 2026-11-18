# 💰 錢錢簿

自用嘅資產記錄 app：定期、活期、股票、強積金、儲蓄保險、信用卡欠款。

- 靜態 HTML/CSS/JS，冇 build step，放 GitHub Pages
- 雲端：同 PM tracker、旅行筆記共用「PM Management」Supabase project（table 用 `invest_` 前綴）
- 登入：PM tracker 同一個 email + 密碼
- 示範模式：網址加 `?demo=1`，用假資料，唔會寫入雲端

## 第一次設定

1. Supabase → SQL Editor → 貼 `supabase/schema.sql` 成段執行
2. 開 GitHub repo，push 呢個資料夾，Settings → Pages 揀 `main` branch

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
