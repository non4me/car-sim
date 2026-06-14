# car-sim — self-contained image: FastAPI backend + static client + baked map tiles.
# Map bake is offline (tools/bake_city.py); the baked artifacts are committed and copied in.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PORT=8080 CITIES_DIR=/app/data/cities

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY data/cities/ ./data/cities/

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=5 \
  CMD python -c "import urllib.request,os,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/healthz').status==200 else 1)"

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
