# Build the web app, then serve it from the same FastAPI service that answers /api.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ ./api/
COPY data/ ./data/
COPY --from=web /web/dist ./web/dist
# Build the database at image build time: recipe and nutrition tables are static.
RUN python data/build_db.py
ENV PORT=8000
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
