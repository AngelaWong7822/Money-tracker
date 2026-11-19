/* 錢錢簿 — 畫面 */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { assets: [], settings: { usd_hkd: 7.8 }, tab: 'overview' };

/* ── 共用小工具 ── */
function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${y}/${m}/${d}`;
}

function daysLeftBadge(days) {
    if (days === null) return '';
    if (days < 0) return '<span class="badge badge-done">已到期</span>';
    if (days === 0) return '<span class="badge badge-soon">今日到期</span>';
    if (days <= (state.settings.fd_remind_days ?? 7)) return `<span class="badge badge-soon">仲有 ${days} 日</span>`;
    return `<span class="badge">仲有 ${days} 日</span>`;
}

/* ── 「即係話」白話解釋 ── */
const explain = (html) => `<div class="explain"><svg class="ic"><use href="#i-info"/></svg><div><b>即係話：</b>${html}</div></div>`;

function emptyCard(title, body) {
    return `<div class="card empty"><p class="empty-title">${title}</p><p class="muted small">${body}</p></div>`;
}

function fmtShortDate(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ── 規則檢查 ── */
function renderRulesCard() {
    const rules = checkRules(state.assets, state.settings);
    if (!rules.length) {
        return `<div class="card rules-empty"><div class="card-head"><h2>我嘅規則</h2><button class="link-btn" data-open-settings>設定規則</button></div>
            <p class="small muted" style="margin:0">你可以定啲簡單規則，例如「活期最少要有 $50,000」。唔符合嘅話會提你。</p></div>`;
    }
    const bad = rules.filter((r) => !r.ok).length;
    return `<div class="card">
        <div class="card-head"><h2>我嘅規則</h2><span class="small ${bad ? 'warn-ink' : 'up'}">${bad ? `${bad} 條唔符合` : '全部符合'}</span></div>
        <ul class="rule-list">${rules.map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">
            <span class="rule-mark" aria-hidden="true">${r.ok ? '✓' : '!'}</span>
            <div><div class="item-name">${esc(r.title)}</div><div class="item-sub">${esc(r.detail)}</div></div>
        </li>`).join('')}</ul>
    </div>`;
}

