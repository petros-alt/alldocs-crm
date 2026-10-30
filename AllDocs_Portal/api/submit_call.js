export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID || process.env.DOCKETWISE_TOKEN;
    if (!apiKey) return res.status(500).json({ success: false, error: "API ключ Docketwise не найден на сервере" });

    try {
        const data = req.body || {};
        const actionType = data.actionType || 'Note'; // 'Note' | 'Task' | 'CreateContact'
        let clientId = data.clientId;

        // === 1. ЕСЛИ НУЖНО СОЗДАТЬ НОВОГО КЛИЕНТА В DOCKETWISE ===
        if (actionType === 'CreateContact') {
            const fullName = (data.fullName || 'New Client').trim();
            const parts = fullName.split(/\s+/);
            const firstName = parts[0] || 'Client';
            const lastName = parts.slice(1).join(' ') || 'Lead';

            const createRes = await fetch(`https://app.docketwise.com/api/v1/contacts`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    first_name: firstName,
                    last_name: lastName,
                    phone: data.phone || '',
                    phone_numbers_attributes: data.phone ? [{ number: data.phone, label: 'Mobile' }] : [],
                    type: 'Lead'
                })
            });

            if (!createRes.ok) {
                const errText = await createRes.text();
                throw new Error(`Docketwise Create Contact Error (${createRes.status}): ${errText}`);
            }

            const newContact = await createRes.json();
            return res.status(200).json({
                success: true,
                actionType: 'CreateContact',
                clientId: newContact.id,
                contact: newContact,
                message: `Клиент успешно создан в Docketwise (ID: ${newContact.id})`
            });
        }

        // === 2. ПОИСК ID КЛИЕНТА, ЕСЛИ ОН НЕ ПЕРЕДАН ===
        if (!clientId) {
            const rawPhone = (data.phone || '').replace(/\D/g, '');
            const searchQuery = rawPhone.length >= 7 ? rawPhone.slice(-10) : (data.fullName || '');
            if (searchQuery) {
                const searchRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodeURIComponent(searchQuery)}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    const list = Array.isArray(searchData) ? searchData : (searchData.contacts || []);
                    if (list.length > 0) {
                        clientId = list[0].id;
                    }
                }
            }
        }

        if (!clientId) {
            return res.status(404).json({
                success: false,
                needCreateContact: true,
                error: "Клиент не найден в Docketwise. Сначала нажмите '+ Create Client in Docketwise'."
            });
        }

        // === 3. СОЗДАНИЕ ЗАМЕТКИ (NOTE) В DOCKETWISE ===
        if (actionType === 'Note') {
            const noteHeader = `[CRM Call Note | Logged by: ${data.operatorName || 'Staff'}${data.assignedStaff ? ' | For: ' + data.assignedStaff : ''}]`;
            const noteBody = `${noteHeader}\nDate: ${data.date || new Date().toLocaleString()}\nClient: ${data.fullName || ''} (${data.phone || ''})\n\nNote:\n${data.description || ''}${data.followUpNotes ? '\n\nResolution / Reply:\n' + data.followUpNotes : ''}`;

            const notePayload = {
                contact_id: Number(clientId),
                client_id: Number(clientId),
                title: `Call Note — ${data.fullName || 'Client'}`,
                subject: `Call Note — ${data.fullName || 'Client'}`,
                content: noteBody,
                body: noteBody
            };
            if (data.matterId) {
                notePayload.matter_id = Number(data.matterId);
            }

            const crmResponse = await fetch(`https://app.docketwise.com/api/v1/notes`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(notePayload)
            });

            if (!crmResponse.ok) {
                const errText = await crmResponse.text();
                throw new Error(`Docketwise Note Error (${crmResponse.status}): ${errText}`);
            }

            return res.status(200).json({ success: true, clientId, message: "Заметка успешно добавлена в Docketwise!" });
        }

        // === 4. СОЗДАНИЕ ЗАДАЧИ (TASK) НА ВЫБРАННОГО СОТРУДНИКА В DOCKETWISE ===
        if (actionType === 'Task') {
            const taskTitle = data.taskTitle || `📞 Call Follow-Up: ${data.fullName || 'Client'} (${data.phone || ''})`;
            const taskDesc = `[Assigned via CRM by ${data.operatorName || 'Operator'}]\nClient: ${data.fullName || ''} | Phone: ${data.phone || ''}\n\nTask / Inquiry:\n${data.description || ''}`;

            const taskPayload = {
                contact_id: Number(clientId),
                client_id: Number(clientId),
                title: taskTitle,
                name: taskTitle,
                description: taskDesc,
                body: taskDesc,
                due_date: data.dueDate || new Date().toISOString().split('T')[0],
                status: "incomplete"
            };

            // Если выбран сотрудник с официальным Docketwise ID (например 339159, 418892, 332487, 332810)
            if (data.assigneeId && String(data.assigneeId).length >= 5) {
                taskPayload.assignee_id = Number(data.assigneeId);
                taskPayload.user_id = Number(data.assigneeId);
            }
            if (data.matterId) {
                taskPayload.matter_id = Number(data.matterId);
            }

            const crmResponse = await fetch(`https://app.docketwise.com/api/v1/tasks`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(taskPayload)
            });

            if (!crmResponse.ok) {
                const errText = await crmResponse.text();
                throw new Error(`Docketwise Task Error (${crmResponse.status}): ${errText}`);
            }

            return res.status(200).json({ success: true, clientId, message: "Задача (Task) успешно создана в Docketwise!" });
        }

        return res.status(400).json({ success: false, error: "Неизвестный тип действия" });

    } catch (error) {
        console.error("Docketwise API Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
