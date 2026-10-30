export default async function handler(req, res) {
    const { query, type, clientId, downloadDocId } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    const DW_CSRF_TOKEN = process.env.DOCKETWISE_CSRF_TOKEN || "S2SIaBjTm3Al8iBwva92n1nhRwwpFyMfZF08ry5lEFR4x6JOZwG5PSGFWpA7MkfE09vFqUcpbSNlnwAWssHZjg";
    const DW_COOKIE = process.env.DOCKETWISE_COOKIE || "__stripe_mid=7a09a5c6-21ec-4d21-886d-c0bf6cc90d9760274d; intercom-device-id-q07v75s8=345a6aa1-5a77-4f02-afd1-47df40c5c1cd; browser.timezone=America/Los_Angeles; browser_id=a6350fa1-3722-4eac-9f81-3a34c6aa9572; _borderwise_session=8f901a47ce2fe3fc9898508ebf9b6160; intercom-session-q07v75s8=TnFLcXM3Q2RNcm9sRTRQTW5CazZjaGhQUllpU0NiVTQ0Yi84ekwvTDZwTEhjRHZqU2ZDdzNTTytzQWlsYjNPdDgzd3FiQk1idkhCa1cyb0FoRW9wRGkxekpHL3E3Y3MzVmlxbEVtaWo2SVkwckdsV1hSa1lPS0V6V3ROVEFNSEtTVWtnN3FHVDNkWUg5bnFXYnEwM2FGQnRvS1l3ZTYxaDloaGN0V052M2k4d1ErSEhwRlAwRTRHdkhacUUydW9MNFZtKzVoQTBxQUxzNFVQN1pweTZPVklSR0RjMG96b2NPMUVZdlJkdzZKSTBSQWl4NENHZlA3ZGFtS25yVFBEWjZnaU5admlzQWNHK1I1VFhSNkZSbzkvRDRpdCt4YXVjcDF1bUN4U1RQVlRyb3JOSjNzRUd3QmU3QnhkdGl0WEMtLUV6UmN5dVYvNzlkV3NiNi9TN0IvbXc9PQ==--f033a28c53b8aec83838622733173f9f2dc41aba; __stripe_sid=2cd489e7-9fc4-435a-bf3e-1632e9209388ae3582; per_page=50";

    if (!apiKey) return res.status(500).json({ success: false, error: "Ключ не найден" });

    // Умный классификатор файлов клиента (отсеивает мусор и выбирает самые важные для форм!)
    function classifyClientFile(fileName = '') {
        const lower = fileName.toLowerCase();
        // Мусор / Финансовые чеки — низкий приоритет
        if (/(zelle|receipt|invoice|payment|retainer|contract|check|bill_paid)/i.test(lower)) {
            return { category: 'ignore', badge: '💸 Billing/Ignore', priority: 0, autoSelect: false };
        }
        // Корзина 1: Личные документы (Паспорт, ID, SSN, Свидетельство о рождении, Medi-Cal, Адрес)
        if (/(passport|pass|dl|driver|license|id_card|state_id|ssn|social|birth|green_card|greencard|permanent|naturalization|medi-cal|medical_card|bic|benefit|utility|lease|address|questionnaire|intake)/i.test(lower)) {
            return { category: 'identity', badge: '🪪 ID / Personal', priority: 100, autoSelect: true };
        }
        // Корзина 2: Медицинские документы и предыдущие формы (MC 223, SOC, Врачи, Лекарства, SSI)
        if (/(mc_223|mc223|mc 223|soc|873|804|814|453|839|medical|doctor|dr\.|clinic|hospital|meds|medication|rx|diagnosis|visit|summary|noa|ssi|capi|disability|appeal|hearing|dpa)/i.test(lower)) {
            return { category: 'medical_form', badge: '🩺 Medical / Form', priority: 90, autoSelect: true };
        }
        // Все остальные файлы
        return { category: 'other', badge: '📄 Document', priority: 40, autoSelect: false };
    }

    // === РЕЖИМ 1: ПОЛНОЕ ДОСЬЕ КЛИЕНТА + УМНЫЙ СПИСОК ФАЙЛОВ ИЗ ВКЛАДКИ FILES (?clientId=...) ===
    if (clientId) {
        try {
            let contact = {};

            // 1. Запрашиваем профиль контакта через REST API
            const r = await fetch(`https://app.docketwise.com/api/v1/contacts/${clientId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            if (r.ok) {
                const d = await r.json();
                contact = d.contact || d.data || d || {};
            }

            // 2. Запрашиваем расширенный профиль через веб-сессию Docketwise
            try {
                const webRes = await fetch(`https://app.docketwise.com/contacts/${clientId}.json`, {
                    headers: {
                        "accept": "application/json",
                        "x-csrf-token": DW_CSRF_TOKEN,
                        "x-requested-with": "XMLHttpRequest",
                        "cookie": DW_COOKIE,
                        "Referer": `https://app.docketwise.com/en/contacts/${clientId}`
                    }
                });
                if (webRes.ok) {
                    const webData = await webRes.json();
                    const webContact = webData.contact || webData.data || webData || {};
                    contact = { ...contact, ...webContact };
                }
            } catch (e) {}

            // 3. ЗАБИРАЕМ ВСЕ ФАЙЛЫ ИЗ ВКЛАДКИ FILES (/documents?client_id=...)
            let rawFiles = [];
            try {
                // Сначала пробуем получить JSON список документов
                const docJsonRes = await fetch(`https://app.docketwise.com/documents.json?client_id=${clientId}&per_page=50`, {
                    headers: {
                        "accept": "application/json, text/javascript, */*; q=0.01",
                        "x-csrf-token": DW_CSRF_TOKEN,
                        "x-requested-with": "XMLHttpRequest",
                        "cookie": DW_COOKIE,
                        "Referer": `https://app.docketwise.com/en/contacts/${clientId}`
                    }
                });

                const docText = await docJsonRes.text();
                try {
                    const parsedDocs = JSON.parse(docText);
                    const list = Array.isArray(parsedDocs) ? parsedDocs : (parsedDocs.documents || parsedDocs.files || parsedDocs.data || []);
                    list.forEach(item => {
                        const title = item.title || item.name || item.file_name || item.filename || `Document #${item.id}`;
                        rawFiles.push({
                            id: item.id,
                            name: title,
                            url: item.url || item.download_url || item.file_url || `https://app.docketwise.com/documents/${item.id}/download`,
                            updatedAt: item.updated_at || item.created_at || '',
                            size: item.size || item.file_size || ''
                        });
                    });
                } catch (notJsonErr) {
                    // Если Docketwise вернул JS/HTML шаблон (как в перехваченном запросе /documents?client_id=...)
                    const jsRes = await fetch(`https://app.docketwise.com/documents?client_id=${clientId}`, {
                        headers: {
                            "accept": "*/*;q=0.5, text/javascript, application/javascript",
                            "x-csrf-token": DW_CSRF_TOKEN,
                            "x-requested-with": "XMLHttpRequest",
                            "cookie": DW_COOKIE,
                            "Referer": `https://app.docketwise.com/en/contacts/${clientId}`
                        }
                    });
                    const jsBody = await jsRes.text();

                    // Вытаскиваем названия и ID всех файлов из ответа Docketwise
                    const docMatches = [...jsBody.matchAll(/\/documents\/(\d+)(?:\/download|")[^>]*>([^<]+)</g)];
                    docMatches.forEach(m => {
                        const cleanTitle = m[2].replace(/\\n|\\t/g, '').trim();
                        if (cleanTitle && !rawFiles.some(f => String(f.id) === String(m[1]))) {
                            rawFiles.push({
                                id: m[1],
                                name: cleanTitle,
                                url: `https://app.docketwise.com/documents/${m[1]}`,
                                updatedAt: ''
                            });
                        }
                    });
                }
            } catch (docErr) {
                console.warn("Ошибка чтения вкладки Files:", docErr);
            }

            // Применяем Умный Фильтр ко всем найденным файлам
            let classifiedFiles = rawFiles.map(f => {
                const meta = classifyClientFile(f.name);
                return { ...f, ...meta };
            }).sort((a, b) => b.priority - a.priority);

            // Ограничиваем авто-галочки максимум 5 самыми важными файлами
            let autoSelectedCount = 0;
            classifiedFiles = classifiedFiles.map(f => {
                if (f.autoSelect && autoSelectedCount < 5) {
                    autoSelectedCount++;
                    return { ...f, autoSelect: true };
                }
                return { ...f, autoSelect: false };
            });

            // 4. АНАЛИЗИРУЕМ ТЕКСТ ЗАМЕТОК И АНКЕТЫ КЛИЕНТА НА НАЛИЧИЕ SSN, DOB И АДРЕСА
            let notesTextBlob = JSON.stringify(contact);
            try {
                const notesRes = await fetch(`https://app.docketwise.com/en/contacts/${clientId}`, {
                    headers: { "cookie": DW_COOKIE }
                });
                if (notesRes.ok) {
                    const htmlPage = await notesRes.text();
                    notesTextBlob += " " + htmlPage;
                }
            } catch (e) {}

            // Извлекаем базовые поля
            const firstName = contact.first_name || (contact.name ? contact.name.split(' ')[0] : '') || '';
            const lastName = contact.last_name || (contact.name ? contact.name.split(' ').slice(1).join(' ') : '') || '';
            const middleName = contact.middle_name || '';
            const fullName = `${firstName} ${lastName}`.trim() || contact.name || '';
            const lastFirstMI = lastName ? `${lastName}, ${firstName}${middleName ? ' ' + middleName.charAt(0) : ''}` : fullName;

            let phone = contact.mobile_number || contact.home_number || contact.work_number || contact.phone || '';
            if (!phone && Array.isArray(contact.phone_numbers) && contact.phone_numbers.length > 0) {
                phone = contact.phone_numbers[0].number || contact.phone_numbers[0] || '';
            }

            const addrObj = contact.physical_address || contact.mailing_address || (Array.isArray(contact.addresses) ? contact.addresses[0] : {}) || {};
            let street = addrObj.street_number_and_name || addrObj.street || addrObj.address_1 || addrObj.line1 || contact.street_address || contact.address || '';
            const apt = addrObj.apartment_number || addrObj.apt || addrObj.suite || addrObj.address_2 || '';
            if (apt && street && !street.includes(apt)) street = `${street}, Apt ${apt}`;
            let city = addrObj.city || contact.city || 'Glendale';
            let state = addrObj.state || addrObj.province || contact.state || 'CA';
            let zip = addrObj.zip_code || addrObj.postal_code || addrObj.zip || contact.zip || '';

            let rawDob = contact.birthday || contact.date_of_birth || contact.dob || contact.birth_date || '';
            let formattedDob = rawDob;
            if (rawDob && /^\d{4}-\d{2}-\d{2}/.test(rawDob)) {
                const [yr, mo, dy] = rawDob.split('T')[0].split('-');
                formattedDob = `${mo}/${dy}/${yr}`;
            }

            let ssn = contact.ssn || contact.social_security_number || '';
            if (!ssn) {
                const ssnMatch = notesTextBlob.match(/\b(\d{3}-\d{2}-\d{4})\b/);
                if (ssnMatch) ssn = ssnMatch[1];
            }
            if (!formattedDob) {
                const dobMatch = notesTextBlob.match(/(?:DOB|Birth|Birthday)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i);
                if (dobMatch) formattedDob = dobMatch[1].replace(/-/g, '/');
            }

            const aNumber = contact.alien_number || contact.a_number || contact.uscis_number || '';
            const gender = contact.gender || contact.sex || '';
            const email = contact.email || (Array.isArray(contact.email_addresses) && contact.email_addresses[0]?.address) || '';
            const language = contact.primary_language || contact.language || 'Armenian';
            const heightFeet = contact.height_feet || '';
            const heightInches = contact.height_inches || '';
            const weight = contact.weight || '';

            return res.status(200).json({
                success: true,
                profile: {
                    id: clientId,
                    firstName,
                    lastName,
                    middleName,
                    fullName,
                    lastFirstMI,
                    phone,
                    email,
                    ssn,
                    aNumber,
                    dob: formattedDob,
                    gender,
                    street,
                    city,
                    state,
                    zip,
                    language,
                    heightFeet,
                    heightInches,
                    weight,
                    files: classifiedFiles
                }
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }

    // === РЕЖИМ 2: СТАНДАРТНЫЙ ПОИСК КЛИЕНТОВ И КЕЙСОВ (?query=...) ===
    if (!query) return res.status(400).json({ success: false, error: "Пустой запрос" });

    const staffMap = {
        332487: "Norayr Badalyan",
        418892: "Petros Eghiazaryan",
        339159: "Mariam Djaradjian",
        332810: "Artak Badalyan",
        341318: "Rima Avetisyan",
        397654: "Gohar Aloyan",
        379998: "Nairi Hovhannisyan",
        445336: "Argishti Shahbazyan"
    };

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        const isPhoneSearch = type === 'phone' || (digits.length >= 4 && !/[a-zа-я]/i.test(rawQuery));

        let contacts = [];

        if (isPhoneSearch) {
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

        const clientsData = await Promise.all(topMatches.map(async (contact) => {
            const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || contact.name || "Unknown Name";
            
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
                    
                    mattersArray = await Promise.all(mattersList.map(async (m) => {
                        let staffName = "";
                        
                        try {
                            const singleMatterRes = await fetch(`https://app.docketwise.com/api/v1/matters/${m.id}`, {
                                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                            });
                            
                            if (singleMatterRes.ok) {
                                const singleData = await singleMatterRes.json();
                                const fullMatter = singleData.data || singleData.matter || singleData;
                                
                                if (Array.isArray(fullMatter.user_ids) && fullMatter.user_ids.length > 0) {
                                    staffName = fullMatter.user_ids.map(id => staffMap[id] || `Staff (ID: ${id})`).join(", ");
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