/* ── 總覽 ── */
function renderOverview() {
    const el = $('#tab-overview');
    const { assets, settings } = state;
    if (!assets.length) {
        el.innerHTML = emptyCard('記低你第一筆資產', '撳右下角「＋」，加你嘅定期或者股票。');
        return;
    }
    const s = summarize(assets, settings);

    // 分佈：固定次序，顏色跟類別
    const parts = ALLOCATION_ORDER
        .filter((t) => s.byType[t] > 0)
        .map((t) => ({ type: t, value: s.byType[t], pct: s.assetsTotal ? (s.byType[t] / s.assetsTotal) * 100 : 0 }));
    const biggest = [...parts].sort((a, b) => b.value - a.value)[0];

    const bar = parts.map((p) => `<div class="seg" style="flex-grow:${p.value};background:${TYPES[p.type].color}"
            data-tip="${esc(`${TYPES[p.type].label}：${fmtMoney(p.value)}（${fmtPct(p.pct)}）`)}"></div>`).join('');
    const legend = parts.map((p) => `<li>
            <span class="dot" style="background:${TYPES[p.type].color}"></span>
            <span>${TYPES[p.type].label}</span>
            <span class="legend-value">${fmtMoney(p.value)}</span>
            <span class="legend-pct">${fmtPct(p.pct, 0)}</span>
        </li>`).join('');

    let allocText = '';
    if (biggest) {
        allocText = `你最多錢放喺<b>${TYPES[biggest.type].label}</b>（${fmtPct(biggest.pct, 0)}）`;
        if (TYPES[biggest.type].explain) allocText += `，${TYPES[biggest.type].explain}`;
        allocText += '。';
    }
    const stocks = assets.filter((a) => a.type === 'stock');
    if (stocks.length === 1) allocText += `股票部分得 1 隻（${esc(stocks[0].name)}），嗰部分嘅升跌完全跟呢間公司。`;

    const hkdPct = s.assetsTotal ? (s.byCurrency.HKD / s.assetsTotal) * 100 : 0;
    const usdPct = s.assetsTotal ? (s.byCurrency.USD / s.assetsTotal) * 100 : 0;
    if (usdPct > 0) allocText += `有 ${fmtPct(usdPct, 0)} 係美元，因為港元同美元掛鈎，匯率上落對你影響好細。`;

    // 定期
    const fds = assets.filter((a) => a.type === 'fd' && a.maturity_date)
        .map((a) => ({ a, days: fdDaysLeft(a) }))
        .sort((x, y) => x.days - y.days);
    const upcoming = fds.filter((f) => f.days >= -30).slice(0, 3);
    const totalInterest = fds.reduce((sum, f) => sum + toHKD(fdInterest(f.a) ?? 0, f.a.currency, settings), 0);
    const cashNow = s.byType.cash || 0;
    const next = fds.find((f) => f.days >= 0);

    el.innerHTML = `
        <div class="card hero">
            <p class="hero-label">淨資產（港幣）</p>
            <p class="hero-number">${fmtMoney(s.net)}</p>
            <div class="hero-sub">
                <span>總資產 <b>${fmtMoney(s.assetsTotal)}</b></span>
                <span>欠款 <b>${fmtMoney(s.liabilities)}</b></span>
            </div>
        </div>

        <div class="stat-row">
            <div class="stat"><div class="stat-label">隨時可用（活期）</div><div class="stat-value">${fmtMoney(cashNow)}</div></div>
            <div class="stat"><div class="stat-label">定期預計利息</div><div class="stat-value">${fmtMoney(totalInterest)}</div></div>
        </div>

        ${renderRulesCard()}

        <div class="card">
            <div class="card-head"><h2>資產分佈</h2><span class="small muted num">港幣 ${fmtPct(hkdPct, 0)} · 美元 ${fmtPct(usdPct, 0)}</span></div>
            <div class="alloc-bar" role="img" aria-label="資產分佈">${bar}</div>
            <ul class="legend">${legend}</ul>
            ${allocText ? explain(allocText) : ''}
        </div>

        <div class="card">
            <div class="card-head"><h2>就到期</h2>${fds.length ? '<button class="link-btn" data-goto="fd">睇全部</button>' : ''}</div>
            ${upcoming.length ? `<ul class="mini-list">${upcoming.map(({ a, days }) => `
                <li data-edit="${esc(a.id)}">
                    <div><div class="item-name">${esc(a.institution ? a.institution + ' ' : '')}${esc(a.name)}</div>
                        <div class="item-sub num">${fmtMoney(nativeValue(a), a.currency)}${a.currency === 'USD' ? `（${hkdHint(nativeValue(a), a.currency, settings)}）` : ''} · 年息 ${a.rate ? Number(a.rate) + '%' : '—'}</div></div>
                    ${daysLeftBadge(days)}
                </li>`).join('')}</ul>` : '<p class="muted small">暫時冇定期</p>'}
            ${next ? explain(`最快一筆係 ${esc(next.a.institution || '')} ${esc(next.a.name)}，${next.days === 0 ? '今日' : `${next.days} 日後`}到期。到期之後會自動續期定轉返活期，要睇你開定期嗰陣點揀，記得去銀行 app 確認。`) : ''}
        </div>

        ${stocks.length ? `<div class="card">
            <h2>股票</h2>
            <ul class="mini-list">${stocks.map((a) => {
                const pl = stockPnL(a);
                return `<li data-edit="${esc(a.id)}">
                    <div><div class="item-name">${esc(a.name)}</div>
                        <div class="item-sub">${esc(a.symbol || '')} · ${Number(a.shares || 0)} 股${a.price_updated_at ? ` · 股價 ${fmtShortDate(a.price_updated_at)}` : ''}</div></div>
                    <div class="item-right"><div class="main">${fmtMoney(nativeValue(a), a.currency, 2)}</div>
                        ${a.currency === 'USD' ? `<div class="hkd-hint">${hkdHint(nativeValue(a), a.currency, settings)}</div>` : ''}
                        ${pl ? `<div class="small ${pl.pnl >= 0 ? 'up' : 'down'}">${pl.pnl >= 0 ? '+' : ''}${fmtMoney(pl.pnl, a.currency, 2)}（${pl.pnl >= 0 ? '+' : ''}${fmtPct(pl.pct)}）</div>${a.currency === 'USD' ? `<div class="hkd-hint">${hkdHint(pl.pnl, a.currency, settings, true)}</div>` : ''}` : '<div class="small muted">未有現價</div>'}</div>
                </li>`;
            }).join('')}</ul>
            ${explain(stocks.map((a) => {
                const pl = stockPnL(a);
                if (!pl) return '';
                return `${esc(a.name)} 而家${pl.pnl >= 0 ? '高' : '低'}過你買入價 ${fmtPct(Math.abs(pl.pct))}，賬面${pl.pnl >= 0 ? '賺' : '蝕'}緊 ${fmtMoney(Math.abs(pl.pnl), a.currency, 2)}${a.currency === 'USD' ? `（${hkdHint(Math.abs(pl.pnl), a.currency, settings).replace('≈ ', '約 ')}）` : ''}。`;
            }).join('') + '未賣出之前，盈虧只係賬面數字。香港居民收美股股息會先被扣 30% 稅。')}
        </div>` : ''}
    `;
}

