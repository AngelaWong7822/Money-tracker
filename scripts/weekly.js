/* 錢錢簿每週分析（GitHub Actions 逢星期一朝早行）
 * 計好數字 → 叫 Edge Function invest-analyze（Gemini）→ 儲報告 → email
 * DRY_RUN=1：只印數字，唔叫 Gemini、唔寄 email
 */
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const calc = require('../js/calc.js');

const env = (k) => {
    const v = process.env[k];
    if (!v) throw new Error(`未設定環境變數 ${k}`);
    return v;
};
const DRY = process.env.DRY_RUN === '1';
const APP_URL = process.env.APP_URL || 'https://angelawong7822.github.io/Money-tracker/';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA'); // YYYY-MM-DD（TZ=Asia/Hong_Kong）
}

function emailHtml(report) {
    const c = report.content;
    const sections = c.sections.map((s) => `
        <h3 style="font-size:15px;margin:18px 0 4px;color:#0f2a4a">${esc(s.title)}</h3>
        <p style="margin:0;line-height:1.6;color:#0f1b2d">${esc(s.body).replace(/\n/g, '<br>')}</p>`).join('');
    const watch = c.watch_points.length
        ? `<div style="background:#fdf3e1;color:#8a5a00;border-radius:10px;padding:10px 14px;margin-top:18px">
             <b>值得留意</b><ul style="margin:6px 0 0;padding-left:18px">${c.watch_points.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
        : '';
    return `<div style="font-family:system-ui,-apple-system,'Segoe UI','Microsoft JhengHei',sans-serif;max-width:560px;color:#0f1b2d">
        <div style="background:#0f2a4a;color:#fff;border-radius:12px;padding:14px 16px">
            <div style="font-size:12px;color:#a9bdd6">錢錢簿每週分析</div>
            <div style="font-size:16px;font-weight:600;margin-top:4px">${esc(c.headline)}</div>
        </div>
        ${sections}
        ${watch}
        <p style="margin-top:18px"><a href="${APP_URL}" style="color:#1f5fa8">打開錢錢簿睇詳細</a></p>
        <p style="color:#8c99aa;font-size:12px">由 Gemini 根據你嘅資料自動寫成，只係分析，唔係投資建議。</p>
    </div>`;
}

async function main() {
    const url = env('SUPABASE_URL');
    const secret = env('SUPABASE_SERVICE_ROLE_KEY');
    const db = createClient(url, secret, { auth: { persistSession: false } });
    console.log(`今日（香港）：${calc.todayISO()}${DRY ? '（DRY RUN）' : ''}`);

    const { data: assets, error } = await db.from('invest_assets').select('*').eq('deleted', false);
    if (error) throw error;
    const { data: settingsRows, error: sErr } = await db.from('invest_settings').select('*');
    if (sErr) throw sErr;

    for (const userId of [...new Set(assets.map((a) => a.user_id))]) {
        // 行兩次都唔會出兩份：5 日內有每週報告就跳過
        const { count } = await db.from('invest_reports').select('id', { head: true, count: 'exact' })
            .eq('user_id', userId).eq('source', 'weekly').gte('created_at', new Date(Date.now() - 5 * 86400000).toISOString());
        if (count && !DRY) { console.log('5 日內已經有每週報告，跳過'); continue; }

        const settings = settingsRows.find((s) => s.user_id === userId) ?? { usd_hkd: 7.8 };
        const { data: prevRows } = await db.from('invest_snapshots').select('*')
            .eq('user_id', userId).lte('snap_date', isoDaysAgo(6)).order('snap_date', { ascending: false }).limit(1);
        const facts = calc.buildFacts(assets.filter((a) => a.user_id === userId), settings, prevRows?.[0] ?? null);
        // repo 係 public，Actions log 人人睇到：唔寫任何金額
        console.log(`數字已計好（${facts.change_since_last_week ? '有' : '未有'}上週快照可以比較）`);
        if (DRY) continue;

        const res = await fetch(`${url}/functions/v1/invest-analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, apikey: secret },
            body: JSON.stringify({ user_id: userId, source: 'weekly', facts }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`invest-analyze 出錯（${res.status}）：${out.error || ''}`);
        console.log('報告已產生');

        if (settings.email_enabled === false) { console.log('已熄 email，唔寄'); continue; }
        const transport = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: env('GMAIL_USER'), pass: env('GMAIL_APP_PASSWORD') },
        });
        await transport.sendMail({
            from: `錢錢簿 <${env('GMAIL_USER')}>`,
            to: env('RECIPIENT_EMAIL'),
            subject: `錢錢簿每週分析：${out.report.content.headline}`.slice(0, 150),
            html: emailHtml(out.report),
        });
        console.log('已寄 email');
    }
}

module.exports = { emailHtml };

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
