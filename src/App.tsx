import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, AudioLines, Camera, CameraOff, Check, CheckCircle2, Clipboard,
  Headphones, Link2, LoaderCircle, LockKeyhole, Mic, MicOff, MonitorPlay,
  PhoneOff, Radio, RefreshCw, ShieldCheck, Signal, Sparkles, UsersRound, Video,
  Wifi, WifiOff,
} from 'lucide-react';
import { CallPhase, useInterview } from './useInterview';

const status: Record<CallPhase, { label: string; detail: string; tone: string }> = {
  idle: { label: 'Не подключено', detail: 'Начни видеособеседование, когда будешь готов', tone: 'neutral' },
  preparing: { label: 'Подключаем устройства', detail: 'Запрашиваем доступ к камере и микрофону', tone: 'yellow' },
  'server-connecting': { label: 'Соединяемся с сервером', detail: 'Устанавливаем WebSocket-соединение', tone: 'yellow' },
  waiting: { label: 'Ожидаем собеседника', detail: 'Открой ссылку во втором окне или отправь другу', tone: 'yellow' },
  negotiating: { label: 'Соединяем участников', detail: 'Обмениваемся offer, answer и ICE-кандидатами', tone: 'yellow' },
  connected: { label: 'На связи', detail: 'Защищённое соединение WebRTC установлено', tone: 'green' },
  disconnected: { label: 'Соединение завершено', detail: 'Можно войти заново', tone: 'red' },
  error: { label: 'Ошибка подключения', detail: 'Посмотри сообщение ниже и попробуй ещё раз', tone: 'red' },
};

