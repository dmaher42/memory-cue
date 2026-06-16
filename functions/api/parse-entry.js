const jsonResponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ALLOWED_TYPES = new Set(["reminder", "note", "question", "unknown"]);

// Coerce the model's reply into the flat shape the capture pipeline expects
// ({ type, title, reminderDate, tags }). Falls back to "unknown" so an unusable
// reply degrades to a plain note rather than breaking capture.
const normalizeEntry = (raw, fallbackText) => {
  const fallback = { type: "unknown", title: fallbackText, reminderDate: null, tags: [] };
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const type =
    typeof raw.type === "string" && ALLOWED_TYPES.has(raw.type.trim().toLowerCase())
      ? raw.type.trim().toLowerCase()
      : "unknown";
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : fallbackText;
  const reminderDate =
    typeof raw.reminderDate === "string" && raw.reminderDate.trim() ? raw.reminderDate.trim() : null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : ""))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return { type, title, reminderDate, tags };
};

export async function onRequestPost(context) {
  try {
    const request = context.request;
    const env = context.env;

    const body = await request.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return jsonResponse({ error: "Missing text" }, 400);
    }

    if (!env || !env.OPENAI_API_KEY) {
      return jsonResponse({ error: "Server misconfiguration: missing OPENAI_API_KEY" }, 500);
    }

    const now = typeof body?.now === "string" && body.now.trim() ? body.now.trim() : new Date().toISOString();
    const timeZone = typeof body?.timeZone === "string" && body.timeZone.trim() ? body.timeZone.trim() : "UTC";

    const systemPrompt = [
      "You classify one short personal capture for a notes-and-reminders app and reply with ONLY a JSON object.",
      "",
      "JSON fields:",
      '- "type": one of "reminder", "note", "question", "unknown".',
      '    "reminder" = an actionable or dated task (e.g. "call the dentist tomorrow", "pay rent on the 1st", "pick up milk").',
      '    "note" = information to keep (e.g. "ideas for the trip", "Sarah\'s number is 0400 123 456", "lesson plan: fractions").',
      '    "question" = a question the user is asking.',
      '    "unknown" = only if it truly does not fit the above.',
      '- "title": a short cleaned title WITHOUT the date/time words (e.g. "Call the dentist", not "Call the dentist tomorrow at 3pm").',
      '- "reminderDate": for a reminder that names a time, the resolved ISO 8601 datetime; otherwise null.',
      `    Resolve relative times ("tomorrow", "tonight", "next Friday") against the current time ${now} in time zone ${timeZone}.`,
      '- "tags": 0 to 4 short lowercase topic tags.',
      "",
      "Reply with only the JSON object and nothing else.",
    ].join("\n");

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      return jsonResponse({ error: "OpenAI request failed" }, 500);
    }

    const data = await openaiResponse.json();
    const content = data?.choices?.[0]?.message?.content;
    let parsed = null;
    if (typeof content === "string" && content.trim()) {
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = null;
      }
    }

    return jsonResponse(normalizeEntry(parsed, text));
  } catch (error) {
    return jsonResponse({ error: "Server error", details: error?.message || String(error) }, 500);
  }
}
