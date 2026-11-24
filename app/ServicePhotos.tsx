'use client';
import {useEffect,useState} from 'react';
export function ReceptionPhotos({value,onChange}:{value:string[];onChange:(v:string[])=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function choose(files:FileList|null){
  if(!files)return;setBusy(true);setError('');
  try{if(value.length+files.length>4)throw Error('Puedes adjuntar hasta 4 fotos.');
   const images:string[]=[];
   for(const file of Array.from(files)){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Usa fotos JPG, PNG o WebP de hasta 15 MB.');
    const bitmap=await createImageBitmap(file),scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const image=canvas.toDataURL('image/jpeg',0.75);if(image.length>700000)throw Error('Selecciona una foto de menor tamaño.');images.push(image);
   }onChange([...value,...images]);
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="service-wide"><label>Fotos del equipo (opcionales, hasta 4)<input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{void choose(e.target.files);e.target.value=''}}/></label>{busy&&<p>Preparando fotos…</p>}{error&&<p role="alert">{error}</p>}<div className="service-photos">{value.map((src,index)=><figure key={index}><img src={src} alt={'Foto del equipo '+(index+1)}/><button type="button" onClick={()=>onChange(value.filter((_,i)=>i!==index))}>Quitar foto</button></figure>)}</div></div>
}
export function SavedServicePhotos({orderId}:{orderId:number}){
 const [photos,setPhotos]=useState<string[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;fetch('/api/auth?resource=service-photos&orderId='+orderId,{cache:'no-store'}).then(async r=>{const d:any=await r.json();if(!r.ok)throw Error(d.error);if(active)setPhotos(d.photos||[])}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[orderId]);
 return <div className="service-photos print-hide">{error&&<p role="alert">{error}</p>}{photos.map((src,i)=><a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={'Foto del equipo '+(i+1)}/></a>)}</div>
}
