export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Ключ не найден" });
    if (!query) return res.status(400).json({ success: false, error: "Пустой запрос" });

    try {
        const rawQuery = query.toLowerCase().trim();
        const digits = rawQuery.replace(/\D/g, '');
        const isPhoneSearch = digits.length >= 7;

        let contacts = [];

        if (isPhoneSearch) {
            // ХАК: Ищем только по последним 4 цифрам! Docketwise их найдет мгновенно.
            const last4 = digits.slice(-4);
            const phoneRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${last4}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            
            if (phoneRes.ok) {
                const data = await phoneRes.json();
                const potentialContacts = Array.isArray(data) ? data : (data.contacts || []);
                
                // Фильтруем на нашем сервере точное совпадение по всему номеру
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
            }
        } else {
            // Стандартный быстрый поиск по имени
            const encodedQuery = encodeURIComponent(rawQuery);
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodedQuery}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                contacts = Array.isArray(data) ? data : (data.contacts || []);
            }
        }

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "Клиенты не найдены" });

        // Ограничиваем список до 12 совпадений
        const topMatches = contacts.slice(0, 12);

        // Вытягиваем дела (Matters)
        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Имя не указано";
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
                    mattersArray = mattersList.map(m => ({ id: m.id, title: m.title || m.description || `Дело #${m.id}` }));
                }
            } catch (e) {}

            return { id: contact.id, name: fullName, phone: phoneStr, matters: mattersArray };
        }));

        res.status(200).json({ success: true, clients: clientsData });

    } catch (error) {
        console.error("Сбой:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
}