/* ── 資產列表 ── */
function renderAssets() {
    const el = $('#tab-assets');
    const { assets, settings } = state;
    if (!assets.length) {
        el.innerHTML = emptyCard('仲未有資產', '撳右下角「＋」新增。');
        return;
    }
    const order = [...ALLOCATION_ORDER, 'credit'];
    el.innerHTML = order.map((t) => {
        const list = assets.filter((a) => a.type === t);
        if (!list.length) return '';
        const total = list.reduce((sum, a) => sum + valueHKD(a, settings), 0);
        return `<div class="card">
            <h2><span class="dot" style="background:${TYPES[t].color}"></span>${TYPES[t].label}
                <span class="h2-total">${t === 'credit' ? '-' : ''}${fmtMoney(total)}</span></h2>
            ${TYPES[t].explain ? `<p class="small muted" style="margin:-0.3rem 0 0.3rem">${TYPES[t].explain}</p>` : ''}
            <ul class="mini-list">${list.map((a) => `
                <li data-edit="${esc(a.id)}">
                    <div><div class="item-name">${esc(a.name)}</div>
                        <div class="item-sub">${esc(a.institution || '')}${a.type === 'fd' && a.rate ? ` · 年息 ${Number(a.rate)}%` : ''}${a.type === 'stock' ? ` · ${Number(a.shares || 0)} 股` : ''}</div></div>
                    <div class="item-right"><div class="main">${fmtMoney(nativeValue(a), a.currency, a.currency === 'USD' ? 2 : 0)}</div>${a.currency === 'USD' ? `<div class="hkd-hint">${hkdHint(nativeValue(a), a.currency, settings)}</div>` : ''}</div>
                </li>`).join('')}</ul>
        </div>`;
    }).join('');
}

/* ── 定期時間表 ── */
function renderFD() {
    const el = $('#tab-fd');
    const fds = state.assets.filter((a) => a.type === 'fd')
        .map((a) => ({ a, days: fdDaysLeft(a) }))
        .sort((x, y) => (x.days ?? 99999) - (y.days ?? 99999));
    if (!fds.length) {
        el.innerHTML = emptyCard('仲未有定期', '撳右下角「＋」，類別揀「定期」。');
        return;
    }
    const today = todayISO();
    el.innerHTML = `<p class="section-note">按到期日排，最快到期排最頭</p>` + fds.map(({ a, days }) => {
        const interest = fdInterest(a);
        const hint = (v) => (a.currency === 'USD' ? `<div class="hkd-hint">${hkdHint(v, a.currency, state.settings)}</div>` : '');
        let progress = null;
        if (a.start_date && a.maturity_date) {
            const total = daysBetween(a.start_date, a.maturity_date);
            const done = daysBetween(a.start_date, today);
            progress = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : null;
        }
        return `<div class="card fd-card ${days !== null && days >= 0 && days <= 7 ? 'fd-soon' : ''}" data-edit="${esc(a.id)}">
            <div class="fd-head">
                <div><div class="item-name">${esc(a.name)}</div><div class="item-sub">${esc(a.institution || '')}</div></div>
                ${daysLeftBadge(days)}
            </div>
            ${progress !== null ? `<div class="progress" role="img" aria-label="已過 ${Math.round(progress)}%"><div style="width:${progress}%"></div></div>
                <div class="progress-dates num"><span>${fmtDate(a.start_date)}</span><span>${fmtDate(a.maturity_date)}</span></div>` : ''}
            <dl class="fd-grid">
                <div><dt>本金</dt><dd>${fmtMoney(Number(a.amount || 0), a.currency)}${hint(Number(a.amount || 0))}</dd></div>
                <div><dt>年息</dt><dd>${a.rate ? Number(a.rate) + '%' : '—'}</dd></div>
                <div><dt>預計利息</dt><dd>${interest !== null ? fmtMoney(interest, a.currency, 2) + hint(interest) : '—'}</dd></div>
                <div><dt>到期總額</dt><dd>${interest !== null ? fmtMoney(Number(a.amount) + interest, a.currency, 2) + hint(Number(a.amount) + interest) : '—'}</dd></div>
            </dl>
            ${days !== null && days < 0
                ? '<p class="warn-note">已經到期咗。如果續咗期，改返開始日同到期日；如果提走咗，就刪除呢筆。</p>'
                : interest !== null ? explain(`存到 ${fmtDate(a.maturity_date)}，會收到大約 <b>${fmtMoney(interest, a.currency, 2)}</b>${a.currency === 'USD' ? `（${hkdHint(interest, a.currency, state.settings).replace('≈ ', '約 ')}）` : ''}利息。`) : ''}
        </div>`;
    }).join('');
}

