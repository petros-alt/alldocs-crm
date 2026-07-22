export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    const { first_name, last_name, phone } = req.body;

    // 🔑 ТВОИ РЕАЛЬНЫЕ КЛЮЧИ DOCKETWISE
    const CLIENT_ID = "ca918898ed5b7b8f01a0d8c680ed992e8c45a01c4a6d562f8a6fc8c584d6a984";
    const CLIENT_SECRET = "0a4098bdd5b44c1e3a5e881daddbebc8555ca8afd6502f80263a6f3628e0f4d2";
    const API_KEY = "a-YHg4J2SN1SX7TC17_iLQHTB43qSTXaTUZLNqtAeAE";

    try {
        // 1. Передаем ID и Secret прямо в ссылке
        const apiUrl = `https://app.docketwise.com/api/v1/contacts?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`;

        const dwResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                // 2. На всякий случай дублируем API-ключ в заголовке
                'Authorization': `Bearer ${API_KEY}` 
            },
            body: JSON.stringify({
                first_name: first_name || "Test",
                last_name: last_name || "Lead",
                phone_numbers_attributes: [{ number: phone }]
            })
        });

        // Безопасно читаем ответ сервера
        const textResponse = await dwResponse.text();
        let data = {};

        if (textResponse) {
            try {
                data = JSON.parse(textResponse);
            } catch (e) {
                data = { raw_text: textResponse }; 
            }
        }

        if (dwResponse.ok) {
            return res.status(200).json({ success: true, contact: data });
        } else {
            return res.status(400).json({ 
                success: false, 
                error: "Docketwise rejected the request", 
                docketwise_status: dwResponse.status,
                docketwise_details: data 
            });
        }

    } catch (error) {
        console.error("Docketwise Creation Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
