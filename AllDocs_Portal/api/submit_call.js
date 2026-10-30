export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    // Используем ТОЛЬКО рабочий ключ из Vercel (тот же самый, что в search.js!)
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;
    if (!apiKey) {
        return res.status(500).json({ success: false, error: "API ключ DOCKETWISE не найден в переменных Vercel" });
    }

    // Официальные ID сотрудников в Docketwise (из search.js)
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

        // Определяем Docketwise User ID того сотрудника, от чьего имени идет запрос
        const authorDwId = staffNameToDwId[data.operatorName] || 332487; // По умолчанию ID админа Норайра (332487)

        // === 1. СОЗДАНИЕ НОВОГО КЛИЕНТА В DOCKETWISE ===
        if (actionType === 'CreateContact') {
            const fullName = (data.fullName || 'New Client').trim();
            const parts = fullName.split(/\s+/);
            const firstName = parts[0] || 'Client';
            const lastName = parts.slice(1).join(' ') || 'Lead';

            const createAttempts = [
                { first_name: firstName, last_name: lastName, phone_numbers_attributes: data.phone ? [{ number: data.phone }] : [] },
                { contact: { first_name: firstName, last_name: lastName, phone: data.phone || '' } }
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

        const cleanMatterTitle = (data.matterTitle || '').replace('📂', '').trim();
        const subjectLine = `Call Note: ${data.fullName || 'Client'} (${new Date().toLocaleDateString()})`;
        const fullNoteText = `[CRM Call Note | Logged by: ${data.operatorName || 'Staff'}${cleanMatterTitle ? ' | Case: ' + cleanMatterTitle : ''}]\nDate: ${data.date || new Date().toLocaleString()}\nClient: ${data.fullName || ''} (${data.phone || ''})\n\n${data.description || ''}`;

        // === 3. СОЗДАНИЕ ЗАМЕТКИ (NOTE) В DOCKETWISE ===
        if (actionType === 'Note') {
            const cId = Number(clientId);
            const mId = data.matterId ? Number(data.matterId) : null;

            // Пробуем все официальные маршруты и структуры Docketwise API для заметок
            const noteRoutesToTry = [];

            if (mId) {
                noteRoutesToTry.push({
                    path: `/matters/${mId}/notes`,
                    body: { title: subjectLine, content: fullNoteText, body: fullNoteText, user_id: authorDwId, created_by_id: authorDwId }
                });
                noteRoutesToTry.push({
                    path: `/notes`,
                    body: { title: subjectLine, content: fullNoteText, body: fullNoteText, matter_id: mId, contact_id: cId, client_id: cId, user_id: authorDwId, created_by_id: authorDwId }
                });
                noteRoutesToTry.push({
                    path: `/notes`,
                    body: { note: { title: subjectLine, content: fullNoteText, body: fullNoteText, matter_id: mId, contact_id: cId, user_id: authorDwId } }
                });
            }

            noteRoutesToTry.push({
                path: `/contacts/${cId}/notes`,
                body: { title: subjectLine, content: fullNoteText, body: fullNoteText, user_id: authorDwId, created_by_id: authorDwId }
            });
            noteRoutesToTry.push({
                path: `/notes`,
                body: { title: subjectLine, content: fullNoteText, body: fullNoteText, contact_id: cId, client_id: cId, user_id: authorDwId }
            });

            let diagnosticLog = [];
            for (const attempt of noteRoutesToTry) {
                const resAttempt = await callDw(attempt.path, 'POST', attempt.body);
                if (resAttempt.ok) {
                    return res.status(200).json({
                        success: true,
                        clientId,
                        message: `Заметка (Note) успешно сохранена в Docketwise! (${attempt.path})`
                    });
                }
                diagnosticLog.push(`${attempt.path} -> ${resAttempt.status} (${resAttempt.text.slice(0, 80)})`);
            }

            throw new Error(`Docketwise отклонил запись Note. Ответы сервера: ${diagnosticLog.join(' | ')}`);
        }

        // === 4. СОЗДАНИЕ ЗАДАЧИ (TASK) В DOCKETWISE ===
        if (actionType === 'Task') {
            const cId = Number(clientId);
            const mId = data.matterId ? Number(data.matterId) : null;
            const targetUserId = data.assigneeId ? Number(data.assigneeId) : authorDwId;
            const dueDate = data.dueDate || new Date().toISOString().split('T')[0];

            const taskTitle = `📞 Call Follow-Up: ${data.fullName || 'Client'}${cleanMatterTitle ? ' [' + cleanMatterTitle + ']' : ''}`;
            const taskDesc = `[Assigned via CRM by ${data.operatorName || 'Operator'}]\nClient: ${data.fullName || ''} | Phone: ${data.phone || ''}\nCase: ${cleanMatterTitle || 'General'}\n\nTask / Inquiry:\n${data.description || ''}`;

            const taskRoutesToTry = [
                {
                    path: `/tasks`,
                    body: {
                        title: taskTitle,
                        name: taskTitle,
                        description: taskDesc,
                        due_date: dueDate,
                        contact_id: cId,
                        client_id: cId,
                        ...(mId ? { matter_id: mId } : {}),
                        assignee_id: targetUserId,
                        user_id: targetUserId
                    }
                },
                {
                    path: `/tasks`,
                    body: {
                        task: {
                            title: taskTitle,
                            name: taskTitle,
                            description: taskDesc,
                            due_date: dueDate,
                            contact_id: cId,
                            ...(mId ? { matter_id: mId } : {}),
                            user_id: targetUserId
                        }
                    }
                }
            ];

            if (mId) {
                taskRoutesToTry.unshift({
                    path: `/matters/${mId}/tasks`,
                    body: { title: taskTitle, name: taskTitle, description: taskDesc, due_date: dueDate, user_id: targetUserId, assignee_id: targetUserId }
                });
            }

            let diagnosticLog = [];
            for (const attempt of taskRoutesToTry) {
                const resAttempt = await callDw(attempt.path, 'POST', attempt.body);
                if (resAttempt.ok) {
                    return res.status(200).json({
                        success: true,
                        clientId,
                        message: `Задача (Task) успешно назначена на ${data.assignedStaff || 'сотрудника'} в Docketwise!`
                    });
                }
                diagnosticLog.push(`${attempt.path} -> ${resAttempt.status} (${resAttempt.text.slice(0, 80)})`);
            }

            throw new Error(`Docketwise отклонил запись Task. Ответы сервера: ${diagnosticLog.join(' | ')}`);
        }

        return res.status(400).json({ success: false, error: "Неизвестный тип действия" });

    } catch (error) {
        console.error("Docketwise API Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
