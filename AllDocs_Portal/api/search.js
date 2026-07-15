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
                // Скачиваем ПОЛНЫЙ профиль клиента, чтобы получить и Дела, и Заметки
                const fullRes = await fetch(`https://app.docketwise.com/api/v1/contacts/${contact.id}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                
                if (fullRes.ok) {
                    const fullData = await fullRes.json();
                    const dataObj = fullData.data || fullData; 
                    const mattersList = dataObj.matters || [];
                    const notesList = dataObj.notes || [];
                    
                    mattersArray = mattersList.map(m => {
                        let staffName = "";

                        // ШАГ 1: Пытаемся взять сотрудника напрямую из Дела (Matter), как на твоем скриншоте
                        if (m.assignee_names) {
                            staffName = m.assignee_names.replace(/@/g, '').split(',')[0].trim();
                        } else if (m.assignee && m.assignee.name) {
                            staffName = m.assignee.name;
                        } else if (m.attorney_name) {
                            staffName = m.attorney_name;
                        } else if (Array.isArray(m.assignees) && m.assignees.length > 0) {
                            staffName = m.assignees[0].name || m.assignees[0].first_name || "";
                        }

                        // ШАГ 2: Если Дело пустое, используем резервный поиск по Заметкам (Notes)
                        if (!staffName) {
                            const matterNotes = notesList.filter(n => n.matter_id === m.id);
                            for (const note of matterNotes) {
                                if (note.assignee_names) {
                                    staffName = note.assignee_names.replace(/@/g, '').split(',')[0].trim();
                                    break;
                                } else if (note.created_by_name) {
                                    staffName = note.created_by_name.trim();
                                    break;
                                }
                            }
                        }

                        return { 
                            id: m.id, 
                            title: m.title || m.description || `Дело #${m.id}`,
                            assignee_name: staffName 
                        };
                    });
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
