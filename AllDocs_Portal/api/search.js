export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Vercel: Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Vercel: Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // Отсекаем +1 от телефонии Ooma для входящих звонков
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        // Если есть цифры - ищем по цифрам. Если текст - ищем по тексту.
        const searchTarget = digits.length > 0 ? digits : encodeURIComponent(rawQuery);

        // ПРЯМОЙ ЗАПРОС: без хаков, отдаем всё прямо в базу Docketwise
        const dwResponse = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${searchTarget}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
        });

        if (!dwResponse.ok) {
            return res.status(500).json({ success: false, error: `Docketwise Error: ${dwResponse.status}` });
        }

        const data = await dwResponse.json();
        let contacts = Array.isArray(data) ? data : (data.contacts || []);

        if (contacts.length === 0) {
            return res.status(404).json({ success: false, error: "Docketwise: No clients found" });
        }

        // Ограничиваем выдачу, чтобы форма не зависла, если найдено 100 человек с кодом 818
        const topMatches = contacts.slice(0, 15);

        // Вытягиваем дела
        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown";
            
            let phoneStr = "";
            if (contact.phone_numbers && contact.phone_numbers.length > 0) phoneStr = contact.phone_numbers[0].number || contact.phone_numbers[0];
            else if (contact.phone) phoneStr = contact.phone;

            let mattersArray = [];
            try {
                const mRes = await fetch(`https://app.docketwise.com/api/v1/matters?client_id=${contact.id}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                if (mRes.ok) {
                    const mData = await mRes.json();
                    const mList = Array.isArray(mData) ? mData : (mData.matters || []);
                    mattersArray = mList.map(m => ({ id: m.id, title: m.title || `Matter #${m.id}` }));
                }
            } catch (e) {}

            return { id: contact.id, name: fullName, phone: phoneStr, matters: mattersArray };
        }));

        res.status(200).json({ success: true, clients: clientsData });

    } catch (error) {
        console.error("Search Error:", error);
        res.status(500).json({ success: false, error: "Vercel: Server Crash" });
    }
}
