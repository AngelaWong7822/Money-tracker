// 錢錢簿：問 AI（根據用戶資產數字對話）
// 收 facts（計好嘅資產數字）+ 對話 → Gemini → 回覆。對話唔會儲落任何地方。
// 要 secret：GEMINI_API_KEY（可選 GEMINI_MODEL）
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_TURNS = 20;
const MAX_TEXT = 2000;
const MAX_FACTS_BYTES = 60_000;

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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

const SYSTEM = (facts: unknown) => `你係「錢錢簿」入面嘅理財助手，同用戶（一位香港理財新手）傾偈。
用廣東話（繁體中文）答，語氣友善、簡單易明；用到術語就順便解釋。答案盡量精簡，用短段落或者點列。

用戶可以問任何問題，你都盡力答，唔使拒絕話題。只有兩樣要做到：
1. 講到用戶自己嘅資產（金額、持股、定期、盈虧），一定要用下面「用戶資產數字」，唔好自己估或者作；數字冇提供就直接講「錢錢簿冇呢個資料」。
2. 預測、意見或者一般睇法（例如股價走勢、某隻股票或 ETF 好唔好），要講明係估計或者一般睇法，唔係確定事實。

金額用港幣，格式例如 $12,345（美元就寫 US$）。今日日期同匯率喺數字入面（as_of、usd_hkd）。

用戶資產數字（JSON）：
${JSON.stringify(facts)}`;

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

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: '只接受 POST' }, 405);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: '未設定 GEMINI_API_KEY' }, 500);

    // 一定要登入咗先用得
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const anonKey = envKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
    if (!token || !anonKey) return json({ error: '未登入' }, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: '未登入' }, 401);

    let body: { facts?: unknown; messages?: { role?: string; text?: string }[] };
    try {
        body = await req.json();
    } catch {
        return json({ error: '資料格式唔啱' }, 400);
    }
    if (!body.facts || typeof body.facts !== 'object') return json({ error: '冇收到資產數字' }, 400);
    if (JSON.stringify(body.facts).length > MAX_FACTS_BYTES) return json({ error: '資產數字太多' }, 400);
    const messages = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
        .slice(-MAX_TURNS)
        .map((m) => ({ role: m.role as 'user' | 'model', parts: [{ text: m.text!.slice(0, MAX_TEXT) }] }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: '冇收到問題' }, 400);

    let model = Deno.env.get('GEMINI_MODEL') ?? cachedModel ?? 'gemini-2.5-flash';
    const requestBody = JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM(body.facts) }] },
        contents: messages,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    });
    const call = (m: string) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: requestBody,
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
        console.error('Gemini error', res.status, model, detail.slice(0, 300));
        let reason = '';
        try { reason = JSON.parse(detail)?.error?.message ?? ''; } catch { /* ignore */ }
        const msg = res.status === 429 ? '今日 Gemini 免費額度用晒，遲啲再試' : `Gemini 出錯（${res.status}）${reason ? '：' + reason.slice(0, 200) : ''}`;
        return json({ error: msg }, 502);
    }

    const result = await res.json();
    const candidate = result?.candidates?.[0];
    const reply = candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('').trim() ?? '';
    if (!reply) {
        const why = candidate?.finishReason === 'SAFETY' ? 'Gemini 因為佢自己嘅安全規則冇答呢條問題，試下換個講法' : 'Gemini 冇回覆，試多次';
        return json({ error: why }, 502);
    }
    return json({ reply, model });
});
