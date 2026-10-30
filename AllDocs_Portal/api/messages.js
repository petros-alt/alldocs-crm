import crypto from 'crypto';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const postgres = await import('@vercel/postgres');
        const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
        const pool = postgres.createPool({ connectionString });

        // Автоматически создаем таблицу для сообщений
        await pool.sql`
            CREATE TABLE IF NOT EXISTS global_messages (
                id INTEGER PRIMARY KEY,
                data JSONB
            );
        `;

        if (req.method === 'GET') {
            const result = await pool.sql`SELECT data FROM global_messages WHERE id = 1;`;
            const messages = result.rows.length > 0 ? result.rows[0].data : [];
            return res.status(200).json({ success: true, messages: messages });
        }

        if (req.method === 'POST') {
            const { messages, directSms } = req.body || {};

            // === 1. ПРЯМАЯ ОТПРАВКА СМС ЧЕРЕЗ OOMA OFFICE PRO (БЕЗ ZAPIER И БЕЗ ЛИМИТОВ) ===
            let oomaStatus = null;
            if (directSms && directSms.phone && directSms.text) {
                let cleanPhone = String(directSms.phone).replace(/[^\d+]/g, '');
                if (cleanPhone.length === 10 && !cleanPhone.startsWith('+')) {
                    cleanPhone = '+1' + cleanPhone;
                } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
                    cleanPhone = '+' + cleanPhone;
                }

                const oomaToken = process.env.OOMA_AUTH_TOKEN || "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjYzMjg0ODQ2ZWJhNTE1ODhiNzdmMTg5ZDVmNTMwMDc1In0.eyJpc3MiOiJrYXpvbyIsImlkZW50aXR5X3NpZyI6ImxpeVNNT2toRFkyX1NscXpRU28tS2NWeTIySm5IRS10S0I0ZE9qLTQ3YUkiLCJvd25lcl9pZCI6IjYyMmVkYTBkY2IzNjAxMzMxNGY1MDE0Yjc5ZjdhMzkwIiwiYWNjb3VudF9pZCI6Ijc5OGMwYjQxZTNlYjRmM2JkMmY1OGY3OWViNGE3MzMyIiwiZXhwIjoxNzk1OTE0MTUxLCJtZXRob2QiOiJjYl91c2VyX2F1dGgiLCJhcHBsaWNhdGlvbiI6Imthem9vX29vIn0.IkbmY5i8oAAHh4j6NrmDZi-VH85aTcY5rBnynCRU0KYAvlaBQpBBD5it1IkyINtsYORRBPpniY3mkAe3Oqavqtreo59k4iAYdgQkKi6QJuSm2ZHP-L3RUHqMlwXdK7yx35ybqA30GzNCtBnrUE-IqCpgYnHAFWnfI6kZAMFVRTK3ZrkeZFUSjoqmGNpzr5sBbtUTgK4Pctp_gAaNbeU11Ucaq9IWwqhQ2Yh1HFtWifT-FYA4duBF-czJNVd_oNdUi9k79ImwXuLoF4AIa2mEoN9l5nSgQgxI97iO03YR7KMmBerg_SO46v4eJypqeVUpRib39E6xa1MlJYWGCdun3w";
                const oomaLocalNumber = process.env.OOMA_LOCAL_NUMBER || "+17472042404";
                const oomaPostedBy = process.env.OOMA_POSTED_BY || "1008@vdm7h.smb.ooma.com";

                const payload = {
                    data: {
                        text: directSms.text,
                        localNumber: oomaLocalNumber,
                        remoteNumber: [cleanPhone],
                        from: oomaLocalNumber,
                        postedBy: oomaPostedBy,
                        clientMsgId: crypto.randomUUID ? crypto.randomUUID() : ('msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9)),
                        createdTs: Date.now()
                    }
                };

                try {
                    const oomaRes = await fetch("https://officemobile.ooma.com/v2/messaging", {
                        method: "POST",
                        headers: {
                            "accept": "application/json, text/plain, */*",
                            "accept-language": "en-US,en;q=0.6",
                            "content-type": "application/json",
                            "x-auth-token": oomaToken,
                            "Referer": "https://office-app.ooma.com/"
                        },
                        body: JSON.stringify(payload)
                    });
                    const oomaData = await oomaRes.text();
                    oomaStatus = { ok: oomaRes.ok, status: oomaRes.status, response: oomaData };
                } catch (smsErr) {
                    console.error("Ooma Direct SMS Error:", smsErr);
                    oomaStatus = { ok: false, error: smsErr.message };
                }
            }

            // === 2. СОХРАНЕНИЕ ИСТОРИИ СООБЩЕНИЙ В БАЗУ CRM ===
            if (messages) {
                await pool.sql`
                    INSERT INTO global_messages (id, data) 
                    VALUES (1, ${JSON.stringify(messages)})
                    ON CONFLICT (id) DO UPDATE 
                    SET data = EXCLUDED.data;
                `;
            }

            return res.status(200).json({ success: true, ooma: oomaStatus });
        }

        return res.status(405).json({ success: false, message: 'Method not allowed' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}
