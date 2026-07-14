export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // Фикс для Ooma: отсекаем +1 для американских входящих звонков
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        // Если в запросе нет букв и есть хотя бы 3 цифры — это 100% поиск по номеру
        const isPhoneSearch = digits.length >= 3 && !/[a-z]/.test(rawQuery);

        let contacts = [];
        const MAX_PER_PAGE = 100;

        if (isPhoneSearch) {
            // Оставляем старый хак: ищем по 4 последним цифрам, чтобы обойти форматы в Docketwise
            const searchStr = digits.length >= 7 ? digits.slice(-4) : digits;
            
            // НОВАЯ ЛОГИКА: Пагинация
            let page = 1;
            const MAX_PAGES = 5; // Проверяем до 500 человек (5 страниц), чтобы избежать таймаута на Vercel
            let hasMore = true;

            // Крутим цикл, пока: есть страницы, мы не превысили лимит в 5 страниц, и не нашли 12 контактов
            while (hasMore && page <= MAX_PAGES && contacts.length < 12) {
                const phoneRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${searchStr}&per_page=${MAX_PER_PAGE}&page=${page}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                
                if (!phoneRes.ok) {
                    console.error(`Docketwise API error on page ${page}: ${phoneRes.status}`);
                    break;
                }

                const data = await phoneRes.json();
                const potentialContacts = Array.isArray(data) ? data : (data.contacts || []);
                
                // ЖЕСТКИЙ ЛОКАЛЬНЫЙ ФИЛЬТР
                const matchedContacts = potentialContacts.filter(c => {
                    let cPhone = "";
                    if (c.phone_numbers && c.phone_numbers.length > 0) cPhone = c.phone_numbers[0].number || c.phone_numbers[0];
                    else if (c.phone) cPhone = c.phone;
                    
                    if (typeof cPhone === 'string') {
                        const cDigits = cPhone.replace(/\D/g, '');
                        return cDigits.includes(digits); // Ищем очищенный ввод в очищенном номере
                    }
                    return false;
                });

                // Добавляем найденных на этой странице клиентов в общий массив
                contacts = [...contacts, ...matchedContacts];

                // Если API вернуло меньше 100 человек, значит это последняя страница — пора останавливать цикл
                if (potentialContacts.length < MAX_PER_PAGE) {
                    hasMore = false;
                }
                
                page++; // Переходим к следующей странице
            }
            
            // Дедупликация (на случай, если API Docketwise отдает дубли при пагинации)
            const uniqueIds = new Set();
            contacts = contacts.filter(c => {
                if (uniqueIds.has(c.id)) return false;
                uniqueIds.add(c.id);
                return true;
            });

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

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "No clients found" });

        // Ограничиваем список до 12 совпадений для быстрой загрузки формы
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
