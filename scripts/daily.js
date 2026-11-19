/* 錢錢簿每日排程（GitHub Actions 每朝行）
 * 1. 更新 USD/HKD 匯率（open.er-api.com，免費唔使 key）
 * 2. 更新股價（Finnhub）
 * 3. 檢查定期到期同自訂規則，有嘢要提先寄 email
 *
 * DRY_RUN=1：只會印出嚟，唔會寫入 Supabase、唔會寄 email
 */
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const calc = require('../js/calc.js');
const { buildReminders } = require('./reminders.js');

const env = (k, required = true) => {
    const v = process.env[k];
    if (required && !v) throw new Error(`未設定環境變數 ${k}`);
    return v;
};
const DRY = process.env.DRY_RUN === '1';
const APP_URL = process.env.APP_URL || 'https://angelawong7822.github.io/Money-tracker/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function updateFx(db) {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const rate = (await res.json())?.rates?.HKD;
        if (!(rate > 7.6 && rate < 8.0)) {
            console.warn('匯率數值唔合理，唔更新：', rate);
            return;
        }
        console.log('USD/HKD =', rate);
        if (DRY) return;
        const { error } = await db.from('invest_settings')
            .update({ usd_hkd: rate, usd_hkd_updated_at: new Date().toISOString() })
            .not('user_id', 'is', null);
        if (error) throw error;
    } catch (err) {
        console.warn('更新匯率失敗：', err.message);
    }
}

async function updatePrices(db, assets) {
    const token = env('FINNHUB_API_KEY', !DRY);
    if (!token) { console.log('冇 FINNHUB_API_KEY，跳過股價'); return; }
    const symbols = [...new Set(assets.filter((a) => a.type === 'stock' && a.symbol).map((a) => a.symbol.toUpperCase()))];
    for (const sym of symbols) {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}`, {
                headers: { 'X-Finnhub-Token': token },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const q = await res.json();
            if (!(q.c > 0)) { console.warn(`${sym}：Finnhub 冇報價（代號啱唔啱？）`); continue; }
            console.log(`${sym} = ${q.c}`);
            if (!DRY) {
                const { error } = await db.from('invest_assets')
                    .update({ last_price: q.c, price_updated_at: new Date().toISOString() })
                    .eq('type', 'stock').eq('symbol', sym).eq('deleted', false);
                if (error) throw error;
            }
        } catch (err) {
            console.warn(`${sym} 更新失敗：`, err.message);
        }
        await sleep(1100); // 免費版每分鐘 60 次
    }
}

function emailHtml(items) {
    const rows = items.map((i) => `
        <tr><td style="padding:10px 0;border-bottom:1px solid #e3e8ef">
            <div style="font-weight:600;color:${i.kind === 'rule' ? '#8a5a00' : '#0f2a4a'}">${i.title}</div>
            <div style="color:#5b6b80;font-size:13px;margin-top:2px">${i.detail}</div>
        </td></tr>`).join('');
    return `<div style="font-family:system-ui,-apple-system,'Segoe UI','Microsoft JhengHei',sans-serif;max-width:520px;color:#0f1b2d">
        <div style="background:#0f2a4a;color:#fff;border-radius:12px;padding:14px 16px;font-size:16px;font-weight:600">錢錢簿提醒</div>
        <table style="width:100%;border-collapse:collapse;margin-top:8px">${rows}</table>
        <p style="margin-top:16px"><a href="${APP_URL}" style="color:#1f5fa8">打開錢錢簿</a></p>
        <p style="color:#8c99aa;font-size:12px">呢封係自動提醒，唔係投資建議。想改提醒，去錢錢簿 → 設定。</p>
    </div>`;
}

async function main() {
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    console.log(`今日（香港）：${calc.todayISO()}${DRY ? '（DRY RUN）' : ''}`);

    await updateFx(db);

    let { data: assets, error } = await db.from('invest_assets').select('*').eq('deleted', false);
    if (error) throw error;
    await updatePrices(db, assets);

    // 用更新咗嘅數再計
    ({ data: assets, error } = await db.from('invest_assets').select('*').eq('deleted', false));
    if (error) throw error;
    const { data: settingsRows, error: sErr } = await db.from('invest_settings').select('*');
    if (sErr) throw sErr;
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const { data: sentRows, error: nErr } = await db.from('invest_notifications').select('user_id, ref, sent_at').gte('sent_at', since);
    if (nErr) throw nErr;

    const users = [...new Set(assets.map((a) => a.user_id))];
    for (const userId of users) {
        const settings = settingsRows.find((s) => s.user_id === userId) ?? { usd_hkd: 7.8, fd_remind_days: 7, email_enabled: true };
        const sent = sentRows.filter((r) => r.user_id === userId);
        const items = buildReminders(assets.filter((a) => a.user_id === userId), settings, sent, new Date());
        if (!items.length) { console.log('今日冇嘢要提'); continue; }
        console.log('要提：\n' + items.map((i) => `- ${i.title}：${i.detail}`).join('\n'));
        if (settings.email_enabled === false) { console.log('已熄 email 提醒，唔寄'); continue; }
        if (DRY) continue;

        const transport = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: env('GMAIL_USER'), pass: env('GMAIL_APP_PASSWORD') },
        });
        await transport.sendMail({
            from: `錢錢簿 <${env('GMAIL_USER')}>`,
            to: env('RECIPIENT_EMAIL'),
            subject: `錢錢簿提醒：${items[0].title}${items.length > 1 ? ` 等 ${items.length} 項` : ''}`,
            html: emailHtml(items),
        });
        const { error: insErr } = await db.from('invest_notifications')
            .insert(items.map((i) => ({ user_id: userId, kind: i.kind, ref: i.ref })));
        if (insErr) throw insErr;
        console.log(`已寄 email（${items.length} 項）`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
