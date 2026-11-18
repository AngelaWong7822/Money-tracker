/* 錢錢簿 — 影相匯入：截圖 → Gemini → 確認畫面 → 儲存 */

const importDialog = $('#import-dialog');
const importFile = $('#import-file');
const MAX_IMPORT_IMAGES = 5;
let importItems = [];

/** 喺部機將圖縮細做 JPEG（最長邊 1600px），慳流量同 Gemini 額度 */
async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error(`讀唔到「${file.name}」，試下用 JPG 或 PNG`));
            i.src = url;
        });
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        return { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] };
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** 同現有資產比較，搵可能重複 */
function findDuplicate(item) {
    const inst = (item.institution || '').toLowerCase();
    return state.assets.find((a) => {
        if (a.type !== item.type || (a.institution || '').toLowerCase() !== inst) return false;
        if (item.type === 'stock') return item.symbol && (a.symbol || '').toUpperCase() === item.symbol.toUpperCase();
        if (item.type === 'fd') return Number(a.amount) === Number(item.amount) && a.maturity_date === item.maturity_date;
        return Number(a.amount) === Number(item.amount);
    });
}

const field = (idx, name, label, value, attrs = '') =>
    `<label>${label}<input data-idx="${idx}" data-field="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
const numField = (idx, name, label, value, step = '0.01') =>
    field(idx, name, label, value, `type="number" step="${step}" min="0" inputmode="decimal"`);

function renderImportCard(item, idx) {
    const t = item.type;
    const typeOptions = [...ALLOCATION_ORDER, 'credit']
        .map((k) => `<option value="${k}" ${k === t ? 'selected' : ''}>${TYPES[k].label}</option>`).join('');
    const amountLabel = { fd: '本金', credit: '欠款', mpf: '結餘', insurance: '現金價值' }[t] || '金額';
    return `<div class="import-card ${item.checked ? '' : 'unchecked'}" data-card="${idx}">
        <div class="import-card-head">
            <label class="check"><input type="checkbox" data-idx="${idx}" data-field="checked" ${item.checked ? 'checked' : ''}> 匯入呢筆</label>
            ${item.duplicate ? `<span class="badge badge-soon">可能重複：已有「${esc(item.duplicate)}」</span>` : ''}
        </div>
        <div class="row">
            <label>類別<select data-idx="${idx}" data-field="type">${typeOptions}</select></label>
            <label class="narrow">貨幣<select data-idx="${idx}" data-field="currency">
                <option ${item.currency === 'HKD' ? 'selected' : ''}>HKD</option>
                <option ${item.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
        </div>
        <div class="row">
            ${field(idx, 'name', '名稱', item.name)}
            ${field(idx, 'institution', '銀行／機構', item.institution)}
        </div>
        ${t === 'stock' ? `
            <div class="row">${field(idx, 'symbol', '代號', item.symbol)}${numField(idx, 'shares', '股數', item.shares, '0.0001')}</div>
            <div class="row">${numField(idx, 'cost_price', '買入價（每股）', item.cost_price, '0.0001')}${numField(idx, 'last_price', '現價（每股）', item.last_price, '0.0001')}</div>`
        : `<div class="row">${numField(idx, 'amount', amountLabel, item.amount)}${t === 'fd' ? numField(idx, 'rate', '年息 %', item.rate, '0.001') : ''}</div>`}
        ${t === 'fd' ? `<div class="row">${field(idx, 'start_date', '開始日', item.start_date, 'type="date"')}${field(idx, 'maturity_date', '到期日', item.maturity_date, 'type="date"')}</div>` : ''}
        <p class="error" data-card-error="${idx}" hidden></p>
    </div>`;
}

function renderImportList() {
    $('#import-list').innerHTML = importItems.map(renderImportCard).join('');
    const n = importItems.length;
    const dup = importItems.filter((i) => i.duplicate).length;
    $('#import-summary').textContent = n
        ? `搵到 ${n} 筆${dup ? `，其中 ${dup} 筆可能已經有咗（預設唔剔）` : ''}。`
        : '';
    $('#import-save').hidden = !n;
    if (!n) showImportError('喺截圖入面搵唔到資產。試下用定期詳情頁或者股票持倉頁嘅截圖。');
}

function showImportError(msg) {
    $('#import-error').textContent = msg;
    $('#import-error').hidden = false;
}

// 欄位改咗 → 更新 importItems；改類別就重畫嗰張卡
$('#import-list').addEventListener('change', (e) => {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    const idx = Number(el.dataset.idx);
    const item = importItems[idx];
    const f = el.dataset.field;
    if (f === 'checked') {
        item.checked = el.checked;
        el.closest('.import-card').classList.toggle('unchecked', !el.checked);
        return;
    }
    item[f] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim();
    if (f === 'type') {
        const card = el.closest('.import-card');
        card.outerHTML = renderImportCard(item, idx);
    }
});

function validateItem(item) {
    if (!item.name) return '要填名稱';
    if (item.type === 'stock') return item.shares ? null : '要填股數';
    if (item.amount === null || item.amount === undefined || item.amount === '') return '要填金額';
    if (item.type === 'fd') {
        if (!item.maturity_date) return '要填到期日';
        if (item.start_date && item.maturity_date <= item.start_date) return '到期日要喺開始日之後';
    }
    return null;
}

$('#import-save').addEventListener('click', async () => {
    $('#import-error').hidden = true;
    document.querySelectorAll('[data-card-error]').forEach((p) => { p.hidden = true; });
    const chosen = importItems.map((item, idx) => ({ item, idx })).filter(({ item }) => item.checked);
    if (!chosen.length) { showImportError('未剔任何一筆'); return; }

    let bad = false;
    for (const { item, idx } of chosen) {
        const err = validateItem(item);
        if (err) {
            const p = document.querySelector(`[data-card-error="${idx}"]`);
            p.textContent = err;
            p.hidden = false;
            bad = true;
        }
    }
    if (bad) { showImportError('有啲欄未填好，睇返紅色字'); return; }

    const btn = $('#import-save');
    btn.disabled = true;
    let saved = 0;
    try {
        for (const { item } of chosen) {
            const { checked, duplicate, ...asset } = item;
            if (asset.type === 'stock' && asset.last_price !== null && asset.last_price !== undefined) {
                asset.price_updated_at = new Date().toISOString();
            }
            await store.saveAsset(asset);
            saved++;
        }
        importDialog.close();
        toast(`已匯入 ${saved} 筆`);
    } catch (err) {
        showImportError(`儲存咗 ${saved} 筆之後出錯：${err.message || err}`);
    } finally {
        btn.disabled = false;
        await reload();
    }
});

$('#import-cancel').addEventListener('click', () => importDialog.close());

$('#import-btn').addEventListener('click', () => {
    importFile.value = '';
    importFile.click();
});

importFile.addEventListener('change', async () => {
    const files = [...importFile.files];
    if (!files.length) return;
    dialog.close();
    importItems = [];
    $('#import-error').hidden = true;
    $('#import-result').hidden = true;
    $('#import-save').hidden = true;
    $('#import-loading').hidden = false;
    importDialog.showModal();

    try {
        if (files.length > MAX_IMPORT_IMAGES) throw new Error(`一次最多揀 ${MAX_IMPORT_IMAGES} 張`);
        const images = await Promise.all(files.map(compressImage));
        const found = await store.extractFromImages(images);
        importItems = found.map((a) => {
            const dup = findDuplicate(a);
            return { ...a, checked: !dup, duplicate: dup ? dup.name : null };
        });
        $('#import-result').hidden = false;
        renderImportList();
    } catch (err) {
        console.error(err);
        showImportError('辨認失敗：' + (err.message || err));
    } finally {
        $('#import-loading').hidden = true;
    }
});
