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
    const el = $('#analysis-reports');
    const left = manualLeftToday();
    const [latest, ...older] = analysis.reports;

    const action = `<div class="card">
        <div class="card-head"><h2>Gemini 分析</h2><span class="small muted">今日尚可分析 ${left} 次</span></div>
        <p class="small muted" style="margin:0 0 0.8rem">根據你現時的資料，撰寫一份淺白的分析。每星期一早上亦會自動產生一份，並以 email 寄給你。</p>
        <button id="analyze-btn" class="btn btn-primary btn-block" ${analysis.busy || left === 0 ? 'disabled' : ''}>
            ${analysis.busy ? 'Gemini 正在分析…（約 10 至 20 秒）' : left === 0 ? '今日次數已用完，請明天再試' : '立即分析'}</button>
        ${analysis.error ? `<p class="error">${esc(analysis.error)}</p>` : ''}
        <p class="hint" style="margin:0.6rem 0 0">只會將計算好的數字傳送給 Gemini（金額、百分比、到期日、股票代號），不會傳送戶口號碼或你的姓名。</p>
    </div>`;

    if (!analysis.loaded) {
        el.innerHTML = action + '<p class="section-note">載入中…</p>';
        return;
    }
    if (!latest) {
        el.innerHTML = action + emptyCard('尚未有報告', '按上方「立即分析」，或等待星期一的自動報告。');
        return;
    }

    el.innerHTML = action + `
        <div class="card report">
            <div class="report-meta">${reportMeta(latest)}</div>
            <p class="report-headline">${esc(latest.content?.headline || '')}</p>
            ${reportBody(latest)}
            <p class="hint" style="margin:1rem 0 0">由 Gemini 根據你的資料自動撰寫，僅供分析，並非投資建議。AI 或會出錯，重要數字請與資產頁核對。</p>
        </div>
        ${older.length ? `<p class="section-note">過往報告</p>` + older.map((r) => `
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
        const facts = buildFacts(state.assets, state.settings, prev, state.trades);
        const { report } = await store.analyzeNow(facts);
        analysis.reports = [report, ...analysis.reports.filter((r) => r.id !== report.id)];
        toast('分析完成');
    } catch (err) {
        analysis.error = '分析失敗：' + (err.message || err);
    } finally {
        analysis.busy = false;
        renderAnalysis();
    }
});
