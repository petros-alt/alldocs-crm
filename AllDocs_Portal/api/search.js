export default async function handler(req, res) {
    // Теперь мы ловим параметр type из нашего URL
    const { query, type } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Ключ не найден" });
    if (!query) return res.status(400).json({ success: false, error: "Пустой запрос" });

    try {
        const rawQuery = query.toLowerCase().trim();
        // Сервер больше не гадает! Он точно знает, что мы ищем, благодаря type
        const isPhoneSearch = type === 'phone';
        const MAX_PER_PAGE = 100;

        let contacts = [];

        if (isPhoneSearch) {
            let digits = rawQuery.replace(/\D/g, '');
            // Отсекаем +1 от телефонии Ooma
            if (digits.length === 11 && digits.startsWith('1')) {
                digits = digits.substring(1);
            }

            // ХАК: Ищем по 4 последним цифрам (если номер длинный), чтобы обойти скобки в Docketwise
            const searchQuery = digits.length >= 4 ? digits.slice(-4) : digits;
            
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${searchQuery}&per_page=${MAX_PER_PAGE}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                const potentialContacts = Array.isArray(data) ? data : (data.contacts || []);
                
                // ЖЕСТКИЙ ФИЛЬТР: Проверяем ВСЕ поля телефонов. Если совпадения нет - в мусорку!
                contacts = potentialContacts.filter(c => {
                    let phonesToTest = [];
                    if (c.phone) phonesToTest.push(c.phone);
                    if (c.mobile_number) phonesToTest.push(c.mobile_number);
                    if (c.home_number) phonesToTest.push(c.home_number);
                    if (c.work_number) phonesToTest.push(c.work_number);
                    if (Array.isArray(c.phone_numbers)) {
                        c.phone_numbers.forEach(p => {
                            if (typeof p === 'string') phonesToTest.push(p);
                            else if (p && p.number) phonesToTest.push(p.number);
                        });
                    }
                    
                    return phonesToTest.some(p => {
                        if (typeof p === 'string') {
                            const cDigits = p.replace(/\D/g, '');
                            return cDigits.includes(digits) || digits.includes(cDigits);
                        }
                        return false;
                    });
                });
            }
        } else {
            // Стандартный поиск по имени
            const encodedQuery = encodeURIComponent(rawQuery);
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodedQuery}&per_page=${MAX_PER_PAGE}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (response.ok) {
                const data = await response.json();
                contacts = Array.isArray(data) ? data : (data.contacts || []);
            }
        }

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "Клиенты не найдены" });

        // Ограничиваем список до 15 совпадений
        const topMatches = contacts.slice(0, 15);

        // Вытягиваем дела (Matters)
        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name";
            
            // Находим правильный телефон для отображения
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
