/* 資料層：雲端（Supabase）或者示範模式（?demo=1，只喺記憶體，唔會寫入雲端） */

const SETTINGS_FIELDS = ['usd_hkd', 'min_cash', 'max_stock_pct', 'max_usd_pct', 'fd_remind_days', 'email_enabled'];

const ASSET_FIELDS = [
    'type', 'name', 'institution', 'currency', 'amount',
    'rate', 'start_date', 'maturity_date',
    'symbol', 'shares', 'cost_price', 'last_price', 'price_updated_at',
    'notes',
];

function cleanAsset(input) {
    const out = {};
    for (const k of ASSET_FIELDS) {
        const v = input[k];
        out[k] = v === '' || v === undefined ? null : v;
    }
    return out;
}

function createCloudStore() {
    const client = window.supabase.createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'money-tracker-auth' },
    });

    return {
        demo: false,
        async getUser() {
            const { data } = await client.auth.getSession();
            return data.session?.user ?? null;
        },
        onAuthChange(cb) {
            client.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
        },
        async signIn(email, password) {
            const { error } = await client.auth.signInWithPassword({ email, password });
            if (error) throw error;
        },
        async signOut() {
            await client.auth.signOut();
        },
        async listAssets() {
            const { data, error } = await client
                .from('invest_assets')
                .select('*')
                .eq('deleted', false)
                .order('created_at', { ascending: true });
            if (error) throw error;
            return data;
        },
        async saveAsset(asset) {
            const row = { ...cleanAsset(asset), updated_at: new Date().toISOString() };
            const query = asset.id
                ? client.from('invest_assets').update(row).eq('id', asset.id)
                : client.from('invest_assets').insert(row);
            const { error } = await query;
            if (error) throw error;
        },
        async deleteAsset(id) {
            const { error } = await client
                .from('invest_assets')
                .update({ deleted: true, updated_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;
        },
        async getSettings() {
            const { data, error } = await client.from('invest_settings').select('*').maybeSingle();
            if (error) throw error;
            return data ?? { usd_hkd: 7.8, fd_remind_days: 7, email_enabled: true };
        },
        async saveSettings(settings) {
            const user = await this.getUser();
            const row = { user_id: user.id, updated_at: new Date().toISOString() };
            for (const k of SETTINGS_FIELDS) if (k in settings) row[k] = settings[k];
            const { error } = await client.from('invest_settings').upsert(row);
            if (error) throw error;
        },
        /** 影相匯入：images = [{ mimeType, data(base64) }] → [asset, ...] */
        async extractFromImages(images) {
            const { data, error } = await client.functions.invoke('invest-extract', {
                body: { images, today: todayISO() },
            });
            if (error) {
                let msg = error.message;
                let fromFunction = false;
                try {
                    const body = await error.context.json();
                    if (body?.error) { msg = body.error; fromFunction = true; }
                } catch { /* 冇 JSON 就用原本訊息 */ }
                if (!fromFunction && error.name === 'FunctionsFetchError') msg = '連唔到 invest-extract function，檢查下網絡或者 function 有冇部署';
                throw new Error(msg);
            }
            return data.assets;
        },
    };
}

function createDemoStore() {
    const iso = (offsetDays) => {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return d.toISOString().slice(0, 10);
    };
    let assets = [
        { type: 'cash', name: '活期', institution: 'ZA Bank', currency: 'HKD', amount: 30000 },
        { type: 'fd', name: '3個月定期', institution: 'ZA Bank', currency: 'HKD', amount: 50000, rate: 3.2, start_date: iso(-80), maturity_date: iso(10) },
        { type: 'fd', name: '6個月定期', institution: 'Mox Bank', currency: 'HKD', amount: 80000, rate: 3.0, start_date: iso(-60), maturity_date: iso(122) },
        { type: 'fd', name: '美元定期', institution: 'Mox Bank', currency: 'USD', amount: 5000, rate: 4.0, start_date: iso(-20), maturity_date: iso(70) },
        { type: 'stock', name: 'P&G', institution: 'ZA Bank', currency: 'USD', symbol: 'PG', shares: 7, cost_price: 150, last_price: 160, price_updated_at: new Date().toISOString() },
        { type: 'mpf', name: '強積金', institution: '示範', currency: 'HKD', amount: 120000 },
        { type: 'credit', name: '信用卡', institution: '示範', currency: 'HKD', amount: 3500 },
    ].map((a, i) => ({ id: `demo-${i}`, ...cleanAsset(a), created_at: new Date(Date.now() + i).toISOString() }));
    let settings = { usd_hkd: 7.8, usd_hkd_updated_at: new Date().toISOString(), min_cash: 50000, max_stock_pct: 10, max_usd_pct: 30, fd_remind_days: 7, email_enabled: true };
    const user = { email: 'demo@example.com' };

    return {
        demo: true,
        async getUser() { return user; },
        onAuthChange() {},
        async signIn() {},
        async signOut() { location.href = location.pathname; },
        async listAssets() { return assets.map((a) => ({ ...a })); },
        async saveAsset(asset) {
            if (asset.id) {
                assets = assets.map((a) => (a.id === asset.id ? { ...a, ...cleanAsset(asset) } : a));
            } else {
                assets.push({ id: `demo-${Date.now()}`, ...cleanAsset(asset), created_at: new Date().toISOString() });
            }
        },
        async deleteAsset(id) { assets = assets.filter((a) => a.id !== id); },
        async getSettings() { return { ...settings }; },
        async saveSettings(s) { settings = { ...settings, ...s }; },
        // 示範：假裝 Gemini 讀到兩筆，其中一筆同現有嘅重複
        async extractFromImages() {
            await new Promise((r) => setTimeout(r, 1200));
            return [
                { type: 'fd', name: '3個月定期', institution: 'ZA Bank', currency: 'HKD', amount: 50000, rate: 3.2, start_date: iso(-80), maturity_date: iso(10) },
                { type: 'fd', name: '12個月定期', institution: 'ZA Bank', currency: 'HKD', amount: 20000, rate: 2.8, start_date: iso(0), maturity_date: iso(365) },
                { type: 'stock', name: 'Apple', institution: 'ZA Bank', currency: 'USD', symbol: 'AAPL', shares: 3, cost_price: 190, last_price: null },
            ];
        },
    };
}

const store = new URLSearchParams(location.search).has('demo') ? createDemoStore() : createCloudStore();
