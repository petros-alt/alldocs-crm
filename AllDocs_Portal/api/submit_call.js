export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    // Берем и переменный ключ из Vercel, и прямой ключ из create-dw-contact.js
    const envKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID || process.env.DOCKETWISE_TOKEN;
    const directApiKey = "a-YHg4J2SN1SX7TC17_iLQHTB43qSTXaTUZLNqtAeAE";
    const primaryKey = envKey || directApiKey;

    // Умная функция отправки в Docketwise (пробует Bearer + резервный api_key в URL)
    async function callDocketwise(endpoint, method = 'POST', payload = null) {
        const keysToTry = [
            { headers: { 'Authorization': `Bearer ${primaryKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, urlSuffix: '' },
            { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, urlSuffix: (endpoint.includes('?') ? '&' : '?') + `api_key=${directApiKey}` },
            { headers: { 'Authorization': `Token token=${directApiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }, urlSuffix: '' }
        ];

        let lastStatus = 500;
        let lastText = '';

        for (const attempt of keysToTry) {
            const url = `https://app.docketwise.com/api/v1${endpoint}${attempt.urlSuffix}`;
            const options = { method, headers: attempt.headers };
            if (payload && method !== 'GET') {
                options.body = JSON.stringify(payload);
            }
            const response = await fetch(url, options);
            lastStatus = response.status;
            lastText = await response.text();

            if (response.ok) {
                let json = {};
                try { json = JSON.parse(lastText); } catch (e) { json = { raw: lastText }; }
                return { ok: true, status: response.status, data: json };
            }
            // Если ошибка не связана с правами/авторизацией (401/403), не перебираем ключи дальше
            if (response.status !== 401 && response.status !== 403) {
                break;
            }
        }

        return { ok: false, status: lastStatus, errorText: lastText };
    }

    try {
        const data = req.body || {};
        const actionType = data.actionType || 'Note';
        let clientId = data.clientId;

        // === 1. СОЗДАНИЕ НОВОГО КЛИЕНТА В DOCKETWISE ===
        if (actionType === 'CreateContact') {
            const fullName = (data.fullName || 'New Client').trim();
            const parts = fullName.split(/\s+/);
            const firstName = parts[0] || 'Client';
            const lastName = parts.slice(1).join(' ') || 'Lead';

            const result = await callDocketwise('/contacts', 'POST', {
                first_name: firstName,
                last_name: lastName,
                phone_numbers_attributes: data.phone ? [{ number: data.phone }] : []
            });

            if (!result.ok) {
                throw new Error(`Docketwise Create Contact Error (${result.status}): ${result.errorText}`);
            }

            const newId = result.data?.id || result.data?.contact?.id;
            return res.status(200).json({
                success: true,
                actionType: 'CreateContact',
                clientId: newId,
                contact: result.data,
                message: `Клиент успешно создан в Docketwise (ID: ${newId})`
            });
        }

        // === 2. АВТО-ПОИСК ID КЛИЕНТА, ЕСЛИ НЕ ПЕРЕДАН ===
        if (!clientId) {
            const rawPhone = (data.phone || '').replace(/\D/g, '');
            const searchQuery = rawPhone.length >= 7 ? rawPhone.slice(-10) : (data.fullName || '');
            if (searchQuery) {
                const searchRes = await callDocketwise(`/contacts?search=${encodeURIComponent(searchQuery)}`, 'GET');
                if (searchRes.ok) {
                    const list = Array.isArray(searchRes.data) ? searchRes.data : (searchRes.data?.contacts || []);
                    if (list.length > 0) clientId = list[0].id;
                }
            }
        }

        if (!clientId) {
            return res.status(404).json({
                success: false,
                error: "Клиент не найден в Docketwise. Сначала нажмите '👤 + New Client'."
            });
        }

        // === 3. СОЗДАНИЕ ЗАМЕТКИ (NOTE) В DOCKETWISE ===
        if (actionType === 'Note') {
            const cleanMatterTitle = (data.matterTitle || '').replace('📂', '').trim();
            const noteHeader = `[CRM Call Note | By: ${data.operatorName || 'Staff'}${cleanMatterTitle ? ' | Case: ' + cleanMatterTitle : ''}]`;
            const noteBody = `${noteHeader}\nDate: ${data.date || new Date().toLocaleString()}\nClient: ${data.fullName || ''} (${data.phone || ''})\n\n${data.description || ''}`;
            const subjectLine = `Call Note: ${data.fullName || 'Client'} (${new Date().toLocaleDateString()})`;

            // Пробуем стандартные форматы Docketwise API для Notes
            const notePayloadsToTry = [
                // Вариант 1: Плоский формат с contact_id и matter_id
                {
                    title: subjectLine,
                    subject: subjectLine,
                    content: noteBody,
                    body: noteBody,
                    contact_id: Number(clientId),
                    ...(data.matterId ? { matter_id: Number(data.matterId) } : {})
                },
                // Вариант 2: Обернутый в объект note (Rails strong parameters)
                {
                    note: {
                        title: subjectLine,
                        content: noteBody,
                        body: noteBody,
                        contact_id: Number(clientId),
                        ...(data.matterId ? { matter_id: Number(data.matterId) } : {})
                    }
                },
                // Вариант 3: Только contact_id (если matter_id вызывает 403 в Docketwise)
                {
                    title: subjectLine,
                    content: noteBody,
                    contact_id: Number(clientId)
                }
            ];

            let noteRes = null;
            for (const payload of notePayloadsToTry) {
                noteRes = await callDocketwise('/notes', 'POST', payload);
                if (noteRes.ok) break;
            }

            if (!noteRes || !noteRes.ok) {
                throw new Error(`Docketwise Note Error (${noteRes?.status}): ${noteRes?.errorText || 'Forbidden / Check API Token permissions'}`);
            }

            return res.status(200).json({
                success: true,
                clientId,
                message: "Заметка (Note) успешно сохранена в Docketwise!"
            });
        }

        // === 4. СОЗДАНИЕ ЗАДАЧИ (TASK) НА ВЫБРАННОГО СОТРУДНИКА В DOCKETWISE ===
        if (actionType === 'Task') {
            const cleanMatterTitle = (data.matterTitle || '').replace('📂', '').trim();
            const taskTitle = `📞 Call Follow-Up: ${data.fullName || 'Client'}${cleanMatterTitle ? ' [' + cleanMatterTitle + ']' : ''}`;
            const taskDesc = `[Assigned via CRM by ${data.operatorName || 'Operator'}]\nClient: ${data.fullName || ''} | Phone: ${data.phone || ''}\nCase: ${cleanMatterTitle || 'General'}\n\nTask / Inquiry:\n${data.description || ''}`;
            const dueDate = data.dueDate || new Date().toISOString().split('T')[0];

            const baseTask = {
                title: taskTitle,
                name: taskTitle,
                description: taskDesc,
                due_date: dueDate,
                contact_id: Number(clientId),
                ...(data.matterId ? { matter_id: Number(data.matterId) } : {}),
                ...(data.assigneeId ? { assignee_id: Number(data.assigneeId), user_id: Number(data.assigneeId) } : {})
            };

            const taskPayloadsToTry = [
                baseTask,
                { task: baseTask },
                { title: taskTitle, description: taskDesc, contact_id: Number(clientId), due_date: dueDate }
            ];

            let taskRes = null;
            for (const payload of taskPayloadsToTry) {
                taskRes = await callDocketwise('/tasks', 'POST', payload);
                if (taskRes.ok) break;
            }

            if (!taskRes || !taskRes.ok) {
                throw new Error(`Docketwise Task Error (${taskRes?.status}): ${taskRes?.errorText || 'Forbidden'}`);
            }

            return res.status(200).json({
                success: true,
                clientId,
                message: `Задача (Task) успешно назначена на ${data.assignedStaff || 'сотрудника'} в Docketwise!`
            });
        }

        return res.status(400).json({ success: false, error: "Неизвестный тип действия" });

    } catch (error) {
        console.error("Docketwise API Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
