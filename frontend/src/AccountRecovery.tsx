import { useEffect, useState } from 'react';
type Mode = 'forgot' | 'request' | 'reset' | 'verify';
export default function AccountRecovery() {
  const [enabled,setEnabled] = useState(false);
  const [mode,setMode] = useState<Mode | null>(null);
  const [token,setToken] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  useEffect(()=>{
    const hash = new URLSearchParams(location.hash.slice(1));
    for (const kind of ['reset','verify'] as const) {
      const value=hash.get(kind);
      if(value){setToken(value);setMode(kind);history.replaceState(null,'',location.pathname+location.search);break;}
    }
    const abort=new AbortController();
    fetch('/auth/config',{signal:abort.signal}).then(r=>r.json()).then(r=>setEnabled(r.email_enabled===true)).catch(()=>{});
    return ()=>abort.abort();
  },[]);
  if(!mode) return enabled ? <div className="auth-recovery-links"><button className="text-button" onClick={()=>{setMode('forgot');setMessage('');}}>Забыли пароль?</button><button className="text-button" onClick={()=>{setMode('request');setMessage('');}}>Подтвердить почту</button></div> : null;
  const titles={forgot:'Восстановление доступа',request:'Подтверждение почты',reset:'Новый пароль',verify:'Подтвердить адрес'};
  return <section className="auth-recovery" aria-label={titles[mode]}><h2>{titles[mode]}</h2>
    <form onSubmit={async e=>{
      e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
      const data=new FormData(e.currentTarget);
      try {
        const endpoint={forgot:'forgot-password',request:'request-verification',reset:'reset-password',verify:'verify-email'}[mode];
        const response=await fetch('/auth/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({email:data.get('email'),password:data.get('password'),confirmPassword:data.get('confirmPassword'),token})});
        const result=await response.json();if(!response.ok)throw new Error(result.detail||'Не удалось выполнить запрос');
        setMessage(result.message);if(mode==='reset'||mode==='verify')setToken('');
      } catch(e){setError((e as Error).message);} finally{setBusy(false);}
    }}>
      <fieldset className="auth-fields" disabled={busy}>
      {(mode==='forgot'||mode==='request')&&<label>Почта<input name="email" type="email" maxLength={254} autoComplete="email" required/></label>}
      {mode==='reset'&&token&&<><label>Новый пароль<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><label>Повторите пароль<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label></>}
      {(token||mode==='forgot'||mode==='request')&&<button className="button primary">{busy?'Отправка…':mode==='verify'?'Подтвердить почту':mode==='reset'?'Сохранить пароль':'Отправить письмо'}</button>}
      </fieldset>
    </form>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error-banner">{error}</p>}
    <button className="text-button" disabled={busy} onClick={()=>{setMode(null);setToken('');setError('');}}>Закрыть</button>
  </section>;
}