function render() {
    renderOverview();
    renderAssets();
    renderFD();
}

async function reload() {
    try {
        const [assets, settings] = await Promise.all([store.listAssets(), store.getSettings()]);
        state.assets = assets;
        state.settings = settings;
        render();
    } catch (err) {
        console.error(err);
        toast('載入失敗：' + (err.message || err));
    }
}

/* ── 分頁 ── */
function showTab(tab) {
    state.tab = tab;
    for (const t of ['overview', 'assets', 'fd']) $(`#tab-${t}`).hidden = t !== tab;
    document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#page-title').textContent = { overview: '我的資產', assets: '資產明細', fd: '定期' }[tab];
    window.scrollTo(0, 0);
}

/* ── 新增／編輯 ── */
const dialog = $('#asset-dialog');
const form = $('#asset-form');

function buildTypePicker() {
    const order = [...ALLOCATION_ORDER, 'credit'];
    $('#type-picker').innerHTML = order.map((t) =>
        `<button type="button" data-type="${t}">${TYPES[t].label}</button>`).join('');
}

function setType(type) {
    form.elements.type.value = type;
    document.querySelectorAll('#type-picker button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    document.querySelectorAll('#asset-form [data-show]').forEach((el) => {
        const show = el.dataset.show.split(' ').includes(type);
        el.hidden = !show;
        el.querySelectorAll('input,select').forEach((i) => { i.disabled = !show; });
    });
    form.elements.amount.required = type !== 'stock';
    form.elements.shares.required = type === 'stock';
    form.elements.maturity_date.required = type === 'fd';
    const amountLabel = { fd: '本金', credit: '欠款', mpf: '結餘', insurance: '現金價值' }[type] || '金額';
    $('[data-label-for="amount"]').textContent = amountLabel;
}

function openAssetDialog(asset) {
    form.reset();
    $('#asset-error').hidden = true;
    $('#asset-dialog-title').textContent = asset ? '編輯資產' : '新增資產';
    $('#asset-delete').hidden = !asset;
    $('#import-entry').hidden = !!asset;
    form.elements.id.value = asset?.id ?? '';
    if (asset) {
        for (const el of form.elements) {
            if (el.name && el.name !== 'type' && el.name !== 'id' && asset[el.name] !== null && asset[el.name] !== undefined) {
                el.value = asset[el.name];
            }
        }
    }
    setType(asset?.type ?? 'fd');
    dialog.showModal();
}

function readForm() {
    const fd = new FormData(form);
    const type = fd.get('type');
    const numeric = ['amount', 'rate', 'shares', 'cost_price', 'last_price'];
    const asset = { id: fd.get('id') || undefined, type };
    for (const [k, v] of fd.entries()) {
        if (k === 'id' || k === 'type') continue;
        asset[k] = numeric.includes(k) ? (v === '' ? null : Number(v)) : v.trim();
    }
    if (type === 'stock' && asset.symbol) asset.symbol = asset.symbol.toUpperCase();
    // 現價有改 → 記低時間
    if (type === 'stock' && asset.last_price !== null) {
        const before = state.assets.find((a) => a.id === asset.id);
        if (!before || Number(before.last_price) !== asset.last_price) asset.price_updated_at = new Date().toISOString();
        else asset.price_updated_at = before.price_updated_at;
    }
    return asset;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const asset = readForm();
    if (asset.type === 'fd' && asset.start_date && asset.maturity_date && asset.maturity_date <= asset.start_date) {
        $('#asset-error').textContent = '到期日要喺開始日之後';
        $('#asset-error').hidden = false;
        return;
    }
    try {
        await store.saveAsset(asset);
        dialog.close();
        toast('已儲存');
        await reload();
    } catch (err) {
        $('#asset-error').textContent = '儲存失敗：' + (err.message || err);
        $('#asset-error').hidden = false;
    }
});

