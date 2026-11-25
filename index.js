/**
 * dsh-turn-prompt — Host half.
 *
 * The browser half arms one prompt set for one Session through the
 * authenticated Connection route. This half contributes that text as a
 * system-prompt section for the owning agent, and drops the selection when the
 * turn ends, so the following turn starts from the default of no extra prompt.
 *
 * Nothing is written to the Session log: the selection is request-side state,
 * and the transcript keeps exactly the message the user typed.
 */

/** Plugin row name; the Client module uses the package name instead. */
export const name = 'dsh-turn-prompt';

/** The prompt registry is the one capability this plugin cannot work without. */
export const inject = ['systemPrompt'];

/** Position after first-party guidance (order 0–199) and before the environment block (10000). */
const SECTION_ORDER = 5100;
const MAX_TITLE = 120;
const MAX_TEXT = 20000;
/** Absolute paths below `/api`; the Client asks for them without the leading slash. */
const ROUTE = { arm: '/api/turn-prompt.arm', state: '/api/turn-prompt.state' };

/** sessionId → { id, title, text } armed for that Session's next turn. */
const armed = new Map();

/**
 * Normalize one identifier field.
 * @param value - untrusted request or session value.
 * @returns the trimmed string, or an empty string.
 */
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Compose the system-prompt section body for one Session.
 * @param sessionId - the Session the request belongs to.
 * @returns section text; empty text contributes no section at all.
 */
function sectionText(sessionId) {
  const entry = armed.get(sessionId);
  if (entry === undefined) return '';
  const body = entry.text.trim();
  if (body.length === 0) return '';
  const title = entry.title.trim();
  const heading = title.length > 0 ? `## Selected turn prompt: ${title}` : '## Selected turn prompt';
  return `${heading}\n\n${body}`;
}

/**
 * Read one JSON request body.
 * @param request - the Fetch request Connection handed over.
 * @returns the parsed object, or null for a malformed body.
 */
async function readJson(request) {
  try {
    const body = await request.json();
    return body !== null && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

/**
 * Answer one bridge call.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 * @returns the Fetch response.
 */
function reply(status, body) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Register the arm/state routes inside Connection's authentication fence.
 * Only owner Peers reach them, so a local process cannot inject text into a
 * session it does not already speak for.
 * @param child - context carrying the `connection` service.
 * @returns disposer releasing both routes.
 */
function registerBridge(child) {
  const route = {
    methods: ['POST'],
    requestBody: 'buffered',
  };

  const armDispose = child.connection.fetch.register({
    ...route,
    path: ROUTE.arm,
    fetch: async request => {
      const body = await readJson(request);
      if (body === null) return reply(400, { ok: false, message: 'invalid JSON body' });
      const sessionId = textOf(body.sessionId);
      if (sessionId.length === 0) return reply(400, { ok: false, message: 'sessionId is required' });
      const text = textOf(body.text).slice(0, MAX_TEXT);
      if (text.length === 0) {
        const cleared = armed.delete(sessionId);
        return reply(200, { ok: true, armed: false, changed: cleared });
      }
      const entry = {
        id: textOf(body.id).slice(0, MAX_TITLE) || 'custom',
        title: textOf(body.title).slice(0, MAX_TITLE),
        text,
      };
      armed.set(sessionId, entry);
      return reply(200, { ok: true, armed: true, id: entry.id, title: entry.title });
    },
  });

  const stateDispose = child.connection.fetch.register({
    ...route,
    path: ROUTE.state,
    fetch: async request => {
      const body = await readJson(request);
      if (body === null) return reply(400, { ok: false, message: 'invalid JSON body' });
      const sessionId = textOf(body.sessionId);
      if (sessionId.length === 0) return reply(400, { ok: false, message: 'sessionId is required' });
      const entry = armed.get(sessionId);
      return reply(200, {
        ok: true,
        armed: entry !== undefined,
        id: entry?.id ?? '',
        title: entry?.title ?? '',
      });
    },
  });

  return () => {
    void armDispose().catch(() => {});
    void stateDispose().catch(() => {});
  };
}

/**
 * Activate the Host half.
 * @param ctx - Host context.
 */
export function apply(ctx) {
  /** agent → disposer of its scoped section. */
  const scoped = new Map();

  /**
   * Contribute the armed section to one agent's own prompt scope.
   * @param agent - the created agent.
   */
  const install = agent => {
    if (scoped.has(agent)) return;
    const sessionId = textOf(agent?.session?.id);
    if (sessionId.length === 0) return;
    const dispose = agent.ctx.effect(() =>
      agent.ctx.systemPrompt.section({
        name: 'dsh-turn-prompt',
        order: SECTION_ORDER,
        interpolate: false,
        text: () => sectionText(sessionId),
      }),
    );
    let released = false;
    scoped.set(agent, () => {
      if (released) return;
      released = true;
      try {
        dispose();
      } catch {
        // The agent scope may already be unwound; nothing is left to release.
      }
    });
  };

  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/disposed', ({ agent }) => {
    const release = scoped.get(agent);
    if (release === undefined) return;
    scoped.delete(agent);
    release();
  });

  // The end of a turn retires the selection: the next turn is the default one.
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    const sessionId = textOf(session?.id);
    if (sessionId.length > 0) armed.delete(sessionId);
  });

  ctx.effect(() => () => {
    for (const release of scoped.values()) release();
    scoped.clear();
  });

  // A profile without a browser surface has no Connection service: the module
  // then simply contributes the prompt section with nothing able to arm it.
  ctx.inject(['connection'], child => {
    child.effect(() => registerBridge(child));
  });
}
