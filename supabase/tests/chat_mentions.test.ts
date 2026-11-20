/**
 * Chat @mentions and reactions (no database): the composer's "@" rules and the highlighting of tagged names (src/lib/chat/mentions.ts), and the
 * request schemas the server uses. The database decides who may be tagged (current members of the group only). Run: npm run test:unit
 */
import { activeMentions, applyMention, mentionQuery, mentionSuggestions, splitMentions } from '../../src/lib/chat/mentions.js';
import { CHAT_PURGE_CONFIRMATION, CHAT_REACTIONS, chatPurgeSchema, chatReactSchema, chatReactionsQuerySchema, chatSendSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const people = [{ id: 'a', name: 'Priya Shah' }, { id: 'b', name: 'Priya Nair' }, { id: 'c', name: 'Rahul Verma' }, { id: 'd', name: 'Anil Kumar' }];

check(JSON.stringify(mentionQuery('Hi @Pri', 7)) === JSON.stringify({ start: 3, query: 'Pri' }), '"@Pri" before the caret is a mention being typed');
check(JSON.stringify(mentionQuery('@', 1)) === JSON.stringify({ start: 0, query: '' }), 'a lone "@" at the start opens the list');
check(mentionQuery('mail me at x@y.com', 18) === null, 'an e-mail address is not a mention');
check(JSON.stringify(mentionQuery('@Priya Sh', 9)) === JSON.stringify({ start: 0, query: 'Priya Sh' }), 'names with a space keep matching');
check(mentionQuery('@Priya\nnext', 11) === null, 'a new line ends it');
check(mentionQuery('no at sign', 10) === null, 'nothing to suggest without "@"');

check(mentionSuggestions(people, 'pri').map(p => p.id).join() === 'b,a', 'suggestions match the typed start of a name (alphabetical)', mentionSuggestions(people, 'pri'));
check(mentionSuggestions(people, 'verma').map(p => p.id).join() === 'c', '... or any word of it');
check(mentionSuggestions(people, '').length === 4, 'an empty query lists every member');
check(mentionSuggestions(people, 'pri', ['a']).map(p => p.id).join() === 'b', 'someone already tagged is not offered again');
check(mentionSuggestions(people, 'zzz').length === 0, 'no match, no list');

const applied = applyMention('Hi @Pri thanks', 3, 7, 'Priya Shah');
check(applied.text === 'Hi @Priya Shah thanks' && applied.caret === 'Hi @Priya Shah '.length, 'picking a member writes "@Full Name " in place', applied);

check(activeMentions('Thanks @Priya Shah and @Rahul Verma', people).join() === 'a,c', 'the people whose "@Name" is in the text are tagged');
check(activeMentions('Thanks Priya', [people[0]]).length === 0, 'a tag whose "@Name" was deleted from the text is not sent');

const parts = splitMentions('Hi @Priya Shah, ask @Priya too', ['Priya Shah', 'Priya']);
check(parts.filter(p => p.mention).map(p => p.text).join('|') === '@Priya Shah|@Priya', 'the longest name wins when highlighting', parts);
check(parts.map(p => p.text).join('') === 'Hi @Priya Shah, ask @Priya too', 'highlighting keeps every character');
check(splitMentions('a (b) @R.V', ['R.V'])[1]?.mention === true, 'names with special characters are matched literally');

check(CHAT_REACTIONS.join(' ') === '👍 ❤️ 😂 😮 😢 🙏', 'the six offered reactions');
check(chatReactSchema.safeParse({ emoji: '❤️' }).success && chatReactSchema.safeParse({ emoji: null }).success, 'a reaction can be set or removed (null)');
check(!chatReactSchema.safeParse({ emoji: '🔥' }).success, 'any other emoji is refused');
check(chatReactionsQuerySchema.parse({ ids: '0b6f9a1e-6c7d-4a8e-9b2f-1a2b3c4d5e6f, 1b6f9a1e-6c7d-4a8e-9b2f-1a2b3c4d5e6f' }).ids.length === 2, 'reactions of several messages are asked for at once');
check(!chatPurgeSchema.safeParse({ confirm: 'yes' }).success && chatPurgeSchema.safeParse({ confirm: CHAT_PURGE_CONFIRMATION }).success, 'deleting everybody\'s chats needs the typed confirmation');
check(chatSendSchema.parse({ body: 'hi', clientMsgId: '0b6f9a1e-6c7d-4a8e-9b2f-1a2b3c4d5e6f' }).mentions.length === 0, 'an older app that sends no tags still works');
check(!chatSendSchema.safeParse({ body: 'hi', clientMsgId: '0b6f9a1e-6c7d-4a8e-9b2f-1a2b3c4d5e6f', mentions: ['not-an-id'] }).success, 'tags are member ids');

console.log(`=== ${passed} CHAT MENTION AND REACTION CHECKS PASSED ===`);
