/* 計數：全部換算做港幣 */

const TYPES = {
    fd:        { label: '定期',     color: 'var(--series-1)', explain: '本金穩陣、利息固定，但錢要鎖到到期日先攞得返' },
    cash:      { label: '活期/儲蓄', color: 'var(--series-2)', explain: '隨時攞得返，但利息通常最低' },
    stock:     { label: '股票',     color: 'var(--series-3)', explain: '有機會升值同收股息，但價格會上落，可以蝕本' },
    mpf:       { label: '強積金',   color: 'var(--series-4)', explain: '一般要到 65 歲先攞得返，係長線退休錢' },
    insurance: { label: '儲蓄保險', color: 'var(--series-5)', explain: '通常要持有好多年，太早退保可能攞返少過已供嘅錢' },
    other:     { label: '其他',     color: 'var(--series-6)', explain: '' },
    credit:    { label: '信用卡欠款', color: 'var(--text-muted)', explain: '要還嘅錢，會喺總資產度減返' },
};
// 分佈圖固定次序（顏色跟類別，唔跟排名）
const ALLOCATION_ORDER = ['fd', 'cash', 'stock', 'mpf', 'insurance', 'other'];

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function toHKD(amount, currency, settings) {
    if (amount === null) return 0;
    return currency === 'USD' ? amount * Number(settings.usd_hkd || 7.8) : amount;
}

/** 資產原幣值（股票 = 股數 × 現價；冇現價就用買入價） */
function nativeValue(a) {
    if (a.type === 'stock') {
        const price = num(a.last_price) ?? num(a.cost_price) ?? 0;
        return (num(a.shares) ?? 0) * price;
    }
    return num(a.amount) ?? 0;
}

function valueHKD(a, settings) {
    return toHKD(nativeValue(a), a.currency, settings);
}

