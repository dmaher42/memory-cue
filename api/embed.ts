export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!text) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing text'
      }), { status: 400 });
    }

    if (!env.OPENAI_API_KEY) {
      console.warn('[embed] OPENAI_API_KEY not set');
      return new Response(JSON.stringify({
        success: false,
        error: 'Embedding service unavailable'
      }), { status: 500 });
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to generate embedding'
      }), { status: 500 });
    }

    const data = await response.json();
    const embedding = data?.data?.[0]?.embedding || [];

    return new Response(JSON.stringify({
      success: true,
      embedding
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to generate embedding'
    }), { status: 500 });
  }
}