function duration(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function App() {
  const call = useInterview();
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(() => sessionStorage.getItem('oneroom-name') || 'Участник');
  const [editName, setEditName] = useState(false);

  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = call.localStream;
  }, [call.localStream]);
  useEffect(() => {
    if (remoteVideo.current) remoteVideo.current.srcObject = call.remoteStream;
  }, [call.remoteStream]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      window.prompt('Скопируй ссылку для собеседника:', window.location.href);
    }
  }

  const current = status[call.phase];
  const connecting = call.phase === 'preparing' || call.phase === 'server-connecting';
  const canReconnect = call.phase === 'disconnected' || call.phase === 'error';

  return (
    <div className="app-shell">
      <div className="background-glow glow-one" aria-hidden="true" />
      <div className="background-glow glow-two" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Video size={21} strokeWidth={2.5} /></span>
          <span className="brand-name">one<span>room</span><span className="brand-dot">.</span></span>
          <span className="brand-divider" />
          <span className="brand-caption">Видеособеседования</span>
        </div>
        <div className="header-right">
          <span className="realtime"><span className="pulse-dot" /> WEBRTC / P2P</span>
          <span className="user-bubble" title="Без регистрации"><UsersRound size={17} /></span>
        </div>
      </header>

      <main className="main-content">
        <div className="breadcrumb"><span>РАБОЧЕЕ ПРОСТРАНСТВО</span><span className="crumb-separator">/</span><strong>КОМНАТА 01</strong></div>
        <section className="hero">
          <div className="hero-main">
            <div className="eyebrow"><Sparkles size={14} /> ONE-ON-ONE INTERVIEW</div>
            <h1>Встречи, которые <span>имеют значение.</span></h1>
            <p>Видеосвязь один на один прямо в браузере. Без установки приложений — только ты и твой собеседник.</p>
          </div>
          <div className="hero-side">
            <span className="hero-icon"><ShieldCheck size={19} /></span>
            <div><strong>Прямое соединение</strong><span>Аудио и видео через WebRTC</span></div>
          </div>
        </section>

        <section className="workspace" aria-label="Видеособеседование">
          <div className="workspace-head">
            <div className="workspace-title"><span className="workspace-icon"><MonitorPlay size={19} /></span><div><h2>Комната интервью</h2><p>Личная встреча · максимум 2 участника</p></div></div>
            <div className={`status-pill ${current.tone}`}><span className="status-light" /> {current.label}</div>
          </div>

          <div className="videos">
            <div className="video-panel remote-panel">
              <video ref={remoteVideo} autoPlay playsInline className={`video-feed ${call.remoteStream ? 'visible' : ''}`} />
              {(!call.remoteStream || call.phase !== 'connected') && (
                <div className="remote-placeholder">
                  <div className={`remote-orbit ${call.inRoom ? 'searching' : ''}`}>
                    <div className="orbit-orbit"/><span><UsersRound size={38} strokeWidth={1.4} /></span>
                  </div>
                  <strong>{call.inRoom ? (call.phase === 'connected' ? 'Получаем видео...' : 'Ждём подключения') : 'Место для собеседника'}</strong>
                  <p>{call.inRoom ? current.detail : 'Здесь появится видео второго участника'}</p>
                </div>
              )}
              <span className="video-caption"><span className="caption-dot" /> СОБЕСЕДНИК</span>
              {call.phase === 'connected' && <span className="video-duration"><Radio size={14} /> {duration(call.secondsConnected)}</span>}
            </div>

            <div className="video-panel local-panel">
              <video ref={localVideo} autoPlay playsInline muted className={`video-feed local-feed ${call.localStream && call.cameraOn ? 'visible' : ''}`} />
              {(!call.localStream || !call.cameraOn) && (
                <div className="local-placeholder"><div className="local-avatar"><CameraOff size={27} /></div><span>{call.localStream ? 'Камера выключена' : 'Предпросмотр камеры'}</span></div>
              )}
              <span className="video-caption"><span className="caption-dot local" /> {name.toUpperCase()} (ВЫ)</span>
              {call.inRoom && <span className="local-indicator"><span /> LIVE</span>}
            </div>
          </div>

          <div className="call-toolbar">
            <div className="call-status"><span className={`connection-symbol ${current.tone}`}>{call.phase === 'connected' ? <Signal size={19} /> : call.inRoom ? <Wifi size={19} /> : <WifiOff size={19} />}</span><div><strong>{current.label}</strong><span>{current.detail}</span></div></div>
            <div className="call-buttons">
              {call.inRoom ? (
                <>
                  <button className={`control-btn ${!call.micOn ? 'off' : ''}`} onClick={call.toggleMic} title={call.micOn ? 'Отключить микрофон' : 'Включить микрофон'} aria-label={call.micOn ? 'Отключить микрофон' : 'Включить микрофон'}>{call.micOn ? <Mic size={19} /> : <MicOff size={19} />}</button>
                  <button className={`control-btn ${!call.cameraOn ? 'off' : ''}`} onClick={call.toggleCamera} title={call.cameraOn ? 'Отключить камеру' : 'Включить камеру'} aria-label={call.cameraOn ? 'Отключить камеру' : 'Включить камеру'}>{call.cameraOn ? <Camera size={19} /> : <CameraOff size={19} />}</button>
                  <button className="end-btn" onClick={call.leave}><PhoneOff size={17} /> Завершить</button>
                </>
              ) : (
                <button className="start-btn" onClick={() => void call.join()} disabled={connecting}>
                  {connecting ? <LoaderCircle className="spin" size={18} /> : canReconnect ? <RefreshCw size={18} /> : <Video size={18} />}
                  {connecting ? 'Подключаем...' : canReconnect ? 'Попробовать снова' : 'Начать встречу'}
                  {!connecting && <ArrowRight size={17} />}
                </button>
              )}
            </div>
          </div>

          {call.error && <div className="error-note" role="alert"><WifiOff size={17} /><span>{call.error}</span></div>}
        </section>

        <section className="bottom-grid">
          <div className="info-card">
            <div className="card-heading"><span className="card-icon violet"><Link2 size={19} /></span><div><h3>Пригласить собеседника</h3><p>Отправь ссылку второму участнику</p></div></div>
            <div className="share-row"><span className="link-text">{window.location.href}</span><button onClick={() => void copyLink()} className={`copy-button ${copied ? 'copied' : ''}`} aria-label="Копировать ссылку">{copied ? <Check size={16}/> : <Clipboard size={16}/>}<span>{copied ? 'Скопировано' : 'Копировать'}</span></button></div>
            <div className="helper"><span className="helper-bullet" /> Тот же адрес открой во втором окне или на другом устройстве.</div>
          </div>
          <div className="info-card">
            <div className="card-heading"><span className="card-icon blue"><AudioLines size={19} /></span><div><h3>Перед подключением</h3><p>Небольшая проверка оборудования</p></div></div>
            <div className="settings-line"><span><Camera size={16}/> Камера и микрофон</span><span className="setting-good"><CheckCircle2 size={15}/> Доступ при старте</span></div>
            <div className="settings-line"><span><LockKeyhole size={16}/> Режим звонка</span><span className="setting-value">1 на 1</span></div>
            <div className="settings-line last"><span><Headphones size={16}/> Наушники</span><span className="setting-value">Рекомендуются</span></div>
          </div>
        </section>

        <div className="name-bar">
          <span>Ваше отображаемое имя:</span>
          {editName ? (
            <form onSubmit={(event) => {event.preventDefault();const fixed=name.trim().slice(0,26) || 'Участник';setName(fixed);sessionStorage.setItem('oneroom-name',fixed);setEditName(false);}} className="name-form">
              <input autoFocus aria-label="Имя" value={name} onChange={e=>setName(e.target.value)} maxLength={26}/><button type="submit">Сохранить</button>
            </form>
          ) : <button className="name-edit" onClick={() => setEditName(true)}>{name} <span>Изменить</span></button>}
          <span className="name-detail">Имя видно только в этом окне. Сервер не требует регистрации.</span>
        </div>
      </main>
      <footer className="footer"><div><span className="footer-brand">one<span>room.</span></span><span>Простое пространство для важного разговора</span></div><div><span className="footer-secure"><ShieldCheck size={15}/> WebRTC Peer-to-Peer</span><span>© 2026 OneRoom</span></div></footer>
    </div>
  );
}

export default App;