function daysBetween(fromISO, toISO) {
    const ms = new Date(toISO + 'T00:00:00') - new Date(fromISO + 'T00:00:00');
    return Math.round(ms / 86400000);
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 定期：預計利息（原幣）＝ 本金 × 年息 × 日數 / 365 */
function fdInterest(a) {
    const p = num(a.amount), r = num(a.rate);
    if (!p || !r || !a.start_date || !a.maturity_date) return null;
    const days = daysBetween(a.start_date, a.maturity_date);
    if (days <= 0) return null;
    return (p * r) / 100 * days / 365;
}

function fdDaysLeft(a) {
    return a.maturity_date ? daysBetween(todayISO(), a.maturity_date) : null;
}

/** 股票盈虧（原幣） */
function stockPnL(a) {
    const shares = num(a.shares), cost = num(a.cost_price), price = num(a.last_price);
    if (!shares || !cost || price === null) return null;
    const pnl = (price - cost) * shares;
    return { pnl, pct: (price / cost - 1) * 100 };
}

function summarize(assets, settings) {
    const byType = {};
    let assetsTotal = 0, liabilities = 0;
    const byCurrency = { HKD: 0, USD: 0 };
    for (const a of assets) {
        const v = valueHKD(a, settings);
        if (a.type === 'credit') { liabilities += v; continue; }
        byType[a.type] = (byType[a.type] || 0) + v;
        assetsTotal += v;
        byCurrency[a.currency] = (byCurrency[a.currency] || 0) + v;
    }
    return { byType, assetsTotal, liabilities, net: assetsTotal - liabilities, byCurrency };
}

const fmtMoney = (v, currency = 'HKD', digits = 0) => {
    const sym = currency === 'USD' ? 'US$' : '$';
    const sign = v < 0 ? '-' : '';
    return sign + sym + Math.abs(v).toLocaleString('en-HK', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtPct = (v, digits = 1) => `${v.toFixed(digits)}%`;

/** 美元金額嘅港幣參考：「≈ HK$9,376」；港幣金額就回空字串 */
function hkdHint(v, currency, settings, signed = false) {
    if (currency !== 'USD' || v === null || v === undefined) return '';
    const h = toHKD(v, currency, settings);
    const sign = signed && h > 0 ? '+' : '';
    return `≈ ${sign}${fmtMoney(h).replace('$', 'HK$')}`;
}

/**
 * 自訂規則檢查（網頁同每日排程共用）
 * 回傳 [{ key, ok, title, detail }]；冇設定嘅規則唔會出現
 */
function checkRules(assets, settings) {
    const s = summarize(assets, settings);
    const results = [];
    const minCash = num(settings.min_cash);
    if (minCash !== null) {
        const cash = s.byType.cash || 0;
        results.push({
            key: 'min_cash',
            ok: cash >= minCash,
            title: `活期最少 ${fmtMoney(minCash)}`,
            detail: cash >= minCash
                ? `而家活期有 ${fmtMoney(cash)}，夠你定嘅數。`
                : `而家活期得 ${fmtMoney(cash)}，少過你定嘅 ${fmtMoney(minCash)}，差 ${fmtMoney(minCash - cash)}。`,
        });
    }
    const maxStock = num(settings.max_stock_pct);
    if (maxStock !== null && s.assetsTotal > 0) {
        const over = assets
            .filter((a) => a.type === 'stock')
            .map((a) => ({ a, pct: (valueHKD(a, settings) / s.assetsTotal) * 100 }))
            .filter((x) => x.pct > maxStock);
        results.push({
            key: 'max_stock_pct',
            ok: over.length === 0,
            title: `單一股票唔超過 ${maxStock}%`,
            detail: over.length === 0
                ? '每隻股票都喺你定嘅比例之內。'
                : over.map((x) => `${x.a.name} 佔總資產 ${fmtPct(x.pct)}`).join('、') + `，超過你定嘅 ${maxStock}%。`,
        });
    }
    const maxUsd = num(settings.max_usd_pct);
    if (maxUsd !== null && s.assetsTotal > 0) {
        const usdPct = ((s.byCurrency.USD || 0) / s.assetsTotal) * 100;
        results.push({
            key: 'max_usd_pct',
            ok: usdPct <= maxUsd,
            title: `美元唔超過 ${maxUsd}%`,
            detail: usdPct <= maxUsd
                ? `而家美元佔 ${fmtPct(usdPct)}。`
                : `而家美元佔 ${fmtPct(usdPct)}，超過你定嘅 ${maxUsd}%。`,
        });
    }
    return results;
}

/** 美國公司股息，香港居民預扣 30%；其他地方稅率唔同，唔估 */
const US_DIVIDEND_TAX_PCT = 30;

/**
 * 股票每年股息估算（原幣）
 * 回傳 null = 未有資料；{ none: true } = 冇派息；
 * 否則 { gross, net, taxPct }，taxPct = null 代表非美國公司、未計稅（net = gross）
 */
function dividendInfo(a) {
    if (a.type !== 'stock') return null;
    const dps = num(a.dividend_per_share);
    if (dps === null) return null;
    if (dps <= 0) return { none: true };
    const gross = dps * (num(a.shares) ?? 0);
    const taxPct = a.company_country === 'US' ? US_DIVIDEND_TAX_PCT : null;
    return { gross, net: taxPct === null ? gross : gross * (1 - taxPct / 100), taxPct };
}

/** 全部股票一年股息合計（港幣） */
function dividendTotals(assets, settings) {
    let net = 0, untaxed = 0, counted = 0, missing = 0;
    for (const a of assets) {
        if (a.type !== 'stock') continue;
        const d = dividendInfo(a);
        if (!d) { missing++; continue; }
        if (d.none) continue;
        counted++;
        net += toHKD(d.net, a.currency, settings);
        if (d.taxPct === null) untaxed++;
    }
    return { net, counted, untaxed, missing };
}

/** 每日快照（港幣，四捨五入） */
function snapshotOf(assets, settings) {
    const s = summarize(assets, settings);
    const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    return {
        net: Math.round(s.net),
        assets_total: Math.round(s.assetsTotal),
        liabilities: Math.round(s.liabilities),
        by_type: round(s.byType),
        by_currency: round(s.byCurrency),
    };
}

/**
 * 傳俾 Gemini 分析嘅數字：全部計好、換晒港幣，唔包戶口號碼同人名
 * prev = 大約一個禮拜前嘅快照（可以係 null）
 */
function buildFacts(assets, settings, prev) {
    const s = summarize(assets, settings);
    const total = s.assetsTotal || 0;
    const pct = (v) => (total ? Math.round((v / total) * 1000) / 10 : 0);
    const r = (v) => Math.round(v);
    const r2 = (v) => Math.round(v * 100) / 100;
    const today = todayISO();

    const byType = {};
    for (const t of Object.keys(s.byType)) byType[TYPES[t].label] = { hkd: r(s.byType[t]), pct: pct(s.byType[t]) };

    const fds = assets.filter((a) => a.type === 'fd').map((a) => {
        const i = fdInterest(a);
        return {
            bank: a.institution || null,
            name: a.name,
            currency: a.currency,
            principal_hkd: r(valueHKD(a, settings)),
            annual_rate_pct: num(a.rate),
            start_date: a.start_date,
            maturity_date: a.maturity_date,
            days_left: fdDaysLeft(a),
            expected_interest_hkd: i === null ? null : r2(toHKD(i, a.currency, settings)),
        };
    }).sort((x, y) => (x.days_left ?? 99999) - (y.days_left ?? 99999));

    const soon = fds.filter((f) => f.days_left !== null && f.days_left >= 0 && f.days_left <= 90);
    const byMonth = {};
    for (const f of soon) {
        const m = f.maturity_date.slice(0, 7);
        byMonth[m] = (byMonth[m] || 0) + f.principal_hkd;
    }

    const stocks = assets.filter((a) => a.type === 'stock').map((a) => {
        const pl = stockPnL(a);
        const v = valueHKD(a, settings);
        return {
            symbol: a.symbol,
            name: a.name,
            currency: a.currency,
            shares: num(a.shares),
            value_hkd: r(v),
            pct_of_total: pct(v),
            pnl_pct: pl ? Math.round(pl.pct * 10) / 10 : null,
            pnl_hkd: pl ? r(toHKD(pl.pnl, a.currency, settings)) : null,
            company_country: a.company_country || null,
            annual_dividend_before_tax_hkd: dividendInfo(a) ? r(toHKD(dividendInfo(a).gross ?? 0, a.currency, settings)) : null,
            dividend_tax_pct: dividendInfo(a)?.taxPct ?? null,
            annual_dividend_after_tax_hkd: dividendInfo(a) ? (dividendInfo(a).taxPct === null ? null : r(toHKD(dividendInfo(a).net ?? 0, a.currency, settings))) : null,
        };
    }).sort((x, y) => y.value_hkd - x.value_hkd);

    let change = null;
    if (prev) {
        const types = new Set([...Object.keys(prev.by_type || {}), ...Object.keys(s.byType)]);
        const byTypeChange = {};
        for (const t of types) {
            const diff = r((s.byType[t] || 0) - Number(prev.by_type?.[t] || 0));
            if (diff !== 0) byTypeChange[TYPES[t]?.label ?? t] = diff;
        }
        change = {
            compared_with_date: prev.snap_date,
            days: daysBetween(prev.snap_date, today),
            net_before_hkd: r(Number(prev.net)),
            net_change_hkd: r(s.net - Number(prev.net)),
            by_type_change_hkd: byTypeChange,
        };
    }

    return {
        as_of: today,
        usd_hkd: Number(settings.usd_hkd || 7.8),
        net_hkd: r(s.net),
        assets_hkd: r(total),
        credit_card_debt_hkd: r(s.liabilities),
        cash_available_hkd: r(s.byType.cash || 0),
        by_type: byType,
        currency_pct: { HKD: pct(s.byCurrency.HKD || 0), USD: pct(s.byCurrency.USD || 0) },
        fixed_deposits: fds,
        fd_maturing_next_90_days: { total_hkd: r(soon.reduce((x, f) => x + f.principal_hkd, 0)), by_month_hkd: byMonth },
        stocks,
        us_dividend_withholding_tax_pct: stocks.some((x) => x.company_country === 'US') ? US_DIVIDEND_TAX_PCT : null,
        dividends_note: '股息係按而家派息水平估算全年，唔保證；非美國公司（company_country 唔係 US）稅率唔同，只有稅前數',
        annual_dividends_hkd: (() => {
            const t = dividendTotals(assets, settings);
            return { estimated_total: r(t.net), stocks_paying: t.counted, non_us_untaxed: t.untaxed, stocks_without_data: t.missing };
        })(),
        rules: checkRules(assets, settings).map(({ title, ok, detail }) => ({ title, ok, detail })),
        change_since_last_week: change,
    };
}

// 俾 Node（每日排程 script）用；瀏覽器冇 module，唔會行呢段
if (typeof module !== 'undefined') {
    module.exports = { TYPES, num, toHKD, nativeValue, valueHKD, daysBetween, todayISO, fdInterest, fdDaysLeft, stockPnL, summarize, fmtMoney, fmtPct, hkdHint, checkRules, snapshotOf, buildFacts, dividendInfo, dividendTotals };
}
