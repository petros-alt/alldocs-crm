export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;
    if (!apiKey) return res.status(500).json({ error: "API ключ не найден" });

    try {
        const data = req.body;
        let clientId = data.clientId; // Берем ID из формы
        
        // ЗАПАСНОЙ ПЛАН: Если форма потеряла ID, ищем клиента сами по телефону!
        if (!clientId) {
            const encodedSearch = encodeURIComponent(data.phone || data.fullName || '');
            const searchRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodedSearch}`, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
            });
            
            if (searchRes.ok) {
                const searchData = await searchRes.json();
                if (searchData && searchData.contacts && searchData.contacts.length > 0) {
                    clientId = searchData.contacts[0].id; // Спасли ситуацию, нашли ID!
                }
            }
        }

        if (!clientId) {
            throw new Error("Не удалось определить ID клиента. Пожалуйста, убедитесь, что клиент выбран из выпадающего списка.");
        }

        // --- Создаем заметку ИЛИ задачу ---
        let crmResponse;
        
        if (data.actionType === 'Note') {
            const noteText = `[Call Resolved on Spot]\nDate: ${data.date} at ${data.time}\nOperator: ${data.assignedStaff}\nDescription: ${data.description}\nFollow-up: ${data.followUpNotes || 'None'}`;
            
            crmResponse = await fetch(`https://app.docketwise.com/api/v1/notes`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact_id: clientId, client_id: clientId, content: noteText, body: noteText })
            });
        } else {
            const taskText = `[Call Follow-up Needed] from ${data.fullName}\nPhone: ${data.phone}\nDescription: ${data.description}\nNotes: ${data.followUpNotes || 'None'}`;
            
            crmResponse = await fetch(`https://app.docketwise.com/api/v1/tasks`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ contact_id: clientId, client_id: clientId, title: `Call Log: ${data.fullName}`, name: `Call Log: ${data.fullName}`, description: taskText, status: "incomplete" })
            });
        }

        if (!crmResponse.ok) {
            const errText = await crmResponse.text();
            throw new Error(`Сбой Docketwise (Код ${crmResponse.status}): ${errText}`);
        }

        res.status(200).json({ success: true, message: `Успешно сохранено как ${data.actionType}` });

    } catch (error) {
        console.error("Сбой submit_call:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}