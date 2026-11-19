/* 錢錢簿 — 賣出股票 + 已賣出記錄（已實現盈虧） */

const sellDialog = $('#sell-dialog');
const sellForm = $('#sell-form');
const tradeDialog = $('#trade-dialog');
const tradeForm = $('#trade-form');
let selling = null;

const nOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function pnlText(pnl, pct, currency, settings) {
    if (pnl === null) return '<span class="muted">未有買入價</span>';
    const cls = pnl >= 0 ? 'up' : 'down';
    const sign = pnl >= 0 ? '+' : '';
    return `<span class="${cls}">${sign}${fmtMoney(pnl, currency, 2)}（${sign}${fmtPct(pct)}）</span>`
        + (currency === 'USD' ? `<div class="hkd-hint">${hkdHint(pnl, currency, settings, true)}</div>` : '');
}

/* ── 「已賣出」卡（放喺資產頁最底） ── */
function renderTradesCard() {
    const trades = state.trades || [];
    if (!trades.length) return '';
    const year = todayISO().slice(0, 4);
    const sum = realizedSummary(trades, state.settings, year);
    const sign = sum.total >= 0 ? '+' : '';
    return `<div class="card">
        <div class="card-head"><h2>已賣出</h2>
            <span class="small ${sum.total >= 0 ? 'up' : 'down'}">${year} 年已實現 ${sign}${fmtMoney(sum.total)}</span></div>
        <ul class="mini-list">${trades.map((t) => {
            const p = tradePnL(t);
            return `<li data-trade="${esc(t.id)}">
                <div><div class="item-name">${esc(t.name)}</div>
                    <div class="item-sub num">${fmtDate(t.sold_on)} · ${Number(t.shares)} 股 · 賣出價 ${fmtMoney(Number(t.sell_price), t.currency, 2)}</div></div>
                <div class="item-right small">${pnlText(p.pnl, p.pct, t.currency, state.settings)}</div>
            </li>`;
        }).join('')}</ul>
        ${explain(`已實現盈虧係已經賣出、真正落袋嘅賺蝕（已扣手續費）。香港冇資本增值稅，所以唔使為呢啲賺蝕報稅。${sum.skipped ? `有 ${sum.skipped} 筆冇買入價，冇計入合計。` : ''}`)}
    </div>`;
}

/* ── 賣出 ── */
function updateSellPreview() {
    const a = selling;
    const f = sellForm.elements;
    const t = { shares: nOrNull(f.shares.value) ?? 0, sell_price: nOrNull(f.sell_price.value) ?? 0, fee: nOrNull(f.fee.value) ?? 0, cost_price: a.cost_price };
    const p = tradePnL(t);
    const hint = (v, signed) => (a.currency === 'USD' ? `（${hkdHint(v, a.currency, state.settings, signed)}）` : '');
    $('#sell-preview').innerHTML = `
        <div class="sell-row"><span>收到</span><b class="num">${fmtMoney(p.proceeds, a.currency, 2)}${hint(p.proceeds)}</b></div>
        <div class="sell-row"><span>已實現盈虧</span><b class="num">${p.pnl === null ? '<span class="muted">未有買入價，計唔到</span>'
            : `<span class="${p.pnl >= 0 ? 'up' : 'down'}">${p.pnl >= 0 ? '+' : ''}${fmtMoney(p.pnl, a.currency, 2)}（${p.pnl >= 0 ? '+' : ''}${fmtPct(p.pct)}）</span>${hint(p.pnl, true)}`}</b></div>`;
    $('#sell-cash-label').textContent = `將收到嘅 ${fmtMoney(p.proceeds, a.currency, 2)} 加入活期：`;
}

function openSell(asset) {
    selling = asset;
    sellForm.reset();
    $('#sell-error').hidden = true;
    const f = sellForm.elements;
    $('#sell-title').textContent = `賣出：${asset.name}${asset.symbol ? `（${asset.symbol}）` : ''}`;
    $('#sell-holding').textContent = `持有 ${Number(asset.shares)} 股${Number(asset.cost_price) > 0 ? ` · 平均買入價 ${fmtMoney(Number(asset.cost_price), asset.currency, 2)}` : ''}`;
    f.sold_on.value = todayISO();
    f.shares.value = asset.shares;
    f.sell_price.value = asset.last_price ?? '';

    // 同一隻貨幣嘅活期先可以加
    const cash = state.assets.filter((a) => a.type === 'cash' && a.currency === asset.currency);
    $('#sell-cash-wrap').hidden = !cash.length;
    $('#sell-cash-select').hidden = !cash.length;
    $('#sell-cash-select').innerHTML = cash.map((c) => `<option value="${esc(c.id)}">${esc((c.institution ? c.institution + ' ' : '') + c.name)}（${fmtMoney(Number(c.amount || 0), c.currency)}）</option>`).join('');
    const sameBank = cash.find((c) => c.institution && c.institution === asset.institution);
    if (sameBank) $('#sell-cash-select').value = sameBank.id;

    updateSellPreview();
    dialog.close();
    sellDialog.showModal();
}

