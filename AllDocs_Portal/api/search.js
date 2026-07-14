export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // Фикс для Ooma: отсекаем +1 для американских звонков
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        const isPhoneSearch = digits.length >= 3 && !/[a-z]/.test(rawQuery);
        let contacts = [];
        const MAX_PER_PAGE = 100;

        if (isPhoneSearch) {
            let searchQueries = [];
            
            // Если ввели 10 цифр, создаем 3 точных формата. 
            // Это решает проблему зоопарка форматов Docketwise без сбора мусора!
            if (digits.length === 10) {
                const format1 = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`; // 


(818) 478-0991

                const format2 = `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;   // 


818-478-0991

                const format3 = digits;                                                            // 


8184780991

                searchQueries = [format1, format2, format3];
            } else if (digits.length >= 7) {
                // Для номеров странной длины оставляем комбинацию
                searchQueries = [digits, digits.slice(-4)];
            } else {
                searchQueries = [digits]; // Для 3-6 цифр
            }

            // Запускаем запросы ПАРАЛЛЕЛЬНО для максимальной скорости Vercel
            const fetchPromises = searchQueries.map(q => 
                fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodeURIComponent(q)}&per_page=${MAX_PER_PAGE}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                }).then(res => res.ok ? res.json() : null)
            );

            const results = await Promise.all(fetchPromises);
            
            let potentialContacts = [];
            results.forEach(data => {
                if (data) {
                    const list = Array.isArray(data) ? data : (data.contacts || []);
                    potentialContacts = potentialContacts.concat(list);
                }
            });

            // ИСПРАВЛЕННЫЙ ЖЕСТКИЙ ФИЛЬТР: Проверяем ВСЕ номера клиента, а не только первый!
            const uniqueIds = new Set();
            contacts = potentialContacts.filter(c => {
                // Убираем дубликаты, так как мы делали несколько параллельных запросов
                if (uniqueIds.has(c.id)) return false;
                
                let phoneValues = [];
                if (c.phone_numbers && Array.isArray(c.phone_numbers)) {
                    phoneValues = c.phone_numbers.map(p => p.number || p);
                } else if (c.phone) {
                    phoneValues = [c.phone];
                }

                // Проверяем, есть ли совпадение ХОТЯ БЫ В ОДНОМ из номеров клиента
                const hasMatch = phoneValues.some(pVal => {
                    if (typeof pVal === 'string') {
                        return pVal.replace(/\D/g, '').includes(digits);
                    }
                    return false;
                });

                if (hasMatch) {
                    uniqueIds.add(c.id);
                    return true;
                }
                return false;
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

        const topMatches = contacts.slice(0, 12);

        // Вытягиваем дела и правильный номер
        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name";
            
            // ИСПРАВЛЕНИЕ: Выводим во фронтенд именно тот номер, который мы искали!
            let phoneStr = "";
            let phoneValues = [];
            if (contact.phone_numbers && Array.isArray(contact.phone_numbers)) {
                phoneValues = contact.phone_numbers;
            } else if (contact.phone) {
                phoneValues = [{ number: contact.phone }];
            }

            const matchedPhoneObj = phoneValues.find(p => {
                const pVal = p.number || p;
                return typeof pVal === 'string' && pVal.replace(/\D/g, '').includes(digits);
            });

            if (matchedPhoneObj) {
                phoneStr = matchedPhoneObj.number || matchedPhoneObj;
            } else if (phoneValues.length > 0) {
                phoneStr = phoneValues[0].number || phoneValues[0];
            }

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
