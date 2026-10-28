import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The emoji picker of the chat composer. No library and no network: a fixed set of common emojis in a few groups, drawn by the device's own
 * emoji font (so they look right on desktop, tablet and phone), with a search over the names and a "recently used" row kept in this browser.
 */
const GROUPS: { id: string; label: string; icon: string; items: [string, string][] }[] = [
  { id: 'smileys', label: 'Smileys', icon: '😀', items: [
    ['😀', 'grinning'], ['😃', 'smile'], ['😄', 'happy'], ['😁', 'beaming'], ['😆', 'laughing'], ['😅', 'sweat smile'], ['🤣', 'rofl'], ['😂', 'joy tears'], ['🙂', 'slight smile'], ['🙃', 'upside down'],
    ['😉', 'wink'], ['😊', 'blush'], ['😇', 'angel'], ['🥰', 'love hearts face'], ['😍', 'heart eyes'], ['🤩', 'star struck'], ['😘', 'kiss'], ['😋', 'yum'], ['😛', 'tongue'], ['😜', 'wink tongue'],
    ['🤗', 'hug'], ['🤔', 'thinking'], ['🤨', 'raised eyebrow'], ['😐', 'neutral'], ['😑', 'expressionless'], ['😶', 'no mouth'], ['🙄', 'eye roll'], ['😏', 'smirk'], ['😒', 'unamused'], ['😬', 'grimace'],
    ['😌', 'relieved'], ['😔', 'pensive'], ['😪', 'sleepy'], ['😴', 'sleeping'], ['😷', 'mask'], ['🤒', 'sick'], ['🤕', 'hurt'], ['🤢', 'nauseated'], ['🥵', 'hot'], ['🥶', 'cold'],
    ['😎', 'cool sunglasses'], ['🤓', 'nerd'], ['🧐', 'monocle'], ['😕', 'confused'], ['😟', 'worried'], ['🙁', 'frown'], ['😮', 'open mouth'], ['😲', 'astonished'], ['😳', 'flushed'], ['🥺', 'pleading'],
    ['😢', 'cry'], ['😭', 'sob'], ['😤', 'huff'], ['😠', 'angry'], ['😡', 'rage'], ['🤯', 'mind blown'], ['😱', 'scream'], ['😨', 'fear'], ['😰', 'anxious'], ['🥳', 'party']
  ] },
  { id: 'gestures', label: 'People', icon: '👍', items: [
    ['👍', 'thumbs up yes ok'], ['👎', 'thumbs down no'], ['👏', 'clap'], ['🙌', 'raised hands'], ['🤝', 'handshake deal'], ['🙏', 'pray thanks please'], ['💪', 'strong muscle'], ['👌', 'ok hand'], ['✌️', 'victory peace'], ['🤞', 'fingers crossed'],
    ['🤟', 'love you'], ['🤘', 'rock'], ['👋', 'wave hello'], ['🤚', 'raised hand'], ['✋', 'stop hand'], ['👆', 'point up'], ['👇', 'point down'], ['👈', 'point left'], ['👉', 'point right'], ['☝️', 'index up'],
    ['✍️', 'writing'], ['🤳', 'selfie'], ['👀', 'eyes look'], ['🧠', 'brain'], ['👤', 'person'], ['👥', 'people'], ['🧑‍💻', 'technologist laptop'], ['🧑‍💼', 'office worker'], ['🦸', 'superhero'], ['🤷', 'shrug']
  ] },
  { id: 'hearts', label: 'Hearts', icon: '❤️', items: [
    ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'], ['💔', 'broken heart'], ['❣️', 'heart exclamation'],
    ['💕', 'two hearts'], ['💞', 'revolving hearts'], ['💓', 'beating heart'], ['💗', 'growing heart'], ['💖', 'sparkling heart'], ['💘', 'heart arrow'], ['💝', 'heart gift'], ['💯', 'hundred'], ['🔥', 'fire'], ['✨', 'sparkles']
  ] },
  { id: 'objects', label: 'Work', icon: '💼', items: [
    ['💼', 'briefcase'], ['📁', 'folder'], ['📂', 'open folder'], ['📄', 'document'], ['📊', 'chart'], ['📈', 'chart up growth'], ['📉', 'chart down'], ['📅', 'calendar'], ['📆', 'calendar date'], ['📌', 'pin'],
    ['📎', 'paperclip'], ['✏️', 'pencil'], ['📝', 'memo note'], ['📞', 'phone call'], ['📱', 'mobile'], ['💻', 'laptop'], ['🖥️', 'desktop'], ['⌨️', 'keyboard'], ['🖨️', 'printer'], ['📧', 'email'],
    ['📨', 'incoming mail'], ['📬', 'mailbox'], ['🔔', 'bell'], ['🔕', 'bell off'], ['🔒', 'lock'], ['🔓', 'unlock'], ['🔑', 'key'], ['🔍', 'search'], ['💡', 'idea bulb'], ['⏰', 'alarm clock'],
    ['⏳', 'hourglass'], ['💰', 'money bag'], ['💵', 'dollar'], ['💳', 'credit card'], ['🧾', 'receipt invoice'], ['🏢', 'office building'], ['🏠', 'home'], ['🚗', 'car'], ['✈️', 'plane'], ['🎯', 'target goal']
  ] },
  { id: 'symbols', label: 'Symbols', icon: '✅', items: [
    ['✅', 'check done'], ['☑️', 'ballot check'], ['✔️', 'tick'], ['❌', 'cross no'], ['❎', 'cross mark'], ['⭕', 'circle'], ['❗', 'exclamation'], ['❓', 'question'], ['⚠️', 'warning'], ['🚫', 'prohibited'],
    ['🆗', 'ok'], ['🆕', 'new'], ['🔴', 'red circle'], ['🟠', 'orange circle'], ['🟡', 'yellow circle'], ['🟢', 'green circle'], ['🔵', 'blue circle'], ['⭐', 'star'], ['🌟', 'glowing star'], ['➕', 'plus'],
    ['➖', 'minus'], ['➡️', 'right arrow'], ['⬅️', 'left arrow'], ['⬆️', 'up arrow'], ['⬇️', 'down arrow'], ['🔁', 'repeat'], ['🔄', 'refresh'], ['🎉', 'party popper celebrate'], ['🎊', 'confetti'], ['🏆', 'trophy win']
  ] },
  { id: 'nature', label: 'Nature & food', icon: '☕', items: [
    ['☕', 'coffee'], ['🍵', 'tea'], ['🍕', 'pizza'], ['🍔', 'burger'], ['🍟', 'fries'], ['🍎', 'apple'], ['🍌', 'banana'], ['🍰', 'cake'], ['🎂', 'birthday cake'], ['🍪', 'cookie'],
    ['🌞', 'sun'], ['🌙', 'moon'], ['⭐', 'star'], ['🌈', 'rainbow'], ['☔', 'rain umbrella'], ['⚡', 'lightning'], ['❄️', 'snow'], ['🌸', 'blossom'], ['🌹', 'rose'], ['🌳', 'tree'],
    ['🐶', 'dog'], ['🐱', 'cat'], ['🦁', 'lion'], ['🐼', 'panda'], ['🐢', 'turtle'], ['🦋', 'butterfly'], ['🐝', 'bee'], ['🌍', 'earth'], ['⚽', 'football'], ['🏏', 'cricket']
  ] }
];
const RECENT_KEY = 'amuwa-chat-recent-emoji';
const RECENT_MAX = 16;

