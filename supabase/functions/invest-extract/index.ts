// 錢錢簿：影相匯入
// 收截圖 → 叫 Gemini 讀 → 交返整理好嘅資產資料。張圖唔會儲落任何地方。
// 要 secret：GEMINI_API_KEY（可選 GEMINI_MODEL，預設 gemini-2.5-flash）
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_IMAGES = 5;
const MAX_IMAGE_BASE64 = 6_000_000; // 每張約 4.5MB
const TYPES = ['cash', 'fd', 'stock', 'mpf', 'insurance', 'credit', 'other'];

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const PROMPT = (today: string) => `你係一個幫香港人整理個人資產嘅助手。以下係佢銀行／投資 app 嘅截圖（可能係 ZA Bank、Mox Bank 等）。
今日係 ${today}。

請將截圖入面每一筆資產抽出嚟：
- 定期存款 → type "fd"：amount = 本金；rate = 年利率（%，例如 3.2）；start_date、maturity_date 用 YYYY-MM-DD。
  如果只見到存期（例如「3個月」）同開始日，就自己計到期日。
- 股票 → type "stock"：symbol = 股票代號（例如 PG）；shares = 股數；cost_price = 每股平均成本；last_price = 每股現價。amount 留 null。
- 活期／儲蓄戶口結餘 → "cash"；強積金 → "mpf"；儲蓄保險現金價值 → "insurance"；信用卡欠款 → "credit"（amount 用正數）；其他 → "other"。
- currency 只可以係 "HKD" 或 "USD"。
- institution = 銀行或平台名（例如 "ZA Bank"、"Mox Bank"）。
- name = 簡短名稱（例如「3個月定期」、「P&G」）。
- 唔肯定嘅欄位就填 null，唔好估。
- 唔好抽「總資產」「總結餘」呢類加埋嘅總數，只要逐筆資產。
- 唔好喺任何欄位寫戶口號碼、卡號或者人名。
- 搵唔到任何資產就回 {"assets": []}。`;

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type, nullable: true, ...extra });

const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        assets: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    type: { type: 'STRING', enum: TYPES },
                    name: { type: 'STRING' },
                    institution: nullable('STRING'),
                    currency: { type: 'STRING', enum: ['HKD', 'USD'] },
                    amount: nullable('NUMBER'),
                    rate: nullable('NUMBER'),
                    start_date: nullable('STRING'),
                    maturity_date: nullable('STRING'),
                    symbol: nullable('STRING'),
                    shares: nullable('NUMBER'),
                    cost_price: nullable('NUMBER'),
                    last_price: nullable('NUMBER'),
                },
                required: ['type', 'name', 'currency'],
            },
        },
    },
    required: ['assets'],
};

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const strOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

function clean(a: Record<string, unknown>) {
    return {
        type: TYPES.includes(a.type as string) ? a.type : 'other',
        name: strOrNull(a.name) ?? '未命名',
        institution: strOrNull(a.institution),
        currency: a.currency === 'USD' ? 'USD' : 'HKD',
        amount: numOrNull(a.amount),
        rate: numOrNull(a.rate),
        start_date: isDate(a.start_date) ? a.start_date : null,
        maturity_date: isDate(a.maturity_date) ? a.maturity_date : null,
        symbol: strOrNull(a.symbol)?.toUpperCase() ?? null,
        shares: numOrNull(a.shares),
        cost_price: numOrNull(a.cost_price),
        last_price: numOrNull(a.last_price),
    };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: '只接受 POST' }, 405);

    // 一定要登入咗先用得
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!token || !supabaseKey) return json({ error: '未登入' }, 401);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, supabaseKey);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: '未登入' }, 401);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: '未設定 GEMINI_API_KEY' }, 500);
    const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';

    let body: { images?: { mimeType: string; data: string }[]; today?: string };
    try {
        body = await req.json();
    } catch {
        return json({ error: '資料格式唔啱' }, 400);
    }
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) return json({ error: '冇收到圖片' }, 400);
    if (images.length > MAX_IMAGES) return json({ error: `一次最多 ${MAX_IMAGES} 張` }, 400);
    for (const img of images) {
        if (!/^image\/(jpeg|png|webp)$/.test(img?.mimeType ?? '') || typeof img.data !== 'string' || img.data.length > MAX_IMAGE_BASE64) {
            return json({ error: '圖片格式唔啱或者太大' }, 400);
        }
    }
    const today = isDate(body.today) ? body.today! : new Date().toISOString().slice(0, 10);

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [
                    { text: PROMPT(today) },
                    ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })),
                ],
            }],
            generationConfig: {
                temperature: 0,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA,
            },
        }),
    });

    if (!geminiRes.ok) {
        const detail = await geminiRes.text();
        console.error('Gemini error', geminiRes.status, detail.slice(0, 500));
        return json({ error: `Gemini 出錯（${geminiRes.status}）` }, 502);
    }

    const result = await geminiRes.json();
    const text = result?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    try {
        const parsed = JSON.parse(text);
        const assets = Array.isArray(parsed.assets) ? parsed.assets.slice(0, 50).map(clean) : [];
        return json({ assets, model });
    } catch {
        console.error('Unparseable Gemini output', text.slice(0, 500));
        return json({ error: 'Gemini 回覆睇唔明，試多次或者換張清楚啲嘅圖' }, 502);
    }
});
