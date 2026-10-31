FROM mcr.microsoft.com/playwright:v1.58.2
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir pytest==8.3.5 coverage==7.8.0
WORKDIR /opt/runner
RUN npm init -y && npm install --save-exact @playwright/test@1.58.2 c8@10.1.3
COPY runner/worker.py /opt/runner/worker.py
ENV PATH="/opt/venv/bin:${PATH}" NODE_PATH=/opt/runner/node_modules HOME=/tmp
WORKDIR /work
USER 1000:1000
ENTRYPOINT ["python", "/opt/runner/worker.py"]
