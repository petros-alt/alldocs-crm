export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        const digits = rawQuery.replace(/\D/g, '');
        const isPhoneSearch = digits.length >= 4 && /\d/.test(rawQuery);

        let contacts = [];

        if (isPhoneSearch) {
            // Умный поиск: сначала пытаемся искать по формату (XXX) XXX-XXXX
            let searchStr = rawQuery;
            if (digits.length >= 10) {
                const clean10 = digits.slice(-10);
                searchStr = `(${clean10.slice(0,3)}) ${clean10.slice(3,6)}-${clean10.slice(6,10)}`;
            } else if (digits.length > 4) {
                searchStr = digits.slice(-4);
            }

            let phoneRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodeURIComponent(searchStr)}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            
            let data = phoneRes.ok ? await phoneRes.json() : { contacts: [] };
            let potentialContacts = Array.isArray(data) ? data : (data.contacts || []);

            // Запасной план: если ничего не нашли, ищем железно по последним 4 цифрам
            if (potentialContacts.length === 0 && digits.length >= 4) {
                const last4 = digits.slice(-4);
                let fallbackRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${last4}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                let fallbackData = fallbackRes.ok ? await fallbackRes.json() : { contacts: [] };
                potentialContacts = Array.isArray(fallbackData) ? fallbackData : (fallbackData.contacts || []);
            }
            
            // Фильтруем от мусора, оставляя только точные совпадения
            const searchTarget = digits.length >= 7 ? digits.slice(-7) : digits;
            contacts = potentialContacts.filter(c => {
                let cPhone = "";
                if (c.phone_numbers && c.phone_numbers.length > 0) cPhone = c.phone_numbers[0].number || c.phone_numbers[0];
                else if (c.phone) cPhone = c.phone;
                
                if (typeof cPhone === 'string') {
                    const cDigits = cPhone.replace(/\D/g, '');
                    return cDigits.endsWith(searchTarget) || cDigits.includes(searchTarget) || searchTarget.includes(cDigits);
                }
                return false;
            });
        } else {
            // Обычный поиск по имени
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

        const topMatches = contacts.slice(0, 10);

        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name";
            let phoneStr = "";
            if (contact.phone_numbers && contact.phone_numbers.length > 0) phoneStr = contact.phone_numbers[0].number || contact.phone_numbers[0];
            else if (contact.phone) phoneStr = contact.phone;

            let mattersArray = [];
            try {
                const mattersRes = await fetch(`https://app.docketwise.com/api/v1/matters?client_id=${contact.id}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                if (mattersRes.ok) {
                    const mattersData = await mattersRes.json();
                    const mattersList = Array.isArray(mattersData) ? mattersData : (mattersData.matters || []);
                    mattersArray = mattersList.map(m => ({ id: m.id, title: m.title || m.description || `Matter #${m.id}` }));
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
