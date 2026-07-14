export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // 1. ФИКС ДЛЯ OOMA: Отсекаем код страны 1 для входящих звонков
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        const isPhoneSearch = digits.length >= 3;
        let contacts = [];

        if (isPhoneSearch) {
            let potentialContacts = [];

            // ПОПЫТКА 1: Прямой поиск по всем введенным цифрам. 
            // Идеально находит Артура (8184780991) и частичные вводы (8184)
            const res1 = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${digits}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (res1.ok) {
                const data1 = await res1.json();
                potentialContacts = Array.isArray(data1) ? data1 : (data1.contacts || []);
            }

            // ПОПЫТКА 2 (Запасная): Твой старый хак. 
            // Если юзер ввел длинный номер, а база ничего не нашла (значит номер со скобками)
            if (potentialContacts.length === 0 && digits.length >= 7) {
                const last4 = digits.slice(-4);
                const res2 = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${last4}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                if (res2.ok) {
                    const data2 = await res2.json();
                    potentialContacts = Array.isArray(data2) ? data2 : (data2.contacts || []);
                }
            }

            // ЖЕСТКИЙ ФИЛЬТР: Оставляем только тех, кто реально содержит эти цифры
            contacts = potentialContacts.filter(c => {
                let cPhone = "";
                if (c.phone_numbers && c.phone_numbers.length > 0) cPhone = c.phone_numbers[0].number || c.phone_numbers[0];
                else if (c.phone) cPhone = c.phone;
                
                if (typeof cPhone === 'string') {
                    const cDigits = cPhone.replace(/\D/g, '');
                    return cDigits.includes(digits);
                }
                return false;
            });

        } else {
            // Поиск по имени
            const encodedQuery = encodeURIComponent(rawQuery);
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodedQuery}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                contacts = Array.isArray(data) ? data : (data.contacts || []);
            }
        }

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "No clients found" });

        const topMatches = contacts.slice(0, 15);

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
        res.status(500).json({ success: false, error: "Server Error" });
    }
}
