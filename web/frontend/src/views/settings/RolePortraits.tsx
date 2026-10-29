import { useEffect, useState } from 'react'
import { apiFetch, apiGet, apiUpload } from '../../lib/api'

interface RolePhoto { role: string; has_custom: boolean; url: string }
export function RolePortraits() {
 const [photos,setPhotos] = useState<RolePhoto[]>([])
 const [busy,setBusy] = useState('')
 const [error,setError] = useState('')
 const refresh=async()=>{setPhotos(await apiGet<RolePhoto[]>('/api/roles'));setError('')}
 useEffect(()=>{
  const check=()=>{void refresh().catch(()=>setError('Не удалось загрузить портреты участников.'))}
  check()
  const timer=setInterval(check,10000)
  window.addEventListener('tribunal-appearance',check)
  return()=>{clearInterval(timer);window.removeEventListener('tribunal-appearance',check)}
 },[])
 const change=async(role:string,file?:File)=>{
  setBusy(role);setError('')
  try {
   let ok: boolean
   if(file){const form=new FormData();form.set('photo',file);ok=await apiUpload(`/api/roles/${role}/photo`,form)}
   else ok=(await apiFetch(`/api/roles/${role}/photo`,{method:'DELETE'})).ok
   if(!ok)throw new Error('Нужен PNG, JPG или WebP до 5 МБ. Проверьте ключ доступа и соединение.')
   await refresh()
  }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось изменить портрет.')}
  finally{setBusy('')}
 }
 return <section className="settings-panel role-portraits"><div className="section-heading"><span className="section-index">04</span><div><h2>Стороны процесса</h2><p>В суде над стримером говорит прокурор, в апелляции — адвокат. Сцена показывает портрет говорящего. Фотографию можно заменить на свой персонаж.</p></div></div>
  <div className="cast-portrait-grid">{photos.map(photo=><div key={photo.role} className="cast-portrait"><div className="cast-portrait-image"><img src={photo.url} alt={photo.role==='prosecutor'?'Прокурор':'Адвокат'} /></div><div><h3>{photo.role==='prosecutor'?'Прокурор':'Адвокат'}</h3><p>{photo.role==='prosecutor'?'Гигачад · суд над стримером':'Сол Гудман · апелляция'}</p><label className="secondary-action upload-label">Заменить портрет<input type="file" disabled={!!busy} accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];if(file)void change(photo.role,file);event.target.value=''}} /></label>{photo.has_custom&&<button type="button" className="file-text-button" disabled={!!busy} onClick={()=>void change(photo.role)}>Стандартный персонаж</button>}</div></div>)}</div>
  {error&&<p role="alert" className="desk-error">{error}</p>}<p className="media-save-note">Загрузка сразу меняет изображение на сцене. Голоса выбираются в «Голоса и подача».</p>
 </section>
}
