export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // ФИКС ДЛЯ OOMA: Отсекаем код страны 1 для американских входящих звонков
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        // НАЧИНАЕМ ПОИСК С 3-Й ЦИФРЫ (как ты и просил)
        const isPhoneSearch = digits.length >= 3;

        let contacts = [];

        if (isPhoneSearch) {
            // АГРЕССИВНАЯ СЕТЬ DOCKETWISE
            // Делаем сразу 3 запроса, чтобы вытащить клиента, как бы криво ни был записан его номер
            let queriesToTry = new Set();
            queriesToTry.add(digits); // Ищем то, что ввели (сработает для 9433000050)
            if (digits.length >= 3) queriesToTry.add(digits.slice(0, 3)); // Ищем по префиксу
            if (digits.length >= 4) queriesToTry.add(digits.slice(-4)); // Ищем по хвосту

            // Запускаем все запросы одновременно (работает мгновенно)
            const fetchPromises = Array.from(queriesToTry).map(q => 
                fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodeURIComponent(q)}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                }).then(res => res.ok ? res.json() : { contacts: [] })
            );

            const results = await Promise.all(fetchPromises);
            
            // Сливаем всех найденных людей в одну кучу
            let potentialContacts = [];
            results.forEach(data => {
                const arr = Array.isArray(data) ? data : (data.contacts || []);
                potentialContacts = potentialContacts.concat(arr);
            });

            // ЖЕСТКИЙ ФИЛЬТР (СУЖЕНИЕ КРУГА)
            const uniqueMap = new Map();
            
            potentialContacts.forEach(c => {
                let cPhone = "";
                if (c.phone_numbers && c.phone_numbers.length > 0) cPhone = c.phone_numbers[0].number || c.phone_numbers[0];
                else if (c.phone) cPhone = c.phone;
                
                if (typeof cPhone === 'string') {
                    let cDigits = cPhone.replace(/\D/g, '');
                    // Убираем единицу из базы Docketwise, если кто-то сохранил номер через +1
                    if (cDigits.length === 11 && cDigits.startsWith('1')) cDigits = cDigits.substring(1);
                    
                    // Если в номере есть точная последовательность введенных цифр - оставляем клиента
                    if (cDigits.includes(digits) || digits.includes(cDigits)) {
                        uniqueMap.set(c.id, c);
                    }
                }
            });
            
            contacts = Array.from(uniqueMap.values());

        } else {
            // СТАНДАРТНЫЙ ПОИСК ПО ИМЕНИ
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

        // Ограничиваем список
        const topMatches = contacts.slice(0, 12);

        // Вытягиваем дела (Matters)
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
