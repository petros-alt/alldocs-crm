export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // 1. ФИКС ДЛЯ OOMA: Отсекаем код страны 1 для американских входящих звонков
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        // 2. Начинаем искать уже с 3 введенных цифр
        const isPhoneSearch = digits.length >= 3;

        let contacts = [];

        if (isPhoneSearch) {
            // ПОПЫТКА 1: Ищем точные цифры (идеально для слитных номеров как у Карен)
            let phoneRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${digits}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            let data = phoneRes.ok ? await phoneRes.json() : { contacts: [] };
            let potentialContacts = Array.isArray(data) ? data : (data.contacts || []);

            // ПОПЫТКА 2 (Запасной план): Если Docketwise запутался в скобках
            if (potentialContacts.length === 0) {
                let fallbackSearch = "";
                if (digits.length >= 7) {
                    // Для длинных номеров ищем по последним 4 цифрам (они всегда без пробелов)
                    fallbackSearch = digits.slice(-4);
                } else {
                    // Для коротких номеров ищем по первым 3 цифрам (код города)
                    fallbackSearch = digits.slice(0, 3);
                }

                let fallbackRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${fallbackSearch}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                let fallbackData = fallbackRes.ok ? await fallbackRes.json() : { contacts: [] };
                potentialContacts = Array.isArray(fallbackData) ? fallbackData : (fallbackData.contacts || []);
            }

            // ЖЕСТКИЙ ФИЛЬТР: Оставляем только тех, у кого есть ВСЕ введенные цифры подряд
            contacts = potentialContacts.filter(c => {
                let cPhone = "";
                if (c.phone_numbers && c.phone_numbers.length > 0) cPhone = c.phone_numbers[0].number || c.phone_numbers[0];
                else if (c.phone) cPhone = c.phone;
                
                if (typeof cPhone === 'string') {
                    const cDigits = cPhone.replace(/\D/g, '');
                    return cDigits.includes(digits) || digits.includes(cDigits);
                }
                return false;
            });

        } else {
            // ОБЫЧНЫЙ ПОИСК ПО ИМЕНИ
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

        const topMatches = contacts.slice(0, 12);

        // Вытягиваем дела
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
