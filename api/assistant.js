export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    // Temporary test response to confirm routing works
    return res.status(200).json({ reply: `Echo: ${message}` });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
}