sellForm.addEventListener('input', updateSellPreview);
$('#sell-all').addEventListener('click', () => {
    sellForm.elements.shares.value = selling.shares;
    updateSellPreview();
});
$('#sell-cancel').addEventListener('click', () => sellDialog.close());

$('#asset-sell').addEventListener('click', () => {
    const a = state.assets.find((x) => x.id === form.elements.id.value);
    if (a) openSell(a);
});

sellForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = selling;
    const f = sellForm.elements;
    const shares = nOrNull(f.shares.value);
    const price = nOrNull(f.sell_price.value);
    const fee = nOrNull(f.fee.value) ?? 0;
    const holding = Number(a.shares);
    const err = (m) => { $('#sell-error').textContent = m; $('#sell-error').hidden = false; };
    if (!(shares > 0)) return err('要填賣出股數');
    if (shares > holding + 1e-9) return err(`最多只可以賣 ${holding} 股`);
    if (!(price > 0)) return err('要填賣出價');

    const trade = {
        symbol: a.symbol, name: a.name, institution: a.institution, currency: a.currency,
        shares, cost_price: Number(a.cost_price) > 0 ? Number(a.cost_price) : null,
        sell_price: price, fee, sold_on: f.sold_on.value,
    };
    const proceeds = tradePnL(trade).proceeds;
    let step = '儲存賣出記錄';
    try {
        await store.saveTrade(trade);
        step = '更新持倉';
        const remaining = Math.round((holding - shares) * 1e8) / 1e8;
        if (remaining <= 0) await store.deleteAsset(a.id);
        else await store.saveAsset({ ...a, shares: remaining });
        if (f.add_cash.checked && !$('#sell-cash-wrap').hidden) {
            step = '加入活期';
            const c = state.assets.find((x) => x.id === f.cash_id.value);
            if (c) await store.saveAsset({ ...c, amount: Math.round((Number(c.amount || 0) + proceeds) * 100) / 100 });
        }
        sellDialog.close();
        toast(remaining <= 0 ? '已賣出全部' : `已賣出 ${shares} 股`);
    } catch (e2) {
        err(`「${step}」出錯：${e2.message || e2}${step !== '儲存賣出記錄' ? '（賣出記錄已經儲咗，請檢查持倉）' : ''}`);
    } finally {
        await reload();
    }
});

/* ── 改／刪賣出記錄 ── */
document.addEventListener('click', (e) => {
    const li = e.target.closest('[data-trade]');
    if (!li) return;
    const t = state.trades.find((x) => x.id === li.dataset.trade);
    if (!t) return;
    tradeForm.reset();
    $('#trade-error').hidden = true;
    $('#trade-title').textContent = `賣出記錄：${t.name}`;
    for (const k of ['id', 'sold_on', 'shares', 'fee', 'cost_price', 'sell_price']) tradeForm.elements[k].value = t[k] ?? '';
    tradeDialog.showModal();
});
$('#trade-cancel').addEventListener('click', () => tradeDialog.close());
tradeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = tradeForm.elements;
    const t = state.trades.find((x) => x.id === f.id.value);
    if (!(Number(f.shares.value) > 0) || !(Number(f.sell_price.value) > 0)) {
        $('#trade-error').textContent = '股數同賣出價要大過 0';
        $('#trade-error').hidden = false;
        return;
    }
    try {
        await store.saveTrade({
            ...t,
            sold_on: f.sold_on.value,
            shares: Number(f.shares.value),
            fee: nOrNull(f.fee.value) ?? 0,
            cost_price: nOrNull(f.cost_price.value),
            sell_price: Number(f.sell_price.value),
        });
        tradeDialog.close();
        toast('已儲存');
        await reload();
    } catch (err) {
        $('#trade-error').textContent = '儲存失敗：' + (err.message || err);
        $('#trade-error').hidden = false;
    }
});
$('#trade-delete').addEventListener('click', async () => {
    const id = tradeForm.elements.id.value;
    const t = state.trades.find((x) => x.id === id);
    if (!t || !confirm(`確定刪除「${t.name}」呢筆賣出記錄？持倉股數唔會自動加返。`)) return;
    try {
        await store.deleteTrade(id);
        tradeDialog.close();
        toast('已刪除');
        await reload();
    } catch (err) {
        $('#trade-error').textContent = '刪除失敗：' + (err.message || err);
        $('#trade-error').hidden = false;
    }
});
