/** Client research (server/ba/research.ts): the cheap Tavily calls, the Claude fallback when Tavily credits run out, and the safety of the answer. */
import { cleanSuggestions, researchClient, researchSettings } from '../../server/ba/research.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mapAnswer = {
  summary: 'Hot Co is a bakery in Pune.',
  fields: {
    industry: { value: 'Bakery', basis: 'VERIFIED', sources: [1] },
    productsServices: { value: 'Cakes and bread. Call +91 98222 22221 or mail hot@example.com', basis: 'VERIFIED', sources: [2, 9] },
    targetAudience: { value: 'Families in Pune', basis: 'VERIFIED', sources: [] },
    businessGoals: null,
    notAField: { value: 'x', basis: 'VERIFIED', sources: [1] }
  },
  uncertainMatch: false,
  missingInformation: ['Which tools do they use for orders?']
};

function fakeNet(opts: { searchStatus?: number; extractStatus?: number; claudeWeb?: unknown } = {}) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    calls.push({ url, body, headers: init?.headers as Record<string, string> });
    if (url.endsWith('/search')) {
      if (opts.searchStatus) return json(opts.searchStatus, { detail: { error: 'limit' } });
      return json(200, { results: [
        { url: 'https://www.justdial.com/pune/hot-co', title: 'Hot Co - Justdial', content: 'Hot Co, bakery in Pune.' },
        { url: 'https://hotco.in/', title: 'Hot Co Bakery', content: 'Fresh cakes and bread since 2015.' }
      ], usage: { credits: 1 } });
    }
    if (url.endsWith('/extract')) {
      if (opts.extractStatus) return json(opts.extractStatus, { detail: { error: 'x' } });
      return json(200, { results: [{ url: 'https://hotco.in/', raw_content: 'We bake for families across Pune.' }, { url: 'https://hotco.in/about', raw_content: 'Founded by two friends.' }], failed_results: [{ url: 'https://hotco.in/services' }], usage: { credits: 1 } });
    }
    if (url.endsWith('/v1/messages')) {
      const web = Array.isArray(body.tools) && body.tools.length > 0;
      if (web) return json(200, opts.claudeWeb ?? { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...mapAnswer, sources: [{ url: 'https://hotco.in/', title: 'Hot Co' }, { url: 'javascript:alert(1)', title: 'bad' }] }) }],
        usage: { input_tokens: 20000, output_tokens: 1500, server_tool_use: { web_search_requests: 2 } } });
      return json(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n' + JSON.stringify(mapAnswer) + '\n```' }], usage: { input_tokens: 3000, output_tokens: 800 } });
    }
    return json(404, {});
  }) as typeof fetch;
  return { f, calls };
}

const env = (extra: Record<string, string> = {}) => researchSettings({ ANTHROPIC_API_KEY: 'test-anthropic', TAVILY_API_KEY: 'tvly-test', BA_AI_MODEL: 'claude-sonnet-5-5', ...extra } as NodeJS.ProcessEnv);
const subject = { business: 'Hot Co', city: 'Pune', businessCategory: 'Bakery', website: null, industry: null };

// ---- Tavily path
{
  const { f, calls } = fakeNet();
  const r = await researchClient(env(), subject, false, f);
  const search = calls.find(c => c.url.endsWith('/search'))!;
  const extract = calls.find(c => c.url.endsWith('/extract'))!;
  check(r.provider === 'TAVILY', 'Tavily is used first');
  check(search.body.search_depth === 'basic' && search.body.auto_parameters === false && search.body.include_raw_content === false && (search.body.max_results as number) <= 6,
    'the search is basic (1 credit), never "auto" (which can cost 2), with short snippets only', search.body);
  check(search.headers.authorization === 'Bearer tvly-test', 'the Tavily key goes in the Authorization header');
  check(String(search.body.query).includes('"Hot Co"') && String(search.body.query).includes('Pune'), 'the search is the business name and city');
  check(!JSON.stringify(calls.map(c => c.body)).includes('98222'), 'no phone number is sent anywhere');
  check(extract && extract.body.extract_depth === 'basic' && (extract.body.urls as string[]).length <= 3 && (extract.body.urls as string[])[0] === 'https://hotco.in/',
    'the client\'s own site (not the directory) is extracted, basic, at most 3 pages', extract?.body);
  check(r.usage.tavilyCredits === 2 && r.usage.tavilySearches === 1 && r.usage.tavilyPages === 2, 'about 2 Tavily credits for one client', r.usage);
  check(calls.filter(c => c.url.endsWith('/v1/messages')).length === 1 && !calls.find(c => c.url.endsWith('/v1/messages'))!.body.tools, 'Claude is called once, without web search, to fill the fields');
  check(typeof r.usage.estimatedUsd === 'number' && r.usage.estimatedUsd! < 0.05, 'the estimated cost of a Tavily research is a few cents', r.usage);
  check(r.suggestions.fields.industry?.value === 'Bakery' && r.suggestions.fields.industry?.basis === 'VERIFIED', 'a cited fact stays Verified');
  check(r.suggestions.fields.targetAudience?.basis === 'ASSUMPTION', 'a "Verified" point without a source becomes an Assumption');
  check(!/98222|hot@example/.test(r.suggestions.fields.productsServices!.value) && r.suggestions.fields.productsServices!.sources.join() === '2', 'phone numbers and e-mails are removed, and only existing sources are cited', r.suggestions.fields.productsServices);
  check(!('notAField' in r.suggestions.fields) && r.suggestions.fields.businessGoals === undefined, 'unknown and empty fields are dropped');
  check(r.sources.length >= 2 && r.sources.every(s => /^https:/.test(s.url)), 'the sources are kept with their links');
}
{
  const { f, calls } = fakeNet();
  await researchClient(env(), { ...subject, website: 'hotco.in' }, false, f);
  check((calls.find(c => c.url.endsWith('/extract'))!.body.urls as string[])[0] === 'https://hotco.in/', 'a typed website is used as it is');
}

// ---- credits used up -> Claude fallback
{
  const { f, calls } = fakeNet({ searchStatus: 432 });
  const r = await researchClient(env(), subject, false, f);
  const web = calls.find(c => c.url.endsWith('/v1/messages'))!;
  const tool = (web.body.tools as { type: string; max_uses: number }[])[0];
  check(r.provider === 'CLAUDE' && r.usage.fallbackReason === 'TAVILY_CREDITS_USED_UP' && r.tavilyExhausted, 'Tavily credits used up (HTTP 432): Claude\'s web search takes over and Tavily is paused');
  check(tool.type === 'web_search_20260209' && tool.max_uses === 3, 'Claude may search at most 3 times', tool);
  check(r.usage.claudeWebSearches === 2 && r.usage.estimatedUsd! > 0.05, 'the searches and the higher cost are recorded', r.usage);
  check(r.sources.length === 1 && r.sources[0].url === 'https://hotco.in/', 'a source that is not a web link is dropped');
}
{
  const { f } = fakeNet({ searchStatus: 433 });
  check((await researchClient(env(), subject, false, f)).provider === 'CLAUDE', 'the pay-as-you-go limit (HTTP 433) also falls back');
}
{
  const { f, calls } = fakeNet();
  const r = await researchClient(env(), subject, true, f);
  check(r.provider === 'CLAUDE' && !calls.some(c => c.url.includes('tavily')) && !r.tavilyExhausted, 'while Tavily is paused, no Tavily call is wasted');
}
{
  const { f, calls } = fakeNet();
  const r = await researchClient(env({ TAVILY_API_KEY: '' }), subject, false, f);
  check(r.provider === 'CLAUDE' && r.usage.fallbackReason === 'TAVILY_NOT_SET_UP' && !calls.some(c => c.url.includes('tavily')), 'without a Tavily key, Claude researches');
}
{
  const { f } = fakeNet({ searchStatus: 500 });
  const r = await researchClient(env(), subject, false, f);
  check(r.provider === 'CLAUDE' && !r.tavilyExhausted, 'a Tavily outage falls back too, without pausing Tavily');
}
{
  const { f, calls } = fakeNet({ extractStatus: 500 });
  const r = await researchClient(env(), subject, false, f);
  check(r.provider === 'TAVILY' && r.usage.tavilyPages === 0 && calls.filter(c => c.url.endsWith('/v1/messages')).length === 1, 'a failed page extract still uses the search results');
}
{
  const { f } = fakeNet({ extractStatus: 432 });
  check((await researchClient(env(), subject, false, f)).provider === 'CLAUDE', 'credits running out during the extract also falls back');
}

// ---- fallback switched off
{
  const { f } = fakeNet({ searchStatus: 432 });
  let err: { message?: string; tavilyFailure?: string } = {};
  try { await researchClient(env({ BA_RESEARCH_FALLBACK: 'none' }), subject, false, f); } catch (e) { err = e as typeof err; }
  check(/credits for this month are used up/.test(err.message || '') && err.tavilyFailure === 'TAVILY_CREDITS_USED_UP', 'with BA_RESEARCH_FALLBACK=none the user is told the credits are used up', err);
}
{
  let err: { message?: string } = {};
  try { await researchClient(env({ ANTHROPIC_API_KEY: '' }), subject, false, fakeNet().f); } catch (e) { err = e as typeof err; }
  check(/ANTHROPIC_API_KEY/.test(err.message || ''), 'without the AI key, research is not available (and nothing is searched)');
}

// ---- a long Claude search turn that pauses is continued
{
  let n = 0;
  const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    n += 1;
    const body = JSON.parse(String(init?.body));
    if (n === 1) return json(200, { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'Hot Co Pune' } }], usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } });
    check(body.messages.length === 2 && body.messages[1].role === 'assistant', 'the paused turn is sent back to continue it');
    return json(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(mapAnswer) }], usage: { input_tokens: 200, output_tokens: 20, server_tool_use: { web_search_requests: 1 } } });
  }) as typeof fetch;
  const r = await researchClient(env({ TAVILY_API_KEY: '' }), subject, false, f);
  check(r.usage.claudeWebSearches === 2 && r.usage.claudeInputTokens === 300, 'usage is added up across the continued turn', r.usage);
}

// ---- a wrong answer is refused, never patched
{
  let threw = false;
  try { cleanSuggestions({ fields: { industry: { value: 'x', basis: 'MAYBE' } } }, 1); } catch { threw = true; }
  check(threw, 'an answer in the wrong form is refused');
}

console.log(`ba_research: ${passed} checks passed`);
