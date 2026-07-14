export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ success: false, error: "Missing API Key" });
    if (!query) return res.status(400).json({ success: false, error: "Empty query" });

    try {
        const rawQuery = query.toLowerCase().trim();
        let digits = rawQuery.replace(/\D/g, '');

        if (digits.length === 11 && digits.startsWith('1')) {
            digits = digits.substring(1);
        }

        const isPhoneSearch = digits.length >= 3 && !/[a-zа-я]/i.test(rawQuery);
        let contacts = [];
        const MAX_PER_PAGE = 100;

        if (isPhoneSearch) {
            // ДВОЙНОЙ УДАР ПО ТЕЛЕФОНУ: Ищем и полный ввод, и хвост (чтобы обойти любые скобки)
            let fetchPromises = [
                fetch(`https://app.docketwise.com/api/v1/contacts?search=${digits}&per_page=${MAX_PER_PAGE}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                }).then(r => r.ok ? r.json() : { contacts: [] })
            ];

            if (digits.length >= 4) {
                fetchPromises.push(
                    fetch(`https://app.docketwise.com/api/v1/contacts?search=${digits.slice(-4)}&per_page=${MAX_PER_PAGE}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                    }).then(r => r.ok ? r.json() : { contacts: [] })
                );
            }

            const results = await Promise.all(fetchPromises);
            let potentialContacts = [];
            results.forEach(data => {
                potentialContacts = potentialContacts.concat(Array.isArray(data) ? data : (data.contacts || []));
            });

            // ЖЕСТКИЙ ФИЛЬТР: Оставляем только точные совпадения цифр
            const uniqueMap = new Map();
            potentialContacts.forEach(c => {
                let cPhone = "";
                if (c.phone_numbers && c.phone_numbers.length > 0) cPhone = c.phone_numbers[0].number || c.phone_numbers[0];
                else if (c.phone) cPhone = c.phone;
                
                if (typeof cPhone === 'string') {
                    const cDigits = cPhone.replace(/\D/g, '');
                    if (cDigits.includes(digits)) uniqueMap.set(c.id, c);
                }
            });
            contacts = Array.from(uniqueMap.values());

        } else {
            // ПОИСК ПО ИМЕНИ: Умный фильтр по словам
            const response = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodeURIComponent(rawQuery)}&per_page=${MAX_PER_PAGE}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                const potentialContacts = Array.isArray(data) ? data : (data.contacts || []);
                
                const queryParts = rawQuery.split(' ').filter(Boolean);
                contacts = potentialContacts.filter(c => {
                    const fullName = `${c.first_name || ''} ${c.last_name || ''} ${c.name || ''}`.toLowerCase();
                    // Клиент должен содержать ВСЕ введенные слова (Например: и "karen", и "kha")
                    return queryParts.every(part => fullName.includes(part));
                });
            }
        }

        if (contacts.length === 0) return res.status(404).json({ success: false, error: "No clients found" });

        const topMatches = contacts.slice(0, 15);

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
        res.status(500).json({ success: false, error: "Server Error" });
    }
}
