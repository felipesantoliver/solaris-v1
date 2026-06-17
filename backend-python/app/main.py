import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Importa os roteadores
from app.routers import voice, files, embeddings, search, memories

load_dotenv()

app = FastAPI(title="Solaris Python Microservice", version="1.0.0")

# ─── CORS ─────────────────────────────────────────────────────────────
# 🔥 Permitir origens: frontend (Vercel) e também o Node (Render)
#    (embora o Node não precise de CORS, não faz mal)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
NODE_URL = os.getenv("NODE_URL", "http://localhost:3001")  # opcional, mas incluímos
origins = [
    FRONTEND_URL,
    NODE_URL,
    # Se quiser, pode adicionar também o domínio do Render do Node
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registra as rotas
app.include_router(voice.router, prefix="/voice", tags=["voice"])
app.include_router(files.router, prefix="/files", tags=["files"])
app.include_router(embeddings.router, prefix="/embeddings", tags=["embeddings"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(memories.router, prefix="/memories", tags=["memories"])

@app.get("/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=False   # em produção, não use reload
    )