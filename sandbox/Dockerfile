FROM python:3.12-slim

WORKDIR /app

# Instala dependências leves (apenas o essencial para matemática e dados)
RUN pip install --no-cache-dir fastapi uvicorn numpy pandas

COPY ./app /app/app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]