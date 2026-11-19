// 錢錢簿：Gemini 分析報告
// 收已經計好嘅數字（facts）→ 叫 Gemini 寫白話分析 → 儲落 invest_reports。
// 兩種叫法：
//   1. App「而家分析一次」：用登入 token，每日最多 3 次
//   2. 每週排程（GitHub Actions）：用 sb_secret_ key，body 帶 user_id
// 要 secret：GEMINI_API_KEY（可選 GEMINI_MODEL）
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MANUAL_PER_DAY = 3;
const MAX_FACTS_BYTES = 60_000;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** 讀 key：舊名（SUPABASE_ANON_KEY）冇就由新嘅 JSON 字典（SUPABASE_PUBLISHABLE_KEYS）攞 */
function envKey(legacy: string, jsonName: string): string | undefined {
    const v = Deno.env.get(legacy);
    if (v) return v;
    try {
        const o = JSON.parse(Deno.env.get(jsonName) ?? '{}');
        return (o.default ?? Object.values(o)[0]) as string | undefined;
    } catch {
        return undefined;
    }
}

const PROMPT = (facts: unknown) => `你係一個幫香港新手理財嘅助手，用廣東話（繁體中文）寫一份「每週資產分析」。
讀者係理財新手，要用簡單白話，唔好用術語；一定要用術語就順便解釋。

嚴格規則：
- 只做「分析同描述」，唔好叫佢買、賣、轉倉、開乜產品，唔好推介任何股票、基金或銀行。
- 只可以用下面提供嘅數字，唔好自己估或者作任何數字（例如唔好估股息金額、唔好估未來股價）。
- 金額用港幣，格式例如 $12,345；百分比留一個小數。
- 如果 change_since_last_week 係 null，就講「呢個係第一份報告，下個禮拜開始會同上週比較」。
- 每段 2 至 4 句，簡潔。
- watch_points 係「值得留意嘅事實」，例如定期集中喺同一個月到期、某隻股票佔比高、規則唔符合；冇就留空陣列。

分段（sections 嘅 title 用以下名，冇相關資料嘅段可以略過）：
1. 本週總結
2. 資產分佈
3. 定期
4. 股票
5. 我嘅規則

數字（JSON）：
${JSON.stringify(facts)}`;

const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        headline: { type: 'STRING' },
        sections: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: { title: { type: 'STRING' }, body: { type: 'STRING' } },
                required: ['title', 'body'],
            },
        },
        watch_points: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['headline', 'sections', 'watch_points'],
};

// 由 Google 攞模型清單，揀版本最新、支援 generateContent 嘅正式版 Flash
let cachedModel: string | null = null;
async function pickFlashModel(apiKey: string): Promise<string | null> {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) return null;
    const { models = [] } = await res.json();
    const version = (n: string) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const names: string[] = models
        .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: { name: string }) => m.name.replace(/^models\//, ''))
        .filter((n: string) => /^gemini-[\d.]+-flash(-\d+)?$/.test(n) || /^gemini-[\d.]+-flash-latest$/.test(n) || n === 'gemini-flash-latest');
    names.sort((a, b) => version(b) - version(a));
    cachedModel = names[0] ?? null;
    return cachedModel;
}

async function callGemini(apiKey: string, facts: unknown) {
    let model = Deno.env.get('GEMINI_MODEL') ?? cachedModel ?? 'gemini-2.5-flash';
    const body = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT(facts) }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
    });
    const call = (m: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
    });
    let res = await call(model);
    if (res.status === 404) {
        await res.body?.cancel();
        const fallback = await pickFlashModel(apiKey);
        if (fallback && fallback !== model) {
            model = fallback;
            res = await call(model);
        }
    }
    if (!res.ok) {
        const detail = await res.text();
        console.error('Gemini error', res.status, model, detail.slice(0, 500));
        let reason = '';
        try { reason = JSON.parse(detail)?.error?.message ?? ''; } catch { /* ignore */ }
        throw new Error(`Gemini 出錯（${res.status}，${model}）${reason ? '：' + reason.slice(0, 200) : ''}`);
    }
    const result = await res.json();
    const text = result?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    const parsed = JSON.parse(text);
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    return {
        model,
        content: {
            headline: str(parsed.headline, 200),
            sections: (Array.isArray(parsed.sections) ? parsed.sections : []).slice(0, 8)
                .map((s: { title?: unknown; body?: unknown }) => ({ title: str(s.title, 40), body: str(s.body, 1200) }))
                .filter((s: { title: string; body: string }) => s.title && s.body),
            watch_points: (Array.isArray(parsed.watch_points) ? parsed.watch_points : []).slice(0, 8)
                .map((w: unknown) => str(w, 300)).filter(Boolean),
        },
    };
}

/** 香港時間今日 00:00 嘅 ISO 時間 */
function hkDayStartISO() {
    const hk = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    return `${hk}T00:00:00+08:00`;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: '只接受 POST' }, 405);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: '未設定 GEMINI_API_KEY' }, 500);
    const url = Deno.env.get('SUPABASE_URL')!;
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: '未登入' }, 401);

    let body: { facts?: unknown; user_id?: string; source?: string };
    try {
        body = await req.json();
    } catch {
        return json({ error: '資料格式唔啱' }, 400);
    }
    if (!body.facts || typeof body.facts !== 'object') return json({ error: '冇收到數字' }, 400);
    if (JSON.stringify(body.facts).length > MAX_FACTS_BYTES) return json({ error: '數字太多' }, 400);

    // ── 每週排程：secret key ──
    if (token.startsWith('sb_secret_')) {
        if (!body.user_id) return json({ error: '要 user_id' }, 400);
        const admin = createClient(url, token, { auth: { persistSession: false } });
        const check = await admin.from('invest_reports').select('id', { head: true, count: 'exact' }).limit(1);
        if (check.error) return json({ error: 'key 唔啱' }, 401);
        try {
            const { model, content } = await callGemini(apiKey, body.facts);
            const { data, error } = await admin.from('invest_reports')
                .insert({ user_id: body.user_id, source: 'weekly', content, facts: body.facts, model })
                .select('id, created_at, source, content, model').single();
            if (error) throw error;
            return json({ report: data });
        } catch (err) {
            return json({ error: (err as Error).message || String(err) }, 502);
        }
    }

    // ── App：登入用戶 ──
    const anonKey = envKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
    if (!anonKey) return json({ error: '伺服器設定唔齊' }, 500);
    const db = createClient(url, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: '未登入' }, 401);

    const { count, error: countError } = await db.from('invest_reports')
        .select('id', { head: true, count: 'exact' })
        .eq('source', 'manual')
        .gte('created_at', hkDayStartISO());
    if (countError) return json({ error: countError.message }, 500);
    if ((count ?? 0) >= MANUAL_PER_DAY) {
        return json({ error: `今日已經分析咗 ${MANUAL_PER_DAY} 次，聽日再試啦`, remaining: 0 }, 429);
    }

    try {
        const { model, content } = await callGemini(apiKey, body.facts);
        const { data, error } = await db.from('invest_reports')
            .insert({ source: 'manual', content, facts: body.facts, model })
            .select('id, created_at, source, content, model').single();
        if (error) throw error;
        return json({ report: data, remaining: MANUAL_PER_DAY - (count ?? 0) - 1 });
    } catch (err) {
        return json({ error: (err as Error).message || String(err) }, 502);
    }
});
