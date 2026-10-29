import { type RoleVoice, type TtsState, type VoiceLists } from './shared'

export function RoleVoices({tts,setTts,voices}:{tts:TtsState;setTts:(tts:TtsState)=>void;voices:VoiceLists}) {
 const update=(role:string,patch:RoleVoice)=>setTts({...tts,roles:{...tts.roles,[role]:{...tts.roles[role],...patch}}})
 return <details className="voice-details cast-voices" open><summary>Голоса участников</summary><p>Судья объявляет решение. Прокурор выступает против стримера, адвокат — за участника в апелляции. Ведущий говорит сам.</p>
  {(['judge','prosecutor','advocate'] as const).map(role=>{
   const profile=tts.roles[role]||{}
   const title=role==='judge'?'Судья':role==='prosecutor'?'Прокурор':'Адвокат'
   return <div className="cast-voice-row" key={role}><span>{title}<small>{role==='judge'?'Решение суда':role==='prosecutor'?'Обвинение стримера':'Защита в апелляции'}</small></span><div>
    {tts.engine==='edge'&&<><label className="sr-only" htmlFor={`edge-${role}`}>Голос: {title}</label><select id={`edge-${role}`} value={profile.edge_voice||''} onChange={event=>update(role,{edge_voice:event.target.value})}><option value="">{role!=='judge'?'Авто · Дмитрий':'Основной голос'}</option>{(voices.edge.length?voices.edge:['ru-RU-SvetlanaNeural','ru-RU-DmitryNeural']).map(voice=><option key={voice} value={voice}>{voice.includes('Svetlana')?'Светлана':voice.includes('Dmitry')?'Дмитрий':voice}</option>)}</select><label className="cast-rate">Темп<input value={profile.rate||''} placeholder={role==='judge'?tts.judgeRate:role==='advocate'?'+8%':tts.rate} onChange={event=>update(role,{rate:event.target.value})}/></label></>}
    {tts.engine==='silero'&&<><label className="sr-only" htmlFor={`silero-${role}`}>Голос: {title}</label><select id={`silero-${role}`} value={profile.silero_voice||''} onChange={event=>update(role,{silero_voice:event.target.value})}><option value="">{role==='judge'?'Основной голос':role==='prosecutor'?'Авто · Евгений':'Авто · Айдар'}</option>{(voices.silero.length?voices.silero:['kseniya','baya','eugene','aidar','xenia']).map(voice=><option key={voice} value={voice}>{({kseniya:'Ксения',baya:'Бая',eugene:'Евгений',aidar:'Айдар',xenia:'Ксения · другой тембр'} as Record<string,string>)[voice]||voice}</option>)}</select></>}
    {tts.engine==='elevenlabs'&&<label>Voice ID<input value={profile.eleven_voice_id||''} placeholder="Основной Voice ID" onChange={event=>update(role,{eleven_voice_id:event.target.value})}/></label>}
    {tts.engine==='piper'&&<label>Модель .onnx<input value={profile.piper_model_path||''} placeholder="Основная модель" onChange={event=>update(role,{piper_model_path:event.target.value})}/></label>}
   </div></div>
  })}
  {tts.engine==='edge'&&<p>В этом подключении Edge два русских тембра. Для трёх разных дикторов выберите Silero или назначьте разные Voice ID в ElevenLabs.</p>}
  {tts.engine==='piper'&&<p>Для другого диктора скачайте его модель: <code>./voice.sh piper ru_RU-dmitri-medium</code>, затем укажите <code>models/ru_RU-dmitri-medium.onnx</code>. Конфиг .onnx.json берётся рядом с моделью.</p>}
  {tts.engine==='elevenlabs'&&<p>Для разных тембров нужны разные Voice ID из вашего аккаунта. Если поле пустое, используется основной голос; роли не создают платные голоса автоматически.</p>}
 </details>
}
