export async function onRequest(context) {
  const { request, env } = context;

  // Only allow POST
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { text } = await request.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'Missing text' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const apiKey = env.OPENAI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing API key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    const data = await response.json();

    return new Response(JSON.stringify({
      embedding: data.data[0].embedding
    }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
