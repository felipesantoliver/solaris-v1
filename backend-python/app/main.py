import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from app.routers import voice, files, embeddings, search, memories, history, title, intent

load_dotenv()

app = FastAPI(title="Solaris Python Microservice", version="1.0.0")

# CORS
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
NODE_URL = os.getenv("NODE_URL", "http://localhost:3001")
origins = [FRONTEND_URL, NODE_URL]

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
app.include_router(history.router, prefix="/history", tags=["history"])
app.include_router(title.router, prefix="/title", tags=["title"])
app.include_router(intent.router, prefix="/intent", tags=["intent"])

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
        reload=False
    )