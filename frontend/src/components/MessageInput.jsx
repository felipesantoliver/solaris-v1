import React, { useRef, useEffect } from 'react';
import { Send, Loader2, Mic, Plus, AlertTriangle, Check } from 'lucide-react';
import { ModelToggle } from './ui/ModelToggle';

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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  return (
    <footer className="p-10 pt-4">
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
            uploadStatus.type === 'error' ? 'text-red-400' :
            uploadStatus.type === 'success' ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {uploadStatus.type === 'uploading' && <Loader2 size={12} className="animate-spin" />}
            {uploadStatus.type === 'success' && <Check size={12} />}
            {uploadStatus.type === 'error' && <AlertTriangle size={12} />}
            <span>{uploadStatus.message}</span>
          </div>
        )}
        <div className={`relative flex items-end border-b ${theme.inputBorder} pb-8 ${theme.inputFocus} transition-all duration-500`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="O que deseja perguntar?"
            className={`flex-1 bg-transparent border-none text-lg ${darkMode ? 'text-[#E8F0F9] placeholder-[#E8F0F9]/20' : 'text-[#0D1B2A] placeholder-[#1E3A5F]/30'} resize-none focus:outline-none py-2 font-light`}
          />
          <button
            onClick={onSend}
            disabled={isLoading || isStreaming || !input.trim()}
            className={`p-2 mb-3 transition-all ${
              (isLoading || isStreaming || !input.trim())
                ? theme.textMuted
                : 'text-[#F5A623] hover:scale-110 hover:text-[#F5A623]/80'
            }`}
          >
            {(isLoading || isStreaming) ? <Loader2 size={20} className="animate-spin" /> :
             input.trim() ? <Send size={20} strokeWidth={1.5} /> :
             <Mic size={20} strokeWidth={1.5} />}
          </button>
        </div>
        <div className={`mt-5 flex justify-between items-center text-[9px] ${theme.textMuted} font-bold tracking-[0.2em] uppercase`}>
          <span>enter para enviar · shift+enter nova linha</span>
          <div className="flex items-center gap-4">
            <span
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center gap-3 cursor-pointer ${darkMode ? 'hover:text-[#F5A623]' : 'hover:text-[#1E3A5F]'} transition-colors mb-2`}
            >
              <Plus size={10} /> Anexo
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}