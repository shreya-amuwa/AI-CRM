import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WhatsAppField } from '../../../src/components/team-member/pipeline/WhatsAppField';
import { startsSameAsMobile, whatsappValue } from '../../../shared/whatsapp';

/** The same wiring as the Add lead and Edit lead forms: a mobile field, the WhatsApp field and what would be saved. */
const Harness: React.FC<{ initialPhone?: string; initialWhatsapp?: string; edit?: boolean }> = ({ initialPhone = '', initialWhatsapp = '', edit }) => {
  const [phone, setPhone] = useState(initialPhone);
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp);
  const [same, setSame] = useState(edit ? startsSameAsMobile(initialPhone, initialWhatsapp) : false);
  return (
    <form onSubmit={e => e.preventDefault()}>
      <label htmlFor="mobile">Mobile number</label>
      <input id="mobile" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      <WhatsAppField id="wa" phone={phone} whatsapp={whatsapp} same={same} onChange={n => { setSame(n.same); setWhatsapp(n.whatsapp); }} />
      <output id="saved">{whatsappValue(same, phone, whatsapp).trim() || 'null'}</output>
    </form>
  );
};

(window as any).mount = (props: Record<string, unknown>) => createRoot(document.getElementById('root')!).render(<Harness {...props} />);