$('#asset-cancel').addEventListener('click', () => dialog.close());
$('#type-picker').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (b) setType(b.dataset.type);
});
$('#asset-delete').addEventListener('click', async () => {
    const id = form.elements.id.value;
    const a = state.assets.find((x) => x.id === id);
    if (!a || !confirm(`確定刪除「${a.name}」？`)) return;
    try {
        await store.deleteAsset(id);
        dialog.close();
        toast('已刪除');
        await reload();
    } catch (err) {
        toast('刪除失敗：' + (err.message || err));
    }
});

$('#add-btn').addEventListener('click', () => openAssetDialog(null));
document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-settings]')) { $('#settings-btn').click(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { showTab(go.dataset.goto); return; }
    const item = e.target.closest('[data-edit]');
    if (!item) return;
    const a = state.assets.find((x) => x.id === item.dataset.edit);
    if (a) openAssetDialog(a);
});

/* ── 設定 ── */
const settingsDialog = $('#settings-dialog');
$('#settings-btn').addEventListener('click', () => {
    const f = $('#settings-form').elements;
    const st = state.settings;
    f.usd_hkd.value = st.usd_hkd;
    for (const k of ['min_cash', 'max_stock_pct', 'max_usd_pct']) f[k].value = st[k] ?? '';
    f.fd_remind_days.value = st.fd_remind_days ?? 7;
    f.email_enabled.checked = st.email_enabled !== false;
    $('#fx-hint').textContent = st.usd_hkd_updated_at
        ? `每朝自動更新，上次更新：${new Date(st.usd_hkd_updated_at).toLocaleString('zh-HK', { dateStyle: 'short', timeStyle: 'short' })}。自己改咗都會俾下次自動更新蓋過。`
        : '每朝自動更新（第一次更新之前用你填嘅數）。港元同美元掛鈎，一般喺 7.75 至 7.85 之間。';
    settingsDialog.showModal();
});
$('#settings-cancel').addEventListener('click', () => settingsDialog.close());
$('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const optional = (el) => (el.value === '' ? null : Number(el.value));
    try {
        await store.saveSettings({
            usd_hkd: Number(f.usd_hkd.value),
            min_cash: optional(f.min_cash),
            max_stock_pct: optional(f.max_stock_pct),
            max_usd_pct: optional(f.max_usd_pct),
            fd_remind_days: Number(f.fd_remind_days.value) || 7,
            email_enabled: f.email_enabled.checked,
        });
        settingsDialog.close();
        toast('已儲存');
        await reload();
    } catch (err) {
        toast('儲存失敗：' + (err.message || err));
    }
});

/* ── 分佈圖 tooltip ── */
const tip = document.createElement('div');
tip.className = 'chart-tip';
tip.hidden = true;
document.body.appendChild(tip);
function showTip(seg, x, y) {
    tip.textContent = seg.dataset.tip;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + 'px';
    tip.style.top = (y - tip.offsetHeight - 12) + 'px';
}
document.addEventListener('pointermove', (e) => {
    const seg = e.target.closest?.('.seg');
    if (seg) showTip(seg, e.clientX, e.clientY);
    else tip.hidden = true;
});
document.addEventListener('pointerdown', (e) => {
    const seg = e.target.closest?.('.seg');
    if (seg) showTip(seg, e.clientX, e.clientY);
});

/* ── 登入 ── */
$('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { email, password } = e.target.elements;
    $('#login-error').hidden = true;
    try {
        await store.signIn(email.value.trim(), password.value);
    } catch (err) {
        $('#login-error').textContent = '登入失敗：' + (err.message || err);
        $('#login-error').hidden = false;
    }
});
$('#logout-btn').addEventListener('click', async () => {
    if (confirm('確定登出？')) await store.signOut();
});

document.querySelectorAll('.bottom-nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

let signedIn = null;
async function applyUser(user) {
    const now = !!user;
    if (now === signedIn) return;
    signedIn = now;
    $('#login-view').hidden = now;
    $('#app-view').hidden = !now;
    if (now) await reload();
    else state.assets = [];
}

(async function init() {
    buildTypePicker();
    $('#demo-banner').hidden = !store.demo;
    store.onAuthChange(applyUser);
    await applyUser(await store.getUser());
    if ('serviceWorker' in navigator && !store.demo && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        navigator.serviceWorker.register('sw.js');
    }
})();
