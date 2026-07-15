export default async function handler(req, res) {
    const { query, type } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Ключ не найден" });
    if (!query) return res.status(400).json({ success: false, error: "Пустой запрос" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        // Отсекаем +1 от Ooma
        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        // Надежная проверка: либо явно передан type=phone, либо в запросе одни цифры (минимум 4)
        const isPhoneSearch = type === 'phone' || (digits.length >= 4 && !/[a-zа-я]/i.test(rawQuery));

        let contacts = [];

        if (isPhoneSearch) {
            // ==========================================
            // ПАРАЛЛЕЛЬНАЯ ЗАГРУЗКА 5000 КЛИЕНТОВ
            // ==========================================
            const fetchPromises = [];
            
            for (let page = 1; page <= 10; page++) {
                fetchPromises.push(
                    fetch(`https://app.docketwise.com/api/v1/contacts?per_page=500&page=${page}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                    }).then(r => r.ok ? r.json() : { contacts: [] })
                );
            }

            const results = await Promise.all(fetchPromises);
            
            let allContacts = [];
            results.forEach(data => {
                allContacts = allContacts.concat(Array.isArray(data) ? data : (data.contacts || []));
            });

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

        } else {
            // ==========================================
            // ПОИСК ПО ИМЕНИ
            // ==========================================
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

        const topMatches = contacts.slice(0, 15);

        // Вытягиваем дела
        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name";
            
            let phoneStr = contact.mobile_number || contact.home_number || contact.work_number || contact.phone || "";
            if (!phoneStr && Array.isArray(contact.phone_numbers) && contact.phone_numbers.length > 0) {
                phoneStr = contact.phone_numbers[0].number || contact.phone_numbers[0] || "";
            }

            let mattersArray = [];
            try {
                // 1. Получаем базовый список дел клиента
                const mattersRes = await fetch(`https://app.docketwise.com/api/v1/matters?client_id=${contact.id}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                
                if (mattersRes.ok) {
                    const mattersData = await mattersRes.json();
                    const mattersList = Array.isArray(mattersData) ? mattersData : (mattersData.matters || []);
                    
                    // 2. Для каждого дела делаем мгновенный микро-запрос в его ПОЛНУЮ карточку
                    mattersArray = await Promise.all(mattersList.map(async (m) => {
                        let staffName = "";
                        
                        try {
                            const singleMatterRes = await fetch(`https://app.docketwise.com/api/v1/matters/${m.id}`, {
                                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                            });
                            
                            if (singleMatterRes.ok) {
                                const singleData = await singleMatterRes.json();
                                // API может отдавать ответ внутри ключа data, matter или просто объектом
                                const fullMatter = singleData.data || singleData.matter || singleData;
                                
                                // Вытаскиваем официальных сотрудников из карточки дела (как на скриншоте)
                                if (fullMatter.assignee_names) {
                                    staffName = fullMatter.assignee_names.replace(/@/g, '').trim();
                                } else if (Array.isArray(fullMatter.assignees) && fullMatter.assignees.length > 0) {
                                    // Если сотрудников несколько, склеиваем их через запятую
                                    staffName = fullMatter.assignees.map(a => a.name || a.first_name || "").filter(Boolean).join(", ");
                                } else if (fullMatter.attorney_name) {
                                    staffName = fullMatter.attorney_name;
                                }
                            }
                        } catch (err) {
                            console.error(`Не удалось загрузить дело ${m.id}:`, err);
                        }

                        return { 
                            id: m.id, 
                            title: m.title || m.description || `Дело #${m.id}`,
                            assignee_name: staffName 
                        };
                    }));
                }
            } catch (e) {
                console.error("Ошибка при получении профиля клиента:", e);
            }

            return { id: contact.id, name: fullName, phone: phoneStr, matters: mattersArray };
        }));

        res.status(200).json({ success: true, clients: clientsData });

    } catch (error) {
        console.error("Сбой:", error);
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
}
