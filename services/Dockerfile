# The OCR service: one image, run as the API or as the worker.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    DATA_DIR=/data \
    PADDLE_PDX_CACHE_HOME=/models \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True

# OpenCV, which PaddleOCR uses, needs these.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# CPU by default. For a GPU worker, see docker-compose.gpu.yml.
ARG PADDLE_PACKAGE=paddlepaddle==3.3.1
ARG PADDLE_INDEX=""
RUN grep -v '^paddlepaddle==' requirements.txt > /tmp/requirements.txt \
 && pip install --no-cache-dir ${PADDLE_INDEX:+--extra-index-url $PADDLE_INDEX} "$PADDLE_PACKAGE" \
 && pip install --no-cache-dir -r /tmp/requirements.txt

COPY invoice_service ./invoice_service

RUN useradd --uid 10001 --no-create-home app \
 && mkdir -p /data /models \
 && chown app:app /data /models
USER app

EXPOSE 8000
# Only Caddy can reach this port (see docker-compose.yml), so its forwarded headers are trusted.
CMD ["uvicorn", "invoice_service.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
