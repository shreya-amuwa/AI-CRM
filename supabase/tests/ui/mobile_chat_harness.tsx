// A small copy of the client dashboard's chat page for the browser test: the real useFillViewport hook and the real stylesheets, with the same
// structure (top bar, channel tabs that appear AFTER the first render, the chat card, the fixed tab bar). No data and no network.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useFillViewport } from '../../../src/lib/chat/useFillViewport';

const Harness: React.FC<{ messages: number }> = ({ messages }) => {
  const [loaded, setLoaded] = useState(false);
  const card = useFillViewport<HTMLDivElement>(() => document.querySelector<HTMLElement>('.cd-tabbar')?.offsetHeight ?? 0);
  useEffect(() => {
    document.documentElement.classList.add('cd-chat-open');
    const t = window.setTimeout(() => setLoaded(true), 50); // the journey answer arrives after the first paint
    return () => { window.clearTimeout(t); document.documentElement.classList.remove('cd-chat-open'); };
  }, []);
  return (
    <div className="cd">
      <div className="cd-shell">
        <div className="cd-main">
          <header className="cd-top"><button className="cd-burger" aria-label="Menu">Menu</button><div className="grow" /><span>AS</span></header>
          <main className="cd-content cd-content-flush">
            <div className="cd-chat-page">
              {loaded ? (
                <div key="tabs" className="cd-chat-tabs" role="tablist">
                  <button role="tab" className="cd-chat-tab" aria-selected="false">Meta verification<small> · closed</small></button>
                  <button role="tab" className="cd-chat-tab" aria-selected="true">Relationship Manager</button>
                </div>
              ) : null}
              <div key="card" className="cd-chat-card" ref={card}>
                <section className="ch-thread">
                  <div className="ch-head">
                    <span className="ch-avatar group" />
                    <div className="ch-head-main"><h2>Your Amuwa team</h2><p>Arjun Support (Relationship Manager) and Meera Support Lead (Team Lead)</p></div>
                  </div>
                  <div className="ch-body" role="log" data-testid="body">
                    {Array.from({ length: messages }, (_, i) => (
                      <div key={i} className={`ch-row ${i % 2 ? 'mine' : 'theirs'}`}><div className="ch-bubble"><p className="ch-text">{`Message ${i + 1} ${'with some words '.repeat(1 + (i % 4) * 3)}`}</p></div></div>
                    ))}
                  </div>
                  <form className="ch-composer" onSubmit={e => e.preventDefault()}>
                    <div className="ch-input">
                      <button type="button" className="ch-icon" aria-label="Insert emoji">:)</button>
                      <button type="button" className="ch-icon" aria-label="Attach a file">+</button>
                      <textarea rows={1} aria-label="Message" placeholder="Write a message" />
                      <button type="submit" className="ch-send" aria-label="Send message">&gt;</button>
                    </div>
                    <p className="ch-hint">Enter to send</p>
                  </form>
                </section>
              </div>
            </div>
          </main>
        </div>
        <nav className="cd-tabbar" aria-label="Quick navigation"><button>Home</button><button>Services</button><button>Tickets</button><button>Campaigns</button><button aria-current="page">Live chat</button></nav>
      </div>
    </div>
  );
};

(window as unknown as { mount: (n: number) => void }).mount = (n: number) => createRoot(document.getElementById('root')!).render(<Harness messages={n} />);
