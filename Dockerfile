# Backend image: Node API + the Python model service it shells out to.
#
# Both runtimes must live in one image because server.js spawns
# python/modelService.py per request. Build context is the REPO ROOT, not
# smartmandi_backend/, because modelService.py resolves the .pkl files at
# ../Model_for_Demand_Forecasting and ../Model_for_Dynamic_Pricing.

FROM node:22-slim

# libgomp1 is required by xgboost's native library.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first: they are the slowest layer and change least often.
COPY smartmandi_backend/python/requirements.txt ./python-requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r ./python-requirements.txt
ENV PYTHON_BIN=/opt/venv/bin/python3

# Node deps next.
COPY smartmandi_backend/package*.json ./smartmandi_backend/
RUN cd smartmandi_backend && npm ci --omit=dev

# Application code and the trained model artifacts.
COPY smartmandi_backend/ ./smartmandi_backend/
COPY Model_for_Demand_Forecasting/*.pkl  ./Model_for_Demand_Forecasting/
COPY Model_for_Demand_Forecasting/*.json ./Model_for_Demand_Forecasting/
COPY Model_for_Dynamic_Pricing/*.pkl     ./Model_for_Dynamic_Pricing/
COPY Model_for_Dynamic_Pricing/*.json    ./Model_for_Dynamic_Pricing/

# Seeding needs the source CSVs; drop this line if you seed from elsewhere.
COPY Dataset_CSV_Files/ ./Dataset_CSV_Files/

ENV NODE_ENV=production
# Render injects PORT; this is only the local default.
ENV PORT=5000
EXPOSE 5000

WORKDIR /app/smartmandi_backend
CMD ["node", "server.js"]
