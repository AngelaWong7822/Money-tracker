/* 錢錢簿 — 問 AI：根據你嘅資產數字同 Gemini 傾偈。對話只喺記憶體，關咗 app 就冇。 */

const CHAT_PER_DAY = 30;
const CHAT_STARTERS = [
    '我的資金分佈如何？',
    '未來 3 個月有多少定期到期？',
    '如果股票全部下跌 10%，我的淨資產會減少多少？',
    'ETF 與單一股票有何分別？',
];
const chat = { messages: [], busy: false, prev: undefined };

/* ── 每日次數（記喺呢部機） ── */
function chatUsage() {
    const today = todayISO();
    try {
        const u = JSON.parse(localStorage.getItem('money-chat-usage') || '{}');
        return u.date === today ? u.n : 0;
    } catch {
        return 0;
    }
}
function chatUse() {
    localStorage.setItem('money-chat-usage', JSON.stringify({ date: todayISO(), n: chatUsage() + 1 }));
}

/* ── 將 AI 回覆嘅簡單 markdown 變 HTML（先 escape，安全） ── */
function chatFormat(text) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const out = [];
    let list = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const bullet = line.match(/^[-*•]\s+(.*)$/);
        const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
        if (bullet || numbered) {
            const tag = bullet ? 'ul' : 'ol';
            if (!list || list.tag !== tag) { if (list) out.push(`</${list.tag}>`); list = { tag }; out.push(`<${tag}>`); }
            out.push(`<li>${inline(bullet ? bullet[1] : numbered[2])}</li>`);
            continue;
        }
        if (list) { out.push(`</${list.tag}>`); list = null; }
        if (!line) continue;
        const heading = line.match(/^#{1,4}\s+(.*)$/);
        out.push(heading ? `<p><b>${inline(heading[1])}</b></p>` : `<p>${inline(line)}</p>`);
    }
    if (list) out.push(`</${list.tag}>`);
    return out.join('');
}

function renderChatLog() {
    const log = $('#chat-log');
    if (!chat.messages.length) {
        log.innerHTML = '<p class="chat-empty">可詢問任何關於你資產的問題，或一般理財問題。</p>';
    } else {
        log.innerHTML = chat.messages.map((m) => m.role === 'user'
            ? `<div class="bubble bubble-user">${esc(m.text).replace(/\n/g, '<br>')}</div>`
            : m.error
                ? `<div class="bubble bubble-error">${esc(m.text)}</div>`
                : `<div class="bubble bubble-ai">${chatFormat(m.text)}<div class="bubble-note">AI 回答，並非持牌顧問意見</div></div>`).join('')
            + (chat.busy ? '<div class="bubble bubble-ai bubble-typing"><span></span><span></span><span></span></div>' : '');
        log.scrollTop = log.scrollHeight;
    }
    const left = Math.max(0, CHAT_PER_DAY - chatUsage());
    $('#chat-left').textContent = `今日尚可提問 ${left} 次`;
    $('#chat-starters').hidden = chat.messages.length > 0;
    $('#chat-send').disabled = chat.busy || left === 0;
    $('#chat-clear').hidden = !chat.messages.length;
}

async function chatSend(text) {
    text = text.trim();
    if (!text || chat.busy) return;
    if (chatUsage() >= CHAT_PER_DAY) { toast('今日次數已用完，請明天再試'); return; }
    chat.messages.push({ role: 'user', text });
    chat.busy = true;
    $('#chat-input').value = '';
    renderChatLog();
    try {
        if (chat.prev === undefined) chat.prev = await store.getPrevSnapshot().catch(() => null);
        const facts = buildFacts(state.assets, state.settings, chat.prev, state.trades);
        // 只傳正常對話（唔傳錯誤訊息）
        const history = chat.messages.filter((m) => !m.error).map(({ role, text: t }) => ({ role, text: t }));
        const reply = await store.chat(facts, history);
        chatUse();
        chat.messages.push({ role: 'model', text: reply });
    } catch (err) {
        chat.messages.push({ role: 'model', text: '出錯：' + (err.message || err), error: true });
    } finally {
        chat.busy = false;
        renderChatLog();
        $('#chat-input').focus();
    }
}

(function buildChat() {
    $('#chat-card').innerHTML = `<div class="card chat">
        <div class="card-head"><h2>問 AI</h2><span class="small muted" id="chat-left"></span></div>
        <div id="chat-log" class="chat-log"></div>
        <div id="chat-starters" class="chat-starters">${CHAT_STARTERS.map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <form id="chat-form" class="chat-form">
            <textarea id="chat-input" rows="1" maxlength="2000" placeholder="向 AI 提問…" aria-label="問題"></textarea>
            <button id="chat-send" type="submit" class="btn btn-primary">送出</button>
        </form>
        <div class="chat-foot">
            <span>只傳送計算好的數字，不含戶口號碼及姓名；對話不會儲存</span>
            <button type="button" id="chat-clear" class="link-btn">清除對話</button>
        </div>
    </div>`;

    $('#chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        chatSend($('#chat-input').value);
    });
    // 電腦：Enter 送出，Shift+Enter 換行
    $('#chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) {
            e.preventDefault();
            chatSend(e.target.value);
        }
    });
    // 自動加高
    $('#chat-input').addEventListener('input', (e) => {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
    });
    $('#chat-starters').addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]');
        if (b) chatSend(b.dataset.q);
    });
    $('#chat-clear').addEventListener('click', () => {
        chat.messages = [];
        renderChatLog();
    });
    renderChatLog();
})();
