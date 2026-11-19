/* 決定今日要提咩（純計算，方便測試） */
const calc = require('../js/calc.js');

const RULE_REPEAT_DAYS = 7;

/**
 * @param assets   呢個用戶嘅資產（未刪除）
 * @param settings 呢個用戶嘅 invest_settings
 * @param sent     已寄記錄 [{ ref, sent_at }]
 * @param now      而家時間
 * @returns [{ kind, ref, title, detail }]
 */
function buildReminders(assets, settings, sent, now) {
    const items = [];
    const sentRefs = new Set(sent.map((r) => r.ref));
    const remindDays = Number(settings.fd_remind_days) || 7;

    // 定期：到期前 N 日同前 1 日各提一次
    for (const a of assets) {
        if (a.type !== 'fd' || !a.maturity_date) continue;
        const days = calc.fdDaysLeft(a);
        if (days !== remindDays && days !== 1) continue;
        const ref = `fd:${a.id}:${a.maturity_date}:${days}`;
        if (sentRefs.has(ref)) continue;
        const interest = calc.fdInterest(a);
        const amount = calc.fmtMoney(Number(a.amount || 0), a.currency);
        items.push({
            kind: 'fd',
            ref,
            title: `${a.institution ? a.institution + ' ' : ''}${a.name}：${days === 1 ? '明天' : `${days} 日後`}到期`,
            detail: `本金 ${amount}${interest !== null ? `，預計利息 ${calc.fmtMoney(interest, a.currency, 2)}` : ''}。到期後會自動續期或轉回活期，視乎你開立定期時的選擇，請到銀行 app 確認。`,
        });
    }

    // 規則：第一次唔符合就提，之後仍然唔符合每 7 日再提
    for (const r of calc.checkRules(assets, settings)) {
        if (r.ok) continue;
        const ref = `rule:${r.key}`;
        const last = sent.filter((x) => x.ref === ref).map((x) => new Date(x.sent_at)).sort((x, y) => y - x)[0];
        if (last && now - last < RULE_REPEAT_DAYS * 86400000) continue;
        items.push({ kind: 'rule', ref, title: `規則不符合：${r.title}`, detail: r.detail });
    }
    return items;
}

module.exports = { buildReminders };
