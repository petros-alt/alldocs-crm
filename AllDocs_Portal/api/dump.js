export default async function handler(req, res) {
    const { query } = req.query; 
    const apiKey = process.env.DOCKETWISE_CLIENT_SECRET || process.env.DOCKETWISE_CLIENT_ID;

    if (!apiKey) return res.status(500).json({ error: "Ключ API не найден" });
    if (!query) return res.status(400).json({ error: "Укажите ID дела" });

    try {
        const fullRes = await fetch(`https://app.docketwise.com/api/v1/matters/${query}`, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
        });
        
        const fullData = await fullRes.json();
        res.status(200).json(fullData);

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