const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
};
const writeRecent = (emoji: string) => {
  try {
    const next = [emoji, ...readRecent().filter(x => x !== emoji)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private window: nothing is remembered */ }
};

/** A popover above the composer. `onPick` receives one emoji each time; the picker stays open so several can be chosen. */
export const EmojiPicker: React.FC<{ onPick: (emoji: string) => void; onClose: () => void }> = ({ onPick, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState(GROUPS[0].id);
  const [term, setTerm] = useState('');
  const [recent, setRecent] = useState<string[]>(readRecent);

  useEffect(() => {
    const down = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      const target = e.target as Node;
      // the button that opened it toggles it itself
      if (el && !el.contains(target) && !(target as HTMLElement).closest?.('[data-emoji-toggle]')) onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); document.removeEventListener('keydown', key, true); };
  }, [onClose]);

  const q = term.trim().toLowerCase();
  const shown = useMemo(() => {
    if (q) {
      const seen = new Set<string>();
      return GROUPS.flatMap(g => g.items).filter(([e, name]) => name.includes(q) && !seen.has(e) && (seen.add(e), true));
    }
    return GROUPS.find(g => g.id === group)?.items ?? [];
  }, [q, group]);

  const pick = (emoji: string) => { writeRecent(emoji); setRecent(readRecent()); onPick(emoji); };

  return (
    <div className="ch-emoji" role="dialog" aria-label="Emoji picker" ref={ref} data-testid="emoji-picker">
      <input className="ch-emoji-search" type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" />
      {!q && (
        <div className="ch-emoji-tabs" role="tablist" aria-label="Emoji groups">
          {GROUPS.map(g => (
            <button key={g.id} type="button" role="tab" aria-selected={group === g.id} aria-label={g.label} title={g.label} onClick={() => setGroup(g.id)}>{g.icon}</button>
          ))}
        </div>
      )}
      <div className="ch-emoji-body">
        {!q && recent.length > 0 && (
          <>
            <p className="ch-emoji-title">Recent</p>
            <div className="ch-emoji-grid" aria-label="Recently used">
              {recent.map(e => <button key={`r${e}`} type="button" onClick={() => pick(e)} aria-label={`Insert ${e}`}>{e}</button>)}
            </div>
          </>
        )}
        <p className="ch-emoji-title">{q ? `Results for “${term.trim()}”` : GROUPS.find(g => g.id === group)?.label}</p>
        {shown.length === 0 ? <p className="ch-emoji-none">No emoji found.</p> : (
          <div className="ch-emoji-grid" aria-label="Emoji">
            {shown.map(([e, name]) => <button key={e} type="button" title={name} onClick={() => pick(e)} aria-label={`Insert ${name}`}>{e}</button>)}
          </div>
        )}
      </div>
    </div>
  );
};
