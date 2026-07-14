export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // Отсекаем +1 от телефонии Ooma
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        // Если есть хотя бы 3 цифры и нет букв - это поиск по ТЕЛЕФОНУ
        const isPhoneSearch = digits.length >= 3 && !/[a-zа-я]/i.test(rawQuery);

        let contacts = [];
        const MAX_PER_PAGE = 100;

        if (isPhoneSearch) {
            // ---------------------------------------------------------
            // ЛОГИКА ТЕЛЕФОНА (ПРОСТАЯ И ПРЯМАЯ)
            // ---------------------------------------------------------
            
            // Шаг 1: Ищем точные цифры в базе
            let dwRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${digits}&per_page=${MAX_PER_PAGE}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            let data = dwRes.ok ? await dwRes.json() : { contacts: [] };
            let potentialContacts = Array.isArray(data) ? data : (data.contacts || []);

            // Шаг 2: Страховка. Если ввели длинный номер, а база ничего не нашла (из-за форматов со скобками), ищем по 4 последним
            if (potentialContacts.length === 0 && digits.length >= 7) {
                const last4 = digits.slice(-4);
                let fallbackRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${last4}&per_page=${MAX_PER_PAGE}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                let fallbackData = fallbackRes.ok ? await fallbackRes.json() : { contacts: [] };
                potentialContacts = Array.isArray(fallbackData) ? fallbackData : (fallbackData.contacts || []);
            }

            // Шаг 3: Жесткий фильтр - оставляем ТОЛЬКО тех, чей номер реально содержит эти цифры
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
            // ---------------------------------------------------------
            // ЛОГИКА ИМЕНИ (С ЖЕСТКИМ ФИЛЬТРОМ ОТ МУСОРА)
            // ---------------------------------------------------------
            const encodedQuery = encodeURIComponent(rawQuery);
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodedQuery}&per_page=${MAX_PER_PAGE}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                const potentialContacts = Array.isArray(data) ? data : (data.contacts || []);
                
                // Шаг 3: Жесткий фильтр имени. Отсекаем людей, если имя/фамилия не совпадают с запросом!
                contacts = potentialContacts.filter(c => {
                    const fullName = `${c.first_name || ''} ${c.last_name || ''} ${c.name || ''}`.toLowerCase();
                    return fullName.includes(rawQuery);
                });
            }
        }

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "No clients found" });

        const topMatches = contacts.slice(0, 15);

        // Подтягиваем дела (Matters)
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
