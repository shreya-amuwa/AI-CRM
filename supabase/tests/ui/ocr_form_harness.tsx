import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShopPhotoScan } from '../../../src/components/common/ShopPhotoScan';
import { planFill, type Flags } from '../../../src/lib/ocr/scanFill';
import type { ShopScan } from '../../../src/lib/ocr/shopText';

/** The same wiring as the Dispatch Field Visit form: the scan card, three fields, and the "read from the photo" notes. */
const Harness: React.FC = () => {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [scan, setScan] = useState<ShopScan | null>(null);
  const [from, setFrom] = useState<Flags>({});
  const [check, setCheck] = useState<Flags>({});
  const apply = (s: ShopScan) => {
    setScan(s);
    const plan = planFill(s, { name, address, phone }, from);
    if (plan.values.name !== undefined) setName(plan.values.name);
    if (plan.values.address !== undefined) setAddress(plan.values.address);
    if (plan.values.phone !== undefined) setPhone(plan.values.phone);
    setFrom(plan.fromPhoto);
    setCheck(plan.check);
  };
  const note = (f: 'name' | 'address' | 'phone') => (from[f] ? <p data-testid={`from-photo-${f}`}>{check[f] ? 'check' : 'Read from the photo'}</p> : null);
  return (
    <form className="p-3 space-y-3 max-w-lg text-xs font-mono" onSubmit={e => e.preventDefault()}>
      <ShopPhotoScan scan={scan} onScan={apply} onPick={(f, v) => { if (f === 'name') setName(v); if (f === 'address') setAddress(v); if (f === 'phone') setPhone(v); setFrom(x => ({ ...x, [f]: true })); }} />
      <input data-testid="name" value={name} onChange={e => { setName(e.target.value); setFrom(f => ({ ...f, name: false })); }} className="w-full px-3 py-2 border" />
      {note('name')}
      <input data-testid="address" value={address} onChange={e => { setAddress(e.target.value); setFrom(f => ({ ...f, address: false })); }} className="w-full px-3 py-2 border" />
      {note('address')}
      <input data-testid="phone" value={phone} onChange={e => { setPhone(e.target.value); setFrom(f => ({ ...f, phone: false })); }} className="w-full px-3 py-2 border" />
      {note('phone')}
    </form>
  );
};
(window as any).mount = () => createRoot(document.getElementById('root')!).render(<Harness />);
