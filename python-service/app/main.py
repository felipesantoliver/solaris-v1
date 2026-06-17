import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Importa os roteadores
from app.routers import voice, files, embeddings, search, memories

load_dotenv()

app = FastAPI(title="Solaris Python Microservice", version="1.0.0")

# Configuração CORS
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
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
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True
    )