export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    const { first_name, last_name, phone } = req.body;

    try {
        const dwResponse = await fetch('https://app.docketwise.com/api/v1/contacts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Передаем токен авторизации
                'Authorization': `Bearer ${process.env.DOCKETWISE_API_KEY}` 
            },
            body: JSON.stringify({
                first_name: first_name || "Test",
                last_name: last_name || "Lead",
                phone_numbers_attributes: [{ number: phone }]
            })
        });

        // 1. Сначала читаем ответ как простой текст, чтобы сервер не выдавал ошибку JSON
        const textResponse = await dwResponse.text();
        let data = {};

        // 2. Если ответ не пустой, пробуем перевести его в JSON
        if (textResponse) {
            try {
                data = JSON.parse(textResponse);
            } catch (e) {
                data = { raw_text: textResponse }; // Если это HTML-ошибка от Docketwise
            }
        }

        // 3. Отвечаем фронтенду
        if (dwResponse.ok) {
            return res.status(200).json({ success: true, contact: data });
        } else {
            // Теперь мы увидим реальную причину отказа (status 401, 404, 422 и т.д.)
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
