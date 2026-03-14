const handler = require('./api/parse-entry');

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    }
  };
}

describe('api/parse-entry parse fallbacks', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  test('returns fallback with 422 for malformed output_text JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: '{"type":"note", bad json' })
    });

    const req = {
      method: 'POST',
      headers: {},
      body: { text: 'Plan trip to Rome and review flights next week.' }
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      type: 'unknown',
      title: 'Plan trip to Rome and review flights next week.',
      tags: [],
      reminderDate: null,
      metadata: { parseError: true }
    });
  });
});
