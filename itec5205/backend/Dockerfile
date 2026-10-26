FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    nginx \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

# CPU-only PyTorch, in its own layer: the default Linux wheel pulls several GB
# of CUDA libraries (no GPU is used here) and the heavy install crashed Docker
# Desktop builds. Separate layer = editing requirements.txt doesn't redo it.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY nginx.conf /etc/nginx/conf.d/backend.conf
RUN chmod +x docker-entrypoint.sh

EXPOSE 5000

# The worker/flower services (same image) override this command entirely
# with their own `celery ...` command, bypassing nginx -- only the
# `backend` service (serving HTTP) uses this entrypoint.
CMD ["./docker-entrypoint.sh"]
