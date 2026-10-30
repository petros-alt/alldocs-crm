export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;
    if (!apiKey) {
        return res.status(500).json({ success: false, error: "API ключ DOCKETWISE не найден в переменных Vercel" });
    }

    const staffNameToDwId = {
        "Norayr Badalyan": 332487,
        "Petros Eghiazaryan": 418892,
        "Petros E.": 418892,
        "Mariam Djaradjian": 339159,
        "Mariam D.": 339159,
        "Artak Badalyan": 332810,
        "Artak B.": 332810,
        "Rima Avetisyan": 341318,
        "Rima A.": 341318,
        "Gohar Aloyan": 397654,
        "Gohar A.": 397654,
        "Nairi Hovhannisyan": 379998,
        "Argishti Shahbazyan": 445336,
        "Argishti Shahbazian": 445336,
        "Argishti S.": 445336
    };

    const dwHeaders = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    async function callDw(path, method = 'POST', bodyObj = null) {
        const url = `https://app.docketwise.com/api/v1${path}`;
        const opts = { method, headers: dwHeaders };
        if (bodyObj && method !== 'GET') {
            opts.body = JSON.stringify(bodyObj);
        }
        const r = await fetch(url, opts);
        const text = await r.text();
        let json = null;
        try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }
        return { ok: r.ok, status: r.status, text, data: json, path };
    }

    try {
        const data = req.body || {};
        const actionType = data.actionType || 'Note';
        let clientId = data.clientId;
        const authorDwId = staffNameToDwId[data.operatorName] || 332487;

        // === 1. СОЗДАНИЕ НОВОГО КЛИЕНТА В DOCKETWISE ===
        if (actionType === 'CreateContact') {
            const fullName = (data.fullName || 'New Client').trim();
            const parts = fullName.split(/\s+/);
            const firstName = parts[0] || 'Client';
            const lastName = parts.slice(1).join(' ') || 'Lead';

            const createAttempts = [
                { first_name: firstName, last_name: lastName, phone_numbers_attributes: data.phone ? [{ number: data.phone }] : [] },
                { contact: { first_name: firstName, last_name: lastName, phone_numbers_attributes: data.phone ? [{ number: data.phone }] : [] } }
            ];

            let lastRes = null;
            for (const payload of createAttempts) {
                lastRes = await callDw('/contacts', 'POST', payload);
                if (lastRes.ok) break;
            }

            if (!lastRes.ok) {
                throw new Error(`Create Contact (${lastRes.status}): ${lastRes.text || 'Forbidden'}`);
            }

            const newId = lastRes.data?.id || lastRes.data?.contact?.id;
            return res.status(200).json({
                success: true,
                actionType: 'CreateContact',
                clientId: newId,
                message: `Клиент успешно создан в Docketwise (ID: ${newId})`
            });
        }

        // === 2. ПОИСК ID КЛИЕНТА, ЕСЛИ НЕ ПЕРЕДАН ===
        if (!clientId) {
            const rawPhone = (data.phone || '').replace(/\D/g, '');
            const searchQuery = rawPhone.length >= 7 ? rawPhone.slice(-10) : (data.fullName || '');
            if (searchQuery) {
                const sRes = await callDw(`/contacts?search=${encodeURIComponent(searchQuery)}`, 'GET');
                if (sRes.ok) {
                    const list = Array.isArray(sRes.data) ? sRes.data : (sRes.data?.contacts || []);
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

        const cId = Number(clientId);
        const mId = data.matterId ? Number(data.matterId) : null;
        const cleanMatterTitle = (data.matterTitle || '').replace('📂', '').trim();
        const subjectLine = `Call Note: ${data.fullName || 'Client'} (${new Date().toLocaleDateString()})`;
        const fullNoteText = `[CRM Call Note | Logged by: ${data.operatorName || 'Staff'}${cleanMatterTitle ? ' | Case: ' + cleanMatterTitle : ''}]\nDate: ${data.date || new Date().toLocaleString()}\nClient: ${data.fullName || ''} (${data.phone || ''})\n\n${data.description || ''}`;

        // === 3. СОЗДАНИЕ ЗАМЕТКИ (NOTE) В DOCKETWISE ===
        if (actionType === 'Note') {
            // Сначала проверяем структуру заметок в вашем аккаунте через GET /notes
            const sampleCheck = await callDw('/notes?per_page=1', 'GET');
            let sampleKeys = '';
            if (sampleCheck.ok && sampleCheck.data) {
                const arr = Array.isArray(sampleCheck.data) ? sampleCheck.data : (sampleCheck.data.notes || [sampleCheck.data]);
                if (arr.length > 0 && arr[0]) {
                    sampleKeys = Object.keys(arr[0]).join(',');
                }
            }

            const notePayloads = [
                // 1. Чистый минимальный формат Docketwise API v1 (без лишних полей!)
                { title: subjectLine, content: fullNoteText, contact_id: cId, ...(mId ? { matter_id: mId } : {}) },
                // 2. Полиморфный формат Rails (noteable_type / noteable_id)
                ...(mId ? [
                    { title: subjectLine, content: fullNoteText, noteable_id: mId, noteable_type: "Matter" },
                    { note: { title: subjectLine, content: fullNoteText, noteable_id: mId, noteable_type: "Matter" } }
                ] : []),
                { title: subjectLine, content: fullNoteText, noteable_id: cId, noteable_type: "Contact" },
                // 3. Обернутый в note только с чистыми полями
                { note: { title: subjectLine, content: fullNoteText, contact_id: cId, ...(mId ? { matter_id: mId } : {}) } },
                // 4. С полем body вместо content
                { note: { title: subjectLine, body: fullNoteText, contact_id: cId, ...(mId ? { matter_id: mId } : {}) } }
            ];

            let diag = [`GET /notes -> ${sampleCheck.status} [keys: ${sampleKeys || 'none'}]`];

            for (const body of notePayloads) {
                const r = await callDw('/notes', 'POST', body);
                if (r.ok) {
                    return res.status(200).json({
                        success: true,
                        clientId,
                        message: `Заметка (Note) успешно сохранена в Docketwise!`
                    });
                }
                diag.push(`POST /notes -> ${r.status}`);
            }

            // РЕЗЕРВНЫЙ МЕТОД: Если /notes закрыт правами 403, пробуем сохранить в описание самого Кейса (PUT /matters/{mId})
            if (mId) {
                const getMatter = await callDw(`/matters/${mId}`, 'GET');
                if (getMatter.ok) {
                    const mObj = getMatter.data?.data || getMatter.data?.matter || getMatter.data || {};
                    const oldNotes = mObj.notes || mObj.description || '';
                    const updatedNotes = oldNotes ? `${oldNotes}\n\n---\n${fullNoteText}` : fullNoteText;

                    const putMatter = await callDw(`/matters/${mId}`, 'PUT', {
                        matter: { description: updatedNotes, notes: updatedNotes },
                        description: updatedNotes,
                        notes: updatedNotes
                    });
                    if (putMatter.ok) {
                        return res.status(200).json({
                            success: true,
                            clientId,
                            message: `Заметка успешно добавлена в карточку дела (Matter #${mId}) в Docketwise!`
                        });
                    }
                    diag.push(`PUT /matters/${mId} -> ${putMatter.status}`);
                }
            }

            throw new Error(`Диагностика Note: ${diag.join(' | ')}`);
        }

        // === 4. СОЗДАНИЕ ЗАДАЧИ (TASK / TODO) В DOCKETWISE ===
        if (actionType === 'Task') {
            const targetUserId = data.assigneeId ? Number(data.assigneeId) : authorDwId;
            const dueDate = data.dueDate || new Date().toISOString().split('T')[0];

            const taskTitle = `📞 Call Follow-Up: ${data.fullName || 'Client'}${cleanMatterTitle ? ' [' + cleanMatterTitle + ']' : ''}`;
            const taskDesc = `[Assigned via CRM by ${data.operatorName || 'Operator'}]\nClient: ${data.fullName || ''} | Phone: ${data.phone || ''}\nCase: ${cleanMatterTitle || 'General'}\n\nTask / Inquiry:\n${data.description || ''}`;

            // В Docketwise задачи называются /todos (или /calendar_events / /events)!
            const todoRoutes = [
                {
                    path: '/todos',
                    body: {
                        title: taskTitle,
                        name: taskTitle,
                        description: taskDesc,
                        content: taskDesc,
                        due_date: dueDate,
                        contact_id: cId,
                        ...(mId ? { matter_id: mId } : {}),
                        user_id: targetUserId,
                        assignee_id: targetUserId,
                        user_ids: [targetUserId]
                    }
                },
                {
                    path: '/todos',
                    body: {
                        todo: {
                            title: taskTitle,
                            name: taskTitle,
                            description: taskDesc,
                            due_date: dueDate,
                            contact_id: cId,
                            ...(mId ? { matter_id: mId } : {}),
                            user_id: targetUserId,
                            user_ids: [targetUserId]
                        }
                    }
                },
                ...(mId ? [{
                    path: `/matters/${mId}/todos`,
                    body: { title: taskTitle, description: taskDesc, due_date: dueDate, user_id: targetUserId }
                }] : []),
                {
                    path: '/events',
                    body: {
                        title: taskTitle,
                        description: taskDesc,
                        start_time: new Date().toISOString(),
                        end_time: new Date(Date.now() + 1800000).toISOString(),
                        contact_id: cId,
                        ...(mId ? { matter_id: mId } : {}),
                        user_ids: [targetUserId]
                    }
                }
            ];

            // Также проверим GET /todos, чтобы увидеть статус и ключи
            const checkTodos = await callDw('/todos?per_page=1', 'GET');
            let todoKeys = '';
            if (checkTodos.ok && checkTodos.data) {
                const arr = Array.isArray(checkTodos.data) ? checkTodos.data : (checkTodos.data.todos || [checkTodos.data]);
                if (arr.length > 0 && arr[0]) todoKeys = Object.keys(arr[0]).join(',');
            }

            let diag = [`GET /todos -> ${checkTodos.status} [keys: ${todoKeys || 'none'}]`];

            for (const route of todoRoutes) {
                const r = await callDw(route.path, 'POST', route.body);
                if (r.ok) {
                    return res.status(200).json({
                        success: true,
                        clientId,
                        message: `Задача успешно создана в Docketwise для ${data.assignedStaff || 'сотрудника'}! (${route.path})`
                    });
                }
                diag.push(`POST ${route.path} -> ${r.status} (${r.text.slice(0, 60)})`);
            }

            throw new Error(`Диагностика Task/Todo: ${diag.join(' | ')}`);
        }

        return res.status(400).json({ success: false, error: "Неизвестный тип действия" });

    } catch (error) {
        console.error("Docketwise API Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
