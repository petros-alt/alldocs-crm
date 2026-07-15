export default async function handler(req, res) {
    const { query } = req.query;
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ error: "Ключ API не найден" });
    if (!query) return res.status(400).json({ error: "Добавь ?query=Имя_клиента в конец ссылки" });

    try {
        // 1. Ищем клиента по имени
        const searchRes = await fetch(`https://app.docketwise.com/api/v1/contacts?search=${encodeURIComponent(query)}&per_page=1`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
        });
        
        if (!searchRes.ok) return res.status(500).json({ error: "Ошибка поиска в Docketwise" });
        const searchData = await searchRes.json();
        const contacts = Array.isArray(searchData) ? searchData : (searchData.contacts || []);

        if (contacts.length === 0) return res.status(404).json({ error: "Клиент не найден" });

        const clientId = contacts[0].id;

        // 2. Скачиваем его ПОЛНЫЙ профиль (со всеми скрытыми полями)
        const fullRes = await fetch(`https://app.docketwise.com/api/v1/contacts/${clientId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
        });
        
        if (!fullRes.ok) return res.status(500).json({ error: "Ошибка скачивания профиля" });
        const fullData = await fullRes.json();

        // 3. Выводим сырой JSON на экран
        res.status(200).json(fullData);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}