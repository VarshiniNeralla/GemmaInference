FROM python:3.12-slim

WORKDIR /app

# Install system deps for Pillow / pillow-heif
RUN apt-get update && apt-get install -y --no-install-recommends \
    libffi-dev libjpeg62-turbo-dev libheif-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 9000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000", "--reload", "--reload-dir", "app"]
