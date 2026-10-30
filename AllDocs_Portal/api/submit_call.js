export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    // Прямые сессионные ключи из вашего браузера Docketwise (как в Ooma!)
    const DW_CSRF_TOKEN = process.env.DOCKETWISE_CSRF_TOKEN || "vSWy1Fb6FyD5h544rOGihnUOy0mEqrS8nomtUMXdp2yOhpjyKSg1bf3w5NgqfJPd_zRJ7OqU-oCfS5HpWXlutg";
    const DW_COOKIE = process.env.DOCKETWISE_COOKIE || "__stripe_mid=7a09a5c6-21ec-4d21-886d-c0bf6cc90d9760274d; intercom-device-id-q07v75s8=345a6aa1-5a77-4f02-afd1-47df40c5c1cd; browser.timezone=America/Los_Angeles; browser_id=a6350fa1-3722-4eac-9f81-3a34c6aa9572; _borderwise_session=8f901a47ce2fe3fc9898508ebf9b6160; __stripe_sid=8aa10d78-31dd-4e21-9982-7d97a32d09029d0dbc; intercom-session-q07v75s8=WGNvdmlmRVo1ZEI5VWlOVUtXdHMyZVhncWI0ZXo0QjI0OXo2NDUzU3pMMm9oYnFQS2RYc1Awclcvc0dMS3U0bEJkR3dCYmlzUkpWYlBKMHJmckJjOS9CWVVFNlZpeWdSQ0laeFp0SUU5dGVmKzkxRTdnbzd2OWNUZll3WC9TK0M0SVIwSjZtOGxnQ0RkcXk2YmpOOXVUdktFalFia0EvelRvSWhBZWVxR3ZXd1BBUDlQMHNoY0tnZkhMa1ZyQkdTZ0hKR21DWEdzd2k4ckE5bGZQdDNocUYrYm1NaWlTQ2IxVmRxN1Y3LzZWN2FTZVFEUzg2UzlWbzZnOUtWZy9ocFl2MDh2eWx3TXpDK21UdG1QZWdsUE1WdHdqUklKQ1poRjdWNUl4NWQxMzhzNVU4RE1ZN2lRNXZrQTJBTzVnNFYtLU8xMjEvbVdiVVo4S2VjeEFxZ3JKaHc9PQ==--ed5bb50fdfee15dabd6227cca99e8da146d2f1d0";

    // Словарь сотрудников -> Docketwise ID
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

    try {
        const data = req.body || {};
        const actionType = data.actionType || 'Note';
        let clientId = data.clientId;
        const authorDwId = staffNameToDwId[data.operatorName] || 418892;

        // === 1. АВТО-ПОИСК КЛИЕНТА ЧЕРЕЗ API, ЕСЛИ ID НЕ ПЕРЕДАН ===
        if (!clientId && actionType !== 'CreateContact' && apiKey) {
            const rawPhone = (data.phone || '').replace(/\D/g, '');
            const searchQuery = rawPhone.length >= 7 ? rawPhone.slice(-10) : (data.fullName || '');
            if (searchQuery) {
                const sRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodeURIComponent(searchQuery)}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
                });
                if (sRes.ok) {
                    const sData = await sRes.json();
                    const list = Array.isArray(sData) ? sData : (sData.contacts || []);
                    if (list.length > 0) clientId = list[0].id;
                }
            }
        }

        // === 2. СОЗДАНИЕ НОВОГО КЛИЕНТА В DOCKETWISE ===
        if (actionType === 'CreateContact') {
            const fullName = (data.fullName || 'New Client').trim();
            const parts = fullName.split(/\s+/);
            const firstName = parts[0] || 'Client';
            const lastName = parts.slice(1).join(' ') || 'Lead';

            // Пробуем создать контакт через сессию Docketwise (/contacts.json) или через API
            const createRes = await fetch("https://app.docketwise.com/contacts.json", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "content-type": "application/json",
                    "x-csrf-token": DW_CSRF_TOKEN,
                    "x-requested-with": "XMLHttpRequest",
                    "cookie": DW_COOKIE,
                    "Referer": "https://app.docketwise.com/en/contacts"
                },
                body: JSON.stringify({
                    contact: {
                        first_name: firstName,
                        last_name: lastName,
                        type: "Lead",
                        phone_numbers_attributes: data.phone ? [{ number: data.phone, daytime: true }] : []
                    }
                })
            });

            const text = await createRes.text();
            let parsed = {};
            try { parsed = JSON.parse(text); } catch (e) {}

            if (!createRes.ok) {
                throw new Error(`Ошибка создания клиента (${createRes.status}): ${text.slice(0, 120)}`);
            }

            const newId = parsed.id || parsed.contact?.id;
            return res.status(200).json({
                success: true,
                actionType: 'CreateContact',
                clientId: newId,
                message: `Клиент "${fullName}" успешно создан в Docketwise! (ID: ${newId})`
            });
        }

        if (!clientId) {
            return res.status(404).json({
                success: false,
                error: "Клиент не найден в Docketwise. Сначала нажмите '👤 + New Client'."
            });
        }

        const cleanMatterTitle = (data.matterTitle || '').replace('📂', '').trim();
        const mIdStr = data.matterId ? String(data.matterId) : "";
        const cIdStr = String(clientId);

        // === 3. СОЗДАНИЕ ЗАМЕТКИ (NOTE) — 1-В-1 КАК В ВАШЕМ FETCH В DOCKETWISE ===
        if (actionType === 'Note') {
            const noteTitle = `CRM Call Note (${data.operatorName || 'Staff'})`;
            const noteContent = `[Logged by: ${data.operatorName || 'Staff'}${cleanMatterTitle ? ' | Case: ' + cleanMatterTitle : ''}]\n${data.description || ''}`;
            const nowIso = new Date().toISOString();

            // Формируем точно такой же URLSearchParams, как в вашем перехваченном запросе:
            // note[title]=...&note[content]=...&note[note_category_id]=&note[date]=...&note[notifyFirm]=&note[client_id]=27032192&note[matter_id]=7376008&note[user_ids][]=418892
            const formBody = new URLSearchParams();
            formBody.append('note[title]', noteTitle);
            formBody.append('note[content]', noteContent);
            formBody.append('note[note_category_id]', '');
            formBody.append('note[date]', nowIso);
            formBody.append('note[notifyFirm]', '');
            formBody.append('note[client_id]', cIdStr);
            formBody.append('note[matter_id]', mIdStr);
            formBody.append('note[user_ids][]', String(authorDwId));

            const noteRes = await fetch("https://app.docketwise.com/notes", {
                method: "POST",
                headers: {
                    "accept": "application/json, text/javascript, */*; q=0.01",
                    "accept-language": "en-US,en;q=0.9",
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "x-csrf-token": DW_CSRF_TOKEN,
                    "x-requested-with": "XMLHttpRequest",
                    "cookie": DW_COOKIE,
                    "Referer": `https://app.docketwise.com/en/contacts/${cIdStr}`
                },
                body: formBody.toString()
            });

            const respText = await noteRes.text();
            if (!noteRes.ok) {
                throw new Error(`Docketwise Note Error (${noteRes.status}): ${respText.slice(0, 150)}`);
            }

            return res.status(200).json({
                success: true,
                clientId,
                message: `Заметка (Note) успешно сохранена в Docketwise (Дело: ${cleanMatterTitle || 'Общий профиль'})!`
            });
        }

        // === 4. СОЗДАНИЕ ЗАДАЧИ (TASK) — 1-В-1 КАК В ВАШЕМ FETCH В DOCKETWISE (/tasks.json) ===
        if (actionType === 'Task') {
            const targetUserId = data.assigneeId ? Number(data.assigneeId) : authorDwId;
            const dueDate = data.dueDate || new Date().toISOString().split('T')[0];

            // В Docketwise у Task нет отдельного поля description, весь текст задачи пишется в title!
            const fullTaskTitle = `[From: ${data.operatorName || 'CRM'}] ${data.description || 'Call Follow-Up'}`;

            const taskPayload = {
                task: {
                    title: fullTaskTitle,
                    client_id: cIdStr,
                    matter_id: mIdStr || null,
                    due_date: dueDate,
                    user_ids: targetUserId ? [targetUserId] : null
                }
            };

            const taskRes = await fetch("https://app.docketwise.com/tasks.json", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "accept-language": "en-US,en;q=0.9",
                    "content-type": "application/json",
                    "x-csrf-token": DW_CSRF_TOKEN,
                    "cookie": DW_COOKIE,
                    "Referer": `https://app.docketwise.com/en/contacts/${cIdStr}`
                },
                body: JSON.stringify(taskPayload)
            });

            const respText = await taskRes.text();
            if (!taskRes.ok) {
                throw new Error(`Docketwise Task Error (${taskRes.status}): ${respText.slice(0, 150)}`);
            }

            return res.status(200).json({
                success: true,
                clientId,
                message: `Задача (Task) успешно создана и назначена на ${data.assignedStaff || 'сотрудника'} в Docketwise!`
            });
        }

        return res.status(400).json({ success: false, error: "Неизвестный тип действия" });

    } catch (error) {
        console.error("Docketwise Gateway Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
