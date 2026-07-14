export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Ключ не найден" });
    if (!query) return res.status(400).json({ success: false, error: "Пустой запрос" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // Отсекаем +1 от телефонии Ooma для правильного поиска
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        // Если в запросе 4 и более цифр и нет букв - это 100% телефон
        const isPhoneSearch = digits.length >= 4 && !/[a-zа-я]/i.test(rawQuery);

        let contacts = [];

        if (isPhoneSearch) {
            // =================================================================
            // ТОТ САМЫЙ "РАСШИРЕННЫЙ ПОИСК" ИЗ ВЧЕРАШНЕГО ДНЯ
            // Мы НЕ используем ?search=. Мы просим базу отдать МАКСИМУМ клиентов.
            // =================================================================
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?per_page=500`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                const allContacts = Array.isArray(data) ? data : (data.contacts || []);
                
                // Наш сервер сам сканирует все 500 человек и ищет номер в ЛЮБОМ поле
                contacts = allContacts.filter(c => {
                    let phones = [];
                    if (c.phone) phones.push(c.phone);
                    if (c.mobile_number) phones.push(c.mobile_number);
                    if (c.home_number) phones.push(c.home_number);
                    if (c.work_number) phones.push(c.work_number);
                    if (Array.isArray(c.phone_numbers)) {
                        c.phone_numbers.forEach(p => {
                            if (typeof p === 'string') phones.push(p);
                            else if (p && p.number) phones.push(p.number);
                        });
                    }
                    
                    return phones.some(p => {
                        const cDigits = p.replace(/\D/g, '');
                        return cDigits.includes(digits);
                    });
                });
            }
        } else {
            // Стандартный поиск по имени (он работает хорошо, оставляем как есть)
            const encodedQuery = encodeURIComponent(rawQuery);
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodedQuery}&per_page=100`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                contacts = Array.isArray(data) ? data : (data.contacts || []);
            }
        }

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "Клиенты не найдены" });

        // Отдаем только первые 15 результатов, чтобы форма не зависала
        const topMatches = contacts.slice(0, 15);

        // Вытягиваем дела
        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name";
            
            // Ищем красивый телефон для отображения в форме
            let phoneStr = contact.mobile_number || contact.home_number || contact.work_number || contact.phone || "";
            if (!phoneStr && Array.isArray(contact.phone_numbers) && contact.phone_numbers.length > 0) {
                phoneStr = contact.phone_numbers[0].number || contact.phone_numbers[0] || "";
            }

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
