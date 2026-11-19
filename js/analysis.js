/* 錢錢簿 — 分析分頁：Gemini 報告 */

const MANUAL_PER_DAY = 3;
const analysis = { reports: [], loaded: false, busy: false, error: '' };

function fmtReportTime(iso) {
    const d = new Date(iso);
    const h = d.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} ${h12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

function manualLeftToday() {
    const today = todayISO();
    const used = analysis.reports.filter((r) => {
        if (r.source !== 'manual') return false;
        const d = new Date(r.created_at);
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return local === today;
    }).length;
    return Math.max(0, MANUAL_PER_DAY - used);
}

function reportBody(r) {
    const c = r.content || {};
    const sections = (c.sections || []).map((s) => `
        <h3 class="report-h">${esc(s.title)}</h3>
        <p class="report-p">${esc(s.body).replace(/\n/g, '<br>')}</p>`).join('');
    const watch = (c.watch_points || []).length
        ? `<div class="warn-note"><b>值得留意</b><ul class="watch-list">${c.watch_points.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
        : '';
    return `${sections}${watch}`;
}

function reportMeta(r) {
    return `<span class="badge ${r.source === 'weekly' ? '' : 'badge-done'}">${r.source === 'weekly' ? '每週' : '手動'}</span>
        <span class="small muted">${fmtReportTime(r.created_at)}</span>`;
}

function renderAnalysis() {
    const el = $('#tab-analysis');
    const left = manualLeftToday();
    const [latest, ...older] = analysis.reports;

    const action = `<div class="card">
        <div class="card-head"><h2>Gemini 分析</h2><span class="small muted">今日仲可以分析 ${left} 次</span></div>
        <p class="small muted" style="margin:0 0 0.8rem">用你而家嘅資料，寫一份白話分析。每個禮拜一朝早亦會自動出一份同 email 俾你。</p>
        <button id="analyze-btn" class="btn btn-primary btn-block" ${analysis.busy || left === 0 ? 'disabled' : ''}>
            ${analysis.busy ? 'Gemini 分析緊…（大約 10 至 20 秒）' : left === 0 ? '今日次數用晒，聽日再試' : '而家分析一次'}</button>
        ${analysis.error ? `<p class="error">${esc(analysis.error)}</p>` : ''}
        <p class="hint" style="margin:0.6rem 0 0">只會傳計好嘅數字俾 Gemini（金額、百分比、到期日、股票代號），唔會傳戶口號碼或者你個名。</p>
    </div>`;

    if (!analysis.loaded) {
        el.innerHTML = action + '<p class="section-note">載入緊…</p>';
        return;
    }
    if (!latest) {
        el.innerHTML = action + emptyCard('仲未有報告', '撳上面「而家分析一次」，或者等星期一嘅自動報告。');
        return;
    }

    el.innerHTML = action + `
        <div class="card report">
            <div class="report-meta">${reportMeta(latest)}</div>
            <p class="report-headline">${esc(latest.content?.headline || '')}</p>
            ${reportBody(latest)}
            <p class="hint" style="margin:1rem 0 0">由 Gemini 根據你嘅資料自動寫成，只係分析，唔係投資建議。AI 有機會講錯，重要數字請對返資產頁。</p>
        </div>
        ${older.length ? `<p class="section-note">之前嘅報告</p>` + older.map((r) => `
            <details class="card report report-old">
                <summary><div class="report-meta">${reportMeta(r)}</div><div class="item-name">${esc(r.content?.headline || '')}</div></summary>
                ${reportBody(r)}
            </details>`).join('') : ''}
    `;
}

async function loadAnalysis() {
    renderAnalysis();
    try {
        analysis.reports = await store.listReports();
        analysis.error = '';
    } catch (err) {
        analysis.error = '載入報告失敗：' + (err.message || err);
    }
    analysis.loaded = true;
    renderAnalysis();
}

document.addEventListener('click', async (e) => {
    if (!e.target.closest('#analyze-btn') || analysis.busy) return;
    analysis.busy = true;
    analysis.error = '';
    renderAnalysis();
    try {
        const prev = await store.getPrevSnapshot();
        const facts = buildFacts(state.assets, state.settings, prev);
        const { report } = await store.analyzeNow(facts);
        analysis.reports = [report, ...analysis.reports.filter((r) => r.id !== report.id)];
        toast('分析好咗');
    } catch (err) {
        analysis.error = '分析失敗：' + (err.message || err);
    } finally {
        analysis.busy = false;
        renderAnalysis();
    }
});
