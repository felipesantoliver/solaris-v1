import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, Loader2, Mic, MicOff, Plus, AlertTriangle, Check, Code } from 'lucide-react';
import { ModelToggle } from './ui/ModelToggle';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export function MessageInput({
  input,
  setInput,
  onSend,
  isLoading,
  isStreaming,
  darkMode,
  theme,
  model,
  setModel,
  authUser,
  programmingMode,
  setProgrammingMode,
  sendError,
  uploadStatus,
  onFileUpload,
  fileInputRef,
}) {
  const textareaRef = useRef(null);

  // ─── Estado de gravação de voz ─────────────────────────────────────────────
  const [isRecording, setIsRecording]       = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError]         = useState('');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
      e.preventDefault();
      onSend();
    }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, []);

  // ─── Inicia gravação ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setVoiceError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Escolhe o formato com melhor compatibilidade cross-browser
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find(t => MediaRecorder.isTypeSupported(t)) || '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = recorder;
      audioChunksRef.current   = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mimeType || 'audio/webm',
        });
        await transcribeAudio(audioBlob, mimeType);
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      setVoiceError('Permissão de microfone negada ou indisponível.');
    }
  }, []);

  // ─── Para gravação ─────────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  // ─── Envia áudio para o backend transcrever ────────────────────────────────
  const transcribeAudio = async (audioBlob, mimeType) => {
    setIsTranscribing(true);
    setVoiceError('');
    try {
      const ext = mimeType?.includes('ogg') ? 'ogg'
                : mimeType?.includes('mp4') ? 'mp4'
                : 'webm';

      const formData = new FormData();
      formData.append('audio', audioBlob, `recording.${ext}`);

      const userId = authUser?.id || localStorage.getItem('guestId') || '';

      const response = await fetch(`${API_BASE}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'x-user-id': userId },
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao transcrever.');
      }

      const { text } = await response.json();

      if (text) {
        setInput(prev => prev ? `${prev} ${text}` : text);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height =
              `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
          }
        }, 0);
      } else {
        setVoiceError('Nenhuma fala detectada. Tente novamente.');
      }
    } catch (err) {
      console.error('Erro na transcrição:', err);
      setVoiceError(err.message || 'Erro ao transcrever áudio.');
    } finally {
      setIsTranscribing(false);
    }
  };

  // ─── Toggle gravar / parar ─────────────────────────────────────────────────
  const handleVoiceButton = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  useEffect(() => {
    if (input) setVoiceError('');
  }, [input]);

  const isBusy = isLoading || isStreaming;

  return (
    <footer className="px-4 md:px-10 py-4 md:py-10 md:pt-4">
      <div className="max-w-3xl mx-auto">
        <ModelToggle
          model={model}
          onChange={setModel}
          authUser={authUser}
          darkMode={darkMode}
          programmingMode={programmingMode}
          onProgrammingModeChange={setProgrammingMode}
        />

        {sendError && (
          <p className="text-red-400 text-xs mb-3 flex items-center gap-1.5">
            <AlertTriangle size={12} />{sendError}
          </p>
        )}

        {uploadStatus && (
          <div className={`mb-3 text-xs flex items-center gap-2 ${
            uploadStatus.type === 'error'    ? 'text-red-400'     :
            uploadStatus.type === 'success'  ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {uploadStatus.type === 'uploading' && <Loader2 size={12} className="animate-spin" />}
            {uploadStatus.type === 'success'   && <Check size={12} />}
            {uploadStatus.type === 'error'     && <AlertTriangle size={12} />}
            <span>{uploadStatus.message}</span>
          </div>
        )}

        {voiceError && (
          <p className="text-red-400 text-xs mb-3 flex items-center gap-1.5">
            <AlertTriangle size={12} />{voiceError}
          </p>
        )}

        {isRecording && (
          <div className="mb-3 text-xs flex items-center gap-2 text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            Gravando... toque no microfone para parar
          </div>
        )}

        {isTranscribing && (
          <div className={`mb-3 text-xs flex items-center gap-2 ${theme.textMuted}`}>
            <Loader2 size={12} className="animate-spin" />
            Transcrevendo áudio...
          </div>
        )}

        <div className={`relative flex items-end border-b pb-6 md:pb-8 transition-all duration-500 ${theme.inputBorder} ${theme.inputFocus}`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={isRecording ? 'Gravando...' : 'O que deseja perguntar?'}
            disabled={isRecording || isTranscribing}
            className={`flex-1 bg-transparent border-none text-base md:text-lg ${
              darkMode ? 'text-white placeholder-white/20' : 'text-black placeholder-black/30'
            } resize-none focus:outline-none py-2 font-light disabled:opacity-50`}
          />

          <div className="flex items-center gap-1 mb-3">
            <button
              onClick={handleVoiceButton}
              disabled={isBusy || isTranscribing}
              title={isRecording ? 'Parar gravação' : 'Gravar voz'}
              className={`p-2 transition-all rounded-lg ${
                isRecording
                  ? 'text-red-400 hover:text-red-300 animate-pulse'
                  : isTranscribing
                    ? theme.textMuted
                    : isBusy
                      ? theme.textMuted
                      : darkMode
                        ? 'text-white/40 hover:text-white hover:bg-white/5'
                        : 'text-black/30 hover:text-black hover:bg-black/5'
              }`}
            >
              {isTranscribing
                ? <Loader2 size={18} className="animate-spin" />
                : isRecording
                  ? <MicOff size={18} strokeWidth={1.5} />
                  : <Mic size={18} strokeWidth={1.5} />
              }
            </button>

            <button
              onClick={onSend}
              disabled={isBusy || !input.trim() || isRecording || isTranscribing}
              className={`p-2 transition-all ${
                (isBusy || !input.trim() || isRecording || isTranscribing)
                  ? theme.textMuted
                  : darkMode
                    ? 'text-white hover:scale-110'
                    : 'text-black hover:scale-110'
              }`}
            >
              {isBusy
                ? <Loader2 size={20} className="animate-spin" />
                : <Send size={20} strokeWidth={1.5} />
              }
            </button>
          </div>
        </div>

        <div className={`mt-4 md:mt-5 flex justify-between items-center text-[9px] ${theme.textMuted} font-bold tracking-[0.2em] uppercase`}>
          <span className="hidden sm:inline">enter para enviar · shift+enter nova linha</span>
          <span className="sm:hidden" />
          <div className="flex items-center gap-4">
            {/* Botão Code — pill igual ao Flash/Pro */}
            <button
              onClick={() => setProgrammingMode(!programmingMode)}
              title={programmingMode ? 'Desativar modo code' : 'Ativar modo code'}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium uppercase tracking-widest transition-all duration-300 mb-2 ${
                programmingMode
                  ? 'border-blue-400/80 text-blue-400 bg-blue-400/10'
                  : darkMode
                    ? 'border-white/10 text-white/30 hover:text-blue-400/60 hover:border-blue-400/30'
                    : 'border-black/10 text-black/30 hover:text-blue-500/60 hover:border-blue-400/30'
              }`}
            >
              <Code size={10} />
              <span>Code</span>
              {programmingMode && (
                <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />
              )}
            </button>
            <span
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center gap-3 cursor-pointer ${darkMode ? 'hover:text-white' : 'hover:text-black'} transition-colors mb-2`}
            >
              <Plus size={10} /> Anexo
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}