export async function onRequestPost(context) {
  try {

    const request = context.request
    const env = context.env

    const body = await request.json()
    const text = body?.text?.trim()

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Missing text" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "Classify the entry and return JSON describing intent."
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    })

    if (!openaiResponse.ok) {
      return new Response(
        JSON.stringify({ error: "OpenAI request failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }

    const data = await openaiResponse.json()

    return new Response(
      JSON.stringify(data),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Server error", details: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
