import { useCallback, useEffect, useRef, useState } from 'react';

// The teacher's server simply forwards any WebSocket message to the other client.
// The hello / ready messages below are our own peer-discovery handshake.
const SIGNALING_URL = 'wss://inai-col3.fishrungames.com/signaling/';

export type CallPhase =
  | 'idle'
  | 'preparing'
  | 'server-connecting'
  | 'waiting'
  | 'negotiating'
  | 'connected'
  | 'disconnected'
  | 'error';

type SignalMessage = {
  type: 'hello' | 'ready' | 'offer' | 'answer' | 'candidate' | 'peer-left';
  from?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function getMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return 'Разреши браузеру доступ к камере и микрофону, затем попробуй снова.';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'Камера или микрофон не найдены. Проверь подключение устройств.';
    }
    if (error.name === 'NotReadableError') {
      return 'Камера или микрофон используются другой программой.';
    }
  }
  return error instanceof Error ? error.message : 'Не удалось начать звонок.';
}

export function useInterview() {
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [error, setError] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [secondsConnected, setSecondsConnected] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const remoteIdRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const offerForRef = useRef<string | null>(null);
  const helloTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const ownIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
  );

  const send = useCallback((message: SignalMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }, []);

  const clearHelloTimer = useCallback(() => {
    if (helloTimerRef.current) {
      clearInterval(helloTimerRef.current);
      helloTimerRef.current = null;
    }
  }, []);

  const resetPeer = useCallback(() => {
    const pc = peerRef.current;
    peerRef.current = null;
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    remoteIdRef.current = null;
    offerForRef.current = null;
    pendingCandidatesRef.current = [];
    remoteRef.current = null;
    setRemoteStream(null);
    setSecondsConnected(0);
  }, []);

  const stopLocal = useCallback(() => {
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;
    setLocalStream(null);
    setCameraOn(true);
    setMicOn(true);
  }, []);

  const disconnect = useCallback(() => {
    generationRef.current += 1; // invalidates an in-flight getUserMedia request
    clearHelloTimer();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    resetPeer();
    stopLocal();
  }, [clearHelloTimer, resetPeer, stopLocal]);

  const leave = useCallback(() => {
    disconnect();
    setError('');
    setPhase('idle');
  }, [disconnect]);

  const createPeer = useCallback((): RTCPeerConnection => {
    if (peerRef.current) return peerRef.current;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerRef.current = pc;
    const stream = localRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate || peerRef.current !== pc) return;
      send({ type: 'candidate', from: ownIdRef.current, candidate: event.candidate.toJSON() });
    };

    pc.ontrack = (event) => {
      if (peerRef.current !== pc) return;
      const incoming = event.streams[0] ?? remoteRef.current ?? new MediaStream();
      if (!event.streams[0] && !incoming.getTracks().some((t) => t.id === event.track.id)) {
        incoming.addTrack(event.track);
      }
      remoteRef.current = incoming;
      setRemoteStream(incoming);
    };

    pc.onconnectionstatechange = () => {
      if (peerRef.current !== pc) return;
      switch (pc.connectionState) {
        case 'connected':
          setPhase('connected');
          setError('');
          break;
        case 'connecting':
          setPhase('negotiating');
          break;
        case 'disconnected':
          setPhase('negotiating');
          break;
        case 'failed':
          setPhase('error');
          setError('Не удалось установить прямое соединение. Попробуйте переподключиться или другую сеть.');
          break;
        default:
          break;
      }
    };
    return pc;
  }, [send]);

  const flushCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const candidates = pendingCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (cause) {
        console.warn('Не удалось добавить ICE-кандидат:', cause);
      }
    }
  }, []);

  const makeOffer = useCallback(async () => {
    const remoteId = remoteIdRef.current;
    if (!remoteId || ownIdRef.current >= remoteId || offerForRef.current === remoteId) return;
    offerForRef.current = remoteId;
    try {
      const pc = createPeer();
      if (pc.signalingState !== 'stable') return;
      setPhase('negotiating');
      const offer = await pc.createOffer();
      if (peerRef.current !== pc || remoteIdRef.current !== remoteId) return;
      await pc.setLocalDescription(offer);
      send({ type: 'offer', from: ownIdRef.current, sdp: pc.localDescription ?? offer });
    } catch (cause) {
      offerForRef.current = null;
      setPhase('error');
      setError(getMediaError(cause));
    }
  }, [createPeer, send]);

  const receive = useCallback(async (message: SignalMessage) => {
    if (!message || typeof message.type !== 'string' || message.from === ownIdRef.current) return;

    if (message.type === 'peer-left') {
      resetPeer();
      setError('Собеседник отключился. Ожидаем следующего участника.');
      setPhase('waiting');
      send({ type: 'hello', from: ownIdRef.current });
      return;
    }

    if (message.type === 'hello' || message.type === 'ready') {
      if (!message.from) return;
      if (remoteIdRef.current && remoteIdRef.current !== message.from) resetPeer();
      remoteIdRef.current = message.from;
      if (message.type === 'hello') send({ type: 'ready', from: ownIdRef.current });
      await makeOffer();
      return;
    }

    if (message.type === 'offer') {
      if (!message.sdp || message.sdp.type !== 'offer' || !message.from) return;
      if (remoteIdRef.current && remoteIdRef.current !== message.from) resetPeer();
      remoteIdRef.current = message.from;
      const pc = createPeer();
      if (pc.signalingState === 'have-local-offer') {
        // A rare collision. Roll back only for the higher client ID.
        if (ownIdRef.current < message.from) return;
        await pc.setLocalDescription({ type: 'rollback' });
        offerForRef.current = null;
      }
      setPhase('negotiating');
      await pc.setRemoteDescription(message.sdp);
      await flushCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: 'answer', from: ownIdRef.current, sdp: pc.localDescription ?? answer });
      return;
    }

    if (message.type === 'answer') {
      if (!message.sdp || message.sdp.type !== 'answer') return;
      if (message.from && remoteIdRef.current && message.from !== remoteIdRef.current) return;
      const pc = peerRef.current;
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription(message.sdp);
      await flushCandidates(pc);
      return;
    }

    if (message.type === 'candidate' && message.candidate) {
      if (message.from && remoteIdRef.current && message.from !== remoteIdRef.current) return;
      const pc = peerRef.current;
      if (!pc?.remoteDescription) {
        pendingCandidatesRef.current.push(message.candidate);
      } else {
        await pc.addIceCandidate(message.candidate);
      }
    }
  }, [createPeer, flushCandidates, makeOffer, resetPeer, send]);

  const join = useCallback(async () => {
    if (phase === 'preparing' || phase === 'server-connecting' || phase === 'negotiating' || phase === 'connected' || phase === 'waiting') return;
    disconnect();
    const current = generationRef.current;
    setPhase('preparing');
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('error');
      setError('Видеозвонок доступен только на HTTPS или localhost в поддерживаемом браузере.');
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (generationRef.current !== current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      localRef.current = media;
      setLocalStream(media);
      setCameraOn(true);
      setMicOn(true);
      setPhase('server-connecting');

      const socket = new WebSocket(SIGNALING_URL);
      socketRef.current = socket;
      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        setPhase('waiting');
        setError('');
        send({ type: 'hello', from: ownIdRef.current });
        // No presence event exists in the supplied server protocol, so retry
        // discovery while alone. The other client replies with 'ready'.
        helloTimerRef.current = setInterval(() => {
          if (!remoteIdRef.current) send({ type: 'hello', from: ownIdRef.current });
        }, 3000);
      };
      socket.onmessage = (event: MessageEvent) => {
        if (socketRef.current !== socket) return;
        try {
          const parsed: SignalMessage = JSON.parse(String(event.data));
          void receive(parsed).catch((cause) => {
            console.error('Ошибка обработки сигнализации:', cause);
            setError('Ошибка WebRTC-соединения. Попробуй завершить звонок и войти снова.');
            setPhase('error');
          });
        } catch (cause) {
          console.warn('Неверный формат сообщения сигнализации:', cause);
        }
      };
      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setError('Не удалось связаться с signaling-сервером. Проверь подключение к интернету.');
      };
      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        clearHelloTimer();
        socketRef.current = null;
        resetPeer();
        stopLocal();
        setPhase('disconnected');
        setError('Сервер закрыл соединение. Возможно, подключился третий участник (сервер допускает только двоих).');
      };
    } catch (cause) {
      if (generationRef.current !== current) return;
      stopLocal();
      setError(getMediaError(cause));
      setPhase('error');
    }
  }, [clearHelloTimer, disconnect, phase, receive, resetPeer, send, stopLocal]);

  const toggleMic = useCallback(() => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((track) => { track.enabled = enabled; });
    setMicOn(enabled);
  }, []);

  const toggleCamera = useCallback(() => {
    const tracks = localRef.current?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach((track) => { track.enabled = enabled; });
    setCameraOn(enabled);
  }, []);

  useEffect(() => {
    if (phase !== 'connected') {
      setSecondsConnected(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setSecondsConnected(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => () => {
    clearHelloTimer();
    socketRef.current?.close();
    peerRef.current?.close();
    localRef.current?.getTracks().forEach((track) => track.stop());
  }, [clearHelloTimer]);

  return {
    phase, error, localStream, remoteStream, cameraOn, micOn, secondsConnected,
    join, leave, toggleMic, toggleCamera,
    inRoom: Boolean(localStream),
    signalingUrl: SIGNALING_URL,
  };
}
