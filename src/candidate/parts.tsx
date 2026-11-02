import React,{useCallback,useEffect,useState} from 'react';
export const textInput='w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100';
export const button='inline-flex justify-center items-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50';
export const secondary='inline-flex justify-center items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
export const readable=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';
export const Card:React.FC<React.PropsWithChildren<{title?:string;className?:string}>>=({title,children,className=''})=><section className={`rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 ${className}`}>{title&&<h2 className="text-lg font-bold text-slate-900 mb-4">{title}</h2>}{children}</section>;
export const Notice:React.FC<{error?:boolean;children:React.ReactNode}>=({error,children})=><p role={error?'alert':'status'} className={`rounded-xl p-3 text-sm ${error?'bg-rose-50 text-rose-800 border border-rose-200':'bg-blue-50 text-blue-900'}`}>{children}</p>;
export const Field:React.FC<React.PropsWithChildren<{label:string;id:string}>>=({label,id,children})=><div><label htmlFor={id} className="block mb-1.5 text-sm font-medium text-slate-700">{label}</label>{children}</div>;
export function useRemote<T>(fetcher:()=>Promise<T>) {
 const [data,setData]=useState<T|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [revision,setRevision]=useState(0);
 const reload=useCallback(()=>setRevision(n=>n+1),[]);
 useEffect(()=>{let active=true;setLoading(true);setError('');fetcher().then(v=>{if(active)setData(v);}).catch(e=>{if(active)setError(readable(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[fetcher,revision]);
 return {data,error,loading,reload,setData};
}
export const Loading=()=> <p role="status" className="p-6 text-slate-500">Loading…</p>;
export const Failure:React.FC<{message:string;retry:()=>void}>=({message,retry})=><div className="space-y-3"><Notice error>{message}</Notice><button className={secondary} onClick={retry}>Try again</button></div>;
export const when=(date:string|null)=>date?new Date(date).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'Not scheduled';
export const stageName=(s:string)=>s.toLowerCase().replace(/_/g,' ').replace(/^./,v=>v.toUpperCase());
