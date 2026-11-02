import React,{useCallback,useState} from 'react';
import type { CareerProfile } from '../../shared/contracts';
import {careerProfileSchema} from '../../shared/validation';
import {candidateRequest} from './api';
import {Card,Field,Failure,Loading,Notice,button,textInput,useRemote,readable} from './parts';
export const Profile:React.FC=()=>{
 const get=useCallback(()=>candidateRequest<CareerProfile>('/candidate/profile'),[]);const r=useRemote(get);
 if(r.loading)return <Loading/>;if(r.error)return <Failure message={r.error} retry={r.reload}/>;if(!r.data)return null;
 return <ProfileForm key={r.data.id} value={r.data} onSaved={r.setData}/>;
};
const ProfileForm:React.FC<{value:CareerProfile;onSaved:(p:CareerProfile)=>void}>=({value,onSaved})=>{
 const [form,setForm]=useState(value);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
 const fields={name:'Full name',phone:'Mobile number',city:'City',state:'State',education:'Education',experience:'Experience',skills:'Skills',bio:'About you'} as const;
 const save=async(e:React.FormEvent)=>{e.preventDefault();const body={...Object.fromEntries(Object.keys(fields).map(k=>[k,form[k as keyof typeof fields]])),version:form.version};const p=careerProfileSchema.safeParse(body);if(!p.success){setError(p.error.issues.map(i=>i.message).join(' '));return;}setBusy(true);setError('');try{const next=await candidateRequest<CareerProfile>('/candidate/profile',p.data,'PATCH');setForm(next);onSaved(next);setNotice('Profile saved. Previously submitted applications keep their original details.');}catch(e){setError(readable(e));}finally{setBusy(false);}};
 return <Card title="My profile"><p className="text-sm text-slate-500 mb-5">Help the recruitment team get to know you. Your verified email is {value.email}.</p><form onSubmit={save} className="space-y-5"><div className="grid sm:grid-cols-2 gap-4">{Object.entries(fields).map(([key,label])=><Field key={key} id={`profile-${key}`} label={label}><textarea id={`profile-${key}`} rows={['bio','experience'].includes(key)?3:1} className={textInput} maxLength={key==='name'?160:key==='phone'?40:['city','state'].includes(key)?120:2000} value={form[key as keyof typeof fields]} required={['name','phone'].includes(key)} onChange={e=>setForm({...form,[key]:e.target.value})}/></Field>)}</div>{error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}<button className={button} disabled={busy}>{busy?'Saving…':'Save profile'}</button></form></Card>;
};
