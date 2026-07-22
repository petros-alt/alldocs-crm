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
                // Твой секретный ключ Docketwise
                'Authorization': `Bearer ${process.env.DOCKETWISE_API_KEY}` 
            },
            body: JSON.stringify({
                first_name: first_name || "Test",
                last_name: last_name || "Lead",
                phone_numbers_attributes: [{ number: phone }]
            })
        });

        const data = await dwResponse.json();

        if (dwResponse.ok) {
            return res.status(200).json({ success: true, contact: data });
        } else {
            return res.status(400).json({ success: false, error: data });
        }

    } catch (error) {
        console.error("Docketwise Creation Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}